/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { IsNull, Repository } from 'typeorm'
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectCommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { TypedConfigService } from '../../config/typed-config.service'
import { FileObject } from '../entities/file-object.entity'
import { FileOrigin } from '../entities/file-origin.enum'
import { DeleteFileResponseDto, FileDto, ListFilesQueryDto, ListFilesResponseDto } from '../dto/file.dto'
import { createHash } from 'node:crypto'
import { nanoid } from 'nanoid'
import { Readable } from 'node:stream'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200
const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024

export interface UploadedBinaryFile {
  buffer: Buffer
  size: number
  originalname?: string
  mimetype?: string
}

@Injectable()
export class FilesService {
  private s3Client: S3Client | null = null

  constructor(
    @InjectRepository(FileObject)
    private readonly fileObjectRepository: Repository<FileObject>,
    private readonly configService: TypedConfigService,
  ) {}

  async upload(organizationId: string, file?: UploadedBinaryFile): Promise<FileDto> {
    if (!file || !file.buffer || file.size === 0) {
      throw new BadRequestException('Missing file')
    }

    const maxFileSize = this.getMaxFileSizeBytes()
    if (file.size > maxFileSize) {
      throw new BadRequestException(`File is too large (max ${maxFileSize} bytes)`)
    }

    const bucket = this.configService.getOrThrow('s3.defaultBucket')
    const id = this.generateFileId()
    const storageKey = this.getStorageKey(organizationId, id, file.originalname || 'upload.bin')
    const checksumSha256 = createHash('sha256').update(file.buffer).digest('hex')

    await this.uploadWithAutoBucketCreation(bucket, storageKey, file)

    const entity = this.fileObjectRepository.create({
      id,
      organizationId,
      filename: file.originalname || 'upload.bin',
      mimeType: file.mimetype || 'application/octet-stream',
      sizeBytes: file.size,
      storageBucket: bucket,
      storageKey,
      checksumSha256,
      origin: FileOrigin.USER_UPLOAD,
    })

    const saved = await this.fileObjectRepository.save(entity)
    return this.toFileDto(saved)
  }

  async list(organizationId: string, query: ListFilesQueryDto): Promise<ListFilesResponseDto> {
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

    const qb = this.fileObjectRepository
      .createQueryBuilder('file')
      .where('file.organization_id = :organizationId', { organizationId })
      .andWhere('file.deleted_at IS NULL')

    if (query.before_id) {
      const before = await this.findByIdOrThrow(organizationId, query.before_id)
      qb.andWhere(
        '(file.created_at < :beforeCreatedAt OR (file.created_at = :beforeCreatedAt AND file.id < :beforeId))',
        {
          beforeCreatedAt: before.createdAt,
          beforeId: before.id,
        },
      )
    }

    if (query.after_id) {
      const after = await this.findByIdOrThrow(organizationId, query.after_id)
      qb.andWhere('(file.created_at > :afterCreatedAt OR (file.created_at = :afterCreatedAt AND file.id > :afterId))', {
        afterCreatedAt: after.createdAt,
        afterId: after.id,
      })
    }

    const rows = await qb
      .orderBy('file.created_at', 'DESC')
      .addOrderBy('file.id', 'DESC')
      .take(limit + 1)
      .getMany()

    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map((row) => this.toFileDto(row))

    return {
      data: items,
      has_more: hasMore,
      first_id: items[0]?.id,
      last_id: items[items.length - 1]?.id,
    }
  }

  async getMetadata(organizationId: string, fileId: string): Promise<FileDto> {
    const file = await this.findByIdOrThrow(organizationId, fileId)
    return this.toFileDto(file)
  }

  async getContent(organizationId: string, fileId: string): Promise<{ metadata: FileDto; content: Buffer }> {
    const file = await this.findByIdOrThrow(organizationId, fileId)

    const content = await this.getS3Client().send(
      new GetObjectCommand({
        Bucket: file.storageBucket,
        Key: file.storageKey,
      }),
    )

    return { metadata: this.toFileDto(file), content: await this.toBuffer(content) }
  }

  async delete(organizationId: string, fileId: string): Promise<DeleteFileResponseDto> {
    const file = await this.findByIdOrThrow(organizationId, fileId)

    await this.getS3Client().send(
      new DeleteObjectCommand({
        Bucket: file.storageBucket,
        Key: file.storageKey,
      }),
    )

    file.deletedAt = new Date()
    await this.fileObjectRepository.save(file)

    return {
      id: file.id,
      type: 'file_deleted',
    }
  }

  private async findByIdOrThrow(organizationId: string, fileId: string): Promise<FileObject> {
    const file = await this.fileObjectRepository.findOne({
      where: {
        id: fileId,
        organizationId,
        deletedAt: IsNull(),
      },
    })

    if (!file) {
      throw new NotFoundException('File not found')
    }

    return file
  }

  private toFileDto(file: FileObject): FileDto {
    return {
      id: file.id,
      type: 'file',
      filename: file.filename,
      mime_type: file.mimeType,
      size_bytes: Number(file.sizeBytes),
      created_at: file.createdAt.toISOString(),
    }
  }

  private generateFileId(): string {
    return `file_${nanoid(20)}`
  }

  private getStorageKey(organizationId: string, fileId: string, fileName: string): string {
    const now = new Date()
    const yyyy = String(now.getUTCFullYear())
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const dd = String(now.getUTCDate()).padStart(2, '0')
    const escapedName = encodeURIComponent(fileName)

    return `files/${organizationId}/${yyyy}/${mm}/${dd}/${fileId}/${escapedName}`
  }

  private getMaxFileSizeBytes(): number {
    const configured = process.env.AGENT_RUNTIME_MAX_FILE_SIZE_BYTES
    if (!configured) {
      return DEFAULT_MAX_FILE_SIZE_BYTES
    }

    const parsed = Number(configured)
    if (Number.isNaN(parsed) || parsed <= 0) {
      return DEFAULT_MAX_FILE_SIZE_BYTES
    }

    return parsed
  }

  private async toBuffer(output: GetObjectCommandOutput): Promise<Buffer> {
    if (!output.Body) {
      return Buffer.alloc(0)
    }

    if (typeof output.Body.transformToByteArray === 'function') {
      const byteArray = await output.Body.transformToByteArray()
      return Buffer.from(byteArray)
    }

    if (output.Body instanceof Readable) {
      const chunks: Buffer[] = []
      for await (const chunk of output.Body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      }
      return Buffer.concat(chunks)
    }

    return Buffer.from([])
  }

  private getS3Client(): S3Client {
    if (this.s3Client) {
      return this.s3Client
    }

    const endpoint = this.configService.get('s3.endpoint')
    const region = this.configService.get('s3.region')
    const accessKey = this.configService.get('s3.accessKey')
    const secretKey = this.configService.get('s3.secretKey')

    if (!endpoint || !region || !accessKey || !secretKey) {
      throw new ServiceUnavailableException('Object storage is not configured')
    }

    this.s3Client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
    })

    return this.s3Client
  }

  private async uploadWithAutoBucketCreation(
    bucket: string,
    storageKey: string,
    file: UploadedBinaryFile,
  ): Promise<void> {
    const putObjectCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Body: file.buffer,
      ContentType: file.mimetype || 'application/octet-stream',
    })

    try {
      await this.getS3Client().send(putObjectCommand)
      return
    } catch (error) {
      if (!this.isNoSuchBucketError(error)) {
        throw error
      }
    }

    await this.ensureBucketExists(bucket)
    await this.getS3Client().send(putObjectCommand)
  }

  private async ensureBucketExists(bucket: string): Promise<void> {
    try {
      await this.getS3Client().send(new CreateBucketCommand({ Bucket: bucket }))
    } catch (error) {
      if (this.isBucketAlreadyExistsError(error)) {
        return
      }
      throw error
    }
  }

  private isNoSuchBucketError(error: unknown): boolean {
    const maybeError = error as { name?: string; Code?: string; code?: string; $metadata?: { httpStatusCode?: number } }
    return (
      maybeError?.name === 'NoSuchBucket' ||
      maybeError?.Code === 'NoSuchBucket' ||
      maybeError?.code === 'NoSuchBucket' ||
      maybeError?.$metadata?.httpStatusCode === 404
    )
  }

  private isBucketAlreadyExistsError(error: unknown): boolean {
    const maybeError = error as { name?: string; Code?: string; code?: string }
    return (
      maybeError?.name === 'BucketAlreadyOwnedByYou' ||
      maybeError?.name === 'BucketAlreadyExists' ||
      maybeError?.Code === 'BucketAlreadyOwnedByYou' ||
      maybeError?.Code === 'BucketAlreadyExists' ||
      maybeError?.code === 'BucketAlreadyOwnedByYou' ||
      maybeError?.code === 'BucketAlreadyExists'
    )
  }
}

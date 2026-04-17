/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { AuthStrategy } from '../../auth/decorators/auth-strategy.decorator'
import { AuthStrategyType } from '../../auth/enums/auth-strategy-type.enum'
import { IsOrganizationAuthContext } from '../../common/decorators/auth-context.decorator'
import { OrganizationAuthContext } from '../../common/interfaces/organization-auth-context.interface'
import { AuthenticatedRateLimitGuard } from '../../common/guards/authenticated-rate-limit.guard'
import { OrganizationAuthContextGuard } from '../../organization/guards/organization-auth-context.guard'
import { FilesService, UploadedBinaryFile } from '../services/files.service'
import { DeleteFileResponseDto, FileDto, ListFilesQueryDto, ListFilesResponseDto } from '../dto/file.dto'
import { FileInterceptor } from '@nestjs/platform-express'
import { Response } from 'express'

@Controller('files')
@ApiTags('files')
@ApiOAuth2(['openid', 'profile', 'email'])
@ApiBearerAuth()
@AuthStrategy([AuthStrategyType.API_KEY, AuthStrategyType.JWT])
@UseGuards(AuthenticatedRateLimitGuard)
@UseGuards(OrganizationAuthContextGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Post()
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Upload file',
    operationId: 'uploadFile',
  })
  @ApiResponse({ status: 200, type: FileDto })
  async upload(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @UploadedFile() file?: UploadedBinaryFile,
  ): Promise<FileDto> {
    return this.filesService.upload(authContext.organizationId, file)
  }

  @Get()
  @ApiOperation({
    summary: 'List files for organization',
    operationId: 'listFiles',
  })
  @ApiResponse({ status: 200, type: ListFilesResponseDto })
  async list(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Query() query: ListFilesQueryDto,
  ): Promise<ListFilesResponseDto> {
    return this.filesService.list(authContext.organizationId, query)
  }

  @Get(':fileId')
  @ApiOperation({
    summary: 'Get file metadata',
    operationId: 'getFile',
  })
  @ApiResponse({ status: 200, type: FileDto })
  async getMetadata(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('fileId') fileId: string,
  ): Promise<FileDto> {
    return this.filesService.getMetadata(authContext.organizationId, fileId)
  }

  @Get(':fileId/content')
  @ApiOperation({
    summary: 'Download file content',
    operationId: 'downloadFile',
  })
  @ApiResponse({ status: 200 })
  async download(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('fileId') fileId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { metadata, content } = await this.filesService.getContent(authContext.organizationId, fileId)

    const safeFileName = encodeURIComponent(metadata.filename)
    res.setHeader('Content-Type', metadata.mime_type || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFileName}`)

    return new StreamableFile(content)
  }

  @Delete(':fileId')
  @ApiOperation({
    summary: 'Delete file',
    operationId: 'deleteFile',
  })
  @ApiResponse({ status: 200, type: DeleteFileResponseDto })
  async delete(
    @IsOrganizationAuthContext() authContext: OrganizationAuthContext,
    @Param('fileId') fileId: string,
  ): Promise<DeleteFileResponseDto> {
    return this.filesService.delete(authContext.organizationId, fileId)
  }
}

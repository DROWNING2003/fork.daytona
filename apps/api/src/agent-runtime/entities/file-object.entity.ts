/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'
import { FileOrigin } from './file-origin.enum'

@Entity('file_object')
@Index('idx_file_object_org_created_at', ['organizationId', 'createdAt'])
@Index('idx_file_object_org_id', ['organizationId', 'id'])
export class FileObject {
  @PrimaryColumn({ type: 'varchar', name: 'id' })
  id: string

  @Column({ type: 'uuid', name: 'organization_id' })
  organizationId: string

  @Column({ type: 'varchar', name: 'filename' })
  filename: string

  @Column({ type: 'varchar', nullable: true, name: 'mime_type' })
  mimeType?: string

  @Column({ type: 'bigint', name: 'size_bytes' })
  sizeBytes: number

  @Column({ type: 'varchar', name: 'storage_bucket' })
  storageBucket: string

  @Column({ type: 'varchar', name: 'storage_key' })
  storageKey: string

  @Column({ type: 'varchar', nullable: true, name: 'checksum_sha256' })
  checksumSha256?: string

  @Column({ type: 'varchar', default: FileOrigin.USER_UPLOAD, name: 'origin' })
  origin: FileOrigin

  @CreateDateColumn({ type: 'timestamp with time zone', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamp with time zone', name: 'updated_at' })
  updatedAt: Date

  @DeleteDateColumn({ type: 'timestamp with time zone', nullable: true, name: 'deleted_at' })
  deletedAt?: Date
}

/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsOptional, IsString, Max, Min } from 'class-validator'

export class FileDto {
  @ApiProperty({ example: 'file_abc123' })
  id: string

  @ApiProperty({ example: 'file' })
  type: 'file'

  @ApiProperty({ example: 'input.csv' })
  filename: string

  @ApiPropertyOptional({ example: 'text/csv' })
  mime_type?: string

  @ApiProperty({ example: 12345 })
  size_bytes: number

  @ApiProperty({ example: '2026-04-16T12:00:00Z' })
  created_at: string
}

export class ListFilesQueryDto {
  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 200 })
  @IsOptional()
  @Min(1)
  @Max(200)
  limit?: number

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  before_id?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  after_id?: string
}

export class ListFilesResponseDto {
  @ApiProperty({ type: [FileDto] })
  data: FileDto[]

  @ApiProperty({ example: false })
  has_more: boolean

  @ApiPropertyOptional({ example: 'file_abc123' })
  first_id?: string

  @ApiPropertyOptional({ example: 'file_abc123' })
  last_id?: string
}

export class DeleteFileResponseDto {
  @ApiProperty({ example: 'file_abc123' })
  id: string

  @ApiProperty({ example: 'file_deleted' })
  type: 'file_deleted'
}

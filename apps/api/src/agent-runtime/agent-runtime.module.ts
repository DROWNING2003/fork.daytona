/*
 * Copyright 2025 Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ConfigModule } from '@nestjs/config'
import { OrganizationModule } from '../organization/organization.module'
import { Sandbox } from '../sandbox/entities/sandbox.entity'
import { FileObject } from './entities/file-object.entity'
import { FilesService } from './services/files.service'
import { FilesController } from './controllers/files.controller'

@Module({
  imports: [ConfigModule, OrganizationModule, TypeOrmModule.forFeature([FileObject, Sandbox])],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class AgentRuntimeModule {}

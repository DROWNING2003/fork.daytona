/*
 * Copyright Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { MigrationInterface, QueryRunner } from 'typeorm'

export class Migration1777000000002 implements MigrationInterface {
  name = 'Migration1777000000002'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sandbox" ADD COLUMN IF NOT EXISTS "fileMounts" jsonb NOT NULL DEFAULT '[]'`)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_sandbox_file_mounts_gin"
      ON "sandbox"
      USING GIN ("fileMounts" jsonb_path_ops)
      WHERE "desiredState" <> 'destroyed';
    `)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_sandbox_file_mounts_gin"`)
    await queryRunner.query(`ALTER TABLE "sandbox" DROP COLUMN IF EXISTS "fileMounts"`)
  }
}

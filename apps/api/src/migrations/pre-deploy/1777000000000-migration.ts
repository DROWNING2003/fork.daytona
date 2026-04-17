/*
 * Copyright Daytona Platforms Inc.
 * SPDX-License-Identifier: AGPL-3.0
 */

import { MigrationInterface, QueryRunner } from 'typeorm'

export class Migration1777000000000 implements MigrationInterface {
  name = 'Migration1777000000000'

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "file_object" (
        "id" character varying NOT NULL,
        "organization_id" uuid NOT NULL,
        "filename" character varying NOT NULL,
        "mime_type" character varying,
        "size_bytes" bigint NOT NULL,
        "storage_bucket" character varying NOT NULL,
        "storage_key" character varying NOT NULL,
        "checksum_sha256" character varying,
        "downloadable" boolean NOT NULL DEFAULT false,
        "origin" character varying NOT NULL DEFAULT 'user_upload',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "file_object_id_pk" PRIMARY KEY ("id")
      )
    `)

    await queryRunner.query(
      `CREATE INDEX "idx_file_object_org_created_at" ON "file_object" ("organization_id", "created_at")`,
    )
    await queryRunner.query(`CREATE INDEX "idx_file_object_org_id" ON "file_object" ("organization_id", "id")`)
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_file_object_org_id"`)
    await queryRunner.query(`DROP INDEX "public"."idx_file_object_org_created_at"`)
    await queryRunner.query(`DROP TABLE "file_object"`)
  }
}

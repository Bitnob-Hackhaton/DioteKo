import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Increment 4 — Bitnob on-chain withdrawals + bulk transfers.
 *
 * Three NEW tables, all additive (no change to any existing table — verified
 * with a follow-up `migration:generate` that produced an empty diff):
 *
 *  - `bitnob_withdrawals` — one row per on-chain stablecoin withdrawal.
 *    `reference` (`dkwd_<id>`) is Bitnob's only idempotency key; the partial
 *    unique index `UQ_bitnob_withdrawals_reference` (WHERE reference IS NOT
 *    NULL) mirrors `UQ_bitnob_payouts_reference` — the row exists briefly at
 *    `status='pending'` with a null `reference` before the Bitnob call.
 *    `organization_id` FK is `ON DELETE RESTRICT` (a money row must not
 *    orphan) even though the raw admin path leaves it null. NO
 *    `subject_did_id` — DID<->address is a permanent public correlation.
 *
 *  - `bitnob_bulk_batches` — one row per bulk-transfer batch.
 *    `idempotency_key` is the caller-supplied dedup key; the partial unique
 *    index `UQ_bitnob_bulk_batches_idempotency_key` (WHERE idempotency_key IS
 *    NOT NULL) enforces at-most-once for the keys that are set. Same
 *    `ON DELETE RESTRICT` org FK.
 *
 *  - `bitnob_bulk_batch_items` — one row per line item.
 *    `FK_bitnob_bulk_batch_items_batch` is `ON DELETE RESTRICT`, matching
 *    every other money-adjacent FK in the schema (`bitnob_payouts.*`,
 *    `bitnob_trades.*`, `admin_certificates_refs.*`). A batch item is a
 *    money-movement record with independent forensic value (`amount`,
 *    `address`, `withdrawal_id` — the pointer to Bitnob's authoritative
 *    per-item record), so it must not be silently wiped by a
 *    `DELETE FROM bitnob_bulk_batches`. The app has no batch-delete path.
 *    `IDX_bitnob_bulk_batch_items_batch_id` backs the frequent "items of
 *    this batch" lookup.
 *
 * All money columns are `numeric` (base-unit integer strings on the entity).
 *
 * `down()` is a clean reverse: drop the FKs, then the item table, then the
 * batch table, then the withdrawal table (FK dependency order). No data is
 * migrated in either direction — these tables are brand new.
 *
 * (Migration-reviewer follow-up 2026-08-30: the item->batch FK was changed
 * from `ON DELETE CASCADE` to `ON DELETE RESTRICT` before Increment 4 was
 * signed off — it is the only money-adjacent FK that wasn't RESTRICT/SET
 * NULL, and nothing depends on CASCADE.)
 */
export class AddBitnobWithdrawalsAndBulkTables1788057330245 implements MigrationInterface {
  name = 'AddBitnobWithdrawalsAndBulkTables1788057330245';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bitnob_withdrawals" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid, "reference" character varying, "transaction_id" character varying, "to_address" character varying NOT NULL, "chain" character varying NOT NULL, "currency" character varying NOT NULL, "amount" numeric NOT NULL, "status" character varying NOT NULL DEFAULT 'pending', "description" character varying, "raw_result" jsonb, CONSTRAINT "PK_0f045408639aed1bd8e8c43bd88" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bitnob_withdrawals_reference" ON "bitnob_withdrawals" ("reference") WHERE "reference" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "bitnob_bulk_batches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "organization_id" uuid, "idempotency_key" character varying, "bitnob_batch_id" character varying, "description" character varying, "status" character varying NOT NULL DEFAULT 'draft', "total_items" integer, "total_amount" numeric, "success_count" integer, "failed_count" integer, "submitted_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "raw_result" jsonb, CONSTRAINT "PK_9a2672c979f4a8e6a3b76b45a9b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bitnob_bulk_batches_idempotency_key" ON "bitnob_bulk_batches" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "bitnob_bulk_batch_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "batch_id" uuid NOT NULL, "bitnob_item_id" character varying, "row_index" integer, "chain" character varying NOT NULL, "currency" character varying NOT NULL, "address" character varying NOT NULL, "amount" numeric NOT NULL, "description" character varying, "status" character varying NOT NULL DEFAULT 'pending', "failure_reason" character varying, "retries" integer NOT NULL DEFAULT '0', "withdrawal_id" character varying, "raw_result" jsonb, CONSTRAINT "PK_bace8e0f0db198122a9bdad7319" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bitnob_bulk_batch_items_batch_id" ON "bitnob_bulk_batch_items" ("batch_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "bitnob_withdrawals" ADD CONSTRAINT "FK_fb3b23107d91adcdea5d00468df" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bitnob_bulk_batches" ADD CONSTRAINT "FK_62a34446e924512cca2d747d5e4" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "bitnob_bulk_batch_items" ADD CONSTRAINT "FK_bitnob_bulk_batch_items_batch" FOREIGN KEY ("batch_id") REFERENCES "bitnob_bulk_batches"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bitnob_bulk_batch_items" DROP CONSTRAINT "FK_bitnob_bulk_batch_items_batch"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bitnob_bulk_batches" DROP CONSTRAINT "FK_62a34446e924512cca2d747d5e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bitnob_withdrawals" DROP CONSTRAINT "FK_fb3b23107d91adcdea5d00468df"`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_bitnob_bulk_batch_items_batch_id"`);
    await queryRunner.query(`DROP TABLE "bitnob_bulk_batch_items"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_bitnob_bulk_batches_idempotency_key"`);
    await queryRunner.query(`DROP TABLE "bitnob_bulk_batches"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_bitnob_withdrawals_reference"`);
    await queryRunner.query(`DROP TABLE "bitnob_withdrawals"`);
  }
}

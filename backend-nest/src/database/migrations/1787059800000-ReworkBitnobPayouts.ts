import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Increment 3 — rework the `bitnob_payouts` table for the 3-step Bitnob
 * payout flow (quote -> initialize -> finalize) with a deterministic
 * idempotency key and a certificate link.
 *
 * The pre-existing rows were written by the removed
 * `BitnobService.executePayout` against an UNVERIFIED endpoint contract
 * (`/api/v1/payouts...`, guessed field shapes) and never represented a real
 * disbursement — they are truncated rather than migrated.
 *
 * Schema changes:
 *  - add `reference` (idempotency key: `dkpayout_<row id>`), `source`,
 *    `admin_certificate_ref_id` (FK -> `admin_certificates_refs`,
 *    ON DELETE RESTRICT — a money row must NOT silently orphan from its
 *    certificate), `raw_quote`, `raw_result` (jsonb);
 *  - `bitnob_payout_id`, `amount`, `organization_id` -> nullable (only known
 *    after the Bitnob round-trip / not set for the raw admin path);
 *  - `status` default `'processing'` -> `'quote'` (row is inserted before
 *    any Bitnob call);
 *  - partial unique index `UQ_bitnob_payouts_active_cert` — at most one
 *    payout per certificate that is still recoverable (`status NOT IN
 *    ('failed','expired')`); an expired quote can be re-quoted;
 *  - partial unique index `UQ_bitnob_payouts_reference` — `reference` is
 *    Bitnob's only idempotency key, so it must be globally unique.
 *
 * Both `up()` and `down()` discard all `bitnob_payouts` rows by design:
 * `up()` TRUNCATEs (old junk), `down()` DELETEs first so the restored
 * NOT NULL constraints can't fail on a `status='quote'` row.
 */
export class ReworkBitnobPayouts1787059800000 implements MigrationInterface {
  name = 'ReworkBitnobPayouts1787059800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`TRUNCATE TABLE "bitnob_payouts"`);

    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ADD "reference" character varying`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ADD "source" character varying`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ADD "admin_certificate_ref_id" uuid`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ADD "raw_quote" jsonb`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ADD "raw_result" jsonb`);

    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ALTER COLUMN "bitnob_payout_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ALTER COLUMN "amount" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ALTER COLUMN "organization_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ALTER COLUMN "status" SET DEFAULT 'quote'`);

    await queryRunner.query(
      `ALTER TABLE "bitnob_payouts" ADD CONSTRAINT "FK_bitnob_payouts_admin_certificate_ref" ` +
        `FOREIGN KEY ("admin_certificate_ref_id") REFERENCES "admin_certificates_refs"("id") ` +
        `ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bitnob_payouts_active_cert" ON "bitnob_payouts" ("admin_certificate_ref_id") ` +
        `WHERE "status" NOT IN ('failed', 'expired')`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bitnob_payouts_reference" ON "bitnob_payouts" ("reference") ` +
        `WHERE "reference" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `down()` discards rows by design (mirrors `up()`'s TRUNCATE) so the
    // restored NOT NULL constraints below can't fail on a `status='quote'` row.
    await queryRunner.query(`DELETE FROM "bitnob_payouts"`);

    await queryRunner.query(`DROP INDEX "UQ_bitnob_payouts_reference"`);
    await queryRunner.query(`DROP INDEX "UQ_bitnob_payouts_active_cert"`);
    await queryRunner.query(
      `ALTER TABLE "bitnob_payouts" DROP CONSTRAINT "FK_bitnob_payouts_admin_certificate_ref"`,
    );

    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ALTER COLUMN "status" SET DEFAULT 'processing'`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ALTER COLUMN "organization_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ALTER COLUMN "amount" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" ALTER COLUMN "bitnob_payout_id" SET NOT NULL`);

    await queryRunner.query(`ALTER TABLE "bitnob_payouts" DROP COLUMN "raw_result"`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" DROP COLUMN "raw_quote"`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" DROP COLUMN "admin_certificate_ref_id"`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" DROP COLUMN "source"`);
    await queryRunner.query(`ALTER TABLE "bitnob_payouts" DROP COLUMN "reference"`);
  }
}

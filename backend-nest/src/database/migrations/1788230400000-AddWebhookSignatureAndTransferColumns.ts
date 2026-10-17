import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Increment 5 — Bitnob webhook signature verification + `transfer.*` handling.
 *
 * Purely additive (a follow-up `migration:generate` produces an empty diff):
 *
 *  - `bitnob_webhook_events.signature_valid boolean NOT NULL DEFAULT true`.
 *    `BitnobWebhookSignatureGuard` sets it per delivery; `false` only on the
 *    dev no-secret skip path. Existing rows predate signature verification —
 *    backfilling `true` records them as trusted (they were accepted before any
 *    check existed). Every new insert passes an explicit value.
 *
 *  - `bitnob_withdrawals.tx_hash varchar NULL` + `network_fee numeric NULL`.
 *    Populated from the verified `transfer.success` / `transfer.failed`
 *    webhook (`data.hash` / `data.fee`) so the on-chain hash and gas fee are
 *    queryable rather than only buried in `raw_result`. Nullable — null until
 *    a `transfer.*` event (or a reconcile poll) fills them.
 *
 * NO bulk-item columns: `transfer.*` -> `bitnob_bulk_batch_items` is deferred
 * with security-analyst M4 (the `transaction_id <-> withdrawal_id` identity is
 * unverified and bulk is 403 in sandbox).
 *
 * `down()` drops the three columns in reverse add order. No data migrated
 * either way.
 */
export class AddWebhookSignatureAndTransferColumns1788230400000 implements MigrationInterface {
  name = 'AddWebhookSignatureAndTransferColumns1788230400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bitnob_webhook_events" ADD "signature_valid" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(`ALTER TABLE "bitnob_withdrawals" ADD "tx_hash" character varying`);
    await queryRunner.query(`ALTER TABLE "bitnob_withdrawals" ADD "network_fee" numeric`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "bitnob_withdrawals" DROP COLUMN "network_fee"`);
    await queryRunner.query(`ALTER TABLE "bitnob_withdrawals" DROP COLUMN "tx_hash"`);
    await queryRunner.query(`ALTER TABLE "bitnob_webhook_events" DROP COLUMN "signature_valid"`);
  }
}

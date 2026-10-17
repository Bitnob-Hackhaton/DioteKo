import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Bitnob Lightning pay-in (C1). Additive and non-destructive: every existing
 * `lightning_invoices` row gets `provider='lnbits'` (they were all issued by
 * LNbits), `external_id` / `expires_at` NULL. Existing `payments` rows get
 * `provider='lnbits'` too, EXCEPT the certificate payout ledger rows
 * (`purpose_type = 'admin_certificate_bitnob_payout'`), which are Bitnob rows
 * and are relabelled `bitnob` so the column never mislabels them. A partial
 * unique index keeps `(provider, external_id)` unique once an external id is
 * set.
 *
 * `down()` drops the columns, which would make any Bitnob invoice
 * indistinguishable from an LNbits one, so it REFUSES to run while Bitnob
 * invoices exist.
 */
export class AddProviderToLightningInvoicesAndPayments1788500000000 implements MigrationInterface {
    name = 'AddProviderToLightningInvoicesAndPayments1788500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" ADD "provider" character varying(20) NOT NULL DEFAULT 'lnbits'`);
        await queryRunner.query(`ALTER TABLE "lightning_invoices" ADD "provider" character varying(20) NOT NULL DEFAULT 'lnbits'`);
        await queryRunner.query(`ALTER TABLE "lightning_invoices" ADD "external_id" character varying`);
        await queryRunner.query(`ALTER TABLE "lightning_invoices" ADD "expires_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_lightning_invoices_provider_external_id" ON "lightning_invoices" ("provider", "external_id") WHERE "external_id" IS NOT NULL`);
        await queryRunner.query(`UPDATE "payments" SET "provider" = 'bitnob' WHERE "purpose_type" = 'admin_certificate_bitnob_payout' OR "bitnob_payout_id" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const rows: Array<{ count: string }> = await queryRunner.query(
            `SELECT count(*)::text AS count FROM "lightning_invoices" WHERE "provider" = 'bitnob'`,
        );
        if (Number(rows[0]?.count ?? 0) > 0) {
            throw new Error(
                'Refusing to revert: Bitnob Lightning invoices exist and would become indistinguishable from LNbits ones. ' +
                    'Delete or archive them first.',
            );
        }
        await queryRunner.query(`DROP INDEX "public"."UQ_lightning_invoices_provider_external_id"`);
        await queryRunner.query(`ALTER TABLE "lightning_invoices" DROP COLUMN "expires_at"`);
        await queryRunner.query(`ALTER TABLE "lightning_invoices" DROP COLUMN "external_id"`);
        await queryRunner.query(`ALTER TABLE "lightning_invoices" DROP COLUMN "provider"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "provider"`);
    }

}

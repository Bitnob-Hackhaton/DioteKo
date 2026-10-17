import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Guards for the automatic certificate generation on `admin_certificate_requests`:
 * - `issuing_token`: set by the worker that claims a request (`paid -> issuing`); its final `issued` write and its
 *   rollback are conditional on that token, so a slow worker overtaken by the resume pass cannot overwrite the
 *   winner (nor revert `issued` to `paid`).
 * - `payment_simulated`: true when the payment was marked paid by the dev-only simulation route; the credential and
 *   the payout routes use it so a simulated certificate can never pass for a paid one.
 * - a partial unique index on `admin_certificate_ref_id`: two requests can never share one certificate reference.
 *   (It does not by itself stop two references for one request: the `issuing_token` claim and the cleanup of a
 *   discarded attempt do that.)
 * Additive; `down()` drops all three. Existing rows get `payment_simulated = false`, token NULL.
 */
export class AddIssuanceGuardsToAdminCertificateRequests1788700000000 implements MigrationInterface {
    name = 'AddIssuanceGuardsToAdminCertificateRequests1788700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" ADD "issuing_token" uuid`);
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" ADD "payment_simulated" boolean NOT NULL DEFAULT false`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_admin_certificate_requests_ref" ON "admin_certificate_requests" ("admin_certificate_ref_id") WHERE "admin_certificate_ref_id" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "UQ_admin_certificate_requests_ref"`);
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" DROP COLUMN "payment_simulated"`);
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" DROP COLUMN "issuing_token"`);
    }

}

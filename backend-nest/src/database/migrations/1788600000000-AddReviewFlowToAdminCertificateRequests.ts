import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Flow B (verify, pay, generate): adds the agent's decision to `admin_certificate_requests`.
 * `status` is a plain varchar (no Postgres enum), so the new values `accepted`, `needs_info` and `issuing` need
 * no schema change.
 *
 * Data: before this migration `pending` meant "ready to invoice"; that is now `accepted`, so existing `pending`
 * rows are moved to `accepted` (otherwise they would wait for a review nobody asked for). `down()` reverses it:
 * `accepted` and `needs_info` go back to `pending`, `issuing` back to `paid` (certificate not generated yet),
 * then the columns are dropped. A `rejected` row stays `rejected` (its reason is lost on down). Caution: a request
 * genuinely waiting for review (`pending` before the revert) becomes invoiceable again under the old flow, where
 * `pending` meant "ready to invoice": review or clear them before rolling back a database that holds real requests.
 */
export class AddReviewFlowToAdminCertificateRequests1788600000000 implements MigrationInterface {
    name = 'AddReviewFlowToAdminCertificateRequests1788600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" ADD "decision_reason" text`);
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" ADD "reviewed_by_user_id" uuid`);
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" ADD "reviewed_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`UPDATE "admin_certificate_requests" SET "status" = 'accepted' WHERE "status" = 'pending'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`UPDATE "admin_certificate_requests" SET "status" = 'pending' WHERE "status" IN ('accepted', 'needs_info')`);
        await queryRunner.query(`UPDATE "admin_certificate_requests" SET "status" = 'paid' WHERE "status" = 'issuing'`);
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" DROP COLUMN "reviewed_at"`);
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" DROP COLUMN "reviewed_by_user_id"`);
        await queryRunner.query(`ALTER TABLE "admin_certificate_requests" DROP COLUMN "decision_reason"`);
    }

}

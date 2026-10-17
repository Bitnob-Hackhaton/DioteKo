import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Index on `admin_certificate_requests.holder_user_id`: every holder-facing read (`GET requests`, `requests/stats`,
 * `requests/:id`, resubmit) filters on it, and Postgres does not index a foreign key by itself.
 * Additive and lock-light on a small table; `down()` drops it. No data is touched.
 */
export class AddHolderIndexToAdminCertificateRequests1788800000000 implements MigrationInterface {
    name = 'AddHolderIndexToAdminCertificateRequests1788800000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE INDEX "IDX_admin_certificate_requests_holder_user_id" ON "admin_certificate_requests" ("holder_user_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_admin_certificate_requests_holder_user_id"`);
    }

}

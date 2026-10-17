import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Agent review of identity dossiers (docs/PLAN_KYC_MANUAL_REVIEW.md): the review columns on `kyc_verifications` and
 * `kyc_documents`, the AES-GCM encrypted copies of the photos an agent compares. Both changes are additive, so `down()`
 * loses only the review bookkeeping and the copies created after `up()`.
 */
export class AddManualReviewToKyc1789100000000 implements MigrationInterface {
    name = 'AddManualReviewToKyc1789100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD "review_origin" character varying`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD "reviewed_by" uuid`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD "reviewed_at" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD "review_note" text`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD CONSTRAINT "FK_kyc_verifications_reviewed_by" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "kyc_documents" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "verification_id" uuid NOT NULL,
            "kind" character varying NOT NULL,
            "mime" character varying NOT NULL,
            "iv" bytea NOT NULL,
            "auth_tag" bytea NOT NULL,
            "ciphertext" bytea NOT NULL,
            "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "UQ_kyc_documents_verification_kind" UNIQUE ("verification_id", "kind"),
            CONSTRAINT "PK_kyc_documents_id" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_kyc_documents_expires_at" ON "kyc_documents" ("expires_at")`);
        await queryRunner.query(`ALTER TABLE "kyc_documents" ADD CONSTRAINT "FK_kyc_documents_verification_id" FOREIGN KEY ("verification_id") REFERENCES "kyc_verifications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "kyc_documents" DROP CONSTRAINT "FK_kyc_documents_verification_id"`);
        await queryRunner.query(`DROP INDEX "IDX_kyc_documents_expires_at"`);
        await queryRunner.query(`DROP TABLE "kyc_documents"`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP CONSTRAINT "FK_kyc_verifications_reviewed_by"`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP COLUMN "review_note"`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP COLUMN "reviewed_at"`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP COLUMN "reviewed_by"`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP COLUMN "review_origin"`);
    }

}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Identity verification (KYC) via Idswyft: one row per attempt in `kyc_verifications` (no image, document number
 * or biometric data, see the entity) and an idempotency log `kyc_webhook_events`. Both tables are new, so
 * `down()` loses only KYC bookkeeping created after `up()`. `user_id` is RESTRICT: a user with a KYC history
 * cannot be deleted silently.
 */
export class CreateKycVerifications1789000000000 implements MigrationInterface {
    name = 'CreateKycVerifications1789000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "kyc_verifications" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "user_id" uuid NOT NULL,
            "provider" character varying NOT NULL DEFAULT 'idswyft',
            "provider_verification_id" character varying NOT NULL,
            "status" character varying NOT NULL DEFAULT 'pending',
            "document_type" character varying NOT NULL,
            "issuing_country" character varying,
            "attempts" integer NOT NULL DEFAULT 0,
            "verified_at" TIMESTAMP WITH TIME ZONE,
            "failure_reason" character varying,
            "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "UQ_kyc_verifications_provider_verification_id" UNIQUE ("provider_verification_id"),
            CONSTRAINT "PK_kyc_verifications_id" PRIMARY KEY ("id")
        )`);
        await queryRunner.query(`CREATE INDEX "IDX_kyc_verifications_user_created" ON "kyc_verifications" ("user_id", "created_at")`);
        // One active dossier per holder, enforced by the database (a double tap cannot open two provider sessions).
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_kyc_verifications_one_active_per_user" ON "kyc_verifications" ("user_id") WHERE "status" IN ('pending', 'manual_review')`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" ADD CONSTRAINT "FK_kyc_verifications_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "kyc_webhook_events" (
            "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
            "event_id" character varying,
            "event_type" character varying NOT NULL,
            "payload" jsonb NOT NULL,
            "processed" boolean NOT NULL DEFAULT false,
            "signature_valid" boolean NOT NULL DEFAULT true,
            "processing_started_at" TIMESTAMP WITH TIME ZONE,
            "processing_error" text,
            "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "UQ_kyc_webhook_events_event_id" UNIQUE ("event_id"),
            CONSTRAINT "PK_kyc_webhook_events_id" PRIMARY KEY ("id")
        )`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "kyc_webhook_events"`);
        await queryRunner.query(`ALTER TABLE "kyc_verifications" DROP CONSTRAINT "FK_kyc_verifications_user_id"`);
        await queryRunner.query(`DROP INDEX "UQ_kyc_verifications_one_active_per_user"`);
        await queryRunner.query(`DROP INDEX "IDX_kyc_verifications_user_created"`);
        await queryRunner.query(`DROP TABLE "kyc_verifications"`);
    }

}

import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * eSignet is removed (identity = Appwrite + Google), so `users.esignet_sub` has no reader or writer left.
 * `up()` drops the column; PostgreSQL drops its unique constraint `UQ_f7407a3759083265921660de7d7` with it.
 * DATA LOSS: any stored eSignet subject is gone. `down()` only recreates the structure (nullable varchar +
 * the same unique constraint), it cannot restore values: dump `SELECT id, esignet_sub FROM users WHERE
 * esignet_sub IS NOT NULL` first on any database that has real data.
 */
export class DropEsignetSubFromUsers1788900000000 implements MigrationInterface {
    name = 'DropEsignetSubFromUsers1788900000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "esignet_sub"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "esignet_sub" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_f7407a3759083265921660de7d7" UNIQUE ("esignet_sub")`);
    }

}

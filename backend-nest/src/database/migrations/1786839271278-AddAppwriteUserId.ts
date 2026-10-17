import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAppwriteUserId1786839271278 implements MigrationInterface {
    name = 'AddAppwriteUserId1786839271278'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "appwrite_user_id" character varying`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_4148da781fc9ffe46932954b94a" UNIQUE ("appwrite_user_id")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_4148da781fc9ffe46932954b94a"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "appwrite_user_id"`);
    }

}

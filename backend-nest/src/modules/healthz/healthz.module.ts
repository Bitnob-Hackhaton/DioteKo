import { Module } from '@nestjs/common';
import { HealthzController } from './healthz.controller';

/**
 * Ops health module — one public `GET /api/healthz` route, no entities, no
 * providers. Uses the app-wide TypeORM `DataSource` (globally available from
 * `TypeOrmModule.forRootAsync` in AppModule) for the DB check.
 */
@Module({
  controllers: [HealthzController],
})
export class HealthzModule {}

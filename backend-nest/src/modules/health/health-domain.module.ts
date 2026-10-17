import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './controllers/health.controller';
import { HealthRecordRef } from './entities/health-record-ref.entity';

/**
 * Domain shell for `health` (plan step 10) — registers the placeholder
 * `HealthRecordRef` entity and the TODO-marked status controller. No real
 * business logic yet; nothing exported since nothing else depends on this
 * module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([HealthRecordRef])],
  controllers: [HealthController],
})
export class HealthDomainModule {}

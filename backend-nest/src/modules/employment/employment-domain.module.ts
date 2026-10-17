import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmploymentController } from './controllers/employment.controller';
import { EmploymentRecordRef } from './entities/employment-record-ref.entity';

/**
 * Domain shell for `employment` (plan step 10) — registers the placeholder
 * `EmploymentRecordRef` entity and the TODO-marked status controller. No
 * real business logic yet; nothing exported since nothing else depends on
 * this module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EmploymentRecordRef])],
  controllers: [EmploymentController],
})
export class EmploymentDomainModule {}

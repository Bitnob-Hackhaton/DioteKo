import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EducationController } from './controllers/education.controller';
import { EducationRecordRef } from './entities/education-record-ref.entity';

/**
 * Domain shell for `education` (plan step 10) — registers the placeholder
 * `EducationRecordRef` entity and the TODO-marked status controller. No
 * real business logic yet; nothing exported since nothing else depends on
 * this module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([EducationRecordRef])],
  controllers: [EducationController],
})
export class EducationDomainModule {}

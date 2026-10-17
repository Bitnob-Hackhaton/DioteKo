import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialAidController } from './controllers/social-aid.controller';
import { SocialAidRecordRef } from './entities/social-aid-record-ref.entity';

/**
 * Domain shell for `social-aid` (plan step 10) — registers the placeholder
 * `SocialAidRecordRef` entity and the TODO-marked status controller. No
 * real business logic yet; nothing exported since nothing else depends on
 * this module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SocialAidRecordRef])],
  controllers: [SocialAidController],
})
export class SocialAidDomainModule {}

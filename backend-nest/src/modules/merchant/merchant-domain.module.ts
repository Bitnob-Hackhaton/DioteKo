import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantController } from './controllers/merchant.controller';
import { MerchantRecordRef } from './entities/merchant-record-ref.entity';

/**
 * Domain shell for `merchant` (plan step 10) — registers the placeholder
 * `MerchantRecordRef` entity and the TODO-marked status controller. No
 * real business logic yet; nothing exported since nothing else depends on
 * this module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([MerchantRecordRef])],
  controllers: [MerchantController],
})
export class MerchantDomainModule {}

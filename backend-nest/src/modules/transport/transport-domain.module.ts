import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransportController } from './controllers/transport.controller';
import { TransportRecordRef } from './entities/transport-record-ref.entity';

/**
 * Domain shell for `transport` (plan step 10) — registers the placeholder
 * `TransportRecordRef` entity and the TODO-marked status controller. No
 * real business logic yet; nothing exported since nothing else depends on
 * this module.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TransportRecordRef])],
  controllers: [TransportController],
})
export class TransportDomainModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LightningInvoice } from './entities/lightning-invoice.entity';
import { Payment } from './entities/payment.entity';
import { LightningInvoicesService } from './services/lightning-invoices.service';

/**
 * Generic Lightning invoice/payment registry — no knowledge of domain-specific
 * purposes (`purposeType`/`purposeId` are opaque strings here) and no
 * dependency on `domains/admin-certificates`, `audit/consent`, or
 * `integrations/bitnob` (this module must stay usable by them without ever
 * importing them back; `BitnobModule` imports THIS module, never the reverse). It
 * has no HTTP surface: it only exports `LightningInvoicesService`, the ledger
 * of invoices issued by the payment provider (Bitnob) and of their `payments` rows.
 */
@Module({
  imports: [TypeOrmModule.forFeature([LightningInvoice, Payment])],
  providers: [LightningInvoicesService],
  exports: [LightningInvoicesService],
})
export class LightningModule {}

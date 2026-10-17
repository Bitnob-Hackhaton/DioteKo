import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum LightningInvoiceStatus {
  PENDING = 'pending',
  PAID = 'paid',
  EXPIRED = 'expired',
  FAILED = 'failed',
}

/**
 * Which service issued (and settles) a Lightning invoice. `LNBITS` is a historic value only: rows that predate
 * Bitnob carry it (and it is the column default of migration 1788500000000); no code issues LNbits invoices anymore.
 */
export enum LightningProvider {
  LNBITS = 'lnbits',
  BITNOB = 'bitnob',
}

/**
 * One row per Lightning invoice (BOLT11), whichever provider issued it — see
 * `provider`. The generic, polymorphic ledger row lives separately in
 * `payment.entity.ts` (`payments` table), linked back here via
 * `Payment.lightningInvoiceId`. `paymentHash` is the BOLT11 payment hash
 * (unique; the webhook lookup key). `checkingId` is a historic column, only
 * set on pre-Bitnob (`lnbits`) rows (`recordInvoice` leaves it null for Bitnob); `externalId`
 * is the provider's own invoice id for Bitnob (`GET /api/lightning/invoices/:id`),
 * unique per provider when set.
 */
@Entity({ name: 'lightning_invoices' })
@Index('UQ_lightning_invoices_provider_external_id', ['provider', 'externalId'], {
  unique: true,
  where: '"external_id" IS NOT NULL',
})
export class LightningInvoice extends BaseEntity {
  @Column({ type: 'varchar', length: 20, default: LightningProvider.LNBITS })
  provider: LightningProvider;

  @Column({ name: 'external_id', type: 'varchar', nullable: true })
  externalId: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ name: 'payment_hash', type: 'varchar', unique: true })
  paymentHash: string;

  @Column({ name: 'payment_request', type: 'text' })
  paymentRequest: string;

  @Column({ name: 'checking_id', type: 'varchar', nullable: true })
  checkingId: string | null;

  @Column({ name: 'amount_sats', type: 'int' })
  amountSats: number;

  @Column({ type: 'varchar', nullable: true })
  memo: string | null;

  @Column({ type: 'varchar', default: LightningInvoiceStatus.PENDING })
  status: LightningInvoiceStatus;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt: Date | null;
}

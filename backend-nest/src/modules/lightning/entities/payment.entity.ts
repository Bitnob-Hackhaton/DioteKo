import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';
import { LightningInvoice, LightningProvider } from './lightning-invoice.entity';

export enum PaymentStatus {
  PENDING = 'pending',
  PAID = 'paid',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

/**
 * Generic, polymorphic payment ledger row — one row per payment attempt
 * regardless of rail (Lightning today via `lightningInvoiceId`; Bitnob
 * fiat/on-chain payouts and trades via `bitnobPayoutId`/`bitnobTradeId`
 * below). `purposeType`/`purposeId` are an app-level polymorphic reference
 * (e.g. `purposeType='admin_certificate_request'`, `purposeId=<that row's
 * id>`) — deliberately no DB FK since the target table varies by
 * `purposeType`; any domain module can mint its own `purposeType` string
 * without this module knowing about it.
 */
@Entity({ name: 'payments' })
export class Payment extends BaseEntity {
  // Rail that collected (or will collect) this payment. `lnbits` is a historic
  // value (rows that predate Bitnob pay-in, and the column default); payout
  // rows keep the default and are told apart by `purposeType` / `bitnobPayoutId`.
  @Column({ type: 'varchar', length: 20, default: LightningProvider.LNBITS })
  provider: LightningProvider;

  @Column({ name: 'lightning_invoice_id', type: 'uuid', nullable: true })
  lightningInvoiceId: string | null;

  @ManyToOne(() => LightningInvoice, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'lightning_invoice_id' })
  lightningInvoice: LightningInvoice | null;

  // Loose reference to `bitnob_payouts.id` (integrations/bitnob), same
  // deliberate no-FK pattern as `purposeType`/`purposeId` above — not a
  // stale placeholder. `integrations/bitnob` exists now, but `LightningModule`
  // is intentionally kept with zero dependency on it (and on any domain
  // module) so it stays importable by both without a cycle; see
  // `LightningModule`'s doc comment. Enforcing this as a real
  // `@ManyToOne`/`@JoinColumn` would require importing the `BitnobPayout`
  // entity here, which breaks that boundary for no behavioral gain — nothing
  // currently reads this column via a loaded relation.
  @Column({ name: 'bitnob_payout_id', type: 'uuid', nullable: true })
  bitnobPayoutId: string | null;

  // Loose reference to `bitnob_trades.id` (integrations/bitnob) — same
  // rationale as `bitnobPayoutId` above.
  @Column({ name: 'bitnob_trade_id', type: 'uuid', nullable: true })
  bitnobTradeId: string | null;

  @Column({ name: 'purpose_type', type: 'varchar' })
  purposeType: string;

  @Column({ name: 'purpose_id', type: 'uuid' })
  purposeId: string;

  @Column({ name: 'amount_sats', type: 'int', nullable: true })
  amountSats: number | null;

  @Column({ type: 'varchar', default: 'SATS' })
  currency: string;

  @Column({ type: 'varchar', default: PaymentStatus.PENDING })
  status: PaymentStatus;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;
}

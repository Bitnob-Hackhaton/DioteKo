import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { AdminCertificateRef } from '../../../modules/admin-certificates/entities/admin-certificate-ref.entity';
import { Did } from '../../../modules/did-vc/entities/did.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

/**
 * One row per Bitnob payout, created up-front at `status: 'quote'` (BEFORE
 * any Bitnob call) so the deterministic idempotency key
 * `reference = 'dkpayout_' + id` exists and the local ledger never lags the
 * remote state. Lifecycle: `quote -> initiated -> finalizing -> processing ->
 * completed | failed` (plus `expired` for a lapsed quote). `finalizing` is a
 * LOCAL-ONLY transient status set by an atomic `initiated -> finalizing`
 * compare-and-swap just before the disbursement call, so two concurrent
 * finalize requests can't both proceed; it reverts to `initiated` if that
 * call never ran.
 *
 * Written by two owners:
 *  - `AdminCertificatesService` for the certificate-scoped path — sets
 *    `adminCertificateRefId` + `organizationId` + `subjectDidId` from the
 *    certificate's own ref row, never from a request body;
 *  - `BitnobMoneyController` for the raw admin path — `adminCertificateRefId`
 *    and `organizationId` stay null (not domain-scoped).
 *
 * The partial unique index `UQ_bitnob_payouts_active_cert` enforces at most
 * one still-recoverable payout per certificate at the DB level
 * (`status NOT IN ('failed','expired')` — an expired quote can be
 * re-quoted), backing the 409 pre-check in
 * `createBitnobPayoutForCertificate`. `UQ_bitnob_payouts_reference` keeps
 * Bitnob's only idempotency key globally unique.
 *
 * `bitnobPayoutId` / `amount` are nullable: both are only known after the
 * Bitnob quote/initialize round-trip. `organizationId` is nullable for the
 * raw admin path. `rawQuote` is stored as-is (no PII); `rawResult` is
 * scrubbed of beneficiary/account keys before persistence (see
 * `stripPayoutPii`).
 *
 * The `admin_certificate_ref_id` FK is `ON DELETE RESTRICT`: a money row
 * must never silently orphan from the certificate it paid out for.
 *
 * `amount`/`settlementAmount` are `numeric` — TypeORM returns them as
 * strings to avoid float-precision loss on money values.
 */
@Entity({ name: 'bitnob_payouts' })
@Index('UQ_bitnob_payouts_active_cert', ['adminCertificateRefId'], {
  unique: true,
  where: `"status" NOT IN ('failed', 'expired')`,
})
@Index('UQ_bitnob_payouts_reference', ['reference'], {
  unique: true,
  where: `"reference" IS NOT NULL`,
})
export class BitnobPayout extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ name: 'subject_did_id', type: 'uuid', nullable: true })
  subjectDidId: string | null;

  @ManyToOne(() => Did, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_did_id' })
  subjectDid: Did | null;

  @Column({ name: 'admin_certificate_ref_id', type: 'uuid', nullable: true })
  adminCertificateRefId: string | null;

  @ManyToOne(() => AdminCertificateRef, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'admin_certificate_ref_id',
    foreignKeyConstraintName: 'FK_bitnob_payouts_admin_certificate_ref',
  })
  adminCertificateRef: AdminCertificateRef | null;

  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  @Column({ name: 'bitnob_payout_id', type: 'varchar', nullable: true })
  bitnobPayoutId: string | null;

  @Column({ name: 'quote_id', type: 'varchar', nullable: true })
  quoteId: string | null;

  @Column({ name: 'from_asset', type: 'varchar' })
  fromAsset: string;

  @Column({ name: 'to_currency', type: 'varchar' })
  toCurrency: string;

  @Column({ type: 'varchar', nullable: true })
  source: string | null;

  @Column({ type: 'numeric', nullable: true })
  amount: string | null;

  @Column({ name: 'settlement_amount', type: 'numeric', nullable: true })
  settlementAmount: string | null;

  @Column({ type: 'varchar', default: 'quote' })
  status: string;

  @Column({ type: 'varchar', nullable: true })
  country: string | null;

  @Column({ name: 'raw_quote', type: 'jsonb', nullable: true })
  rawQuote: Record<string, unknown> | null;

  @Column({ name: 'raw_result', type: 'jsonb', nullable: true })
  rawResult: Record<string, unknown> | null;
}

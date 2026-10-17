import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';
import { User } from '../../../modules/identity/entities/user.entity';
import { Payment } from '../../lightning/entities/payment.entity';
import { AdminCertificateRef } from './admin-certificate-ref.entity';

/**
 * Flow B: `pending` = filed, waiting for an agent of the organization to review it (a type that does not require
 * review is `accepted` straight away). Only an `accepted` request can be invoiced; `paid` -> `issuing` -> `issued`
 * is the generation. `needs_info` = the agent asked the holder for a correction; the holder resubmits and the
 * request goes back to `pending`. `rejected` is final and carries a mandatory reason.
 */
export enum AdminCertificateRequestStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  NEEDS_INFO = 'needs_info',
  AWAITING_PAYMENT = 'awaiting_payment',
  PAID = 'paid',
  ISSUING = 'issuing',
  ISSUED = 'issued',
  REJECTED = 'rejected',
}

/**
 * Intake/payment/issuance workflow row for one holder's request for one
 * admin certificate. New table vs. the old Prisma schema (see the plan's
 * "Entity reconciliation" table) — a deliberate addition needed to keep the
 * request -> Lightning invoice -> paid -> VC-issued lifecycle coherent
 * before a `verifiable_credentials` row exists at all.
 *
 * `organizationId` is the issuing municipality/ministry, resolved once at
 * request-creation time (`AdminCertificatesService.createRequest`) by
 * looking up an `Organization` with `type IN ('municipality','ministry')` —
 * see that method for what happens when none is seeded yet.
 *
 * `paymentId` links to `payments/lightning`'s generic `payments` ledger row
 * (not directly to `lightning_invoices` — see `Payment`'s doc comment on why
 * the polymorphic ledger row is the right link target). `adminCertificateRefId`
 * stays `null` until `issueForRequest` succeeds.
 */
@Entity({ name: 'admin_certificate_requests' })
@Index('IDX_admin_certificate_requests_holder_user_id', ['holderUserId'])
@Index('UQ_admin_certificate_requests_ref', ['adminCertificateRefId'], {
  unique: true,
  where: '"admin_certificate_ref_id" IS NOT NULL',
})
export class AdminCertificateRequest extends BaseEntity {
  @Column({ name: 'holder_user_id', type: 'uuid' })
  holderUserId: string;

  @ManyToOne(() => User, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'holder_user_id' })
  holderUser: User;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'certificate_type', type: 'varchar' })
  certificateType: string;

  @Column({ name: 'submitted_data', type: 'jsonb' })
  submittedData: Record<string, unknown>;

  @Column({ type: 'varchar', default: AdminCertificateRequestStatus.PENDING })
  status: AdminCertificateRequestStatus;

  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId: string | null;

  @ManyToOne(() => Payment, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment | null;

  /** Agent's reason for a rejection, or the message of a request for more information; shown to the holder. */
  @Column({ name: 'decision_reason', type: 'text', nullable: true })
  decisionReason: string | null;

  /** The agent who last decided on this request; `null` for an automatically accepted one. */
  @Column({ name: 'reviewed_by_user_id', type: 'uuid', nullable: true })
  reviewedByUserId: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  /**
   * Set by the worker that claims the request for generation (`paid -> issuing`); the final `issued` write and the
   * rollback are conditional on it, so a slow worker overtaken by the resume pass cannot overwrite the winner.
   */
  @Column({ name: 'issuing_token', type: 'uuid', nullable: true })
  issuingToken: string | null;

  /** True when the payment was marked paid by the dev-only simulation route (never in production). */
  @Column({ name: 'payment_simulated', type: 'boolean', default: false })
  paymentSimulated: boolean;

  @Column({ name: 'admin_certificate_ref_id', type: 'uuid', nullable: true })
  adminCertificateRefId: string | null;

  @ManyToOne(() => AdminCertificateRef, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'admin_certificate_ref_id' })
  adminCertificateRef: AdminCertificateRef | null;
}

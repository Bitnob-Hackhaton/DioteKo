import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../identity/entities/user.entity';
import { KYC_PROVIDER_IDSWYFT, KycReviewOrigin, KycStatus } from '../kyc.constants';

/**
 * One identity-verification attempt by a holder, mirrored from the provider (Idswyft). By design this table
 * stores NO image, NO document number and NO biometric data: only the provider's verification id, the outcome
 * and bookkeeping. The photos go straight to the provider; the only copies are the short-lived encrypted
 * `kyc_documents` rows kept when an agent may have to review the dossier (fallback / manual-only flags).
 *
 * `status = verified` is only ever set after reading the verification back from the provider (the webhook is a
 * signal, never the proof) — see `KycService.refreshFromProvider`.
 */
@Entity({ name: 'kyc_verifications' })
@Index('IDX_kyc_verifications_user_created', ['userId', 'createdAt'])
@Index('UQ_kyc_verifications_one_active_per_user', ['userId'], {
  unique: true,
  where: `"status" IN ('pending', 'manual_review')`,
})
export class KycVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { nullable: false, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', default: KYC_PROVIDER_IDSWYFT })
  provider: string;

  @Column({ name: 'provider_verification_id', type: 'varchar', unique: true })
  providerVerificationId: string;

  @Column({ type: 'varchar', default: KycStatus.PENDING })
  status: KycStatus;

  /** `national_id` | `passport` — what the holder chose, not what the provider read. */
  @Column({ name: 'document_type', type: 'varchar' })
  documentType: string;

  @Column({ name: 'issuing_country', type: 'varchar', nullable: true })
  issuingCountry: string | null;

  /** Uploads (document sides + selfie) sent so far on this session; bounded by the service, not the provider. */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  /** One of `KYC_FAILURE_REASONS` when `failed` / `rejected`; the provider's own wording is never stored. */
  @Column({ name: 'failure_reason', type: 'varchar', nullable: true })
  failureReason: string | null;

  /** Why an agent has to decide (`KYC_REVIEW_ORIGINS`); set when the dossier goes to, or is detached for, review. */
  @Column({ name: 'review_origin', type: 'varchar', nullable: true })
  reviewOrigin: KycReviewOrigin | null;

  /** The agent who decided. `ON DELETE SET NULL`: the decision outlives the agent's account. */
  @Column({ name: 'reviewed_by', type: 'uuid', nullable: true })
  reviewedBy: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'reviewed_by' })
  reviewer?: User | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt: Date | null;

  /** The agent's justification. Staff-only: never returned to the holder. */
  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote: string | null;

  /**
   * Step the provider is waiting for (`front` | `back` | `selfie`), set by the last read-back of the status. NOT a
   * column: it only travels with the entity to the view so the app resumes where the session stopped.
   */
  providerStep?: 'front' | 'back' | 'selfie' | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

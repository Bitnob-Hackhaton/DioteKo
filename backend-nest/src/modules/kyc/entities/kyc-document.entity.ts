import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { KycVerification } from './kyc-verification.entity';

/**
 * AES-256-GCM encrypted copy of one photo, kept ONLY while an agent may have to review the dossier (fallback or
 * manual-only mode, see `KycDocumentVaultService`). One row per (dossier, side): a retake replaces it. Deleted at the
 * decision, when the provider verifies the dossier, or when `expires_at` passes. Never logged, never in an API list.
 */
@Entity({ name: 'kyc_documents' })
@Unique('UQ_kyc_documents_verification_kind', ['verificationId', 'kind'])
@Index('IDX_kyc_documents_expires_at', ['expiresAt'])
export class KycDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'verification_id', type: 'uuid' })
  verificationId: string;

  @ManyToOne(() => KycVerification, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'verification_id' })
  verification: KycVerification;

  /** `front` | `back` | `selfie`. */
  @Column({ type: 'varchar' })
  kind: string;

  @Column({ type: 'varchar' })
  mime: string;

  @Column({ type: 'bytea' })
  iv: Buffer;

  @Column({ name: 'auth_tag', type: 'bytea' })
  authTag: Buffer;

  @Column({ type: 'bytea' })
  ciphertext: Buffer;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

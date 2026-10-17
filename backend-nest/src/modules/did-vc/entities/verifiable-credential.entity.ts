import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Did } from './did.entity';

export enum VerifiableCredentialStatus {
  ACTIVE = 'active',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

/**
 * A W3C-VC-shaped credential, signed as a compact JWT (`jwt`, HS256, shared
 * secret — see `CredentialIssuanceService`). Generalized from the
 * certificate-only `Certificate` row in the old Prisma schema: `type` is any
 * VC type string (e.g. `AdminCertificate`), not certificate-specific.
 * `hash` is a SHA-256 fingerprint of the signed payload (see
 * `common/utils/sha256.util.ts` + `stable-stringify.util.ts`), recomputed by
 * `CredentialVerificationService` to detect tampering independent of the JWT
 * signature check. `status` only ever transitions `active -> revoked` today
 * (see `RevocationService`) — `expired` is a status a future scheduled job
 * could set, but nothing currently writes it; expiry is otherwise detected
 * live from `expiresAt`/the JWT's own `exp` claim at verify time.
 */
@Entity({ name: 'verifiable_credentials' })
export class VerifiableCredential extends BaseEntity {
  @Column({ type: 'varchar' })
  type: string;

  @Column({ name: 'issuer_did_id', type: 'uuid' })
  issuerDidId: string;

  @ManyToOne(() => Did, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'issuer_did_id' })
  issuerDid: Did;

  @Column({ name: 'subject_did_id', type: 'uuid' })
  subjectDidId: string;

  @ManyToOne(() => Did, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subject_did_id' })
  subjectDid: Did;

  @Column({ type: 'text' })
  jwt: string;

  @Column({ type: 'varchar' })
  hash: string;

  @Column({ type: 'varchar', default: VerifiableCredentialStatus.ACTIVE })
  status: VerifiableCredentialStatus;

  @Column({ name: 'issued_at', type: 'timestamptz' })
  issuedAt: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;
}

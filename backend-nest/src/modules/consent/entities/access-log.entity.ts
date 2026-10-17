import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Did } from '../../../modules/did-vc/entities/did.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';
import { User } from '../../../modules/identity/entities/user.entity';

export enum AccessLogActorType {
  VERIFIER_ORGANIZATION = 'verifier_organization',
  // Staff of the issuing organization (issuer/admin) acting on its own requests. `actor_type` is a plain
  // varchar column, so this needs no DB migration.
  ISSUER_ORGANIZATION = 'issuer_organization',
  HOLDER = 'holder',
  ANONYMOUS = 'anonymous',
  SYSTEM = 'system',
}

export enum AccessLogAction {
  ISSUE = 'issue',
  VERIFY = 'verify',
  READ = 'read',
  REVOKE = 'revoke',
  // An agent's decision (accept / reject / request-info) on a certificate request; the decision is in `metadata`.
  // `action` is a plain varchar column, so this needs no DB migration.
  REVIEW = 'review',
  // Bitnob payout lifecycle events on a certificate — recorded on the
  // `initiated` transition and on terminal transitions only (not on `quote`).
  // `action` is a plain varchar column, so this needs no DB migration.
  PAYOUT = 'payout',
  // Bitnob raw money-movement (Increment 4): one row per on-chain withdrawal
  // attempt / bulk-transfer money-move attempt. `action` is a plain varchar
  // column, so these need no DB migration.
  WITHDRAWAL = 'withdrawal',
  BULK_TRANSFER = 'bulk_transfer',
}

export enum AccessLogResult {
  VALID = 'valid',
  INVALID = 'invalid',
  EXPIRED = 'expired',
  ERROR = 'error',
}

/**
 * Append-only audit trail row for anything that touches a VC/DID resource
 * (issue/verify/read/revoke) — the modern home of the old Prisma
 * `VerificationLog`, generalized beyond just verification. Write-mostly by
 * design (see `AccessLogService`): domain modules call `record(...)` inline
 * on their own flows (e.g. `AdminCertificatesService.verifyCertificate`),
 * this module never initiates a write on its own.
 *
 * `actorOrganizationId`/`actorUserId`/`subjectDidId` are all nullable
 * because not every actor/action combination has all three — e.g. a public,
 * unauthenticated certificate verification (`actorType='anonymous'`) has
 * none of them populated beyond what the resource itself implies.
 */
@Entity({ name: 'access_logs' })
export class AccessLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'actor_type', type: 'varchar' })
  actorType: AccessLogActorType;

  @Column({ name: 'actor_organization_id', type: 'uuid', nullable: true })
  actorOrganizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_organization_id' })
  actorOrganization: Organization | null;

  @Column({ name: 'actor_user_id', type: 'uuid', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: User | null;

  @Column({ name: 'subject_did_id', type: 'uuid', nullable: true })
  subjectDidId: string | null;

  @ManyToOne(() => Did, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_did_id' })
  subjectDid: Did | null;

  @Column({ name: 'resource_type', type: 'varchar' })
  resourceType: string;

  @Column({ name: 'resource_id', type: 'uuid' })
  resourceId: string;

  @Column({ type: 'varchar' })
  action: AccessLogAction;

  @Column({ type: 'varchar' })
  result: AccessLogResult;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

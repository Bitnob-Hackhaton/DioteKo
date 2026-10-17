import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Did } from '../../../modules/did-vc/entities/did.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

export enum ConsentStatus {
  GRANTED = 'granted',
  REVOKED = 'revoked',
}

/**
 * A holder's consent grant for a verifier organization to access some
 * resource type/scope of theirs (e.g. "read my AdminCertificate VCs").
 * Deliberately minimal per the plan's "audit/consent built
 * minimally-but-real" MVP scope decision: this is a CRUD-shaped record of
 * consent, not a consent-matching engine — nothing in this pass reads
 * `consents` to gate access during issuance/verification (see
 * `AdminCertificatesService.verifyCertificate`, which only writes to
 * `access_logs`). Wiring consent checks into the actual verify/issue flow is
 * explicitly future work.
 *
 * `scope` is a free-form jsonb bag (e.g. `{fields: ['name','dob']}`) — no
 * fixed shape is enforced yet, matching the "no complex consent-matching
 * logic needed" instruction.
 */
@Entity({ name: 'consents' })
export class Consent extends BaseEntity {
  @Column({ name: 'holder_did_id', type: 'uuid' })
  holderDidId: string;

  @ManyToOne(() => Did, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'holder_did_id' })
  holderDid: Did;

  @Column({ name: 'verifier_organization_id', type: 'uuid' })
  verifierOrganizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'verifier_organization_id' })
  verifierOrganization: Organization;

  @Column({ name: 'resource_type', type: 'varchar' })
  resourceType: string;

  @Column({ type: 'jsonb' })
  scope: Record<string, unknown>;

  @Column({ type: 'varchar', default: ConsentStatus.GRANTED })
  status: ConsentStatus;

  @Column({ name: 'granted_at', type: 'timestamptz' })
  grantedAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt: Date | null;
}

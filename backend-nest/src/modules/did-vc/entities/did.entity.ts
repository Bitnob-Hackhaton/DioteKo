import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organization } from '../../identity/entities/organization.entity';
import { User } from '../../identity/entities/user.entity';

/**
 * A minimal, app-local Decentralized Identifier (DID) record.
 *
 * `did` uses a custom placeholder method — `did:dioteko:<uuid>` — that is
 * NOT a registered DID method per the W3C DID Core spec. There is no real
 * DID resolution, no cryptographic key material bound to it, and `document`
 * is a minimal stub shape (`{id, controller, created}`), not a spec-shaped
 * DID Document. This is a deliberate simplification for this project's
 * scope, not an oversight.
 *
 * Exactly one of `controllerUserId` (a holder, linked at first Google
 * login — see `AuthService.completeAppwriteLogin`) / `controllerOrganizationId`
 * (an issuing/verifying institution) must be set. That invariant is enforced
 * at the service layer (`DidService.createDid`), not via a DB constraint —
 * see the plan's note that an app-level check is sufficient here.
 */
@Entity({ name: 'dids' })
export class Did extends BaseEntity {
  @Column({ type: 'varchar', unique: true })
  did: string;

  @Column({ name: 'controller_user_id', type: 'uuid', nullable: true })
  controllerUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'controller_user_id' })
  controllerUser: User | null;

  @Column({ name: 'controller_organization_id', type: 'uuid', nullable: true })
  controllerOrganizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'controller_organization_id' })
  controllerOrganization: Organization | null;

  @Column({ type: 'jsonb' })
  document: { id: string; controller: string; created: string };
}

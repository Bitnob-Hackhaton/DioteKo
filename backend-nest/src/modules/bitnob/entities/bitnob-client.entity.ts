import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

/**
 * One row per Bitnob "client"/sub-account associated with one of our
 * `organizations` — mirrors the client/org metadata Bitnob's own API
 * exposes about the API-key holder (e.g. what `BitnobService.whoami`
 * probes). Not written automatically by any flow in this pass; the write
 * path (populate from a real `whoami`/client-lookup response) is left for a
 * future round once real credentials let us confirm Bitnob's actual
 * response shape rather than guessing field names for a call we can't test.
 */
@Entity({ name: 'bitnob_clients' })
export class BitnobClient extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'company_id', type: 'varchar', nullable: true })
  companyId: string | null;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ type: 'varchar' })
  environment: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  slug: string;

  @Column({ name: 'org_status', type: 'varchar' })
  orgStatus: string;
}

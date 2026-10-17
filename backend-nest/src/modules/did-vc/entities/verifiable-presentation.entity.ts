import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Organization } from '../../identity/entities/organization.entity';
import { Did } from './did.entity';

/**
 * A minimal Verifiable Presentation record: a holder DID bundling a set of
 * `verifiable_credentials` ids to disclose to a verifier. No selective
 * disclosure and no signature over the presentation itself in this pass —
 * `vpHash` is a content fingerprint (holder + credential ids + context)
 * useful as an integrity/idempotency marker, not a cryptographic proof.
 * `verifierOrganizationId` is nullable — a presentation can be created
 * before a specific verifier is known.
 */
@Entity({ name: 'verifiable_presentations' })
export class VerifiablePresentation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'holder_did_id', type: 'uuid' })
  holderDidId: string;

  @ManyToOne(() => Did, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'holder_did_id' })
  holderDid: Did;

  @Column({ name: 'verifier_organization_id', type: 'uuid', nullable: true })
  verifierOrganizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'verifier_organization_id' })
  verifierOrganization: Organization | null;

  @Column({ name: 'vp_hash', type: 'varchar' })
  vpHash: string;

  @Column({ type: 'jsonb' })
  context: Record<string, unknown>;

  @Column({ name: 'credential_ids', type: 'jsonb' })
  credentialIds: string[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Did } from '../../../modules/did-vc/entities/did.entity';
import { VerifiableCredential } from '../../../modules/did-vc/entities/verifiable-credential.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

/**
 * Placeholder reference row for the `employment` domain shell (plan step 10,
 * "7 domain shells" scope). Mirrors the minimal shape shared by every
 * shell: a link to the subject's DID, the issuing/verifying organization,
 * a `type` tag, an external reference, and an optional linked VC.
 */
// TODO: domain-specific columns — not implemented this pass
@Entity({ name: 'employment_record_refs' })
export class EmploymentRecordRef {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subject_did_id', type: 'uuid', nullable: true })
  subjectDidId: string | null;

  @ManyToOne(() => Did, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_did_id' })
  subjectDid: Did | null;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  @Column({ type: 'varchar' })
  type: string;

  @Column({ name: 'external_reference', type: 'varchar', nullable: true })
  externalReference: string | null;

  @Column({ name: 'vc_id', type: 'uuid', nullable: true })
  vcId: string | null;

  @ManyToOne(() => VerifiableCredential, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'vc_id' })
  vc: VerifiableCredential | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

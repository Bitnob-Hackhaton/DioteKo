import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Did } from '../../../modules/did-vc/entities/did.entity';
import { VerifiableCredential } from '../../../modules/did-vc/entities/verifiable-credential.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

/**
 * Stable public reference row for an issued admin certificate — the modern
 * home of the old Prisma `Certificate.certificateId` concept.
 * `externalReference` is a freshly generated UUID (see
 * `AdminCertificatesService.issueForRequest`), deliberately distinct from
 * this row's own `id` (see the plan's "Entity reconciliation" table), so the
 * PDF filename / QR deep-link / public `GET /:certificateId/...` routes have
 * a stable identifier that isn't the raw DB primary key.
 *
 * The actual signed credential content lives in `verifiable_credentials`
 * (`vcId`) — this row is a thin, domain-specific index on top of it plus the
 * fields needed to serve `GET /:certificateId/file` without re-deriving them
 * (`certificateType`, `organizationId`, `subjectDidId`).
 */
@Entity({ name: 'admin_certificates_refs' })
export class AdminCertificateRef {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'subject_did_id', type: 'uuid' })
  subjectDidId: string;

  @ManyToOne(() => Did, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'subject_did_id' })
  subjectDid: Did;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'certificate_type', type: 'varchar' })
  certificateType: string;

  @Column({ name: 'external_reference', type: 'varchar', unique: true })
  externalReference: string;

  @Column({ name: 'vc_id', type: 'uuid' })
  vcId: string;

  @ManyToOne(() => VerifiableCredential, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vc_id' })
  vc: VerifiableCredential;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

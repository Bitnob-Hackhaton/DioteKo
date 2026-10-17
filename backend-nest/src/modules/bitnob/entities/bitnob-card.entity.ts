import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Did } from '../../../modules/did-vc/entities/did.entity';
import { Organization } from '../../../modules/identity/entities/organization.entity';

/**
 * One row per issued Bitnob virtual card. No service writes this table yet —
 * the card-issuing method was removed from `BitnobService` pending
 * verification against Bitnob's real card API; the table/entity are kept so
 * the schema is ready when the card family is rebuilt.
 * `status` is a plain string, deliberately not a strict TS enum:
 * `BitnobWebhookService.dispatchCardEvent` writes whatever `event_type` a
 * Bitnob card-issuing webhook carries directly onto this column (card
 * issuing v2's exact status vocabulary isn't confirmed against live docs
 * yet — no credentials to test against), so the column must accept
 * arbitrary upstream status strings rather than reject anything outside a
 * guessed enum.
 */
@Entity({ name: 'bitnob_cards' })
export class BitnobCard extends BaseEntity {
  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne(() => Organization, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'subject_did_id', type: 'uuid', nullable: true })
  subjectDidId: string | null;

  @ManyToOne(() => Did, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'subject_did_id' })
  subjectDid: Did | null;

  @Column({ name: 'card_id', type: 'varchar' })
  cardId: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: string;
}

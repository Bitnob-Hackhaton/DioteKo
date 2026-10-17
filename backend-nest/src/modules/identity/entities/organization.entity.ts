import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';

export enum OrganizationType {
  HOSPITAL = 'hospital',
  MUNICIPALITY = 'municipality',
  BANK = 'bank',
  UNIVERSITY = 'university',
  MINISTRY = 'ministry',
  NGO = 'ngo',
  MERCHANT = 'merchant',
}

/**
 * An issuing/verifying institution (hospital, municipality, bank, ...).
 * `type` is an app-level enum (plain `varchar`, no Postgres native enum
 * type) so adding a new organization type is a code-only change.
 */
@Entity({ name: 'organizations' })
export class Organization extends BaseEntity {
  @Column({ type: 'varchar' })
  name: string;

  @Column({ type: 'varchar' })
  type: OrganizationType;
}

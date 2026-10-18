import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../../common/entities/base.entity';
import { Organization } from './organization.entity';

export enum AccountStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

/**
 * A person. Can be linked to Appwrite/Google OAuth (`appwriteUserId` + `googleId`, mobile-client
 * holder-side login) and/or have a conventional email+password login
 * (issuer/verifier/admin staff accounts, seed/admin-created, and citizens via POST /auth/register; see
 * AuthService.login/register). `googleId` is the Google `sub` (Appwrite
 * identity `providerUid`): set once at first Google login and never
 * overwritten. `emailVerified` mirrors the identity provider's verification
 * at last login; `accountStatus` is the local kill switch checked before any
 * token is minted. `organizationId` is a plain scalar mirror of the
 * `organization` relation's FK column (same underlying `organization_id`
 * column via `@JoinColumn`) so callers can read/set the id without loading
 * the relation.
 */
@Entity({ name: 'users' })
export class User extends BaseEntity {
  @Column({ type: 'varchar', nullable: true, unique: true })
  email: string | null;

  @Column({ type: 'varchar', nullable: true, unique: true })
  phone: string | null;

  @Column({ name: 'password_hash', type: 'varchar', nullable: true })
  passwordHash: string | null;

  @Column({ name: 'display_name', type: 'varchar', nullable: true })
  displayName: string | null;

  @Column({ name: 'appwrite_user_id', type: 'varchar', nullable: true, unique: true })
  appwriteUserId: string | null;

  @Column({ name: 'google_id', type: 'varchar', nullable: true, unique: true })
  googleId: string | null;

  @Column({ name: 'email_verified', type: 'boolean', default: false })
  emailVerified: boolean;

  @Column({ name: 'account_status', type: 'varchar', length: 20, default: AccountStatus.ACTIVE })
  accountStatus: AccountStatus;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;
}

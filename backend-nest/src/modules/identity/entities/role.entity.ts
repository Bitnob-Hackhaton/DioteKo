import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum RoleCode {
  HOLDER = 'holder',
  ISSUER = 'issuer',
  VERIFIER = 'verifier',
  ADMIN = 'admin',
}

/**
 * Static role catalog (`holder`/`issuer`/`verifier`/`admin`), seeded once.
 * Users get roles via `user_roles`, never a direct column on `users` — see
 * `UserRole`.
 */
@Entity({ name: 'roles' })
export class Role {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', unique: true })
  code: RoleCode;
}

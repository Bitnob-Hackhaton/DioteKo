import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { Role } from './role.entity';
import { User } from './user.entity';

/**
 * Join table granting a role to a user. `(user_id, role_id)` is unique —
 * granting an already-held role is a no-op, never a duplicate row (see
 * `AuthService.ensureRole`).
 */
@Entity({ name: 'user_roles' })
@Unique('UQ_user_roles_user_id_role_id', ['userId', 'roleId'])
export class UserRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;
}

import { AccountStatus, User } from '../entities/user.entity';

/**
 * The only user shape that may leave AuthService in a login response.
 * Deliberately excludes `passwordHash`, `appwriteUserId`,
 * `googleId`, `phone` and `organizationId` — the entity itself must never be
 * serialized to a client.
 */
export interface AuthUserDto {
  id: string;
  email: string | null;
  displayName: string | null;
  emailVerified: boolean;
  accountStatus: AccountStatus;
  googleLinked: boolean;
  roles: string[];
  did: string | null;
}

/** Field-by-field mapper (no spread / Object.assign of the entity). */
export function toAuthUserDto(user: User, roles: string[], did: string | null): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    accountStatus: user.accountStatus,
    googleLinked: Boolean(user.googleId),
    roles: [...roles],
    did,
  };
}

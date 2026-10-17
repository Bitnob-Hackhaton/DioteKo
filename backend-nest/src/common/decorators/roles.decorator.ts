import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

/**
 * Marks a handler/controller as requiring at least one of the given role
 * codes (`holder`, `issuer`, `verifier`, `admin`). Read by `RolesGuard`.
 * Must be paired with `JwtAuthGuard` (or another guard that populates
 * `req.user`) — `RolesGuard` only checks roles, it does not authenticate.
 */
export const Roles = (...roles: string[]): ReturnType<typeof SetMetadata> => SetMetadata(ROLES_KEY, roles);

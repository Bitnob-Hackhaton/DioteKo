import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a handler/controller as not requiring authentication. Read by
 * `JwtAuthGuard` (now registered globally via `APP_GUARD`) to bypass the
 * JWT check for this route. Absence of this decorator means the route is
 * protected by default — this is the escape hatch, not the default.
 */
export const Public = (): ReturnType<typeof SetMetadata> => SetMetadata(IS_PUBLIC_KEY, true);

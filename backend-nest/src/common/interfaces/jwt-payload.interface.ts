/**
 * Shape of our own app-issued JWT payload (HS256, minted by
 * `modules/identity/services/auth.service.ts`). Consumed by
 * `JwtStrategy.validate()` (trusted as-is, no DB round trip per request)
 * and by `@CurrentUser()` / `RolesGuard` downstream.
 *
 * `did` is only present for holders who logged in with Google via Appwrite
 * (`AuthService.completeAppwriteLogin`) — organizations aren't holders, so
 * the conventional staff `AuthService.login()` path omits it. Treat it as
 * optional everywhere it's read.
 */
export interface JwtPayload {
  sub: string;
  roles: string[];
  did?: string;
}

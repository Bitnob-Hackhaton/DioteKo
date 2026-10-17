import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Reads `@Roles(...)` metadata and compares it against `req.user.roles`
 * (populated by `JwtAuthGuard`). Registered globally in `app.module.ts` via
 * `APP_GUARD`, AFTER `JwtAuthGuard` in the providers array — Nest runs
 * global guards in registration order, so `req.user` is populated before
 * this guard runs. Routes without `@Roles(...)` metadata are allowed
 * through (role-agnostic, just needs a valid JWT); routes marked
 * `@Public()` never reach this guard's role check with a populated
 * `req.user` in the first place, but since they also carry no `@Roles(...)`
 * metadata, this guard is a no-op for them regardless.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const userRoles = request.user?.roles ?? [];

    const hasRequiredRole = requiredRoles.some((role) => userRoles.includes(role));
    if (!hasRequiredRole) {
      throw new ForbiddenException('Insufficient role for this operation');
    }

    return true;
  }
}

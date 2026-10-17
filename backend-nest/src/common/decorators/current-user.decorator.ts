import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Pulls the authenticated JWT payload off `req.user` (populated by
 * `JwtAuthGuard` via `JwtStrategy.validate()`). Only valid on routes
 * guarded by `JwtAuthGuard` — elsewhere `req.user` is undefined.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest<Request & { user: JwtPayload }>();
  return request.user;
});

import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Thin wrapper around Passport's `jwt` strategy (see
 * `modules/identity/strategies/jwt.strategy.ts`), registered globally via
 * `APP_GUARD` in `app.module.ts` — every route requires a valid access
 * token by default. Routes/controllers marked `@Public()` bypass the check
 * entirely (`context.getHandler()` before `context.getClass()`, matching
 * `RolesGuard`'s lookup order).
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}

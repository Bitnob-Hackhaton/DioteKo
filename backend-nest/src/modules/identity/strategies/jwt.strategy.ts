import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';

/**
 * Validates our own app-issued HS256 JWT (Bearer token). No DB round trip
 * per request — the signed payload (`sub`, `roles`) is trusted as-is once
 * the signature/expiry check passes. If a user's roles change mid-token,
 * they only take effect on the next refresh (access tokens are short-lived,
 * ~15m, so this is an accepted staleness window).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Pinned to the single algorithm we actually sign with (see
      // `IdentityModule`'s `signOptions`) — without this, passport-jwt/
      // jsonwebtoken will accept any algorithm the token's own header
      // claims, which is the classic HS256/RS256 confusion vector.
      algorithms: ['HS256'],
      secretOrKey: configService.get<string>('jwt.secret', ''),
    });
  }

  validate(payload: JwtPayload): JwtPayload {
    return { sub: payload.sub, roles: payload.roles, ...(payload.did ? { did: payload.did } : {}) };
  }
}

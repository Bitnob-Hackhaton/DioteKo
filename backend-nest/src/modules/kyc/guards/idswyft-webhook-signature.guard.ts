import { CanActivate, ExecutionContext, Injectable, Logger, RawBodyRequest, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request } from 'express';

/** `sha256=` + 64 hex chars (HMAC-SHA256 digest). */
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/i;
const SIGNATURE_HEADER = 'x-idswyft-signature';

export type KycWebhookRequest = RawBodyRequest<Request> & {
  /**
   * Set by this guard: `true` when the HMAC verified, `false` only on the dev no-secret skip path. A `false`
   * event is stored but never acted upon (see `KycWebhookService.handle`).
   */
  kycSignatureValid?: boolean;
};

/**
 * Verifies `X-Idswyft-Signature` on Idswyft webhook deliveries: `sha256=<hex>`, HMAC-SHA256 keyed with the
 * shared secret over the RAW request bytes (never a re-serialization of the parsed body). Idswyft documents no
 * timestamp, so the delivery-id idempotency in `KycWebhookService` is the only replay defense; the webhook is also only
 * a signal — the verdict is re-read from Idswyft before anything is marked verified.
 *
 * Same fail-safe rules as `BitnobWebhookSignatureGuard`, with a stricter environment check: every rejection is a
 * 401 (never a bare Error), the header is validated before `timingSafeEqual`, no secret => 401 unless
 * `NODE_ENV` is exactly `development` or `test` (then allowed with `kycSignatureValid = false`). No database work here.
 */
@Injectable()
export class IdswyftWebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(IdswyftWebhookSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<KycWebhookRequest>();

    const secret = this.config.get<string>('kyc.idswyftWebhookSecret', '');
    // Allow-list, not deny-list: a missing secret is tolerated only in development / test. Production, staging
    // and any unknown environment fail closed.
    const secretOptional = ['development', 'test'].includes(this.config.get<string>('nodeEnv', 'production'));

    if (!secret) {
      if (!secretOptional) {
        this.reject(request, 'no webhook secret configured');
      }
      this.logger.warn('[RESULT] idswyft webhook signature check SKIPPED — no secret configured (dev only)');
      request.kycSignatureValid = false;
      return true;
    }

    const provided = request.headers[SIGNATURE_HEADER];
    const match = typeof provided === 'string' ? SIGNATURE_PATTERN.exec(provided) : null;
    if (!match) {
      this.reject(request, 'missing or malformed x-idswyft-signature header');
    }

    const rawBody = request.rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      this.reject(request, 'raw request body unavailable');
    }

    const expected = crypto.createHmac('sha256', secret).update(rawBody as Buffer).digest();
    const providedBuf = Buffer.from((match as RegExpExecArray)[1], 'hex');
    if (providedBuf.length !== expected.length || !crypto.timingSafeEqual(providedBuf, expected)) {
      this.reject(request, 'signature mismatch');
    }

    request.kycSignatureValid = true;
    return true;
  }

  private reject(request: KycWebhookRequest, reason: string): never {
    this.logger.warn(`[RESULT] idswyft webhook signature rejected reason="${reason}" sourceIp=${request.ip ?? 'n/a'}`);
    throw new UnauthorizedException('Invalid Idswyft webhook signature');
  }
}

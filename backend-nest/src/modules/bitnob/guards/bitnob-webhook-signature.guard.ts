import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  RawBodyRequest,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request } from 'express';
import { sanitizeEventName } from '../withdrawals.util';

/** SHA512 hex digest = 64 bytes = 128 hex chars. */
const SIGNATURE_PATTERN = /^[0-9a-f]{128}$/i;
const SIGNATURE_HEADER = 'x-bitnob-signature';

export type WebhookRequest = RawBodyRequest<Request> & {
  /**
   * Set by this guard: `true` when the `x-bitnob-signature` HMAC verified,
   * `false` only on the dev no-secret skip path. Consumed by
   * `BitnobWebhooksController` -> `BitnobWebhookService.handleWebhookRequest`,
   * where `false` means "persist the event but never dispatch / mutate money".
   */
  bitnobSignatureValid?: boolean;
};

/**
 * Verifies the `x-bitnob-signature` header on Bitnob webhook deliveries:
 * HMAC-**SHA512** over the **raw request body bytes**, hex digest, no prefix
 * (integration-analyst, 2026-08-30 — a DIFFERENT construction from the
 * outbound request-signing scheme in `bitnob-hmac.util.ts`, which is
 * SHA256 over `clientId:ts:nonce:payload`; this guard must NOT reuse it).
 *
 * Bitnob sends no timestamp and documents no replay window, so `event_id`
 * idempotency in `BitnobWebhookService` is the only replay defense.
 *
 * Composition: registered class-level via `@UseGuards` on the still-`@Public()`
 * `BitnobWebhooksController`. `@Public()` is consulted only inside
 * `JwtAuthGuard`; a controller-scoped `@UseGuards` runs regardless, before the
 * route handler — so a forged body is rejected before `BitnobWebhookService`
 * is ever called (no `bitnob_webhook_events` row on a forged delivery).
 *
 * This guard does NO database work — only `ConfigService` + `crypto`.
 *
 * Fail-safe rules (security-analyst M1 / M8):
 *  - every rejection is an `UnauthorizedException` (401), never a bare `Error`
 *    (which the global filter turns into a 500 + stack leak in dev + a Bitnob
 *    retry storm);
 *  - the header is validated (present / single string / 128 hex chars) BEFORE
 *    `crypto.timingSafeEqual`, which throws on a length mismatch;
 *  - secret unset + `production` -> 401 (fail closed); secret unset + non-prod
 *    -> allow, warn loudly, mark `bitnobSignatureValid = false`;
 *  - a rejection logs the source IP and (best-effort) the `event` name.
 */
@Injectable()
export class BitnobWebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(BitnobWebhookSignatureGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<WebhookRequest>();

    const secret = this.config.get<string>('bitnob.webhookSecret', '');
    const isProduction = this.config.get<string>('bitnob.environment', 'sandbox') === 'production';

    if (!secret) {
      if (isProduction) {
        this.reject(request, 'no webhook secret configured (production)');
      }
      this.logger.warn(
        '[RESULT] bitnob webhook signature check SKIPPED — no secret configured (dev only)',
      );
      request.bitnobSignatureValid = false;
      return true;
    }

    const provided = request.headers[SIGNATURE_HEADER];
    if (typeof provided !== 'string' || !SIGNATURE_PATTERN.test(provided)) {
      this.reject(request, 'missing or malformed x-bitnob-signature header');
    }

    const rawBody = request.rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      this.reject(request, 'raw request body unavailable');
    }

    const expected = crypto
      .createHmac('sha512', secret)
      .update(rawBody as Buffer)
      .digest('hex');

    const providedBuf = Buffer.from(provided as string, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      this.reject(request, 'signature mismatch');
    }

    request.bitnobSignatureValid = true;
    return true;
  }

  /**
   * Logs an actionable rejection line (source IP + best-effort `event` name
   * parsed from the raw buffer) and throws `UnauthorizedException`.
   * `access_logs` is unusable here — its `resource_id` is `uuid NOT NULL`.
   */
  private reject(request: WebhookRequest, reason: string): never {
    // Distinguish "JSON.parse threw" from "parsed fine, no `event` key" —
    // different diagnoses for whoever reads the log.
    let eventName = 'unparseable';
    try {
      const parsed = JSON.parse(request.rawBody?.toString('utf8') ?? '{}') as { event?: unknown };
      eventName =
        typeof parsed?.event === 'string' && parsed.event.length > 0
          ? sanitizeEventName(parsed.event)
          : 'absent';
    } catch {
      // best-effort only — leave `eventName` as 'unparseable'
    }
    this.logger.warn(
      `[RESULT] bitnob webhook signature rejected reason="${reason}" sourceIp=${request.ip ?? 'n/a'} event=${eventName}`,
    );
    throw new UnauthorizedException('Invalid Bitnob webhook signature');
  }
}

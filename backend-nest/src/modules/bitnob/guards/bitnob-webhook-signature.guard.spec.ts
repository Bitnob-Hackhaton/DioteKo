import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BitnobWebhookSignatureGuard, WebhookRequest } from './bitnob-webhook-signature.guard';

/**
 * Focus: the guard fails SAFE (401, never a 500) on every malformed input,
 * verifies a hand-computed HMAC-SHA512 over the raw body, and honours the
 * secret-unset fail-closed (prod) / skip-with-warning (dev) split.
 */
describe('BitnobWebhookSignatureGuard', () => {
  const SECRET = 'whsec_test_secret';
  const RAW = Buffer.from('{"event":"transfer.success","event_id":"evt_1","data":{"reference":"dkwd_1"}}');

  function validSignature(body: Buffer = RAW, secret = SECRET): string {
    return crypto.createHmac('sha512', secret).update(body).digest('hex');
  }

  function makeConfig(values: Record<string, unknown>): ConfigService {
    return {
      get: (key: string, def?: unknown) => (key in values ? values[key] : def),
    } as unknown as ConfigService;
  }

  function makeContext(req: Partial<WebhookRequest>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
  }

  function sandboxGuard(): BitnobWebhookSignatureGuard {
    return new BitnobWebhookSignatureGuard(
      makeConfig({ 'bitnob.webhookSecret': SECRET, 'bitnob.environment': 'sandbox' }),
    );
  }

  it('accepts a valid SHA512 HMAC over the raw buffer and marks the request verified', () => {
    const req: Partial<WebhookRequest> = {
      headers: { 'x-bitnob-signature': validSignature() },
      rawBody: RAW,
      ip: '18.171.51.218',
    };
    expect(sandboxGuard().canActivate(makeContext(req))).toBe(true);
    expect(req.bitnobSignatureValid).toBe(true);
  });

  it('rejects a tampered body with 401', () => {
    const req: Partial<WebhookRequest> = {
      headers: { 'x-bitnob-signature': validSignature() },
      rawBody: Buffer.from(RAW.toString('utf8').replace('dkwd_1', 'dkwd_2')),
    };
    expect(() => sandboxGuard().canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects a malformed / wrong-length signature header with 401, not 500 (M1)', () => {
    for (const bad of ['nothex!!', 'abc123', 'g'.repeat(128), '', validSignature().slice(0, 127), `${validSignature()}00`]) {
      const req: Partial<WebhookRequest> = {
        headers: { 'x-bitnob-signature': bad },
        rawBody: RAW,
      };
      expect(() => sandboxGuard().canActivate(makeContext(req))).toThrow(UnauthorizedException);
    }
  });

  it('rejects a header delivered as an array with 401', () => {
    const req: Partial<WebhookRequest> = {
      headers: { 'x-bitnob-signature': [validSignature(), validSignature()] as unknown as string },
      rawBody: RAW,
    };
    expect(() => sandboxGuard().canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects a missing signature header with 401', () => {
    const req: Partial<WebhookRequest> = { headers: {}, rawBody: RAW };
    expect(() => sandboxGuard().canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('rejects when rawBody is missing with 401 (M1)', () => {
    const req: Partial<WebhookRequest> = {
      headers: { 'x-bitnob-signature': validSignature() },
      rawBody: undefined,
    };
    expect(() => sandboxGuard().canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('fails closed when the secret is unset in production', () => {
    const guard = new BitnobWebhookSignatureGuard(
      makeConfig({ 'bitnob.webhookSecret': '', 'bitnob.environment': 'production' }),
    );
    const req: Partial<WebhookRequest> = {
      headers: { 'x-bitnob-signature': validSignature() },
      rawBody: RAW,
    };
    expect(() => guard.canActivate(makeContext(req))).toThrow(UnauthorizedException);
  });

  it('skips verification (allow + signatureValid=false) when the secret is unset in dev', () => {
    const guard = new BitnobWebhookSignatureGuard(
      makeConfig({ 'bitnob.webhookSecret': '', 'bitnob.environment': 'sandbox' }),
    );
    const req: Partial<WebhookRequest> = { headers: {}, rawBody: undefined };
    expect(guard.canActivate(makeContext(req))).toBe(true);
    expect(req.bitnobSignatureValid).toBe(false);
  });
});

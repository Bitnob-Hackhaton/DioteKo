import { ExecutionContext, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { IdswyftWebhookSignatureGuard, KycWebhookRequest } from './idswyft-webhook-signature.guard';

const SECRET = 'a-shared-secret-of-at-least-32-characters';
const BODY = Buffer.from(JSON.stringify({ event: 'verification.completed', verification_id: 'v1' }));
const sign = (body: Buffer, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;

function contextFor(request: Partial<KycWebhookRequest>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function build(values: Record<string, string>) {
  const config = { get: jest.fn((key: string, fallback?: unknown) => (key in values ? values[key] : fallback)) };
  return new IdswyftWebhookSignatureGuard(config as never);
}

describe('IdswyftWebhookSignatureGuard', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const request = (headers: Record<string, unknown>, rawBody: Buffer | null = BODY) =>
    ({ headers, rawBody: rawBody ?? undefined, ip: '10.0.0.1' }) as unknown as KycWebhookRequest;

  it('accepts a correct signature over the raw bytes and marks it valid', () => {
    const req = request({ 'x-idswyft-signature': sign(BODY) });
    expect(build({ 'kyc.idswyftWebhookSecret': SECRET, nodeEnv: 'production' }).canActivate(contextFor(req))).toBe(true);
    expect(req.kycSignatureValid).toBe(true);
  });

  it.each([
    ['a wrong secret', sign(BODY, 'another-secret')],
    ['a tampered body', sign(Buffer.from('{"event":"x"}'))],
    ['no prefix', sign(BODY).replace('sha256=', '')],
    ['a short digest', 'sha256=abcd'],
    ['an empty header', ''],
  ])('rejects %s with a 401', (_label, header) => {
    const req = request({ 'x-idswyft-signature': header });
    expect(() => build({ 'kyc.idswyftWebhookSecret': SECRET, nodeEnv: 'production' }).canActivate(contextFor(req))).toThrow(UnauthorizedException);
  });

  it('rejects a missing header, a repeated header and an unavailable raw body', () => {
    const guard = build({ 'kyc.idswyftWebhookSecret': SECRET, nodeEnv: 'production' });
    expect(() => guard.canActivate(contextFor(request({})))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextFor(request({ 'x-idswyft-signature': [sign(BODY), sign(BODY)] })))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(contextFor(request({ 'x-idswyft-signature': sign(BODY) }, null)))).toThrow(UnauthorizedException);
  });

  it.each(['production', 'staging', 'something-else'])('fails closed without a secret when NODE_ENV=%s', (nodeEnv) => {
    expect(() => build({ nodeEnv }).canActivate(contextFor(request({})))).toThrow(UnauthorizedException);
  });

  it.each(['development', 'test'])('skips the check without a secret when NODE_ENV=%s, flagging the delivery unsigned', (nodeEnv) => {
    const req = request({});
    expect(build({ nodeEnv }).canActivate(contextFor(req))).toBe(true);
    expect(req.kycSignatureValid).toBe(false);
  });
});

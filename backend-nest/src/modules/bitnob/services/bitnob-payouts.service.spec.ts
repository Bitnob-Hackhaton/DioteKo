import { ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  mapBitnobPayoutStatus,
  payoutStatusRank,
  reconcilePayoutStatus,
  stripPayoutPii,
  summarizePayoutError,
} from '../payouts.util';
import { BitnobApiError, BitnobHttpClientService } from './bitnob-http-client.service';
import { BitnobPayoutsService } from './bitnob-payouts.service';

function envelope<T>(data: T) {
  return { success: true, message: 'ok', data, timestamp: '2026-08-30T00:00:00Z' };
}

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    'bitnob.environment': 'sandbox',
    'app.baseUrl': 'http://localhost:3001',
    ...overrides,
  };
  return {
    get: <T>(key: string, defaultValue?: T): T =>
      (key in values ? (values[key] as unknown as T) : (defaultValue as T)),
  } as unknown as ConfigService;
}

const QUOTE_PAYOUT = {
  id: '01a05000-0ebe-7645-98f3-4b75dc04893a',
  quote_id: 'QT2_21052226',
  status: 'QUOTE',
  amount: '0.364578',
  settlement_amount: '500',
};

const INITIATED_PAYOUT = {
  ...QUOTE_PAYOUT,
  status: 'INITIATED',
  beneficiary: { account_number: '0123456789', account_name: 'TEST ACCOUNT HOLDER' },
};

describe('BitnobPayoutsService', () => {
  let http: { post: jest.Mock; get: jest.Mock };
  let service: BitnobPayoutsService;

  beforeEach(() => {
    http = { post: jest.fn(), get: jest.fn() };
    service = new BitnobPayoutsService(http as unknown as BitnobHttpClientService, makeConfig());
  });

  describe('createQuote', () => {
    it('builds the exact snake_case wire body and unwraps data.payout', async () => {
      http.post.mockResolvedValue(envelope({ payout: QUOTE_PAYOUT }));

      const result = await service.createQuote({
        fromAsset: 'USDT',
        toCurrency: 'NGN',
        country: 'NG',
        settlementAmount: '500',
        reference: 'dkpayout_abc',
      });

      expect(http.post).toHaveBeenCalledTimes(1);
      const [path, body] = http.post.mock.calls[0];
      expect(path).toBe('/api/payouts/quotes');
      expect(body).toStrictEqual({
        from_asset: 'USDT',
        to_currency: 'NGN',
        country: 'NG',
        source: 'offchain',
        settlement_amount: '500',
        reference: 'dkpayout_abc',
      });
      expect(result).toBe(QUOTE_PAYOUT);
    });
  });

  describe('initializePayout', () => {
    it('signs the quote_id into the path, builds the beneficiary body, and injects the server callback_url', async () => {
      http.post.mockResolvedValue(envelope({ payout: INITIATED_PAYOUT }));

      await service.initializePayout('QT2_21052226', {
        reference: 'dkpayout_abc',
        paymentReason: 'certificate_service_fee',
        beneficiary: {
          destinationType: 'bank',
          country: 'NG',
          accountName: 'TEST ACCOUNT HOLDER',
          accountNumber: '0123456789',
          bankCode: '000014',
        },
      });

      const [path, body] = http.post.mock.calls[0];
      expect(path).toBe('/api/payouts/QT2_21052226/initialize');
      expect(body).toStrictEqual({
        quote_id: 'QT2_21052226',
        reference: 'dkpayout_abc',
        payment_reason: 'certificate_service_fee',
        callback_url: 'http://localhost:3001/api/bitnob/webhooks',
        beneficiary: {
          destination_type: 'bank',
          country: 'NG',
          account_name: 'TEST ACCOUNT HOLDER',
          account_number: '0123456789',
          bank_code: '000014',
        },
      });
    });

    it('rejects a non-HTTPS callback URL only in production', async () => {
      const prod = new BitnobPayoutsService(
        http as unknown as BitnobHttpClientService,
        makeConfig({ 'bitnob.environment': 'production', 'app.baseUrl': 'http://insecure.example' }),
      );

      await expect(
        prod.initializePayout('QT2_x', {
          reference: 'r',
          paymentReason: 'x',
          beneficiary: {
            destinationType: 'bank',
            country: 'NG',
            accountName: 'A',
            accountNumber: '123456',
            bankCode: '000014',
          },
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('raises a 500 when APP_BASE_URL is unparseable', async () => {
      const broken = new BitnobPayoutsService(
        http as unknown as BitnobHttpClientService,
        makeConfig({ 'app.baseUrl': 'not a url' }),
      );

      await expect(
        broken.initializePayout('QT2_x', {
          reference: 'r',
          paymentReason: 'x',
          beneficiary: {
            destinationType: 'bank',
            country: 'NG',
            accountName: 'A',
            accountNumber: '123456',
            bankCode: '000014',
          },
        }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('finalizePayout', () => {
    it('is hard-disabled in production before any Bitnob call', async () => {
      const prod = new BitnobPayoutsService(
        http as unknown as BitnobHttpClientService,
        makeConfig({ 'bitnob.environment': 'production' }),
      );

      await expect(prod.finalizePayout('QT2_x')).rejects.toBeInstanceOf(ForbiddenException);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('POSTs an empty body to the finalize path in sandbox', async () => {
      http.post.mockResolvedValue(envelope({ payout: { ...QUOTE_PAYOUT, status: 'PROCESSING' } }));

      await service.finalizePayout('QT2_21052226');

      const [path, body] = http.post.mock.calls[0];
      expect(path).toBe('/api/payouts/QT2_21052226/finalize');
      expect(body).toStrictEqual({});
    });
  });

  describe('accountLookup', () => {
    it('encodeURIComponent-escapes every query value into the path', async () => {
      http.get.mockResolvedValue(envelope({ is_verified: true }));

      await service.accountLookup({ country: 'N G', bankCode: '00/14', accountNumber: '0123456789' });

      expect(http.get).toHaveBeenCalledWith(
        '/api/payouts/account-lookup?country=N%20G&bank_code=00%2F14&account_number=0123456789',
      );
    });
  });

  describe('getPayout', () => {
    it('escapes the payout id in the path', async () => {
      http.get.mockResolvedValue(envelope({ payout: QUOTE_PAYOUT }));
      await service.getPayout('01a0/5000');
      expect(http.get).toHaveBeenCalledWith('/api/payouts/01a0%2F5000');
    });
  });
});

describe('payouts.util', () => {
  it('mapBitnobPayoutStatus lowercases the known vocabulary', () => {
    expect(mapBitnobPayoutStatus('QUOTE')).toBe('quote');
    expect(mapBitnobPayoutStatus('INITIATED')).toBe('initiated');
    expect(mapBitnobPayoutStatus('PROCESSING')).toBe('processing');
    expect(mapBitnobPayoutStatus('COMPLETED')).toBe('completed');
    expect(mapBitnobPayoutStatus('FAILED')).toBe('failed');
    expect(mapBitnobPayoutStatus('EXPIRED')).toBe('expired');
  });

  it('mapBitnobPayoutStatus maps any unknown / empty status to "failed" and warns', () => {
    const warn = jest.fn();
    expect(mapBitnobPayoutStatus('SOMETHING_NEW', { warn })).toBe('failed');
    expect(mapBitnobPayoutStatus(undefined, { warn })).toBe('failed');
    expect(mapBitnobPayoutStatus(null, { warn })).toBe('failed');
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('payoutStatusRank is forward-only and groups terminal states', () => {
    expect(payoutStatusRank('quote')).toBeLessThan(payoutStatusRank('initiated'));
    expect(payoutStatusRank('initiated')).toBeLessThan(payoutStatusRank('finalizing'));
    expect(payoutStatusRank('finalizing')).toBeLessThan(payoutStatusRank('processing'));
    expect(payoutStatusRank('completed')).toBe(payoutStatusRank('failed'));
    expect(payoutStatusRank('failed')).toBe(payoutStatusRank('expired'));
    expect(payoutStatusRank('nonsense')).toBe(-1);
  });

  it('reconcilePayoutStatus downgrades a lapsed QUOTE to expired', () => {
    expect(reconcilePayoutStatus({ status: 'QUOTE', expires_at: '2020-01-01T00:00:00Z' })).toBe('expired');
    expect(reconcilePayoutStatus({ status: 'QUOTE', expires_at: '2999-01-01T00:00:00Z' })).toBe('quote');
    expect(reconcilePayoutStatus({ status: 'PROCESSING', expires_at: '2020-01-01T00:00:00Z' })).toBe('processing');
  });

  it('summarizePayoutError returns only the class name for a non-Bitnob Error (no message)', () => {
    // e.g. `unwrapBitnob` throws `new Error(message)` where `message` may
    // contain a beneficiary account number.
    const leaky = new Error('payout to account 0123456789 declined by bank');
    expect(summarizePayoutError(leaky)).toBe('Error');
    expect(summarizePayoutError(leaky)).not.toContain('0123456789');
  });

  it('stripPayoutPii removes beneficiary / account keys, keeps the rest', () => {
    const scrubbed = stripPayoutPii({
      id: 'x',
      status: 'INITIATED',
      beneficiary: { account_number: '123' },
      account_number: '123',
      bank_account_name: 'A',
      exchange_rate: { rate: '1' },
    });
    expect(scrubbed).toStrictEqual({ id: 'x', status: 'INITIATED', exchange_rate: { rate: '1' } });
  });

  it('summarizePayoutError keeps only non-PII RFC 7807 discriminators', () => {
    const err = new BitnobApiError('Bitnob API request failed: Request failed with status code 400', 400, {
      type: 'https://api.bitnob.com/errors/VALIDATION_ERROR',
      title: 'Validation Error',
      detail: "Quote 'QT2_x' has already been initialized",
      code: 'VALIDATION_ERROR',
    });
    const summary = summarizePayoutError(err);
    expect(summary).toContain('status=400');
    expect(summary).toContain('code=VALIDATION_ERROR');
    expect(summary).toContain('title=Validation Error');
    expect(summary).not.toContain('already been initialized');
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BitnobHttpClientService } from './bitnob-http-client.service';
import { BitnobTransactionsService } from './bitnob-transactions.service';
import { BitnobWithdrawalsService } from './bitnob-withdrawals.service';

function envelope<T>(data: T) {
  return { success: true, message: 'ok', data, timestamp: '2026-08-30T00:00:00Z' };
}

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = { 'bitnob.environment': 'sandbox', ...overrides };
  return {
    get: <T>(key: string, dv?: T): T => (key in values ? (values[key] as unknown as T) : (dv as T)),
  } as unknown as ConfigService;
}

describe('BitnobWithdrawalsService', () => {
  let http: { post: jest.Mock; get: jest.Mock };
  let transactions: { list: jest.Mock; getById: jest.Mock };
  let service: BitnobWithdrawalsService;

  const validInput = {
    toAddress: '0xd0438C776d03df4FCfF69db78B97e2E6B5Cf033b',
    amount: '10000000', // 10 USDT — exactly the $10 minimum
    currency: 'USDT',
    chain: 'ethereum',
    reference: 'dkwd_abc',
  };

  beforeEach(() => {
    http = { post: jest.fn(), get: jest.fn() };
    transactions = { list: jest.fn(), getById: jest.fn() };
    service = new BitnobWithdrawalsService(
      http as unknown as BitnobHttpClientService,
      makeConfig(),
      transactions as unknown as BitnobTransactionsService,
    );
  });

  describe('createWithdrawal — production gate (MUST-FIX 1)', () => {
    it('throws ForbiddenException as the first thing, before any Bitnob call', async () => {
      const prod = new BitnobWithdrawalsService(
        http as unknown as BitnobHttpClientService,
        makeConfig({ 'bitnob.environment': 'production' }),
        transactions as unknown as BitnobTransactionsService,
      );

      await expect(prod.createWithdrawal(validInput)).rejects.toBeInstanceOf(ForbiddenException);
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('createWithdrawal — amount / currency backstop (MUST-FIX 4)', () => {
    it('rejects a below-$10 amount without calling Bitnob', async () => {
      await expect(service.createWithdrawal({ ...validInput, amount: '9999999' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(http.post).not.toHaveBeenCalled();
    });

    it('rejects an amount above the per-withdrawal ceiling', async () => {
      await expect(
        service.createWithdrawal({ ...validInput, amount: '1000000000001' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('rejects a non-integer amount (BigInt parse guard)', async () => {
      await expect(service.createWithdrawal({ ...validInput, amount: '10000000x' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a currency outside USDT/USDC', async () => {
      await expect(service.createWithdrawal({ ...validInput, currency: 'BTC' })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('createWithdrawal — happy path', () => {
    it('builds the exact snake_case wire body, maps status, and returns the scrubbed raw body', async () => {
      http.post.mockResolvedValue(
        envelope({ transaction_id: 'tx-1', status: 'pending', tx_hash: '0xdead', fee: '210', memo: 'secret' }),
      );

      const res = await service.createWithdrawal({ ...validInput, description: 'grant' });

      const [path, body] = http.post.mock.calls[0];
      expect(path).toBe('/api/withdrawals');
      expect(body).toStrictEqual({
        to_address: validInput.toAddress,
        amount: '10000000',
        currency: 'USDT',
        chain: 'ethereum',
        reference: 'dkwd_abc',
        description: 'grant',
      });
      expect(res.transactionId).toBe('tx-1');
      expect(res.status).toBe('submitted');
      // S1 — full body persisted, `memo` scrubbed, tx hash + fee kept.
      expect(res.raw).toStrictEqual({ transaction_id: 'tx-1', status: 'pending', tx_hash: '0xdead', fee: '210' });
    });

    it('falls back to data.id when transaction_id is absent', async () => {
      http.post.mockResolvedValue(envelope({ id: 'wd-9', status: 'completed' }));
      const res = await service.createWithdrawal(validInput);
      expect(res.transactionId).toBe('wd-9');
      expect(res.status).toBe('completed');
    });

    it('omits description from the wire body when not supplied', async () => {
      http.post.mockResolvedValue(envelope({ transaction_id: 'tx-1', status: 'completed' }));
      await service.createWithdrawal(validInput);
      expect(http.post.mock.calls[0][1]).not.toHaveProperty('description');
    });
  });

  describe('validateAddress', () => {
    it('reads the `valid` field (probe-verified) and returns the error string when invalid', async () => {
      http.post.mockResolvedValue(
        envelope({ valid: false, address: '0xNOPE', chain: 'ethereum', error: 'invalid address' }),
      );
      expect(await service.validateAddress('0xNOPE', 'ethereum')).toStrictEqual({
        valid: false,
        error: 'invalid address',
      });
    });

    it('returns valid:true / error:null for a good address', async () => {
      http.post.mockResolvedValue(envelope({ valid: true, address: '0xok', chain: 'ethereum' }));
      expect(await service.validateAddress('0xok', 'ethereum')).toStrictEqual({ valid: true, error: null });
    });
  });

  describe('reconcileWithdrawal', () => {
    it('matches by reference + withdrawal-ish type and maps SETTLED -> completed', async () => {
      transactions.getById.mockResolvedValue({
        reference: 'dkwd_abc',
        type: 'crypto_withdrawal',
        state: 'SETTLED',
      });
      expect(await service.reconcileWithdrawal('dkwd_abc')).toMatchObject({ matched: true, status: 'completed' });
    });

    it('does NOT write when the matched transaction type is not a withdrawal', async () => {
      transactions.getById.mockResolvedValue({ reference: 'dkwd_abc', type: 'deposit', state: 'SETTLED' });
      expect(await service.reconcileWithdrawal('dkwd_abc')).toMatchObject({ matched: false });
    });

    it('does NOT write on an unknown transaction state', async () => {
      transactions.getById.mockResolvedValue({ reference: 'dkwd_abc', type: 'withdrawal', state: 'WAT' });
      expect(await service.reconcileWithdrawal('dkwd_abc')).toMatchObject({ matched: false });
    });

    it('falls back to list+filter when getById misses, and reports no match cleanly', async () => {
      transactions.getById.mockRejectedValue(new Error('404'));
      transactions.list.mockResolvedValue({ transactions: [{ reference: 'other', type: 'withdrawal', state: 'SETTLED' }] });
      expect(await service.reconcileWithdrawal('dkwd_abc')).toMatchObject({ matched: false });
    });
  });
});

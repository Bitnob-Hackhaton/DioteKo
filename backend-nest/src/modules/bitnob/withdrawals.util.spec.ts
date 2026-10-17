import {
  emptyToNull,
  isTerminalBulkBatchStatus,
  isTerminalWithdrawalStatus,
  looksLikeWithdrawalTransaction,
  mapBulkBatchStatus,
  mapTransactionStateToWithdrawalStatus,
  mapWithdrawalCreateStatus,
  stripWithdrawalResultPii,
  sumBaseUnitAmounts,
} from './withdrawals.util';

describe('withdrawals.util', () => {
  describe('mapWithdrawalCreateStatus', () => {
    it('maps completed/failed through and pending/empty to submitted', () => {
      expect(mapWithdrawalCreateStatus('completed')).toBe('completed');
      expect(mapWithdrawalCreateStatus('FAILED')).toBe('failed');
      expect(mapWithdrawalCreateStatus('pending')).toBe('submitted');
      expect(mapWithdrawalCreateStatus('')).toBe('submitted');
    });

    it('maps an unknown value to submitted (request WAS accepted) and warns', () => {
      const warn = jest.fn();
      expect(mapWithdrawalCreateStatus('SOMETHING_NEW', { warn })).toBe('submitted');
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('mapTransactionStateToWithdrawalStatus', () => {
    it('maps the known Bitnob transaction states', () => {
      expect(mapTransactionStateToWithdrawalStatus('SETTLED')).toBe('completed');
      expect(mapTransactionStateToWithdrawalStatus('FAILED')).toBe('failed');
      expect(mapTransactionStateToWithdrawalStatus('REVERSED')).toBe('failed');
      expect(mapTransactionStateToWithdrawalStatus('PENDING')).toBe('submitted');
      expect(mapTransactionStateToWithdrawalStatus('IN_PROGRESS')).toBe('submitted');
    });

    it('returns null for an unknown state so the caller does not write', () => {
      expect(mapTransactionStateToWithdrawalStatus('WAT')).toBeNull();
      expect(mapTransactionStateToWithdrawalStatus(undefined)).toBeNull();
    });
  });

  describe('looksLikeWithdrawalTransaction', () => {
    it('accepts withdrawal / transfer-ish types and rejects others', () => {
      expect(looksLikeWithdrawalTransaction('crypto_withdrawal')).toBe(true);
      expect(looksLikeWithdrawalTransaction('onchain_transfer')).toBe(true);
      expect(looksLikeWithdrawalTransaction('payout')).toBe(true);
      expect(looksLikeWithdrawalTransaction('deposit')).toBe(false);
      expect(looksLikeWithdrawalTransaction('swap')).toBe(false);
      expect(looksLikeWithdrawalTransaction(undefined)).toBe(false);
    });
  });

  describe('sumBaseUnitAmounts', () => {
    it('sums with BigInt', () => {
      expect(sumBaseUnitAmounts(['10000000', '20000000', '5000000'])).toBe(35_000_000n);
    });

    it('throws on a non-integer or non-positive entry', () => {
      expect(() => sumBaseUnitAmounts(['10000000', '1.5'])).toThrow();
      expect(() => sumBaseUnitAmounts(['0'])).toThrow();
      expect(() => sumBaseUnitAmounts(['-1'])).toThrow();
    });
  });

  describe('mapBulkBatchStatus', () => {
    it('lowercases the known set and folds pending -> processing', () => {
      expect(mapBulkBatchStatus('PROCESSING')).toBe('processing');
      expect(mapBulkBatchStatus('pending')).toBe('processing');
      expect(mapBulkBatchStatus('completed')).toBe('completed');
    });

    it('returns "" (leave local status unchanged) on an unknown value and warns', () => {
      const warn = jest.fn();
      expect(mapBulkBatchStatus('???', { warn })).toBe('');
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('terminal-status guards', () => {
    it('isTerminalWithdrawalStatus', () => {
      expect(isTerminalWithdrawalStatus('completed')).toBe(true);
      expect(isTerminalWithdrawalStatus('failed')).toBe(true);
      expect(isTerminalWithdrawalStatus('submitted')).toBe(false);
    });

    it('isTerminalBulkBatchStatus', () => {
      expect(isTerminalBulkBatchStatus('completed')).toBe(true);
      expect(isTerminalBulkBatchStatus('cancelled')).toBe(true);
      expect(isTerminalBulkBatchStatus('confirming')).toBe(false);
      expect(isTerminalBulkBatchStatus('confirm_uncertain')).toBe(false);
    });
  });

  describe('stripWithdrawalResultPii', () => {
    it('drops memo / sender / account-ish keys, keeps the rest', () => {
      expect(
        stripWithdrawalResultPii({
          transaction_id: 't1',
          status: 'pending',
          memo: 'salary for jane doe',
          sender: 'acct-9',
          address: '0xabc',
          beneficiary_name: 'X',
        }),
      ).toStrictEqual({ transaction_id: 't1', status: 'pending', address: '0xabc' });
    });
  });

  describe('emptyToNull', () => {
    it('turns Bitnob empty-string "null" into real null, leaves other values', () => {
      expect(emptyToNull('')).toBeNull();
      expect(emptyToNull('   ')).toBeNull();
      expect(emptyToNull('x')).toBe('x');
      expect(emptyToNull(0)).toBe(0);
      expect(emptyToNull(null)).toBeNull();
    });
  });
});

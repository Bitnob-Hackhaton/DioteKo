import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Repository } from 'typeorm';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { AccessLogService } from '../../consent/services/access-log.service';
import { BitnobPayout } from '../entities/bitnob-payout.entity';
import { BitnobWithdrawal } from '../entities/bitnob-withdrawal.entity';
import { BitnobApiError } from '../services/bitnob-http-client.service';
import { BitnobBulkTransfersService } from '../services/bitnob-bulk-transfers.service';
import { BitnobPayoutsService } from '../services/bitnob-payouts.service';
import { BitnobWithdrawalsService } from '../services/bitnob-withdrawals.service';
import { BitnobMoneyController } from './bitnob-money.controller';

const UUID = '11111111-1111-4111-8111-111111111111';
const ADMIN: JwtPayload = { sub: 'admin-user-1', roles: ['admin'] };

describe('BitnobMoneyController — money-moving routes', () => {
  let payoutsService: {
    createQuote: jest.Mock;
    initializePayout: jest.Mock;
    finalizePayout: jest.Mock;
    getPayout: jest.Mock;
  };
  let accessLog: { record: jest.Mock };
  let repo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let withdrawalsService: {
    validateAddress: jest.Mock;
    createWithdrawal: jest.Mock;
    reconcileWithdrawal: jest.Mock;
  };
  let bulkTransfersService: {
    createDraft: jest.Mock;
    getLocalBatchWithItems: jest.Mock;
    confirmBatch: jest.Mock;
    retryItems: jest.Mock;
    listBatches: jest.Mock;
    reconcileBatch: jest.Mock;
  };
  let withdrawalsRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let controller: BitnobMoneyController;

  beforeEach(() => {
    payoutsService = {
      createQuote: jest.fn(),
      initializePayout: jest.fn(),
      finalizePayout: jest.fn(),
      getPayout: jest.fn(),
    };
    accessLog = { record: jest.fn().mockResolvedValue(undefined) };
    repo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: UUID, ...x })),
      findOne: jest.fn(),
      update: jest.fn(),
    };
    withdrawalsService = {
      validateAddress: jest.fn(),
      createWithdrawal: jest.fn(),
      reconcileWithdrawal: jest.fn(),
    };
    bulkTransfersService = {
      createDraft: jest.fn(),
      getLocalBatchWithItems: jest.fn(),
      confirmBatch: jest.fn(),
      retryItems: jest.fn(),
      listBatches: jest.fn(),
      reconcileBatch: jest.fn(),
    };
    withdrawalsRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: UUID, ...x })),
      findOne: jest.fn(),
    };
    controller = new BitnobMoneyController(
      payoutsService as unknown as BitnobPayoutsService,
      accessLog as unknown as AccessLogService,
      repo as unknown as Repository<BitnobPayout>,
      withdrawalsService as unknown as BitnobWithdrawalsService,
      bulkTransfersService as unknown as BitnobBulkTransfersService,
      withdrawalsRepo as unknown as Repository<BitnobWithdrawal>,
    );
  });

  describe('createQuote', () => {
    it('marks the row "failed" (not left at "quote") when the Bitnob quote throws', async () => {
      payoutsService.createQuote.mockRejectedValue(new BitnobApiError('Bitnob API request failed: boom', 500, null));

      await expect(
        controller.createQuote({ fromAsset: 'USDT', toCurrency: 'NGN', country: 'NG', settlementAmount: '500' }),
      ).rejects.toBeInstanceOf(BitnobApiError);

      const lastSave = repo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('failed');
    });
  });

  describe('initialize', () => {
    it('writes a best-effort audit row on success with the acting admin id', async () => {
      repo.findOne.mockResolvedValue({
        id: UUID,
        status: 'quote',
        quoteId: 'QT2_1',
        reference: `dkpayout_${UUID}`,
      });
      payoutsService.initializePayout.mockResolvedValue({ id: 'bp-1', status: 'INITIATED' });

      await controller.initialize(
        UUID,
        {
          paymentReason: 'x',
          beneficiary: {
            destinationType: 'bank',
            country: 'NG',
            accountName: 'A',
            accountNumber: '0123456789',
            bankCode: '000014',
          },
        },
        ADMIN,
      );

      expect(accessLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'payout',
          actorUserId: 'admin-user-1',
          resourceId: UUID,
          metadata: { reference: `dkpayout_${UUID}` },
        }),
      );
    });
  });

  describe('finalize', () => {
    const initiatedRow = { id: UUID, status: 'initiated', quoteId: 'QT2_1', bitnobPayoutId: 'bp-1', reference: 'r' };

    it('409s when the atomic initiated -> finalizing swap affects 0 rows', async () => {
      repo.findOne.mockResolvedValue({ ...initiatedRow, status: 'processing' });
      repo.update.mockResolvedValue({ affected: 0 });

      await expect(controller.finalize(UUID, ADMIN)).rejects.toBeInstanceOf(ConflictException);
      expect(payoutsService.getPayout).not.toHaveBeenCalled();
      expect(payoutsService.finalizePayout).not.toHaveBeenCalled();
    });

    it('disburses and moves to "processing" when it wins the swap and remote is INITIATED', async () => {
      repo.findOne.mockResolvedValue({ ...initiatedRow });
      repo.update.mockResolvedValue({ affected: 1 });
      payoutsService.getPayout.mockResolvedValue({ status: 'INITIATED' });
      payoutsService.finalizePayout.mockResolvedValue({ status: 'PROCESSING' });

      const res = await controller.finalize(UUID, ADMIN);

      expect(payoutsService.finalizePayout).toHaveBeenCalledWith('QT2_1');
      expect(res.payout.status).toBe('processing');
    });

    it('reverts the row to "initiated" and rethrows when finalize is blocked in production', async () => {
      repo.findOne.mockResolvedValue({ ...initiatedRow });
      repo.update.mockResolvedValue({ affected: 1 });
      payoutsService.getPayout.mockResolvedValue({ status: 'INITIATED' });
      payoutsService.finalizePayout.mockRejectedValue(new ForbiddenException('disabled in production'));

      await expect(controller.finalize(UUID, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);

      const lastSave = repo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('initiated');
    });

    it('surfaces a 503 (not 500) and reverts when the pre-finalize getPayout read fails', async () => {
      repo.findOne.mockResolvedValue({ ...initiatedRow });
      repo.update.mockResolvedValue({ affected: 1 });
      payoutsService.getPayout.mockRejectedValue(new BitnobApiError('Bitnob API request failed: timeout', null, null));

      await expect(controller.finalize(UUID, ADMIN)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(payoutsService.finalizePayout).not.toHaveBeenCalled();
      const lastSave = repo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('initiated');
    });

    it('maps a raw Bitnob finalize rejection to 502 (not a bare 500) and reverts', async () => {
      repo.findOne.mockResolvedValue({ ...initiatedRow });
      repo.update.mockResolvedValue({ affected: 1 });
      payoutsService.getPayout.mockResolvedValue({ status: 'INITIATED' });
      payoutsService.finalizePayout.mockRejectedValue(
        new BitnobApiError('Bitnob API request failed: Request failed with status code 422', 422, null),
      );

      await expect(controller.finalize(UUID, ADMIN)).rejects.toBeInstanceOf(BadGatewayException);
      const lastSave = repo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('initiated');
    });
  });

  // === Increment 4 — withdrawals + bulk transfers ==========================

  describe('createWithdrawal', () => {
    const dto = {
      toAddress: '0xd0438C776d03df4FCfF69db78B97e2E6B5Cf033b',
      amount: '10000000',
      currency: 'USDT',
      chain: 'ethereum',
    };

    it('persists a row, calls the service with a dkwd_ reference, persists the scrubbed raw, audits WITHDRAWAL', async () => {
      withdrawalsService.createWithdrawal.mockResolvedValue({
        transactionId: 'tx-1',
        status: 'submitted',
        raw: { transaction_id: 'tx-1', status: 'pending', tx_hash: '0xabc' },
      });

      const res = await controller.createWithdrawal(dto as never, ADMIN);

      expect(withdrawalsService.createWithdrawal).toHaveBeenCalledWith(
        expect.objectContaining({ reference: `dkwd_${UUID}`, amount: '10000000', currency: 'USDT' }),
      );
      const saved = withdrawalsRepo.save.mock.calls.at(-1)?.[0];
      expect(saved.rawResult).toStrictEqual({ transaction_id: 'tx-1', status: 'pending', tx_hash: '0xabc' });
      expect(accessLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'withdrawal', actorUserId: 'admin-user-1', resourceId: UUID }),
      );
      expect(res.withdrawal.status).toBe('submitted');
    });

    it('DEFINITE rejection: prod gate (HttpException) -> row failed, reference null, rethrown', async () => {
      withdrawalsService.createWithdrawal.mockRejectedValue(new ForbiddenException('disabled in production'));

      await expect(controller.createWithdrawal(dto as never, ADMIN)).rejects.toBeInstanceOf(ForbiddenException);
      const lastSave = withdrawalsRepo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('failed');
      expect(lastSave.reference ?? null).toBeNull();
    });

    it('DEFINITE rejection: Bitnob 422 -> row failed + reference null + 502; Bitnob 409 -> ConflictException', async () => {
      withdrawalsService.createWithdrawal.mockRejectedValue(
        new BitnobApiError('Bitnob API request failed: 422', 422, null),
      );
      await expect(controller.createWithdrawal(dto as never, ADMIN)).rejects.toBeInstanceOf(BadGatewayException);
      let lastSave = withdrawalsRepo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('failed');
      expect(lastSave.reference ?? null).toBeNull();

      withdrawalsService.createWithdrawal.mockRejectedValue(
        new BitnobApiError('Bitnob API request failed: 409', 409, null),
      );
      await expect(controller.createWithdrawal(dto as never, ADMIN)).rejects.toBeInstanceOf(ConflictException);
    });

    it('B2 INDETERMINATE: network error (BitnobApiError.status === null) -> row submitted + reference PERSISTED + 502', async () => {
      withdrawalsService.createWithdrawal.mockRejectedValue(
        new BitnobApiError('Bitnob API request failed: socket hang up', null, null),
      );

      await expect(controller.createWithdrawal(dto as never, ADMIN)).rejects.toBeInstanceOf(BadGatewayException);

      const lastSave = withdrawalsRepo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('submitted');
      expect(lastSave.status).not.toBe('failed');
      expect(lastSave.reference).toBe(`dkwd_${UUID}`);
      expect(lastSave.rawResult).toMatchObject({ indeterminate: true });
    });
  });

  describe('reconcileWithdrawal', () => {
    it('polls for a non-terminal "submitted" row and applies a matched status', async () => {
      withdrawalsRepo.findOne.mockResolvedValue({ id: UUID, status: 'submitted', reference: `dkwd_${UUID}` });
      withdrawalsService.reconcileWithdrawal.mockResolvedValue({ matched: true, status: 'completed', detail: 'ok' });

      const res = await controller.reconcileWithdrawal(UUID);

      expect(withdrawalsService.reconcileWithdrawal).toHaveBeenCalledWith(`dkwd_${UUID}`);
      expect(res.reconciled).toBe(true);
      const saved = withdrawalsRepo.save.mock.calls.at(-1)?.[0];
      expect(saved.status).toBe('completed');
    });

    it('does NOT poll a terminal "failed" row (nothing to reconcile)', async () => {
      withdrawalsRepo.findOne.mockResolvedValue({ id: UUID, status: 'failed', reference: null });

      const res = await controller.reconcileWithdrawal(UUID);

      expect(withdrawalsService.reconcileWithdrawal).not.toHaveBeenCalled();
      expect(res.reconciled).toBe(false);
    });
  });

  describe('createBulkTransfer', () => {
    const item = (address: string) => ({ chain: 'ethereum', currency: 'USDT', address, amount: '10000000' });

    it('forwards the mapped items to the service and audits BULK_TRANSFER on success', async () => {
      bulkTransfersService.createDraft.mockResolvedValue({
        batch: { id: UUID, status: 'draft', totalItems: 1, totalAmount: '10000000', idempotencyKey: null },
        items: [{ id: 'i1', batchId: UUID, amount: '10000000', status: 'pending' }],
      });

      const res = await controller.createBulkTransfer({ items: [item('0xBBB0000000000000000')] } as never, ADMIN);

      expect(bulkTransfersService.createDraft).toHaveBeenCalledWith(
        expect.objectContaining({ items: [expect.objectContaining({ address: '0xBBB0000000000000000', amount: '10000000' })] }),
      );
      expect(res.batch.status).toBe('draft');
      expect(accessLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bulk_transfer', resourceId: UUID }),
      );
    });

    it('propagates the service 400 for an intra-batch duplicate address (guard now lives in the service)', async () => {
      bulkTransfersService.createDraft.mockRejectedValue(new BadRequestException('duplicate destination addresses'));

      await expect(
        controller.createBulkTransfer({ items: [item('0xAAA0000000000000000')] } as never, ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('confirmBulkTransfer', () => {
    it('rethrows the service 409 (wrong expectedTotal) and audits an ERROR row', async () => {
      bulkTransfersService.confirmBatch.mockRejectedValue(new ConflictException('Batch no longer matches'));

      await expect(
        controller.confirmBulkTransfer(UUID, { expectedTotal: '1', expectedItemCount: 1 } as never, ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(accessLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'bulk_transfer', result: 'error' }),
      );
    });
  });
});

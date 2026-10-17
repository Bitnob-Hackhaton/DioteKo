import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { BitnobBulkBatch } from '../entities/bitnob-bulk-batch.entity';
import { BitnobBulkBatchItem } from '../entities/bitnob-bulk-batch-item.entity';
import { BitnobApiError, BitnobHttpClientService } from './bitnob-http-client.service';
import { BitnobBulkTransfersService } from './bitnob-bulk-transfers.service';

function envelope<T>(data: T) {
  return { success: true, message: 'ok', data, timestamp: '2026-08-30T00:00:00Z' };
}

function makeConfig(env = 'sandbox'): ConfigService {
  return {
    get: <T>(key: string, dv?: T): T => (key === 'bitnob.environment' ? (env as unknown as T) : (dv as T)),
  } as unknown as ConfigService;
}

const BATCH_ID = '11111111-1111-4111-8111-111111111111';

/** Two persisted items totalling 30 USDT (10 + 20). */
const ITEMS = [
  { id: 'item-1', batchId: BATCH_ID, rowIndex: 1, amount: '10000000', status: 'pending', bitnobItemId: 'b-1' },
  { id: 'item-2', batchId: BATCH_ID, rowIndex: 2, amount: '20000000', status: 'pending', bitnobItemId: 'b-2' },
];

describe('BitnobBulkTransfersService', () => {
  let http: { post: jest.Mock; get: jest.Mock };
  let batchesRepo: { findOne: jest.Mock; save: jest.Mock; update: jest.Mock };
  let itemsRepo: {
    find: jest.Mock;
    findBy: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    increment: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let service: BitnobBulkTransfersService;

  function build(env = 'sandbox'): BitnobBulkTransfersService {
    return new BitnobBulkTransfersService(
      http as unknown as BitnobHttpClientService,
      makeConfig(env),
      dataSource as unknown as DataSource,
      batchesRepo as unknown as Repository<BitnobBulkBatch>,
      itemsRepo as unknown as Repository<BitnobBulkBatchItem>,
    );
  }

  beforeEach(() => {
    http = { post: jest.fn(), get: jest.fn() };
    batchesRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (x) => x),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    itemsRepo = {
      find: jest.fn().mockResolvedValue(ITEMS),
      findBy: jest.fn(),
      save: jest.fn(async (x) => x),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      increment: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) =>
        cb({
          create: (_e: unknown, obj: Record<string, unknown>) => ({ id: BATCH_ID, ...obj }),
          save: async (x: unknown) => x,
        }),
      ),
    };
    service = build();
  });

  const draftBatch = () => ({ id: BATCH_ID, status: 'draft', bitnobBatchId: 'bat-1' });

  describe('production gate (MUST-FIX 1)', () => {
    it('confirmBatch throws ForbiddenException before the CAS and before Bitnob', async () => {
      const prod = build('production');
      await expect(
        prod.confirmBatch(BATCH_ID, { expectedTotal: '30000000', expectedItemCount: 2 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(batchesRepo.update).not.toHaveBeenCalled();
      expect(http.post).not.toHaveBeenCalled();
    });

    it('createDraft is disabled in production', async () => {
      const prod = build('production');
      await expect(
        prod.createDraft({ items: [{ chain: 'ethereum', currency: 'USDT', address: 'a'.repeat(20), amount: '10000000' }] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('retryItems is disabled in production', async () => {
      const prod = build('production');
      await expect(prod.retryItems(BATCH_ID, ['item-1'])).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('confirmBatch — review gate (MUST-FIX 2c)', () => {
    it('409s on an item-count mismatch, before the CAS and before Bitnob', async () => {
      batchesRepo.findOne.mockResolvedValue(draftBatch());
      await expect(
        service.confirmBatch(BATCH_ID, { expectedTotal: '30000000', expectedItemCount: 3 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(batchesRepo.update).not.toHaveBeenCalled();
      expect(http.post).not.toHaveBeenCalled();
    });

    it('409s on a total mismatch, before the CAS and before Bitnob', async () => {
      batchesRepo.findOne.mockResolvedValue(draftBatch());
      await expect(
        service.confirmBatch(BATCH_ID, { expectedTotal: '30000001', expectedItemCount: 2 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(http.post).not.toHaveBeenCalled();
    });

    it('409s when the (matching) total exceeds BULK_BATCH_MAX_TOTAL_BASE_UNITS — before the CAS', async () => {
      batchesRepo.findOne.mockResolvedValue(draftBatch());
      // 2 x 6,000,000,000,000 = 12e12 > the 10e12 cap.
      itemsRepo.find.mockResolvedValue([
        { id: 'x1', batchId: BATCH_ID, amount: '6000000000000' },
        { id: 'x2', batchId: BATCH_ID, amount: '6000000000000' },
      ]);
      await expect(
        service.confirmBatch(BATCH_ID, { expectedTotal: '12000000000000', expectedItemCount: 2 }),
      ).rejects.toThrow(/exceeds the maximum/i);
      expect(batchesRepo.update).not.toHaveBeenCalled();
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('confirmBatch — atomic CAS (MUST-FIX 2a)', () => {
    it('409s when the draft -> confirming swap affects 0 rows', async () => {
      batchesRepo.findOne.mockResolvedValue(draftBatch());
      batchesRepo.update.mockResolvedValue({ affected: 0 });
      await expect(
        service.confirmBatch(BATCH_ID, { expectedTotal: '30000000', expectedItemCount: 2 }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(http.post).not.toHaveBeenCalled();
    });
  });

  describe('confirmBatch — failure never reverts to draft (MUST-FIX 3)', () => {
    it('leaves the batch at confirm_uncertain and maps to 502 when Bitnob confirm throws', async () => {
      batchesRepo.findOne.mockResolvedValue(draftBatch());
      http.post.mockRejectedValue(
        new BitnobApiError('Bitnob API request failed: Request failed with status code 500', 500, null),
      );

      await expect(
        service.confirmBatch(BATCH_ID, { expectedTotal: '30000000', expectedItemCount: 2 }),
      ).rejects.toBeInstanceOf(BadGatewayException);

      const lastSave = batchesRepo.save.mock.calls.at(-1)?.[0];
      expect(lastSave.status).toBe('confirm_uncertain');
      expect(lastSave.status).not.toBe('draft');
    });

    it('happy path -> processing + submittedAt set', async () => {
      batchesRepo.findOne.mockResolvedValue(draftBatch());
      http.post.mockResolvedValue(envelope({ batch: { id: 'bat-1', status: 'processing' } }));

      const { batch } = await service.confirmBatch(BATCH_ID, { expectedTotal: '30000000', expectedItemCount: 2 });

      expect(batch.status).toBe('processing');
      expect(batch.submittedAt).toBeInstanceOf(Date);
      const [path, body] = http.post.mock.calls[0];
      expect(path).toBe('/api/bulk-transfers/bat-1/confirm');
      expect(body).toStrictEqual({});
    });
  });

  describe('createDraft', () => {
    const oneItem = { chain: 'ethereum', currency: 'USDT', address: 'a'.repeat(20), amount: '10000000' };

    it('returns the existing batch without a second Bitnob call on an idempotency-key hit', async () => {
      batchesRepo.findOne.mockResolvedValue({ id: BATCH_ID, status: 'draft', idempotencyKey: 'k1' });
      itemsRepo.find.mockResolvedValue(ITEMS);

      const res = await service.createDraft({ idempotencyKey: 'k1', items: [oneItem] });

      expect(res.batch.id).toBe(BATCH_ID);
      expect(http.post).not.toHaveBeenCalled();
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects an intra-batch duplicate destination address (service self-guard)', async () => {
      await expect(
        service.createDraft({
          items: [oneItem, { ...oneItem, address: oneItem.address.toUpperCase() }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('builds the exact snake_case wire body and defaults idempotency_key to dkbulk_<id>', async () => {
      http.post.mockResolvedValue(envelope({ batch: { id: 'bat-remote', status: 'draft' }, items: [] }));

      await service.createDraft({ items: [oneItem] });

      const [path, body] = http.post.mock.calls[0];
      expect(path).toBe('/api/bulk-transfers');
      expect(body).toStrictEqual({
        idempotency_key: `dkbulk_${BATCH_ID}`,
        items: [
          {
            row_index: 1,
            chain: 'ethereum',
            currency: 'USDT',
            address: 'a'.repeat(20),
            amount: '10000000',
          },
        ],
      });
    });
  });

  describe('retryItems', () => {
    beforeEach(() => {
      batchesRepo.findOne.mockResolvedValue({ id: BATCH_ID, status: 'failed', bitnobBatchId: 'bat-1' });
      itemsRepo.findBy.mockResolvedValue([{ id: 'item-1', status: 'failed', bitnobItemId: 'b-1', retries: 0 }]);
    });

    it('B1: 409s (concurrent retry) when the atomic failed -> processing claim falls short', async () => {
      itemsRepo.update.mockResolvedValue({ affected: 0 });

      await expect(service.retryItems(BATCH_ID, ['item-1'])).rejects.toBeInstanceOf(ConflictException);
      expect(http.post).not.toHaveBeenCalled();
      expect(itemsRepo.increment).not.toHaveBeenCalled();
    });

    it('B1: a Bitnob-call failure leaves the items NON-failed (no revert) and maps to 502', async () => {
      itemsRepo.update.mockResolvedValue({ affected: 1 });
      http.post.mockRejectedValue(new BitnobApiError('Bitnob API request failed: 500', 500, null));

      await expect(service.retryItems(BATCH_ID, ['item-1'])).rejects.toBeInstanceOf(BadGatewayException);

      // The only status write is the claim (-> 'processing'); nothing reverts to 'failed'.
      const statusWrites = itemsRepo.update.mock.calls
        .map((c) => c[1])
        .filter((patch) => patch && 'status' in patch);
      expect(statusWrites).toStrictEqual([{ status: 'processing' }]);
      expect(itemsRepo.save).not.toHaveBeenCalled();
    });

    it('claims atomically, bumps retries, sends the Bitnob item ids', async () => {
      itemsRepo.update.mockResolvedValue({ affected: 1 });
      http.post.mockResolvedValue(envelope({ batch: { id: 'bat-1', status: 'processing' } }));

      await service.retryItems(BATCH_ID, ['item-1']);

      expect(itemsRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: BATCH_ID, status: 'failed' }),
        { status: 'processing' },
      );
      expect(itemsRepo.increment).toHaveBeenCalledWith(
        expect.objectContaining({ batchId: BATCH_ID }),
        'retries',
        1,
      );
      const [path, body] = http.post.mock.calls[0];
      expect(path).toBe('/api/bulk-transfers/bat-1/retry');
      expect(body).toStrictEqual({ item_ids: ['b-1'] });
    });
  });
});

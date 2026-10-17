import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { KycWebhookService } from './kyc-webhook.service';

describe('KycWebhookService', () => {
  let eventsRepo: Record<string, jest.Mock>;
  let queryBuilder: { update: jest.Mock; set: jest.Mock; where: jest.Mock; execute: jest.Mock };
  let kyc: { findByProviderVerificationId: jest.Mock; refreshFromProvider: jest.Mock };
  let service: KycWebhookService;

  const payload = {
    event: 'verification.completed',
    user_id: 'user-1',
    verification_id: 'prov-1',
    status: 'verified',
    timestamp: '2026-10-16T10:00:00Z',
    data: { ocr_data: { full_name: 'Awa Ndiaye', document_number: 'X123456' } },
  };

  beforeEach(() => {
    queryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    eventsRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: Record<string, unknown>) => ({ id: 'evt-1', processed: false, ...v })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    kyc = {
      findByProviderVerificationId: jest.fn().mockResolvedValue({ id: 'kyc-1', userId: 'user-1' }),
      refreshFromProvider: jest.fn().mockResolvedValue(undefined),
    };
    service = new KycWebhookService(eventsRepo as never, kyc as never);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('stores only four scalar fields: no OCR data, no document number, no name', async () => {
    await service.handle('d-1', payload, true);

    const stored = eventsRepo.create.mock.calls[0][0] as { payload: Record<string, unknown> };
    expect(stored.payload).toEqual({
      event: 'verification.completed',
      verification_id: 'prov-1',
      status: 'verified',
      timestamp: '2026-10-16T10:00:00Z',
    });
    expect(JSON.stringify(eventsRepo.create.mock.calls)).not.toMatch(/Ndiaye|X123456|user-1/);
  });

  it('treats the delivery as a signal: re-reads the verdict from the provider and marks the event processed', async () => {
    const result = await service.handle('d-1', payload, true);

    expect(kyc.refreshFromProvider).toHaveBeenCalledWith({ id: 'kyc-1', userId: 'user-1' });
    expect(eventsRepo.update).toHaveBeenCalledWith({ id: 'evt-1' }, { processed: true, processingError: null });
    expect(result).toEqual({ received: true });
  });

  it('does not refresh for an event that is not a verdict', async () => {
    await service.handle('d-2', { ...payload, event: 'verification.started' }, true);
    expect(kyc.refreshFromProvider).not.toHaveBeenCalled();
  });

  it('ignores an unknown verification id but still closes the event', async () => {
    kyc.findByProviderVerificationId.mockResolvedValue(null);
    await service.handle('d-3', payload, true);
    expect(kyc.refreshFromProvider).not.toHaveBeenCalled();
    expect(eventsRepo.update).toHaveBeenCalledWith({ id: 'evt-1' }, { processed: true, processingError: 'unknown_verification' });
  });

  it('stores an unsigned delivery (dev, no secret) but never acts on it', async () => {
    await service.handle('d-4', payload, false);
    expect(kyc.refreshFromProvider).not.toHaveBeenCalled();
    expect(eventsRepo.update).toHaveBeenCalledWith({ id: 'evt-1' }, { processed: true, processingError: 'unsigned' });
  });

  it('answers a redelivery of a processed event as a duplicate, without refreshing', async () => {
    eventsRepo.findOne.mockResolvedValue({ id: 'evt-1', processed: true, signatureValid: true });
    const result = await service.handle('d-1', payload, true);
    expect(result).toEqual({ received: true, duplicate: true });
    expect(kyc.refreshFromProvider).not.toHaveBeenCalled();
  });

  it('answers a concurrent duplicate (unique violation on event_id) as a duplicate', async () => {
    const violation = new QueryFailedError('insert', [], Object.assign(new Error('dup'), { code: '23505' }));
    eventsRepo.save.mockRejectedValue(violation);
    const result = await service.handle('d-1', payload, true);
    expect(result).toEqual({ received: true, duplicate: true });
  });

  it('lets only the worker holding the claim process a redelivery', async () => {
    eventsRepo.findOne.mockResolvedValue({ id: 'evt-1', processed: false, signatureValid: true });
    queryBuilder.execute.mockResolvedValue({ affected: 0 });
    const result = await service.handle('d-1', payload, true);
    expect(result).toEqual({ received: true, duplicate: true });
    expect(kyc.refreshFromProvider).not.toHaveBeenCalled();
  });

  it('answers 503 and releases the claim when the verdict cannot be read back, so Idswyft redelivers', async () => {
    kyc.refreshFromProvider.mockRejectedValue(new Error('network'));

    await expect(service.handle('d-1', payload, true)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(eventsRepo.update).toHaveBeenCalledWith({ id: 'evt-1' }, { processingError: 'refresh_failed:Error', processingStartedAt: null });
    expect(eventsRepo.update).not.toHaveBeenCalledWith({ id: 'evt-1' }, expect.objectContaining({ processed: true }));
  });
});

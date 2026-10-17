import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { LightningInvoice, LightningInvoiceStatus, LightningProvider } from '../entities/lightning-invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { LightningInvoicesService } from './lightning-invoices.service';

/**
 * The ledger side of Lightning pay-in: where an invoice and its payment become paid or closed. These are
 * the transitions the money flow depends on, so they are tested directly (the callers mock them).
 */
describe('LightningInvoicesService (ledger)', () => {
  let manager: { create: jest.Mock; save: jest.Mock; update: jest.Mock; findOne: jest.Mock };
  let invoicesRepo: { manager: { transaction: jest.Mock }; findOne: jest.Mock; find: jest.Mock };
  let service: LightningInvoicesService;
  let errorSpy: jest.SpyInstance;

  const makeInvoice = (over: Partial<LightningInvoice> = {}): LightningInvoice =>
    ({
      id: 'inv-1',
      provider: LightningProvider.BITNOB,
      externalId: 'bn-1',
      paymentHash: 'hash-1',
      status: LightningInvoiceStatus.PENDING,
      paidAt: null,
      ...over,
    }) as LightningInvoice;

  beforeEach(() => {
    manager = {
      create: jest.fn((_entity: unknown, obj: Record<string, unknown>) => ({ ...obj })),
      save: jest.fn(async (x: Record<string, unknown>) => ({ id: 'row-' + (x.paymentHash ? 'inv' : 'pay'), ...x })),
      update: jest.fn(async () => ({ affected: 1 })),
      findOne: jest.fn(),
    };
    invoicesRepo = {
      manager: { transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)) },
      findOne: jest.fn(),
      find: jest.fn(async () => []),
    };
    service = new LightningInvoicesService(invoicesRepo as unknown as Repository<LightningInvoice>);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('listPendingByProvider', () => {
    const where = { provider: LightningProvider.BITNOB, status: LightningInvoiceStatus.PENDING };

    it('reads the newest half AND the oldest half, so an old pending invoice is never starved', async () => {
      const newest = [makeInvoice({ id: 'n1' })];
      const oldest = [makeInvoice({ id: 'o1' })];
      invoicesRepo.find.mockResolvedValueOnce(newest).mockResolvedValueOnce(oldest);

      const rows = await service.listPendingByProvider(LightningProvider.BITNOB, 50);

      expect(rows.map((r) => r.id)).toEqual(['n1', 'o1']);
      expect(invoicesRepo.find).toHaveBeenNthCalledWith(1, { where, order: { createdAt: 'DESC' }, take: 25 });
      expect(invoicesRepo.find).toHaveBeenNthCalledWith(2, { where, order: { createdAt: 'ASC' }, take: 25 });
    });

    it('does not return the same invoice twice when both halves overlap (few pending invoices)', async () => {
      const a = makeInvoice({ id: 'a' });
      const b = makeInvoice({ id: 'b' });
      invoicesRepo.find.mockResolvedValueOnce([b, a]).mockResolvedValueOnce([a, b]);

      const rows = await service.listPendingByProvider(LightningProvider.BITNOB, 50);

      expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    });
  });

  describe('findByPaymentRequestOrNull', () => {
    it('looks an invoice up by its BOLT11 string', async () => {
      const row = makeInvoice();
      invoicesRepo.findOne.mockResolvedValue(row);

      expect(await service.findByPaymentRequestOrNull('lnbc30u1...')).toBe(row);
      expect(invoicesRepo.findOne).toHaveBeenCalledWith({ where: { paymentRequest: 'lnbc30u1...' } });
    });
  });

  describe('recordInvoice', () => {
    it('writes the invoice and its payments row in ONE transaction, both pending and tagged with the provider', async () => {
      const result = await service.recordInvoice({
        provider: LightningProvider.BITNOB,
        externalId: 'bn-1',
        paymentRequest: 'lnbc...',
        paymentHash: 'hash-1',
        amountSats: 30000,
        expiresAt: new Date('2026-10-04T07:00:00Z'),
        memo: 'm',
        purposeType: 'admin_certificate_request',
        purposeId: 'req-1',
        organizationId: 'org-1',
      });

      expect(invoicesRepo.manager.transaction).toHaveBeenCalledTimes(1);
      expect(manager.create).toHaveBeenNthCalledWith(
        1,
        LightningInvoice,
        expect.objectContaining({ provider: 'bitnob', externalId: 'bn-1', status: LightningInvoiceStatus.PENDING }),
      );
      expect(manager.create).toHaveBeenNthCalledWith(
        2,
        Payment,
        expect.objectContaining({ provider: 'bitnob', purposeId: 'req-1', status: PaymentStatus.PENDING, amountSats: 30000 }),
      );
      expect(result.payment).toBeDefined();
    });

    it('propagates a failure of the transaction (nothing is half-recorded)', async () => {
      invoicesRepo.manager.transaction.mockRejectedValue(new Error('unique violation'));
      await expect(
        service.recordInvoice({
          provider: LightningProvider.BITNOB,
          externalId: 'bn-1',
          paymentRequest: 'x',
          paymentHash: 'h',
          amountSats: 1,
          purposeType: 't',
          purposeId: 'p',
        }),
      ).rejects.toThrow('unique violation');
    });
  });

  describe('markPaid', () => {
    it('flips the invoice with a CONDITIONAL update and marks the linked payment paid', async () => {
      manager.findOne.mockResolvedValue({ id: 'pay-1', status: PaymentStatus.PENDING });
      const invoice = makeInvoice();

      await service.markPaid(invoice);

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        LightningInvoice,
        { id: 'inv-1', status: expect.anything() }, // Not('paid')
        expect.objectContaining({ status: LightningInvoiceStatus.PAID }),
      );
      expect(manager.update).toHaveBeenNthCalledWith(2, Payment, { id: 'pay-1' }, { status: PaymentStatus.PAID });
      expect(invoice.status).toBe(LightningInvoiceStatus.PAID);
      expect(invoice.paidAt).toBeInstanceOf(Date);
    });

    it('does nothing for an invoice that is already paid', async () => {
      await service.markPaid(makeInvoice({ status: LightningInvoiceStatus.PAID }));
      expect(invoicesRepo.manager.transaction).not.toHaveBeenCalled();
    });

    it('loses a race gracefully: no second update, never overwrites paid_at, reloads the stored row', async () => {
      manager.update.mockResolvedValue({ affected: 0 });
      const storedPaidAt = new Date('2026-10-04T06:00:00Z');
      invoicesRepo.findOne.mockResolvedValue(makeInvoice({ status: LightningInvoiceStatus.PAID, paidAt: storedPaidAt }));
      const invoice = makeInvoice();

      await service.markPaid(invoice);

      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.findOne).not.toHaveBeenCalled();
      expect(invoice.status).toBe(LightningInvoiceStatus.PAID);
      expect(invoice.paidAt).toEqual(storedPaidAt);
    });

    it('leaves the in-memory invoice untouched when the transaction fails (a failed write never reads as paid)', async () => {
      invoicesRepo.manager.transaction.mockRejectedValue(new Error('db down'));
      const invoice = makeInvoice();

      await expect(service.markPaid(invoice)).rejects.toThrow('db down');
      expect(invoice.status).toBe(LightningInvoiceStatus.PENDING);
      expect(invoice.paidAt).toBeNull();
    });

    it('logs an ERROR when the invoice has no linked payments row (the request could never be promoted)', async () => {
      manager.findOne.mockResolvedValue(null);

      await service.markPaid(makeInvoice());

      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('NO linked payments row'));
    });
  });

  describe('onInvoicePaid', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    it('notifies the handlers once, after the commit, with the paid invoice', async () => {
      manager.findOne.mockResolvedValue({ id: 'pay-1', status: PaymentStatus.PENDING });
      const handler = jest.fn().mockResolvedValue(undefined);
      service.onInvoicePaid(handler);
      const invoice = makeInvoice();

      await service.markPaid(invoice);
      await flush();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1', status: LightningInvoiceStatus.PAID }));
    });

    it('does not notify when this call lost the race, nor for an already paid invoice, nor when the write failed', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      service.onInvoicePaid(handler);

      manager.update.mockResolvedValue({ affected: 0 });
      invoicesRepo.findOne.mockResolvedValue(makeInvoice({ status: LightningInvoiceStatus.PAID }));
      await service.markPaid(makeInvoice());
      await service.markPaid(makeInvoice({ status: LightningInvoiceStatus.PAID }));
      invoicesRepo.manager.transaction.mockRejectedValue(new Error('db down'));
      await expect(service.markPaid(makeInvoice())).rejects.toThrow('db down');
      await flush();

      expect(handler).not.toHaveBeenCalled();
    });

    it('never lets a failing handler break markPaid, and still runs the other handlers', async () => {
      manager.findOne.mockResolvedValue({ id: 'pay-1', status: PaymentStatus.PENDING });
      const failing = jest.fn().mockRejectedValue(new Error('secret provider body'));
      const second = jest.fn().mockResolvedValue(undefined);
      service.onInvoicePaid(failing);
      service.onInvoicePaid(second);

      await expect(service.markPaid(makeInvoice())).resolves.toBeDefined();
      await flush();

      expect(second).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('invoice-paid handler failed'));
      expect(errorSpy).toHaveBeenCalledWith(expect.not.stringContaining('secret provider body'));
    });
  });

  describe('markClosed', () => {
    it('closes only a still-pending invoice and fails its pending payment', async () => {
      const invoice = makeInvoice();

      expect(await service.markClosed(invoice, LightningInvoiceStatus.EXPIRED)).toBe(true);

      expect(manager.update).toHaveBeenNthCalledWith(
        1,
        LightningInvoice,
        { id: 'inv-1', status: LightningInvoiceStatus.PENDING },
        { status: LightningInvoiceStatus.EXPIRED },
      );
      expect(manager.update).toHaveBeenNthCalledWith(
        2,
        Payment,
        { lightningInvoiceId: 'inv-1', status: PaymentStatus.PENDING },
        { status: PaymentStatus.FAILED },
      );
      expect(invoice.status).toBe(LightningInvoiceStatus.EXPIRED);
    });

    it('never touches an invoice that is no longer pending (e.g. paid in the meantime)', async () => {
      manager.update.mockResolvedValue({ affected: 0 });
      const invoice = makeInvoice();

      expect(await service.markClosed(invoice, LightningInvoiceStatus.FAILED)).toBe(false);
      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(invoice.status).toBe(LightningInvoiceStatus.PENDING);
    });
  });
});

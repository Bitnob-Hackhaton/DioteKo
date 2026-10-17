import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LightningInvoice, LightningProvider } from '../../lightning/entities/lightning-invoice.entity';
import { LightningInvoicesService } from '../../lightning/services/lightning-invoices.service';
import { BitnobInvoiceReconcilerService } from './bitnob-invoice-reconciler.service';
import { BitnobInvoiceSettlementService } from './bitnob-invoice-settlement.service';

const invoice = (id: string): LightningInvoice =>
  ({ id, provider: LightningProvider.BITNOB, externalId: `bn-${id}`, status: 'pending' }) as LightningInvoice;

describe('BitnobInvoiceReconcilerService', () => {
  let ledger: { listPendingByProvider: jest.Mock };
  let settlement: { settleIfPaid: jest.Mock };
  let cfg: Record<string, unknown>;
  let service: BitnobInvoiceReconcilerService;

  const build = () =>
    new BitnobInvoiceReconcilerService(
      ledger as unknown as LightningInvoicesService,
      settlement as unknown as BitnobInvoiceSettlementService,
      { get: (key: string, def?: unknown) => (key in cfg ? cfg[key] : def) } as unknown as ConfigService,
    );

  beforeEach(() => {
    ledger = { listPendingByProvider: jest.fn(async () => []) };
    settlement = { settleIfPaid: jest.fn() };
    cfg = { nodeEnv: 'development', 'bitnob.invoiceReconcileIntervalMs': 5000 };
    service = build();
    for (const m of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined);
    }
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('settles every pending Bitnob invoice and counts the outcomes', async () => {
    const invs = [invoice('1'), invoice('2'), invoice('3'), invoice('4')];
    ledger.listPendingByProvider.mockResolvedValue(invs);
    settlement.settleIfPaid
      .mockResolvedValueOnce({ outcome: 'paid' })
      .mockResolvedValueOnce({ outcome: 'closed', remoteStatus: 'expired' })
      .mockResolvedValueOnce({ outcome: 'not_paid' })
      .mockResolvedValueOnce({ outcome: 'mismatch' });

    expect(await service.runOnce()).toEqual({ checked: 4, paid: 1, closed: 1, unchanged: 1, mismatches: 1, errors: 0 });
    expect(ledger.listPendingByProvider).toHaveBeenCalledWith('bitnob', 50);
    expect(settlement.settleIfPaid.mock.calls.map((c) => c[0])).toEqual(invs);
  });

  it('continues the batch after an error on one invoice', async () => {
    ledger.listPendingByProvider.mockResolvedValue([invoice('1'), invoice('2')]);
    settlement.settleIfPaid
      .mockRejectedValueOnce(new Error('bitnob down'))
      .mockResolvedValueOnce({ outcome: 'paid' });

    expect(await service.runOnce()).toEqual({ checked: 2, paid: 1, closed: 0, unchanged: 0, mismatches: 0, errors: 1 });
    expect(settlement.settleIfPaid).toHaveBeenCalledTimes(2);
  });

  it('a settleIfPaid that throws for a non-Bitnob invoice does not block the rest of the batch', async () => {
    ledger.listPendingByProvider.mockResolvedValue([invoice('1'), invoice('2')]);
    settlement.settleIfPaid
      .mockRejectedValueOnce(new Error('Invoice 1 was not issued by Bitnob (provider=lnbits)'))
      .mockResolvedValueOnce({ outcome: 'closed', remoteStatus: 'expired' });

    const res = await service.runOnce();
    expect(res).toMatchObject({ checked: 2, closed: 1, errors: 1 });
  });

  it('warns when the batch is full (50)', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    ledger.listPendingByProvider.mockResolvedValue(Array.from({ length: 50 }, (_, i) => invoice(String(i))));
    settlement.settleIfPaid.mockResolvedValue({ outcome: 'not_paid' });

    await service.runOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lot plein'));
  });

  it('does not overlap: a second run during a first returns an empty result', async () => {
    let release!: () => void;
    ledger.listPendingByProvider.mockResolvedValue([invoice('1')]);
    settlement.settleIfPaid.mockReturnValue(new Promise((r) => (release = () => r({ outcome: 'paid' }))));

    const first = service.runOnce();
    await Promise.resolve();
    await Promise.resolve();
    const second = await service.runOnce();
    expect(second).toEqual({ checked: 0, paid: 0, closed: 0, unchanged: 0, mismatches: 0, errors: 0, skipped: true });
    expect(ledger.listPendingByProvider).toHaveBeenCalledTimes(1);

    release();
    expect((await first).paid).toBe(1);
    // the guard is released afterwards
    await service.runOnce();
    expect(ledger.listPendingByProvider).toHaveBeenCalledTimes(2);
  });

  it('counts an error and does not throw when listing fails', async () => {
    ledger.listPendingByProvider.mockRejectedValue(new Error('db down'));
    expect((await service.runOnce()).errors).toBe(1);
  });

  describe('scheduling', () => {
    beforeEach(() => jest.useFakeTimers());

    it('runs periodically when enabled and stops on destroy', async () => {
      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(10100);
      expect(ledger.listPendingByProvider).toHaveBeenCalledTimes(2);

      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(20000);
      expect(ledger.listPendingByProvider).toHaveBeenCalledTimes(2);
    });

    it('raises a positive interval below 5000 ms to 5000 ms', async () => {
      cfg = { ...cfg, 'bitnob.invoiceReconcileIntervalMs': 100 };
      service = build();
      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(4900);
      expect(ledger.listPendingByProvider).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(200);
      expect(ledger.listPendingByProvider).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['NaN interval', { 'bitnob.invoiceReconcileIntervalMs': NaN }],
      ['NODE_ENV=test', { nodeEnv: 'test' }],
      ['interval 0', { 'bitnob.invoiceReconcileIntervalMs': 0 }],
    ])('does not start when disabled (%s)', async (_label, override) => {
      cfg = { ...cfg, ...override };
      service = build();
      service.onModuleInit();
      await jest.advanceTimersByTimeAsync(10000);
      expect(ledger.listPendingByProvider).not.toHaveBeenCalled();
    });
  });
});

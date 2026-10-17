import { Logger } from '@nestjs/common';
import { LightningInvoice, LightningProvider } from '../../lightning/entities/lightning-invoice.entity';
import { LightningInvoicesService } from '../../lightning/services/lightning-invoices.service';
import { BitnobInvoiceSettlementService } from './bitnob-invoice-settlement.service';
import { BitnobLightningService } from './bitnob-lightning.service';

const invoice = (over: Partial<LightningInvoice> = {}): LightningInvoice =>
  ({
    id: 'inv-1',
    provider: LightningProvider.BITNOB,
    externalId: 'bn-1',
    paymentHash: 'hash-1',
    amountSats: 1000,
    status: 'pending',
    ...over,
  }) as LightningInvoice;

const remote = (over: Record<string, unknown> = {}) => ({
  externalId: 'bn-1',
  paymentRequest: 'lnbc...',
  paymentHash: 'hash-1',
  amountSats: 1000,
  status: 'paid',
  expiresAt: null,
  reference: null,
  ...over,
});

describe('BitnobInvoiceSettlementService', () => {
  let bitnob: { getInvoice: jest.Mock };
  let ledger: { markPaid: jest.Mock; markClosed: jest.Mock };
  let service: BitnobInvoiceSettlementService;

  beforeEach(() => {
    bitnob = { getInvoice: jest.fn() };
    ledger = { markPaid: jest.fn(async (x) => x), markClosed: jest.fn(async () => true) };
    service = new BitnobInvoiceSettlementService(
      bitnob as unknown as BitnobLightningService,
      ledger as unknown as LightningInvoicesService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('marks the invoice paid when Bitnob reports paid with the amount and hash we issued', async () => {
    bitnob.getInvoice.mockResolvedValue(remote());
    const inv = invoice();

    expect(await service.settleIfPaid(inv)).toEqual({ outcome: 'paid', remoteStatus: 'paid' });
    expect(bitnob.getInvoice).toHaveBeenCalledWith('bn-1');
    expect(ledger.markPaid).toHaveBeenCalledWith(inv);
  });

  it.each(['pending', 'unknown'])('changes nothing when Bitnob reports %s', async (status) => {
    bitnob.getInvoice.mockResolvedValue(remote({ status }));

    expect(await service.settleIfPaid(invoice())).toEqual({ outcome: 'not_paid', remoteStatus: status });
    expect(ledger.markPaid).not.toHaveBeenCalled();
    expect(ledger.markClosed).not.toHaveBeenCalled();
  });

  it.each([
    ['expired', 'expired'],
    ['failed', 'failed'],
  ])('closes the local invoice when Bitnob reports %s, without ever marking it paid', async (status, closedAs) => {
    bitnob.getInvoice.mockResolvedValue(remote({ status }));
    const inv = invoice();

    expect(await service.settleIfPaid(inv)).toEqual({ outcome: 'closed', remoteStatus: status });
    expect(ledger.markClosed).toHaveBeenCalledWith(inv, closedAs);
    expect(ledger.markPaid).not.toHaveBeenCalled();
  });

  it('refuses a paid answer for a different Bitnob invoice id', async () => {
    bitnob.getInvoice.mockResolvedValue(remote({ externalId: 'bn-OTHER' }));

    expect((await service.settleIfPaid(invoice())).outcome).toBe('mismatch');
    expect(ledger.markPaid).not.toHaveBeenCalled();
  });

  it('refuses a paid answer whose amount differs from what we issued', async () => {
    bitnob.getInvoice.mockResolvedValue(remote({ amountSats: 1 }));

    expect((await service.settleIfPaid(invoice())).outcome).toBe('mismatch');
    expect(ledger.markPaid).not.toHaveBeenCalled();
  });

  it('refuses a paid answer whose payment hash differs from what we issued', async () => {
    bitnob.getInvoice.mockResolvedValue(remote({ paymentHash: 'someone-elses-hash' }));

    expect((await service.settleIfPaid(invoice())).outcome).toBe('mismatch');
    expect(ledger.markPaid).not.toHaveBeenCalled();
  });

  it('is idempotent: an already paid invoice is not read again', async () => {
    expect(await service.settleIfPaid(invoice({ status: 'paid' as never }))).toEqual({ outcome: 'already_paid' });
    expect(bitnob.getInvoice).not.toHaveBeenCalled();
    expect(ledger.markPaid).not.toHaveBeenCalled();
  });

  it('refuses an invoice that Bitnob did not issue', async () => {
    await expect(service.settleIfPaid(invoice({ provider: LightningProvider.LNBITS }))).rejects.toThrow(/not issued by Bitnob/);
    await expect(service.settleIfPaid(invoice({ externalId: null }))).rejects.toThrow(/not issued by Bitnob/);
    expect(bitnob.getInvoice).not.toHaveBeenCalled();
  });
});

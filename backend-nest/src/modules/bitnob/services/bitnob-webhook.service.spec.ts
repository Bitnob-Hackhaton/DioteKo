import { Logger } from '@nestjs/common';
import { QueryFailedError, Repository } from 'typeorm';
import { BitnobCard } from '../entities/bitnob-card.entity';
import { BitnobPayout } from '../entities/bitnob-payout.entity';
import { BitnobWebhookEvent } from '../entities/bitnob-webhook-event.entity';
import { BitnobWithdrawal } from '../entities/bitnob-withdrawal.entity';
import { LightningInvoicesService } from '../../lightning/services/lightning-invoices.service';
import { BitnobInvoiceSettlementService } from './bitnob-invoice-settlement.service';
import { BitnobWebhookService } from './bitnob-webhook.service';

/**
 * Covers the payout state-machine guard (forward-only), the Increment 5
 * signature/idempotency invariants (M2 unverified-never-dispatched, M3
 * event_id dedup) and the `transfer.*` → `bitnob_withdrawals` dispatch
 * (advance, forward-only, M6 contradiction alarm, unknown-reference).
 */
describe('BitnobWebhookService', () => {
  let events: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let payouts: { findOne: jest.Mock; save: jest.Mock };
  let cards: { findOne: jest.Mock; save: jest.Mock };
  let withdrawals: { findOne: jest.Mock; save: jest.Mock };
  let lightningInvoices: { findByExternalId: jest.Mock; findByPaymentHashOrNull: jest.Mock; findByPaymentRequestOrNull: jest.Mock };
  let settlement: { settleIfPaid: jest.Mock };
  let service: BitnobWebhookService;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    events = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'evt-1', ...x })),
      findOne: jest.fn(async () => null),
    };
    payouts = { findOne: jest.fn(), save: jest.fn(async (x) => x) };
    cards = { findOne: jest.fn(), save: jest.fn() };
    withdrawals = { findOne: jest.fn(async () => null), save: jest.fn(async (x) => x) };
    lightningInvoices = {
      findByExternalId: jest.fn(async () => null),
      findByPaymentHashOrNull: jest.fn(async () => null),
      findByPaymentRequestOrNull: jest.fn(async () => null),
    };
    settlement = { settleIfPaid: jest.fn() };
    service = new BitnobWebhookService(
      events as unknown as Repository<BitnobWebhookEvent>,
      payouts as unknown as Repository<BitnobPayout>,
      cards as unknown as Repository<BitnobCard>,
      withdrawals as unknown as Repository<BitnobWithdrawal>,
      lightningInvoices as unknown as LightningInvoicesService,
      settlement as unknown as BitnobInvoiceSettlementService,
    );
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  // --- payout dispatch guard (unchanged behaviour, new entry point) ---
  async function deliverPayout(eventName: string, rowStatus: string): Promise<void> {
    payouts.findOne.mockResolvedValue({ bitnobPayoutId: 'bp-1', status: rowStatus });
    await service.handleWebhookRequest({ event: eventName, data: { id: 'bp-1' } }, true);
  }

  it('advances initiated -> processing on payouts.processing', async () => {
    await deliverPayout('payouts.processing', 'initiated');
    expect(payouts.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'processing' }));
  });

  it('maps payouts.initialized to "initiated" (not "processing")', async () => {
    await deliverPayout('payouts.initialized', 'quote');
    expect(payouts.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'initiated' }));
  });

  it('ignores a backward payout transition (processing -> initiated)', async () => {
    await deliverPayout('payouts.initialized', 'processing');
    expect(payouts.save).not.toHaveBeenCalled();
  });

  it('never overwrites a terminal payout status', async () => {
    await deliverPayout('payouts.withdrawal.success', 'completed');
    expect(payouts.save).not.toHaveBeenCalled();
  });

  // --- M2: an unverified event is persisted but never dispatched ---
  it('persists an unverified event and does NOT dispatch it (M2)', async () => {
    payouts.findOne.mockResolvedValue({ bitnobPayoutId: 'bp-1', status: 'initiated' });
    const res = await service.handleWebhookRequest(
      { event: 'payouts.processing', data: { id: 'bp-1' } },
      false,
    );
    expect(res).toEqual({ received: true });
    expect(events.save).toHaveBeenCalledWith(expect.objectContaining({ signatureValid: false }));
    expect(events.save).toHaveBeenLastCalledWith(expect.objectContaining({ processed: true }));
    expect(payouts.save).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('UNVERIFIED'));
  });

  // --- M3: event_id dedup ---
  it('is idempotent on a duplicate event_id (pre-check) and does not re-insert or re-dispatch (M3)', async () => {
    events.findOne.mockResolvedValue({ eventId: 'e1', eventType: 'transfer.success' });
    const res = await service.handleWebhookRequest(
      { event: 'transfer.success', event_id: 'e1', data: { reference: 'dkwd_1' } },
      true,
    );
    expect(res).toEqual({ received: true });
    expect(events.save).not.toHaveBeenCalled();
    expect(withdrawals.save).not.toHaveBeenCalled();
  });

  it('is idempotent on a concurrent 23505 unique-violation insert (M3)', async () => {
    const violation = new QueryFailedError('insert', [], new Error('dup') as never);
    (violation as unknown as { code: string }).code = '23505';
    events.findOne
      .mockResolvedValueOnce(null) // pre-check misses
      .mockResolvedValueOnce({ eventId: 'e1', eventType: 'transfer.success' }); // re-read after 23505
    events.save.mockRejectedValueOnce(violation);
    const res = await service.handleWebhookRequest(
      { event: 'transfer.success', event_id: 'e1', data: { reference: 'dkwd_1' } },
      true,
    );
    expect(res).toEqual({ received: true });
    expect(withdrawals.save).not.toHaveBeenCalled();
  });

  it('logs an event_id collision at error but still answers 200 (M3)', async () => {
    events.findOne.mockResolvedValue({ eventId: 'e1', eventType: 'payouts.processing' });
    await service.handleWebhookRequest(
      { event: 'transfer.success', event_id: 'e1', data: { reference: 'dkwd_1' } },
      true,
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('event_id collision'));
  });

  // --- transfer.* → bitnob_withdrawals ---
  function transferPayload(eventName: string, extra: Record<string, unknown> = {}) {
    return {
      event: eventName,
      event_id: `evt_${eventName}`,
      data: { reference: 'dkwd_1', transaction_id: 'tx_1', hash: '0xabcdef1234567890', fee: '21000', ...extra },
    };
  }

  it('advances submitted -> completed on transfer.success and writes tx_hash + network_fee', async () => {
    withdrawals.findOne.mockResolvedValue({ id: 'w1', reference: 'dkwd_1', status: 'submitted' });
    await service.handleWebhookRequest(transferPayload('transfer.success'), true);
    expect(withdrawals.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', txHash: '0xabcdef1234567890', networkFee: '21000' }),
    );
  });

  it('nests the webhook body under rawResult.webhook, preserving the create-time body (SF2)', async () => {
    withdrawals.findOne.mockResolvedValue({
      id: 'w1',
      reference: 'dkwd_1',
      status: 'submitted',
      rawResult: { transaction_id: 'tx_1', status: 'pending', created_at: 'x' },
    });
    await service.handleWebhookRequest(transferPayload('transfer.success'), true);
    const saved = withdrawals.save.mock.calls[0][0];
    expect(saved.rawResult.created_at).toBe('x');
    expect(saved.rawResult.webhook).toEqual(expect.objectContaining({ event: 'transfer.success' }));
  });

  it('routes a card.* event to dispatchCardEvent via the catch-all (N3)', async () => {
    cards.findOne.mockResolvedValue({ cardId: 'card-1', status: 'pending' });
    await service.handleWebhookRequest({ event: 'card.created', event_id: 'e_card', data: { id: 'card-1' } }, true);
    expect(cards.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'card.created' }));
  });

  it('does not choke on a CR/LF-laden event name (N5 log-injection)', async () => {
    withdrawals.findOne.mockResolvedValue(null);
    const res = await service.handleWebhookRequest(
      { event: 'transfer.success\nFAKE LOG LINE', event_id: 'e_inj', data: { reference: 'dkwd_x' } },
      true,
    );
    expect(res).toEqual({ received: true });
  });

  it('matches on transaction_id when reference is absent', async () => {
    withdrawals.findOne.mockResolvedValue({
      id: 'w1',
      reference: null,
      status: 'pending',
      transactionId: 'tx_1',
    });
    await service.handleWebhookRequest(transferPayload('transfer.failed', { reference: undefined }), true);
    expect(withdrawals.findOne).toHaveBeenCalledWith({ where: { transactionId: 'tx_1' } });
    expect(withdrawals.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
  });

  it('ignores a transfer event that would move a terminal withdrawal to the same status', async () => {
    withdrawals.findOne.mockResolvedValue({ id: 'w1', reference: 'dkwd_1', status: 'completed' });
    await service.handleWebhookRequest(transferPayload('transfer.success'), true);
    expect(withdrawals.save).not.toHaveBeenCalled();
  });

  it('alarms at error on a contradictory terminal transfer event (M6)', async () => {
    withdrawals.findOne.mockResolvedValue({ id: 'w1', reference: 'dkwd_1', status: 'completed' });
    await service.handleWebhookRequest(transferPayload('transfer.failed'), true);
    expect(withdrawals.save).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('contradicts terminal status'));
  });

  it('processes (does not throw / 500) a transfer event for an unknown withdrawal (M4)', async () => {
    withdrawals.findOne.mockResolvedValue(null);
    const res = await service.handleWebhookRequest(transferPayload('transfer.success'), true);
    expect(res).toEqual({ received: true });
    expect(withdrawals.save).not.toHaveBeenCalled();
    expect(events.save).toHaveBeenLastCalledWith(expect.objectContaining({ processed: true }));
  });

  describe('transfer.success carrying a received Lightning payment', () => {
    const OURS = { id: 'inv-1', provider: 'bitnob', externalId: 'bn-1', paymentHash: 'hash-1', status: 'pending' };

    it('(a) without a matching withdrawal but with a known invoice id, asks the settlement service to read it', async () => {
      withdrawals.findOne.mockResolvedValue(null);
      lightningInvoices.findByExternalId.mockResolvedValue(OURS);
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'paid' });

      await service.handleWebhookRequest(
        { event: 'transfer.success', event_id: 'e_ln', data: { id: 'bn-1' } },
        true,
      );

      expect(settlement.settleIfPaid).toHaveBeenCalledWith(OURS);
      expect(withdrawals.save).not.toHaveBeenCalled();
    });

    it('(b) with a matching withdrawal, updates it and never touches invoice settlement', async () => {
      withdrawals.findOne.mockResolvedValue({ id: 'w1', reference: 'dkwd_1', status: 'submitted' });
      lightningInvoices.findByExternalId.mockResolvedValue(OURS);

      await service.handleWebhookRequest(transferPayload('transfer.success', { id: 'bn-1' }), true);

      expect(withdrawals.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
      expect(lightningInvoices.findByExternalId).not.toHaveBeenCalled();
    });

    it('(c) with neither withdrawal nor invoice, does nothing and does not error', async () => {
      withdrawals.findOne.mockResolvedValue(null);
      lightningInvoices.findByExternalId.mockResolvedValue(null);
      lightningInvoices.findByPaymentHashOrNull.mockResolvedValue(null);

      const res = await service.handleWebhookRequest(
        { event: 'transfer.success', event_id: 'e_none', data: { id: 'unrelated' } },
        true,
      );

      expect(res).toEqual({ received: true });
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
      expect(withdrawals.save).not.toHaveBeenCalled();
      expect(events.save).toHaveBeenLastCalledWith(expect.objectContaining({ processed: true }));
      expect(events.save.mock.calls.at(-1)?.[0].processingError).toBeUndefined();
    });
  });

  // --- Lightning invoice settlement: event-name-agnostic signal, status read from Bitnob ---
  describe('Lightning invoice signal', () => {
    const OURS = { id: 'inv-1', provider: 'bitnob', externalId: 'bn-1', paymentHash: 'hash-1', status: 'pending' };

    it('treats ANY unrecognised event that references our invoice id as a signal, whatever its name', async () => {
      lightningInvoices.findByExternalId.mockResolvedValue(OURS);
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'paid' });

      const res = await service.handleWebhookRequest({ event: 'some.unknown.name', data: { id: 'bn-1' } }, true);

      expect(res).toEqual({ received: true });
      expect(lightningInvoices.findByExternalId).toHaveBeenCalledWith('bitnob', 'bn-1');
      expect(settlement.settleIfPaid).toHaveBeenCalledWith(OURS);
    });

    it('falls back to data.payment_hash when no id matches', async () => {
      lightningInvoices.findByExternalId.mockResolvedValue(null);
      lightningInvoices.findByPaymentHashOrNull.mockResolvedValue(OURS);
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'not_paid' });

      await service.handleWebhookRequest({ event: 'x.y', data: { id: 'other', payment_hash: 'hash-1' } }, true);

      expect(lightningInvoices.findByPaymentHashOrNull).toHaveBeenCalledWith('hash-1');
      expect(settlement.settleIfPaid).toHaveBeenCalledWith(OURS);
    });

    it('matches the documented "Lightning received" payload by its BOLT11 (data.invoice)', async () => {
      lightningInvoices.findByPaymentRequestOrNull.mockResolvedValue(OURS);
      settlement.settleIfPaid.mockResolvedValue({ outcome: 'paid' });

      await service.handleWebhookRequest(
        { event: 'transfer.success', event_id: 'e_ln', data: { transaction_id: 'tx-9', reference: 'uuid', invoice: 'lnbc30u1abc' } },
        true,
      );

      expect(lightningInvoices.findByPaymentRequestOrNull).toHaveBeenCalledWith('lnbc30u1abc');
      expect(settlement.settleIfPaid).toHaveBeenCalledWith(OURS);
    });

    it('ignores a BOLT11 match that belongs to another provider', async () => {
      lightningInvoices.findByPaymentRequestOrNull.mockResolvedValue({ ...OURS, provider: 'lnbits' });

      await service.handleWebhookRequest({ event: 'x.y', data: { invoice: 'lnbc30u1abc' } }, true);

      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });

    it('ignores a payment-hash match that belongs to another provider (LNbits)', async () => {
      lightningInvoices.findByExternalId.mockResolvedValue(null);
      lightningInvoices.findByPaymentHashOrNull.mockResolvedValue({ ...OURS, provider: 'lnbits' });

      await service.handleWebhookRequest({ event: 'x.y', data: { payment_hash: 'hash-1' } }, true);

      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });

    it('does nothing (persisted only) when the payload references none of our invoices', async () => {
      lightningInvoices.findByExternalId.mockResolvedValue(null);
      lightningInvoices.findByPaymentHashOrNull.mockResolvedValue(null);

      const res = await service.handleWebhookRequest({ event: 'deposit.success', data: { id: 'unrelated' } }, true);

      expect(res).toEqual({ received: true });
      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
      expect(events.save).toHaveBeenLastCalledWith(expect.objectContaining({ processed: true }));
    });

    it('never settles from an UNVERIFIED delivery (M2)', async () => {
      lightningInvoices.findByExternalId.mockResolvedValue(OURS);

      await service.handleWebhookRequest({ event: 'whatever', data: { id: 'bn-1' } }, false);

      expect(settlement.settleIfPaid).not.toHaveBeenCalled();
    });

    it('records the error and still answers 200 when reading the invoice from Bitnob fails', async () => {
      lightningInvoices.findByExternalId.mockResolvedValue(OURS);
      settlement.settleIfPaid.mockRejectedValue(new Error('bitnob down'));

      const res = await service.handleWebhookRequest({ event: 'whatever', data: { id: 'bn-1' } }, true);

      expect(res).toEqual({ received: true });
      expect(events.save).toHaveBeenLastCalledWith(
        expect.objectContaining({ processed: true, processingError: expect.any(String) }),
      );
    });
  });
});

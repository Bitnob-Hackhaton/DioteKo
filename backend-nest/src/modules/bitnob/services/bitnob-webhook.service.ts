import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { BitnobCard } from '../entities/bitnob-card.entity';
import { BitnobPayout } from '../entities/bitnob-payout.entity';
import { BitnobWebhookEvent } from '../entities/bitnob-webhook-event.entity';
import { BitnobWithdrawal } from '../entities/bitnob-withdrawal.entity';
import { isTerminalPayoutStatus, payoutStatusRank, summarizePayoutError } from '../payouts.util';
import {
  isTerminalWithdrawalStatus,
  sanitizeEventName,
  stripWithdrawalResultPii,
  withdrawalStatusRank,
} from '../withdrawals.util';
import { LightningProvider } from '../../lightning/entities/lightning-invoice.entity';
import { LightningInvoicesService } from '../../lightning/services/lightning-invoices.service';
import { BitnobApiError } from './bitnob-http-client.service';
import { BitnobInvoiceSettlementService } from './bitnob-invoice-settlement.service';

/**
 * Payout webhook `event` name -> local `bitnob_payouts.status` mapping.
 * `payouts.initialized` maps to our post-initialize local status `initiated`
 * (NOT `processing` — that would skip the `finalizing` guard state).
 */
const PAYOUT_EVENT_STATUS_MAP: Record<string, string> = {
  'payouts.initialized': 'initiated',
  'payouts.processing': 'processing',
  'payouts.withdrawal.success': 'completed',
  'payouts.withdrawal.expired': 'expired',
};

/**
 * `transfer.*` webhook `event` name -> local `bitnob_withdrawals.status`.
 * There is NO `data.status` on these events — the event NAME is the outcome
 * (integration-analyst, 2026-08-30). Both values are terminal.
 */
const TRANSFER_EVENT_STATUS_MAP: Record<string, string> = {
  'transfer.success': 'completed',
  'transfer.failed': 'failed',
};

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Handles Bitnob webhook payloads (`BitnobWebhooksController`). Bitnob
 * delivers every event family to ONE global dashboard URL, so the catch-all
 * route calls `handleWebhookRequest`, which dispatches by the `event` name:
 *  - `payouts.*`  -> `dispatchPayoutEvent`  (`bitnob_payouts.status`)
 *  - `transfer.*` -> `dispatchTransferEvent` (`bitnob_withdrawals.status`)
 *  - anything else (`deposit.success`, ...) -> persisted only, no dispatch.
 * `POST /api/bitnob/webhooks/cards` still routes to `handleCardWebhook`.
 *
 * Signature verification is done upstream by `BitnobWebhookSignatureGuard`.
 * `signatureValid` reaches here as a parameter:
 *  - `false` (dev no-secret skip path, security-analyst M2): the event is
 *    PERSISTED and marked `processed`, then NOTHING else — no dispatch, no
 *    money-table mutation, in ANY environment.
 *  - `true`: persist-first, then dispatch (unchanged ordering).
 *
 * Idempotency (security-analyst M3): when the payload carries a top-level
 * `event_id`, a pre-check SELECT + a Postgres `23505` catch both return the
 * idempotent `{ received: true }` 200 — Bitnob retries any non-2xx forever, so
 * a redelivery must never surface as a 500. A stored row whose `event` name
 * differs from an incoming duplicate is logged at ERROR (`event_id collision`)
 * but still answered 200.
 */
@Injectable()
export class BitnobWebhookService {
  private readonly logger = new Logger(BitnobWebhookService.name);

  constructor(
    @InjectRepository(BitnobWebhookEvent)
    private readonly eventsRepository: Repository<BitnobWebhookEvent>,
    @InjectRepository(BitnobPayout)
    private readonly payoutsRepository: Repository<BitnobPayout>,
    @InjectRepository(BitnobCard)
    private readonly cardsRepository: Repository<BitnobCard>,
    @InjectRepository(BitnobWithdrawal)
    private readonly withdrawalsRepository: Repository<BitnobWithdrawal>,
    private readonly lightningInvoices: LightningInvoicesService,
    private readonly invoiceSettlement: BitnobInvoiceSettlementService,
  ) {}

  /** Catch-all route: dispatch by the `event` name (payouts / transfers / ignore). */
  async handleWebhookRequest(
    payload: Record<string, unknown>,
    signatureValid: boolean,
  ): Promise<{ received: true }> {
    return this.handleWebhook(payload, signatureValid, (event) => this.dispatchByEventName(event));
  }

  async handleCardWebhook(
    payload: Record<string, unknown>,
    signatureValid: boolean,
  ): Promise<{ received: true }> {
    return this.handleWebhook(payload, signatureValid, (event) => this.dispatchCardEvent(event));
  }

  private async handleWebhook(
    payload: Record<string, unknown>,
    signatureValid: boolean,
    dispatch: (event: BitnobWebhookEvent) => Promise<void>,
  ): Promise<{ received: true }> {
    const eventType = this.extractEventType(payload);
    const eventId = this.extractEventId(payload);
    // Raw `eventType` drives dispatch + is stored; `safeEventType` (CR/LF
    // stripped, capped) is the only form that reaches a log line — the event
    // name is attacker-influenced on a forged/replayed delivery.
    const safeEventType = sanitizeEventName(eventType);

    this.logger.log(
      `[START] webhook received eventType=${safeEventType} eventId=${eventId ?? 'n/a'} signatureValid=${signatureValid}`,
    );

    // M3 — idempotency pre-check.
    if (eventId) {
      const existing = await this.eventsRepository.findOne({ where: { eventId } });
      if (existing) {
        this.logDuplicate(existing, eventType, eventId, 'pre-check');
        return { received: true };
      }
    }

    let event: BitnobWebhookEvent;
    try {
      event = await this.eventsRepository.save(
        this.eventsRepository.create({
          eventId,
          eventType,
          payload,
          processed: false,
          signatureValid,
        }),
      );
    } catch (error) {
      // M3 — lost the race with a concurrent delivery of the same event_id.
      if (eventId && this.isUniqueViolation(error)) {
        const existing = await this.eventsRepository.findOne({ where: { eventId } });
        if (existing) {
          this.logDuplicate(existing, eventType, eventId, '23505');
        } else {
          this.logger.warn(`[RESULT] webhook duplicate eventId=${eventId} (23505, row not re-read) — idempotent 200`);
        }
        return { received: true };
      }
      throw error;
    }

    this.logger.log(`[ENTITY] bitnob_webhook_events id=${event.id} eventType=${safeEventType}`);

    // M2 — an unverified event is persisted and marked processed, then nothing else.
    if (signatureValid === false) {
      event.processed = true;
      await this.eventsRepository.save(event);
      this.logger.warn(
        `[RESULT] bitnob webhook UNVERIFIED — persisted, not dispatched eventId=${event.id} eventType=${safeEventType}`,
      );
      return { received: true };
    }

    try {
      this.logger.log(`[CALL] dispatch eventType=${safeEventType} eventId=${event.id}`);
      await dispatch(event);
      event.processed = true;
      await this.eventsRepository.save(event);
      this.logger.log(`[RESULT] webhook processed eventId=${event.id} eventType=${safeEventType}`);
    } catch (error) {
      // M7 — PII-safe summary (a BitnobApiError echoes beneficiary data in
      // `detail`/`message`); plain non-Bitnob errors keep their message.
      const message =
        error instanceof BitnobApiError
          ? summarizePayoutError(error)
          : error instanceof Error
            ? error.message
            : String(error);
      event.processed = true;
      event.processingError = message;
      await this.eventsRepository.save(event);
      this.logger.error(
        `[RESULT] webhook dispatch failed eventId=${event.id} eventType=${safeEventType} detail=${message}`,
      );
    }

    return { received: true };
  }

  private async dispatchByEventName(event: BitnobWebhookEvent): Promise<void> {
    if (event.eventType.startsWith('transfer.')) {
      return this.dispatchTransferEvent(event);
    }
    if (event.eventType.startsWith('payouts.')) {
      return this.dispatchPayoutEvent(event);
    }
    // Card families still deliver to the one global URL -> this catch-all is
    // their real entry point now (`@Post('cards')` is a legacy alias). Card
    // handling itself stays deferred — `dispatchCardEvent` just writes the raw
    // event name onto `bitnob_cards.status` (unverified vocabulary).
    if (event.eventType.startsWith('card.') || event.eventType.startsWith('cards.')) {
      return this.dispatchCardEvent(event);
    }
    // Everything else (`deposit.*`, and the Lightning "invoice paid" family whose name Bitnob does not
    // document) lands here. If the payload points at one of OUR pending Bitnob invoices it is treated as a
    // signal to check that invoice; otherwise it is recorded and not acted on.
    if (await this.dispatchLightningInvoiceSignal(event)) {
      return;
    }
    this.logger.warn(
      `[RESULT] webhook no dispatcher for eventType=${sanitizeEventName(event.eventType)} eventId=${event.id} — persisted only`,
    );
  }

  /**
   * Event-name-agnostic handling of a Lightning invoice settlement. Bitnob documents the delivery envelope but
   * not the name of the "invoice paid" event, so this does NOT branch on the name: it looks the payload's
   * `data.id` / `data.invoice_id` / `data.payment_hash` / `data.invoice` (BOLT11) up among OUR Bitnob invoices, and when one matches it
   * asks `BitnobInvoiceSettlementService` to read that invoice from Bitnob. The webhook never marks anything
   * paid by itself, so a forged or replayed delivery for an unpaid invoice is harmless. Returns `true` when the
   * payload referenced one of our invoices (handled), `false` when it matched nothing.
   */
  private async dispatchLightningInvoiceSignal(event: BitnobWebhookEvent): Promise<boolean> {
    const data = (event.payload?.data ?? {}) as Record<string, unknown>;
    const asString = (value: unknown): string | null =>
      typeof value === 'string' && value.length > 0 ? value : null;

    let invoice = null;
    for (const candidate of [asString(data.id), asString(data.invoice_id)]) {
      if (candidate) {
        invoice = await this.lightningInvoices.findByExternalId(LightningProvider.BITNOB, candidate);
        if (invoice) break;
      }
    }
    const paymentHash = asString(data.payment_hash);
    if (!invoice && paymentHash) {
      const byHash = await this.lightningInvoices.findByPaymentHashOrNull(paymentHash);
      invoice = byHash && byHash.provider === LightningProvider.BITNOB ? byHash : null;
    }
    // The documented "Lightning received" payload identifies the invoice only by its BOLT11 string (`data.invoice`).
    const bolt11 = asString(data.invoice);
    if (!invoice && bolt11) {
      const byRequest = await this.lightningInvoices.findByPaymentRequestOrNull(bolt11);
      invoice = byRequest && byRequest.provider === LightningProvider.BITNOB ? byRequest : null;
    }
    if (!invoice) {
      return false;
    }

    const result = await this.invoiceSettlement.settleIfPaid(invoice);
    this.logger.log(
      `[STATE] lightning invoice signal handled eventType=${sanitizeEventName(event.eventType)} invoiceId=${invoice.id} outcome=${result.outcome}`,
    );
    return true;
  }

  private async dispatchPayoutEvent(event: BitnobWebhookEvent): Promise<void> {
    const bitnobPayoutId = this.extractResourceId(event.payload);
    if (!bitnobPayoutId) {
      this.logger.warn(`[RESULT] dispatchPayoutEvent no payout id found in payload eventId=${event.id}`);
      return;
    }

    const payout = await this.payoutsRepository.findOne({ where: { bitnobPayoutId } });
    if (!payout) {
      this.logger.warn(`[RESULT] dispatchPayoutEvent no matching bitnob_payouts row bitnobPayoutId=${bitnobPayoutId}`);
      return;
    }

    const mappedStatus = PAYOUT_EVENT_STATUS_MAP[event.eventType];
    if (!mappedStatus) {
      this.logger.warn(
        `[RESULT] dispatchPayoutEvent unrecognized eventType=${event.eventType} bitnobPayoutId=${bitnobPayoutId} — ignored`,
      );
      return;
    }

    // Forward-only: never overwrite a terminal status, never move the row
    // backward (e.g. a late `payouts.initialized` after we already reached
    // `processing`, or after a local `finalizing` compare-and-swap).
    if (isTerminalPayoutStatus(payout.status)) {
      this.logger.warn(
        `[RESULT] dispatchPayoutEvent ignoring ${event.eventType} — row already terminal ` +
          `bitnobPayoutId=${bitnobPayoutId} status=${payout.status}`,
      );
      return;
    }
    if (payoutStatusRank(mappedStatus) <= payoutStatusRank(payout.status)) {
      this.logger.warn(
        `[RESULT] dispatchPayoutEvent ignoring backward transition ${payout.status} -> ${mappedStatus} ` +
          `bitnobPayoutId=${bitnobPayoutId} eventType=${event.eventType}`,
      );
      return;
    }

    payout.status = mappedStatus;
    await this.payoutsRepository.save(payout);
    this.logger.log(`[STATE] payout status updated bitnobPayoutId=${bitnobPayoutId} status=${mappedStatus}`);
  }

  /**
   * `transfer.success` / `transfer.failed` -> `bitnob_withdrawals.status`
   * (security-analyst M4: withdrawals ONLY this increment — the
   * `data.transaction_id <-> bitnob_bulk_batch_items.withdrawal_id` identity is
   * an unverified guess and bulk is 403 in sandbox, so no bulk-item write).
   *
   * Match on `data.reference` (our `dkwd_<uuid>`), fallback `data.transaction_id`
   * (persisted on the row at create time). Forward-only guard mirrors
   * `dispatchPayoutEvent`. `data.hash` -> `tx_hash`, `data.fee` -> `network_fee`.
   * Reconcile against `GET /api/transactions` stays the authority for any money
   * decision — this is a latency optimisation.
   */
  private async dispatchTransferEvent(event: BitnobWebhookEvent): Promise<void> {
    const data = (event.payload?.data ?? {}) as Record<string, unknown>;
    const reference = typeof data.reference === 'string' && data.reference.length > 0 ? data.reference : null;
    const transactionId =
      typeof data.transaction_id === 'string' && data.transaction_id.length > 0 ? data.transaction_id : null;
    const safeEvent = sanitizeEventName(event.eventType);

    const mappedStatus = TRANSFER_EVENT_STATUS_MAP[event.eventType];
    if (!mappedStatus) {
      this.logger.warn(
        `[RESULT] dispatchTransferEvent unrecognized eventType=${safeEvent} eventId=${event.id} — ignored`,
      );
      return;
    }

    let withdrawal: BitnobWithdrawal | null = null;
    if (reference) {
      withdrawal = await this.withdrawalsRepository.findOne({ where: { reference } });
    }
    if (!withdrawal && transactionId) {
      withdrawal = await this.withdrawalsRepository.findOne({ where: { transactionId } });
    }

    if (!withdrawal) {
      // Bitnob delivers a RECEIVED Lightning payment as `transfer.success`, so before concluding "unknown" try
      // the invoice signal (reads the invoice from Bitnob; the payload is never trusted).
      if (await this.dispatchLightningInvoiceSignal(event)) {
        return;
      }
      // No match: an unrelated merchant transfer, a `deposit.success` misrouted
      // here, or a bulk-item transfer (no per-item `reference` — M4). Recorded,
      // no write.
      this.logger.warn(
        `[RESULT] transfer event for unknown withdrawal ref=${reference ?? 'n/a'} tx=${transactionId ?? 'n/a'} ` +
          `eventType=${safeEvent} — no bulk-item write (M4)`,
      );
      return;
    }

    const refLabel = withdrawal.reference ?? withdrawal.id;

    // Forward-only guard (mirrors dispatchPayoutEvent).
    if (isTerminalWithdrawalStatus(withdrawal.status)) {
      if (withdrawal.status !== mappedStatus) {
        // M6 — a `transfer.success` after `failed` (or vice versa) is a real
        // contradiction: reconcile must decide, not a silent drop.
        this.logger.error(
          `[RESULT] bitnob transfer event contradicts terminal status — reconcile required ` +
            `ref=${refLabel} local=${withdrawal.status} eventType=${safeEvent}`,
        );
      } else {
        this.logger.warn(
          `[RESULT] dispatchTransferEvent ignoring ${safeEvent} — row already terminal ref=${refLabel} status=${withdrawal.status}`,
        );
      }
      return;
    }
    if (withdrawalStatusRank(mappedStatus) <= withdrawalStatusRank(withdrawal.status)) {
      this.logger.warn(
        `[RESULT] dispatchTransferEvent ignoring non-forward transition ${withdrawal.status} -> ${mappedStatus} ref=${refLabel}`,
      );
      return;
    }

    const hash = typeof data.hash === 'string' && data.hash.length > 0 ? data.hash : null;
    const fee =
      typeof data.fee === 'string' && data.fee.length > 0
        ? data.fee
        : typeof data.fee === 'number'
          ? String(data.fee)
          : null;

    withdrawal.status = mappedStatus;
    if (hash) {
      withdrawal.txHash = hash;
    }
    if (fee !== null) {
      withdrawal.networkFee = fee;
    }
    // Nest under `webhook` rather than overwrite: `reconcileWithdrawal` only
    // touches `status`, so a wholesale replace here would discard the
    // Increment 4 S1 create-time scrubbed `POST /api/withdrawals` body. Keep
    // the full forensic trail for a money row (CLAUDE.md §11).
    const existingRaw =
      withdrawal.rawResult && typeof withdrawal.rawResult === 'object' ? withdrawal.rawResult : {};
    withdrawal.rawResult = {
      ...existingRaw,
      webhook: stripWithdrawalResultPii(event.payload as Record<string, unknown>),
    };
    await this.withdrawalsRepository.save(withdrawal);
    this.logger.log(
      `[STATE] withdrawal status updated ref=${refLabel} status=${mappedStatus} ` +
        `hash=${hash ? `${hash.slice(0, 10)}…` : 'n/a'} feeSet=${fee !== null}`,
    );
  }

  private async dispatchCardEvent(event: BitnobWebhookEvent): Promise<void> {
    const bitnobCardId = this.extractResourceId(event.payload);
    if (!bitnobCardId) {
      this.logger.warn(`[RESULT] dispatchCardEvent no card id found in payload eventId=${event.id}`);
      return;
    }

    const card = await this.cardsRepository.findOne({ where: { cardId: bitnobCardId } });
    if (!card) {
      this.logger.warn(`[RESULT] dispatchCardEvent no matching bitnob_cards row cardId=${bitnobCardId}`);
      return;
    }

    // Card-issuing v2's exact event/status vocabulary isn't confirmed
    // against live docs yet, so the raw event_type is stored as-is rather
    // than translated through a guessed mapping (unlike the payout map
    // above, which mirrors the plan's explicitly-named payout event list).
    card.status = event.eventType;
    await this.cardsRepository.save(card);
    this.logger.log(`[STATE] card status updated cardId=${bitnobCardId} status=${event.eventType}`);
  }

  private logDuplicate(
    existing: BitnobWebhookEvent,
    incomingEventType: string,
    eventId: string,
    via: string,
  ): void {
    if (existing.eventType !== incomingEventType) {
      // M3 — same event_id, different event name: a Bitnob bug or an id
      // collision. Alarm, but still 200 (Bitnob retries non-2xx forever).
      // Both names are sanitised — `existing.eventType` came from an earlier
      // (possibly forged) delivery's body.
      this.logger.error(
        `[RESULT] bitnob webhook event_id collision stored=${sanitizeEventName(existing.eventType)} ` +
          `incoming=${sanitizeEventName(incomingEventType)} eventId=${eventId}`,
      );
      return;
    }
    this.logger.log(`[RESULT] webhook duplicate eventId=${eventId} (${via}) — idempotent 200, not re-dispatched`);
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { code?: string }).code === PG_UNIQUE_VIOLATION
    );
  }

  private extractEventType(payload: Record<string, unknown>): string {
    const candidate = payload?.event ?? payload?.event_type ?? payload?.eventType;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : 'unknown';
  }

  private extractEventId(payload: Record<string, unknown>): string | null {
    const candidate = payload?.event_id ?? payload?.eventId ?? payload?.id;
    return typeof candidate === 'string' && candidate.length > 0 ? candidate : null;
  }

  private extractResourceId(payload: Record<string, unknown>): string | null {
    const data = (payload?.data ?? payload) as Record<string, unknown> | undefined;
    const candidate = data?.id ?? data?.reference ?? data?.payoutId ?? data?.cardId;
    return typeof candidate === 'string' ? candidate : null;
  }
}

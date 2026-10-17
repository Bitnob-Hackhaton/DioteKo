import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { LightningInvoice, LightningInvoiceStatus, LightningProvider } from '../entities/lightning-invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';

/** An invoice already issued by an external provider (Bitnob), to be recorded in the local ledger. */
export interface RecordInvoiceParams {
  provider: LightningProvider;
  /** Provider's own invoice id (Bitnob: used for `GET /api/lightning/invoices/:id`). */
  externalId: string | null;
  paymentRequest: string;
  paymentHash: string;
  amountSats: number;
  expiresAt?: Date | null;
  memo?: string;
  /** App-level polymorphic tag — see `Payment.purposeType`'s doc comment. */
  purposeType: string;
  purposeId: string;
  organizationId?: string;
}

/** Called (not awaited) after an invoice has just been marked paid by THIS call. */
export type InvoicePaidHandler = (invoice: LightningInvoice) => Promise<void>;

export interface RecordInvoiceResult {
  invoice: LightningInvoice;
  payment: Payment;
}

/**
 * Local ledger of Lightning pay-in: the two rows that track an invoice issued by an external provider (Bitnob),
 * `lightning_invoices` (provider-specific detail) and `payments` (the generic, polymorphic ledger row any domain
 * module — `domains/admin-certificates` first — links back to via `purposeType`/`purposeId`).
 * Both are always written together so a `payments` row never exists without a matching invoice, and vice versa.
 *
 * Provider-neutral on purpose: `recordInvoice` / `markPaid` take an invoice issued elsewhere. This module must
 * not import `BitnobModule`, so the caller that talks to Bitnob (`AdminCertificatesService`) does the issuing and
 * reading, and only the ledger writes happen here.
 */
@Injectable()
export class LightningInvoicesService {
  private readonly logger = new Logger(LightningInvoicesService.name);
  private readonly invoicePaidHandlers: InvoicePaidHandler[] = [];

  constructor(
    @InjectRepository(LightningInvoice)
    private readonly invoicesRepository: Repository<LightningInvoice>,
  ) {}

  /**
   * Records an invoice issued by an external provider (Bitnob) together with its
   * `payments` ledger row, in ONE transaction so one never exists without the other.
   */
  async recordInvoice(params: RecordInvoiceParams): Promise<RecordInvoiceResult> {
    const { provider, externalId, paymentRequest, paymentHash, amountSats, expiresAt, memo, purposeType, purposeId, organizationId } =
      params;
    this.logger.log(
      `[START] recordInvoice provider=${provider} externalId=${externalId ?? '-'} purposeType=${purposeType} purposeId=${purposeId} amountSats=${amountSats}`,
    );

    const result = await this.invoicesRepository.manager.transaction(async (manager) => {
      const invoice = await manager.save(
        manager.create(LightningInvoice, {
          provider,
          externalId,
          paymentHash,
          paymentRequest,
          checkingId: null,
          amountSats,
          memo: memo ?? null,
          expiresAt: expiresAt ?? null,
          status: LightningInvoiceStatus.PENDING,
        }),
      );
      const payment = await manager.save(
        manager.create(Payment, {
          lightningInvoiceId: invoice.id,
          provider,
          purposeType,
          purposeId,
          amountSats,
          currency: 'SATS',
          status: PaymentStatus.PENDING,
          organizationId: organizationId ?? null,
        }),
      );
      return { invoice, payment };
    });

    this.logger.log(
      `[RESULT] recordInvoice success provider=${provider} invoiceId=${result.invoice.id} paymentId=${result.payment.id} paymentHash=${paymentHash}`,
    );
    return result;
  }

  async findByExternalId(provider: LightningProvider, externalId: string): Promise<LightningInvoice | null> {
    return this.invoicesRepository.findOne({ where: { provider, externalId } });
  }

  /**
   * Still-pending invoices of a provider for the background reconciler: the NEWEST half (a payer is waiting on
   * those) plus the OLDEST half (so a backlog of recent pending invoices can never hide an old one for good: the
   * oldest are closed once the provider reports them expired, and the next oldest then take their place).
   * Includes those whose `expiresAt` has passed on purpose: the provider's own answer (expired) is what closes them.
   */
  async listPendingByProvider(provider: LightningProvider, limit: number): Promise<LightningInvoice[]> {
    const where = { provider, status: LightningInvoiceStatus.PENDING };
    const newestCount = Math.ceil(limit / 2);
    const newest = await this.invoicesRepository.find({ where, order: { createdAt: 'DESC' }, take: newestCount });
    if (limit - newestCount <= 0) {
      return newest;
    }
    const oldest = await this.invoicesRepository.find({ where, order: { createdAt: 'ASC' }, take: limit - newestCount });
    const seen = new Set(newest.map((invoice) => invoice.id));
    return [...newest, ...oldest.filter((invoice) => !seen.has(invoice.id))];
  }

  /** Webhook lookup by payment hash; `null` when no invoice matches. */
  async findByPaymentHashOrNull(paymentHash: string): Promise<LightningInvoice | null> {
    return this.invoicesRepository.findOne({ where: { paymentHash } });
  }

  /** Webhook lookup by the BOLT11 string (Bitnob's paid-invoice payload carries it in `data.invoice`). */
  async findByPaymentRequestOrNull(paymentRequest: string): Promise<LightningInvoice | null> {
    return this.invoicesRepository.findOne({ where: { paymentRequest } });
  }

  /**
   * Registers a listener for invoices that just became paid. This module cannot import the domain modules that
   * react to a payment (`AdminCertificatesService` imports it, not the other way round), so they subscribe here.
   * Handlers run after the transaction committed, are never awaited by `markPaid` and cannot make it fail;
   * they must therefore be idempotent and have their own safety net (the process can die before they finish).
   */
  onInvoicePaid(handler: InvoicePaidHandler): void {
    this.invoicePaidHandlers.push(handler);
  }

  private notifyInvoicePaid(invoice: LightningInvoice): void {
    for (const handler of this.invoicePaidHandlers) {
      void Promise.resolve()
        .then(() => handler(invoice))
        .catch((error: unknown) => {
          this.logger.error(
            `[RESULT] invoice-paid handler failed invoiceId=${invoice.id} detail=${error instanceof Error ? error.name : 'unknown'}`,
          );
        });
    }
  }

  /**
   * Marks an invoice and its linked `payments` row paid, together, in one
   * transaction. The invoice update is CONDITIONAL (`status <> 'paid'`), so when
   * a webhook and a status read race, exactly one of them flips the row and
   * `paid_at` is never overwritten; the loser just reloads. The in-memory
   * entity is only changed after the transaction committed, so a failed write
   * can never leave a caller believing the invoice is paid.
   */
  async markPaid(invoice: LightningInvoice): Promise<LightningInvoice> {
    if (invoice.status === LightningInvoiceStatus.PAID) {
      this.logger.log(`[STATE] markPaid already paid invoiceId=${invoice.id}`);
      return invoice;
    }

    const paidAt = new Date();
    const applied = await this.invoicesRepository.manager.transaction(async (manager) => {
      const result = await manager.update(
        LightningInvoice,
        { id: invoice.id, status: Not(LightningInvoiceStatus.PAID) },
        { status: LightningInvoiceStatus.PAID, paidAt },
      );
      if (!result.affected) {
        return false;
      }

      const payment = await manager.findOne(Payment, { where: { lightningInvoiceId: invoice.id } });
      if (!payment) {
        // The request can never be promoted without this row: surface it loudly.
        this.logger.error(`[RESULT] markPaid invoice paid but NO linked payments row invoiceId=${invoice.id}`);
      } else if (payment.status !== PaymentStatus.PAID) {
        await manager.update(Payment, { id: payment.id }, { status: PaymentStatus.PAID });
        this.logger.log(`[RESULT] markPaid paymentId=${payment.id} invoiceId=${invoice.id}`);
      }
      return true;
    });

    if (applied) {
      invoice.status = LightningInvoiceStatus.PAID;
      invoice.paidAt = paidAt;
      this.logger.log(`[STATE] invoice paid invoiceId=${invoice.id} provider=${invoice.provider}`);
      this.notifyInvoicePaid(invoice);
    } else {
      const fresh = await this.invoicesRepository.findOne({ where: { id: invoice.id } });
      if (fresh) {
        Object.assign(invoice, fresh);
      }
      this.logger.log(`[STATE] markPaid lost the race, already paid invoiceId=${invoice.id}`);
    }
    return invoice;
  }

  /**
   * Closes a still-pending invoice that the provider reports as expired or failed, and fails its
   * `payments` row, so the request can be given a new invoice. Conditional on `status = 'pending'`:
   * a paid (or already closed) invoice is never touched. Returns `true` when it changed something.
   */
  async markClosed(
    invoice: LightningInvoice,
    status: LightningInvoiceStatus.EXPIRED | LightningInvoiceStatus.FAILED,
  ): Promise<boolean> {
    const applied = await this.invoicesRepository.manager.transaction(async (manager) => {
      const result = await manager.update(
        LightningInvoice,
        { id: invoice.id, status: LightningInvoiceStatus.PENDING },
        { status },
      );
      if (!result.affected) {
        return false;
      }
      await manager.update(
        Payment,
        { lightningInvoiceId: invoice.id, status: PaymentStatus.PENDING },
        { status: PaymentStatus.FAILED },
      );
      return true;
    });
    if (applied) {
      invoice.status = status;
      this.logger.log(`[STATE] invoice closed invoiceId=${invoice.id} status=${status}`);
    }
    return applied;
  }
}

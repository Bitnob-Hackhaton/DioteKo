import { Injectable, Logger } from '@nestjs/common';
import {
  LightningInvoice,
  LightningInvoiceStatus,
  LightningProvider,
} from '../../lightning/entities/lightning-invoice.entity';
import { LightningInvoicesService } from '../../lightning/services/lightning-invoices.service';
import { BitnobLightningService } from './bitnob-lightning.service';

export type InvoiceSettlementOutcome =
  /** Bitnob reports it paid and the ledger now says so. */
  | 'paid'
  /** The ledger already said paid; nothing changed. */
  | 'already_paid'
  /** Bitnob does not report it paid and it is still open (pending or unrecognised). Nothing changed. */
  | 'not_paid'
  /** Bitnob reports it expired or failed: the local invoice was closed and its payment failed, so the request can be re-invoiced. */
  | 'closed'
  /** Bitnob says paid but the amount or payment hash differs from what we issued. Nothing changed. */
  | 'mismatch';

export interface InvoiceSettlementResult {
  outcome: InvoiceSettlementOutcome;
  /** Status reported by Bitnob, when it was read. */
  remoteStatus?: string;
}

/**
 * The single place where a Bitnob Lightning invoice is promoted to paid in the
 * local ledger. Both entry points go through it: the webhook (a signal) and the
 * status read in `AdminCertificatesService` (the fallback when no webhook
 * arrives). Neither trusts a payload: the invoice is READ from Bitnob and only
 * a `paid` answer whose amount and payment hash match what we issued is applied.
 * That is the same rule as payouts ("reconcile is the authority"), and it is why
 * a forged or replayed webhook for an unpaid invoice changes nothing.
 */
@Injectable()
export class BitnobInvoiceSettlementService {
  private readonly logger = new Logger(BitnobInvoiceSettlementService.name);

  constructor(
    private readonly bitnobLightning: BitnobLightningService,
    private readonly lightningInvoices: LightningInvoicesService,
  ) {}

  async settleIfPaid(invoice: LightningInvoice): Promise<InvoiceSettlementResult> {
    if (invoice.provider !== LightningProvider.BITNOB || !invoice.externalId) {
      throw new Error(`Invoice ${invoice.id} was not issued by Bitnob (provider=${invoice.provider})`);
    }
    this.logger.log(`[START] settleIfPaid invoiceId=${invoice.id} externalId=${invoice.externalId}`);

    if (invoice.status === 'paid') {
      this.logger.log(`[STATE] settleIfPaid already paid invoiceId=${invoice.id}`);
      return { outcome: 'already_paid' };
    }

    const remote = await this.bitnobLightning.getInvoice(invoice.externalId);

    if (remote.status === 'expired' || remote.status === 'failed') {
      await this.lightningInvoices.markClosed(
        invoice,
        remote.status === 'expired' ? LightningInvoiceStatus.EXPIRED : LightningInvoiceStatus.FAILED,
      );
      this.logger.log(`[RESULT] settleIfPaid closed invoiceId=${invoice.id} remoteStatus=${remote.status}`);
      return { outcome: 'closed', remoteStatus: remote.status };
    }

    if (remote.status !== 'paid') {
      this.logger.log(
        `[RESULT] settleIfPaid not paid invoiceId=${invoice.id} remoteStatus=${remote.status}`,
      );
      return { outcome: 'not_paid', remoteStatus: remote.status };
    }

    if (
      remote.amountSats !== invoice.amountSats ||
      remote.paymentHash !== invoice.paymentHash ||
      remote.externalId !== invoice.externalId
    ) {
      // Do not log the payment hash or amounts of an untrusted answer beyond the fact of the mismatch.
      this.logger.error(
        `[RESULT] settleIfPaid MISMATCH invoiceId=${invoice.id} externalId=${invoice.externalId} ` +
          `amountMatches=${remote.amountSats === invoice.amountSats} hashMatches=${remote.paymentHash === invoice.paymentHash} ` +
          `idMatches=${remote.externalId === invoice.externalId} — not applied`,
      );
      return { outcome: 'mismatch', remoteStatus: remote.status };
    }

    await this.lightningInvoices.markPaid(invoice);
    this.logger.log(`[STATE] settleIfPaid paid invoiceId=${invoice.id}`);
    return { outcome: 'paid', remoteStatus: remote.status };
  }
}

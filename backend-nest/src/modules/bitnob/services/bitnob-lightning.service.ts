import { Injectable, Logger } from '@nestjs/common';
import { unwrapBitnob } from '../common/bitnob-envelope.util';
import { BitnobHttpClientService } from './bitnob-http-client.service';

/** Invoice validity asked from Bitnob when the caller gives none (Bitnob's own default is 24 h). */
export const DEFAULT_INVOICE_EXPIRY_SECONDS = 1800;

/**
 * Statuses documented for Bitnob Lightning invoices. Only `pending` has been
 * observed live; anything else is mapped to `unknown`, which callers must treat
 * as "not paid" (never promote an unrecognised status to paid).
 */
export type BitnobInvoiceStatus = 'pending' | 'paid' | 'expired' | 'failed' | 'unknown';

const KNOWN_STATUSES: readonly BitnobInvoiceStatus[] = ['pending', 'paid', 'expired', 'failed'];

/** Provider-neutral view of a Bitnob Lightning invoice (see `docs/BITNOB.md`, "Lightning pay-in"). */
export interface BitnobLightningInvoice {
  /** Bitnob's invoice id (uuid). Used for `GET /api/lightning/invoices/:id`. */
  externalId: string;
  /** BOLT11 payment request the payer scans or pastes. */
  paymentRequest: string;
  /** 64-hex payment hash. */
  paymentHash: string;
  amountSats: number;
  status: BitnobInvoiceStatus;
  expiresAt: Date | null;
  /** Our idempotency key, echoed back by Bitnob on get/list (not on create). */
  reference: string | null;
}

export interface CreateBitnobInvoiceParams {
  amountSats: number;
  description: string;
  /** Idempotency key, e.g. `dkinv_<requestId>` (`_<n>` for a re-issued invoice). Bitnob requires it. */
  reference: string;
  expirySeconds?: number;
}

/**
 * Bitnob returns `expires_at` as an ISO timestamp on create but as a Unix
 * seconds string on get/list (verified live, 2026-10-04). Accept both.
 */
export function parseBitnobExpiry(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const date = new Date(Number(value) * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function toStatus(value: unknown): BitnobInvoiceStatus {
  return typeof value === 'string' && (KNOWN_STATUSES as readonly string[]).includes(value)
    ? (value as BitnobInvoiceStatus)
    : 'unknown';
}

/**
 * Maps the `data` object of create/get to `BitnobLightningInvoice`. Throws
 * when a field we cannot work without is missing, so a changed response shape
 * fails loudly instead of persisting a half-empty invoice.
 */
export function mapBitnobInvoice(data: Record<string, unknown>): BitnobLightningInvoice {
  const externalId = typeof data.id === 'string' ? data.id : '';
  const paymentRequest = typeof data.request === 'string' ? data.request : '';
  const paymentHash = typeof data.payment_hash === 'string' ? data.payment_hash : '';
  if (!externalId || !paymentRequest || !paymentHash) {
    throw new Error('Bitnob invoice response is missing id, request or payment_hash');
  }
  // Strict: Bitnob sends the amount as a decimal string of whole satoshis; anything else is a changed contract.
  const rawAmount = String(data.amount_sat ?? '');
  const amountSats = /^\d+$/.test(rawAmount) ? Number(rawAmount) : Number.NaN;
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new Error('Bitnob invoice response has no valid amount_sat');
  }
  return {
    externalId,
    paymentRequest,
    paymentHash,
    amountSats,
    status: toStatus(data.status),
    expiresAt: parseBitnobExpiry(data.expires_at),
    reference: typeof data.reference === 'string' && data.reference.length > 0 ? data.reference : null,
  };
}

/**
 * Bitnob Lightning pay-in: create an invoice for a citizen to pay, and read
 * its status back. Signing and error handling live in `BitnobHttpClientService`
 * (a `BitnobApiError` carries `status` and the raw body, which this service
 * never logs). `customer_id` is optional at Bitnob and deliberately not sent:
 * DioteKo collects for its own account.
 *
 * Reading an invoice here is the authority for "was it paid": the webhook is
 * only a signal (see `BitnobWebhookService`), and Bitnob itself recommends
 * querying in case webhooks fail.
 */
@Injectable()
export class BitnobLightningService {
  private readonly logger = new Logger(BitnobLightningService.name);

  constructor(private readonly http: BitnobHttpClientService) {}

  async createInvoice(params: CreateBitnobInvoiceParams): Promise<BitnobLightningInvoice> {
    const { amountSats, description, reference, expirySeconds = DEFAULT_INVOICE_EXPIRY_SECONDS } = params;
    this.logger.log(`[START] createInvoice reference=${reference} amountSats=${amountSats} expiry=${expirySeconds}s`);

    const data = unwrapBitnob<Record<string, unknown>>(
      await this.http.post('/api/lightning/invoices', {
        amount: amountSats,
        description,
        expiry: expirySeconds,
        reference,
      }),
    );
    const invoice = mapBitnobInvoice(data);

    this.logger.log(
      `[RESULT] createInvoice ok reference=${reference} externalId=${invoice.externalId} ` +
        `paymentHash=${invoice.paymentHash} status=${invoice.status}`,
    );
    return invoice;
  }

  async getInvoice(externalId: string): Promise<BitnobLightningInvoice> {
    this.logger.log(`[START] getInvoice externalId=${externalId}`);
    const data = unwrapBitnob<Record<string, unknown>>(
      await this.http.get(`/api/lightning/invoices/${encodeURIComponent(externalId)}`),
    );
    const invoice = mapBitnobInvoice(data);
    if (invoice.status === 'unknown') {
      this.logger.warn(
        `[RESULT] getInvoice unrecognised status externalId=${externalId} — treated as not paid`,
      );
    } else {
      this.logger.log(`[RESULT] getInvoice ok externalId=${externalId} status=${invoice.status}`);
    }
    return invoice;
  }
}

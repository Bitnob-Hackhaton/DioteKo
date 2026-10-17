import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { unwrapBitnob } from '../common/bitnob-envelope.util';
import { BitnobHttpClientService } from './bitnob-http-client.service';

/**
 * `data.payout` shape of the Bitnob payout endpoints (quote / initialize /
 * finalize / `GET /api/payouts/:id`), verified against the live sandbox
 * 2026-08-30. Money fields are DISPLAY-unit strings (`settlement_amount`
 * "500" == ₦500; `amount` "0.364578" == 0.364578 USDT) — the exception to
 * Bitnob's usual smallest-unit convention. `quote_id` is `QT2_<digits>`.
 * `beneficiary` is only present after initialize and carries bank-account
 * PII — never persist or return it unscrubbed (see `stripPayoutPii`).
 */
export interface BitnobPayoutRecord {
  id: string;
  quote_id: string;
  company_id: string;
  status: string;
  source: string;
  from_asset: string;
  to_currency: string;
  amount: string;
  settlement_amount: string;
  exchange_rate: Record<string, unknown>;
  reference: string;
  country: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  beneficiary?: Record<string, unknown>;
  payment_reason?: string;
  callback_url?: string;
  provider_settlement_id?: string | null;
  [key: string]: unknown;
}

/** `data` shape of `GET /api/payouts` — offset pagination, NOT cursor. */
export interface BitnobPayoutListData {
  items: BitnobPayoutRecord[];
  total_count: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

/** `data` shape of `GET /api/payouts/account-lookup`. */
export interface BitnobAccountLookupData {
  account_name: string;
  account_number: string;
  bank_code: string;
  bank_name: string;
  country: string;
  is_verified: boolean;
}

export interface CreateQuoteInput {
  fromAsset: string;
  toCurrency: string;
  country: string;
  settlementAmount: string;
  reference: string;
  source?: string;
}

export interface BankBeneficiaryInput {
  destinationType: string;
  country: string;
  accountName: string;
  accountNumber: string;
  bankCode: string;
}

export interface InitializePayoutInput {
  reference: string;
  paymentReason: string;
  beneficiary: BankBeneficiaryInput;
}

export interface ListPayoutsOptions {
  limit?: number;
  offset?: number;
  status?: string;
}

export interface AccountLookupInput {
  country: string;
  bankCode: string;
  accountNumber: string;
  type?: string;
}

/**
 * The money-moving Bitnob payout surface. Three write steps —
 * `createQuote` -> `initializePayout` -> `finalizePayout` — plus read
 * helpers. `finalizePayout` is the actual disbursement.
 *
 * All wire bodies are built here as explicit snake_case objects (never the
 * caller's DTO spread through) so a rename on our side can't silently change
 * what Bitnob receives. Signing (`BitnobHttpClientService`) is unchanged and
 * confirmed against the live sandbox.
 *
 * This service has NO repository — persistence of the local `bitnob_payouts`
 * row lives with the callers (`BitnobMoneyController` for the raw admin path,
 * `AdminCertificatesService` for the certificate-scoped path), which own the
 * idempotency key and the transactional local writes.
 */
@Injectable()
export class BitnobPayoutsService {
  private readonly logger = new Logger(BitnobPayoutsService.name);

  constructor(
    private readonly http: BitnobHttpClientService,
    private readonly config: ConfigService,
  ) {}

  /**
   * `POST /api/payouts/quotes`. `settlement_amount` is in `to_currency`
   * display units. The response `payout.amount` is the crypto side of the
   * quote (populated on the live sandbox). `reference` MUST be reused
   * verbatim on initialize + finalize — it is Bitnob's only idempotency key.
   */
  async createQuote(input: CreateQuoteInput): Promise<BitnobPayoutRecord> {
    const body = {
      from_asset: input.fromAsset,
      to_currency: input.toCurrency,
      country: input.country,
      source: input.source ?? 'offchain',
      settlement_amount: input.settlementAmount,
      reference: input.reference,
    };
    this.logger.log(
      `[START] payouts.createQuote reference=${input.reference} toCurrency=${input.toCurrency} ` +
        `country=${input.country} settlementAmount=${input.settlementAmount} environment=${this.environment()}`,
    );
    const data = unwrapBitnob<{ payout: BitnobPayoutRecord }>(
      await this.http.post('/api/payouts/quotes', body),
    );
    this.logger.log(
      `[RESULT] payouts.createQuote reference=${input.reference} quoteId=${data?.payout?.quote_id ?? 'n/a'} ` +
        `status=${data?.payout?.status ?? 'n/a'}`,
    );
    return data.payout;
  }

  /**
   * `POST /api/payouts/:quoteId/initialize`. The path param is the
   * `quote_id` ("QT2_...") string, NOT the payout UUID. `callback_url` is
   * built server-side from `APP_BASE_URL` — never accepted from a caller.
   * Non-HTTPS callback URLs are only rejected in `production`.
   */
  async initializePayout(quoteId: string, input: InitializePayoutInput): Promise<BitnobPayoutRecord> {
    const callbackUrl = this.buildAndValidateCallbackUrl();
    const body = {
      quote_id: quoteId,
      reference: input.reference,
      payment_reason: input.paymentReason,
      callback_url: callbackUrl,
      beneficiary: {
        destination_type: input.beneficiary.destinationType,
        country: input.beneficiary.country,
        account_name: input.beneficiary.accountName,
        account_number: input.beneficiary.accountNumber,
        bank_code: input.beneficiary.bankCode,
      },
    };
    this.logger.log(
      `[START] payouts.initializePayout quoteId=${quoteId} reference=${input.reference} environment=${this.environment()}`,
    );
    const data = unwrapBitnob<{ payout: BitnobPayoutRecord }>(
      await this.http.post(`/api/payouts/${encodeURIComponent(quoteId)}/initialize`, body),
    );
    this.logger.log(
      `[RESULT] payouts.initializePayout quoteId=${quoteId} bitnobPayoutId=${data?.payout?.id ?? 'n/a'} ` +
        `status=${data?.payout?.status ?? 'n/a'}`,
    );
    return data.payout;
  }

  /**
   * `POST /api/payouts/:quoteId/finalize` with an empty body — the actual
   * disbursement. HARD-DISABLED in `production` this increment: there is no
   * failure webhook and no reconciliation guarantee yet, so a production
   * finalize could move money we can't track. Callers must gate on the
   * remote status being exactly `INITIATED` before calling this.
   */
  async finalizePayout(quoteId: string): Promise<BitnobPayoutRecord> {
    if (this.environment() === 'production') {
      throw new ForbiddenException(
        'Bitnob payout finalize is disabled in production (Increment 3 interim state)',
      );
    }
    this.logger.log(`[START] payouts.finalizePayout quoteId=${quoteId} environment=${this.environment()}`);
    const data = unwrapBitnob<{ payout: BitnobPayoutRecord }>(
      await this.http.post(`/api/payouts/${encodeURIComponent(quoteId)}/finalize`, {}),
    );
    this.logger.log(
      `[RESULT] payouts.finalizePayout quoteId=${quoteId} status=${data?.payout?.status ?? 'n/a'}`,
    );
    return data.payout;
  }

  /** `GET /api/payouts/:id` — path is the payout UUID, NOT the quote_id. */
  async getPayout(payoutId: string): Promise<BitnobPayoutRecord> {
    this.logger.log(`[START] payouts.getPayout payoutId=${payoutId}`);
    const data = unwrapBitnob<{ payout: BitnobPayoutRecord }>(
      await this.http.get(`/api/payouts/${encodeURIComponent(payoutId)}`),
    );
    this.logger.log(`[RESULT] payouts.getPayout payoutId=${payoutId} status=${data?.payout?.status ?? 'n/a'}`);
    return data.payout;
  }

  /** `GET /api/payouts?limit=&offset=&status=` — offset pagination. */
  async listPayouts(opts: ListPayoutsOptions = {}): Promise<BitnobPayoutListData> {
    const params: Record<string, string | number> = {};
    if (opts.limit !== undefined) params.limit = opts.limit;
    if (opts.offset !== undefined) params.offset = opts.offset;
    if (opts.status !== undefined) params.status = opts.status;
    this.logger.log(
      `[START] payouts.listPayouts limit=${opts.limit ?? 'default'} offset=${opts.offset ?? 0} status=${opts.status ?? 'any'}`,
    );
    const data = unwrapBitnob<BitnobPayoutListData>(await this.http.get('/api/payouts', params));
    this.logger.log(`[RESULT] payouts.listPayouts count=${data?.items?.length ?? 0} hasMore=${data?.has_more ?? false}`);
    return data;
  }

  /**
   * `GET /api/payouts/account-lookup` — name-from-number oracle. Query
   * values are `encodeURIComponent`-escaped into the path string directly
   * (not handed to axios `params`) so there is exactly one layer of
   * encoding.
   */
  async accountLookup(input: AccountLookupInput): Promise<BitnobAccountLookupData> {
    const qs =
      `country=${encodeURIComponent(input.country)}` +
      `&bank_code=${encodeURIComponent(input.bankCode)}` +
      `&account_number=${encodeURIComponent(input.accountNumber)}` +
      (input.type ? `&type=${encodeURIComponent(input.type)}` : '');
    this.logger.log(`[START] payouts.accountLookup country=${input.country} bankCode=${input.bankCode}`);
    const data = unwrapBitnob<BitnobAccountLookupData>(
      await this.http.get(`/api/payouts/account-lookup?${qs}`),
    );
    this.logger.log(`[RESULT] payouts.accountLookup country=${input.country} isVerified=${data?.is_verified ?? 'n/a'}`);
    return data;
  }

  /** `GET /api/payouts/supported-countries` — reference data. */
  async supportedCountries(): Promise<unknown> {
    this.logger.log('[START] payouts.supportedCountries');
    const data = unwrapBitnob<unknown>(await this.http.get('/api/payouts/supported-countries'));
    this.logger.log('[RESULT] payouts.supportedCountries ok');
    return data;
  }

  /** `GET /api/payouts/supported-countries/:country` — per-corridor requirements. */
  async countryRequirements(country: string): Promise<unknown> {
    this.logger.log(`[START] payouts.countryRequirements country=${country}`);
    const data = unwrapBitnob<unknown>(
      await this.http.get(`/api/payouts/supported-countries/${encodeURIComponent(country)}`),
    );
    this.logger.log(`[RESULT] payouts.countryRequirements country=${country} ok`);
    return data;
  }

  /** `GET /api/payouts/banks/:countryCode` — bank directory for a corridor. */
  async banks(countryCode: string): Promise<unknown> {
    this.logger.log(`[START] payouts.banks countryCode=${countryCode}`);
    const data = unwrapBitnob<unknown>(
      await this.http.get(`/api/payouts/banks/${encodeURIComponent(countryCode)}`),
    );
    this.logger.log(`[RESULT] payouts.banks countryCode=${countryCode} ok`);
    return data;
  }

  /** `GET /api/payouts/limits` — per-corridor min/max. */
  async limits(): Promise<unknown> {
    this.logger.log('[START] payouts.limits');
    const data = unwrapBitnob<unknown>(await this.http.get('/api/payouts/limits'));
    this.logger.log('[RESULT] payouts.limits ok');
    return data;
  }

  private environment(): string {
    return this.config.get<string>('bitnob.environment', 'sandbox');
  }

  /**
   * Builds `${APP_BASE_URL}/api/bitnob/webhooks` (the catch-all webhook route
   * — Bitnob delivers every event family to one URL) and validates it. A
   * malformed `APP_BASE_URL` is a 500 (server misconfiguration, not a client
   * error). The HTTPS requirement only bites in `production` — local dev with
   * `BITNOB_ENVIRONMENT=sandbox` may use `http://localhost:3001`.
   */
  private buildAndValidateCallbackUrl(): string {
    const appBaseUrl = this.config.get<string>('app.baseUrl', '');
    let cb: URL;
    try {
      cb = new URL(`${appBaseUrl}/api/bitnob/webhooks`);
    } catch {
      throw new InternalServerErrorException('APP_BASE_URL is not a valid URL');
    }
    if (this.environment() === 'production' && cb.protocol !== 'https:') {
      throw new InternalServerErrorException('Bitnob callback URL must be HTTPS in production');
    }
    return cb.toString();
  }
}

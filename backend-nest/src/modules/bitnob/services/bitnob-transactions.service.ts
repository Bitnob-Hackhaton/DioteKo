import { Injectable, Logger } from '@nestjs/common';
import { unwrapBitnob } from '../common/bitnob-envelope.util';
import { BitnobHttpClientService } from './bitnob-http-client.service';

/**
 * One transaction row. Also the `data` of `GET /api/transactions/:id` (no
 * wrapper). `amount`/`fee` are signed smallest-unit strings — the
 * `*_formatted` siblings are display-only. NOTE: the body field is `state`,
 * but the list query param that filters on it is `status`.
 */
export interface BitnobTransactionItem {
  transaction_id: string;
  account_number: string;
  currency: string;
  type: string;
  state: string;
  amount: string;
  fee: string;
  reference: string;
  idempotency_key: string;
  trade_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  value_date: string;
  amount_formatted: string;
  fee_formatted: string;
  side: 'Debit' | 'Credit';
}

/** `data` shape of `GET /api/transactions`. Feed `next_cursor` back as `?cursor=`. */
export interface TransactionsListData {
  transactions: BitnobTransactionItem[];
  next_cursor: string;
  previous_cursor: string;
  total_count: number;
  has_more: boolean;
}

export interface ListTransactionsOptions {
  cursor?: string;
  /** default 20, max 100 (enforced by the query DTO on the controller). */
  limit?: number;
  /** `PENDING` | `IN_PROGRESS` | `SETTLED` | `FAILED` | `REVERSED`. */
  status?: string;
  /** open string per Bitnob docs — not an enum. */
  type?: string;
  currency?: string;
}

/**
 * Read-only transaction history. `list()` builds the query object dropping
 * any undefined key before it reaches the HTTP client. `getById()` accepts
 * either the transaction UUID or the caller-supplied `reference` string.
 */
@Injectable()
export class BitnobTransactionsService {
  private readonly logger = new Logger(BitnobTransactionsService.name);

  constructor(private readonly http: BitnobHttpClientService) {}

  async list(opts: ListTransactionsOptions = {}): Promise<TransactionsListData> {
    const params: Record<string, string | number> = {};
    if (opts.cursor !== undefined) params.cursor = opts.cursor;
    if (opts.limit !== undefined) params.limit = opts.limit;
    if (opts.status !== undefined) params.status = opts.status;
    if (opts.type !== undefined) params.type = opts.type;
    if (opts.currency !== undefined) params.currency = opts.currency;

    this.logger.log(
      `[START] transactions.list limit=${opts.limit ?? 'default'} status=${opts.status ?? 'any'} ` +
        `type=${opts.type ?? 'any'} currency=${opts.currency ?? 'any'} cursor=${opts.cursor ? 'yes' : 'no'}`,
    );
    const data = unwrapBitnob<TransactionsListData>(await this.http.get('/api/transactions', params));
    this.logger.log(
      `[RESULT] transactions.list count=${data?.transactions?.length ?? 0} hasMore=${data?.has_more ?? false}`,
    );
    return data;
  }

  async getById(id: string): Promise<BitnobTransactionItem> {
    this.logger.log(`[START] transactions.getById id=${id}`);
    const data = unwrapBitnob<BitnobTransactionItem>(
      await this.http.get(`/api/transactions/${encodeURIComponent(id)}`),
    );
    this.logger.log(`[RESULT] transactions.getById id=${id} state=${data?.state ?? 'unknown'}`);
    return data;
  }
}

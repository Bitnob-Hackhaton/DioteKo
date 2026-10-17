import { Injectable, Logger } from '@nestjs/common';
import { unwrapBitnob } from '../common/bitnob-envelope.util';
import { BitnobHttpClientService } from './bitnob-http-client.service';

/**
 * One account row from `GET /api/balances`. All money fields are strings in
 * the smallest unit (USDT/USDC = 1e6, BTC = sats). The `*_formatted`
 * siblings are display-only — never parse them.
 */
export interface BitnobAccount {
  account_id: string;
  account_number: string;
  currency: string;
  ledger_balance: string;
  available_balance: string;
  ledger_balance_formatted: string;
  available_balance_formatted: string;
  created_at: string;
}

/** `data` shape of `GET /api/balances` — no pagination. */
export interface BalancesListData {
  company_id: string;
  accounts: BitnobAccount[];
}

/**
 * `data` shape of `GET /api/balances/:currency`. NOTE: different field names
 * from the list rows — `total_balance`/`pending_balance`, no `*_formatted`,
 * no `account_id`. 404s if there is no wallet for that currency.
 */
export interface CurrencyBalanceData {
  account_number: string;
  currency: string;
  total_balance: string;
  available_balance: string;
  pending_balance: string;
  company_id: string;
}

/**
 * Read-only wallet balance lookups. All money values stay as smallest-unit
 * strings — callers that need arithmetic must parse explicitly and must not
 * use the `*_formatted` display fields.
 */
@Injectable()
export class BitnobBalancesService {
  private readonly logger = new Logger(BitnobBalancesService.name);

  constructor(private readonly http: BitnobHttpClientService) {}

  async list(): Promise<BalancesListData> {
    this.logger.log('[START] balances.list');
    const data = unwrapBitnob<BalancesListData>(await this.http.get('/api/balances'));
    this.logger.log(`[RESULT] balances.list accounts=${data?.accounts?.length ?? 0}`);
    return data;
  }

  async getByCurrency(currency: string): Promise<CurrencyBalanceData> {
    this.logger.log(`[START] balances.getByCurrency currency=${currency}`);
    const data = unwrapBitnob<CurrencyBalanceData>(
      await this.http.get(`/api/balances/${encodeURIComponent(currency)}`),
    );
    this.logger.log(`[RESULT] balances.getByCurrency currency=${currency} ok`);
    return data;
  }
}

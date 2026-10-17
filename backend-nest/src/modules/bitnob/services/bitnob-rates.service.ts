import { Injectable, Logger } from '@nestjs/common';
import { unwrapBitnob } from '../common/bitnob-envelope.util';
import { BitnobHttpClientService } from './bitnob-http-client.service';

/**
 * `data` shape of `GET /api/exchange-rates?from=&to=` (single pair). Every
 * field is a string except `valid_for_seconds`.
 */
export interface RatePairData {
  base_currency: string;
  target_currency: string;
  buy_rate: string;
  sell_rate: string;
  mid_rate: string;
  inverse_rate: string;
  timestamp: string;
  valid_for_seconds: number;
  percent_change_24h: string;
}

/** One row of `GET /api/exchange-rates?base=` — no `mid_rate`/`valid_for_seconds`. */
export interface RateByBaseRow {
  target_currency: string;
  buy_rate: string;
  sell_rate: string;
  inverse_rate: string;
  percent_change_24h: string;
}

/** `data` shape of `GET /api/exchange-rates?base=` (all pairs off one base). */
export interface RatesByBaseData {
  base_currency: string;
  rates: RateByBaseRow[];
  timestamp: string;
  skipped_currencies: string[];
}

/** `data` shape of `GET /api/exchange-rates/convert`. All fields are strings. */
export interface RateConvertData {
  from_currency: string;
  to_currency: string;
  from_amount: string;
  to_amount: string;
  rate_used: string;
  timestamp: string;
}

/**
 * Read-only FX rate lookups. `getPair`/`listByBase` share the
 * `/api/exchange-rates` path — `base` is mutually exclusive with
 * `from`+`to`. `convert` takes its `amount` in DISPLAY units (not the
 * smallest-unit convention used elsewhere).
 */
@Injectable()
export class BitnobRatesService {
  private readonly logger = new Logger(BitnobRatesService.name);

  constructor(private readonly http: BitnobHttpClientService) {}

  async getPair(from: string, to: string): Promise<RatePairData> {
    this.logger.log(`[START] rates.getPair from=${from} to=${to}`);
    const data = unwrapBitnob<RatePairData>(await this.http.get('/api/exchange-rates', { from, to }));
    this.logger.log(`[RESULT] rates.getPair from=${from} to=${to} ok`);
    return data;
  }

  async listByBase(base: string): Promise<RatesByBaseData> {
    this.logger.log(`[START] rates.listByBase base=${base}`);
    const data = unwrapBitnob<RatesByBaseData>(await this.http.get('/api/exchange-rates', { base }));
    this.logger.log(`[RESULT] rates.listByBase base=${base} rates=${data?.rates?.length ?? 0}`);
    return data;
  }

  async convert(from: string, to: string, amount: string): Promise<RateConvertData> {
    this.logger.log(`[START] rates.convert from=${from} to=${to} amount=${amount}`);
    const data = unwrapBitnob<RateConvertData>(
      await this.http.get('/api/exchange-rates/convert', { from, to, amount }),
    );
    this.logger.log(`[RESULT] rates.convert from=${from} to=${to} ok`);
    return data;
  }
}

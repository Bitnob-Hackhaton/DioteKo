import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches } from 'class-validator';
import { PAYOUT_FROM_ASSETS, SETTLEMENT_AMOUNT_PATTERN } from '../payouts.constants';

/**
 * Body for the raw admin `POST /api/bitnob/payouts/quotes`. Admin-only, so
 * the currency/country matchers are deliberately loose (bare ISO shape, not
 * an allow-list) — Bitnob validates the corridor and this endpoint exists
 * precisely to exercise arbitrary ones. `settlementAmount` is in
 * `toCurrency` DISPLAY units (₦5,000 -> "5000").
 *
 * There is NO `reference` field: the reference is derived server-side from
 * the persisted `bitnob_payouts` row id (`dkpayout_<uuid>`) so it is
 * deterministic and can't be spoofed to collide with another payout.
 */
export class CreatePayoutQuoteDto {
  @IsIn([...PAYOUT_FROM_ASSETS])
  fromAsset: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'toCurrency must be an ISO-4217 alpha-3 code' })
  toCurrency: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO-3166-1 alpha-2 code' })
  country: string;

  @IsString()
  @Matches(SETTLEMENT_AMOUNT_PATTERN, {
    message: 'settlementAmount must be a positive decimal string with up to 2 decimal places',
  })
  settlementAmount: string;
}

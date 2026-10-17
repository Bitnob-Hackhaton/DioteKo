import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import {
  BASE_UNIT_AMOUNT_PATTERN,
  BITNOB_ADDRESS_PATTERN,
  BITNOB_CHAINS,
  BITNOB_WITHDRAWAL_CURRENCIES,
  BULK_DESCRIPTION_MAX_LENGTH,
} from '../bitnob-chains.constants';
import { PAYMENT_REASON_SINGLE_LINE } from '../payouts.constants';

/**
 * One line item of a `POST /api/bitnob/bulk-transfers` body.
 *
 * `amount` unit: base-unit integer string, same as a single withdrawal. The
 * Phase 1 probe could NOT verify this against a live sandbox (bulk transfers
 * are "Feature Not Enabled" on the DioteKo sandbox account) — see the note in
 * `bitnob-chains.constants.ts`.
 *
 * `currency` is USDT/USDC only this increment (same $10-min-without-FX reason
 * as withdrawals). `chain` is lower-cased before the allow-list check.
 */
export class BulkTransferItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rowIndex?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn([...BITNOB_CHAINS])
  chain: string;

  @IsIn([...BITNOB_WITHDRAWAL_CURRENCIES])
  currency: string;

  @IsString()
  @MaxLength(120)
  @Matches(BITNOB_ADDRESS_PATTERN, { message: 'address has an unexpected format' })
  address: string;

  @IsString()
  @Matches(BASE_UNIT_AMOUNT_PATTERN, {
    message: 'amount must be a positive base-unit integer string (no leading zero, up to 18 digits)',
  })
  amount: string;

  /** OFF-CHAIN internal label only (see `CreateWithdrawalDto.description`). */
  @IsOptional()
  @IsString()
  @MaxLength(BULK_DESCRIPTION_MAX_LENGTH)
  @Matches(PAYMENT_REASON_SINGLE_LINE, { message: 'description must be a single line' })
  description?: string;
}

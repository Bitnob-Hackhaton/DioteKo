import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  BASE_UNIT_AMOUNT_PATTERN,
  BITNOB_ADDRESS_PATTERN,
  BITNOB_CHAINS,
  BITNOB_WITHDRAWAL_CURRENCIES,
  WITHDRAWAL_DESCRIPTION_MAX_LENGTH,
} from '../bitnob-chains.constants';
import { PAYMENT_REASON_SINGLE_LINE } from '../payouts.constants';

/**
 * Body for `POST /api/bitnob/withdrawals` (raw admin, money-moving).
 *
 * There is NO `reference` field: it is derived server-side from the persisted
 * `bitnob_withdrawals` row id (`dkwd_<uuid>`) so it is deterministic and
 * cannot be spoofed to collide with another withdrawal.
 *
 * There is NO `memo` field this increment: several chains write the memo
 * permanently on-chain, and DioteKo has no need for it yet (MUST-FIX 6).
 *
 * `chain` is lower-cased before the allow-list check, so `"Ethereum"` is
 * accepted and normalised to `"ethereum"`.
 */
export class CreateWithdrawalDto {
  @IsString()
  @MaxLength(120)
  @Matches(BITNOB_ADDRESS_PATTERN, { message: 'toAddress has an unexpected format' })
  toAddress: string;

  @IsString()
  @Matches(BASE_UNIT_AMOUNT_PATTERN, {
    message: 'amount must be a positive base-unit integer string (no leading zero, up to 18 digits)',
  })
  amount: string;

  @IsIn([...BITNOB_WITHDRAWAL_CURRENCIES])
  currency: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn([...BITNOB_CHAINS])
  chain: string;

  /**
   * OFF-CHAIN internal label only. Per the integration contract, Bitnob's
   * `/api/withdrawals` `description` is settlement metadata, NOT an on-chain
   * memo — the on-chain `memo` field was deliberately excluded from this DTO
   * (MUST-FIX 6). Never logged by value (presence/length only).
   */
  @IsOptional()
  @IsString()
  @MaxLength(WITHDRAWAL_DESCRIPTION_MAX_LENGTH)
  @Matches(PAYMENT_REASON_SINGLE_LINE, { message: 'description must be a single line' })
  description?: string;
}

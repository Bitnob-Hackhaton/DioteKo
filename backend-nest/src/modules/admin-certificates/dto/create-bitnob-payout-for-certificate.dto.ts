import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import {
  PAYMENT_REASON_MAX_LENGTH,
  PAYMENT_REASON_SINGLE_LINE,
  PAYOUT_FROM_ASSETS,
  PAYOUT_SETTLEMENT_CURRENCIES,
  PAYOUT_SUPPORTED_COUNTRIES,
  SETTLEMENT_AMOUNT_PATTERN,
} from '../../bitnob/payouts.constants';

/**
 * Body for `POST /api/admin-certificates/:certificateId/bitnob/payouts`.
 *
 * Deliberately carries NO `beneficiary`, NO `customerId`, NO
 * `organizationId`: the beneficiary is resolved server-side from
 * `BITNOB_PAYOUT_BENEFICIARY_*` config, and the organisation / subject DID
 * come from the certificate's own ref row. A caller can only choose the
 * amount, the destination currency/country, and (optionally) the crypto leg
 * and a payment reason.
 *
 * `settlementAmount` is a STRING in `toCurrency` display units (₦5,000 ->
 * "5000") to avoid float precision loss; a positive-number runtime guard in
 * the service backstops the regex.
 */
export class CreateBitnobPayoutForCertificateDto {
  @IsString()
  @Matches(SETTLEMENT_AMOUNT_PATTERN, {
    message: 'settlementAmount must be a positive decimal string with up to 2 decimal places',
  })
  settlementAmount: string;

  @IsIn([...PAYOUT_SETTLEMENT_CURRENCIES])
  toCurrency: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsIn([...PAYOUT_SUPPORTED_COUNTRIES])
  country: string;

  @IsOptional()
  @IsIn([...PAYOUT_FROM_ASSETS])
  fromAsset?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PAYMENT_REASON_MAX_LENGTH)
  @Matches(PAYMENT_REASON_SINGLE_LINE, { message: 'paymentReason must be a single line' })
  paymentReason?: string;
}

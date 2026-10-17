import { Type } from 'class-transformer';
import { IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { PAYMENT_REASON_MAX_LENGTH, PAYMENT_REASON_SINGLE_LINE } from '../payouts.constants';
import { BankBeneficiaryDto } from './bank-beneficiary.dto';

/**
 * Body for the raw admin `POST /api/bitnob/payouts/:id/initialize`. `:id` is
 * our own `bitnob_payouts` row id — the handler loads the row and reads the
 * `quote_id` + `reference` from it (neither is caller-supplied).
 *
 * The certificate-scoped path does NOT use this DTO: its beneficiary is
 * server-resolved and its `payment_reason` defaults to a fixed string.
 */
export class InitializePayoutDto {
  @IsString()
  @MaxLength(PAYMENT_REASON_MAX_LENGTH)
  @Matches(PAYMENT_REASON_SINGLE_LINE, { message: 'paymentReason must be a single line' })
  paymentReason: string;

  @ValidateNested()
  @Type(() => BankBeneficiaryDto)
  beneficiary: BankBeneficiaryDto;
}

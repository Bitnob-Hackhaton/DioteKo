import { IsIn, IsString, Matches, MaxLength } from 'class-validator';
import { BITNOB_CHAINS } from '../bitnob-chains.constants';

/**
 * Body for `POST /api/bitnob/withdrawals/validate-address` — a read-only
 * proxy to Bitnob's `POST /api/addresses/validate`. Non-money-moving.
 *
 * The address matcher here is looser than `CreateWithdrawalDto` (min 6 chars):
 * the whole point of this endpoint is to tell the caller whether an address is
 * valid, so it should reach Bitnob rather than 400 on a borderline string.
 */
export class ValidateAddressDto {
  @IsString()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9]{6,120}$/, { message: 'address has an unexpected format' })
  address: string;

  @IsIn([...BITNOB_CHAINS])
  chain: string;
}

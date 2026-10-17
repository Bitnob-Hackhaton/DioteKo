import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Bank payout beneficiary — used ONLY on the raw admin
 * `POST /api/bitnob/payouts/:id/initialize` endpoint. The certificate-scoped
 * payout path deliberately carries NO beneficiary at all: it is resolved
 * server-side from `BITNOB_PAYOUT_BENEFICIARY_*` config.
 *
 * `country` is validated as a bare ISO-3166-1 alpha-2 code (uppercased);
 * `accountNumber` / `bankCode` formats mirror Bitnob's own constraints.
 */
export class BankBeneficiaryDto {
  @IsIn(['bank'])
  destinationType: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO-3166-1 alpha-2 code' })
  country: string;

  @Matches(/^\d{6,20}$/, { message: 'accountNumber must be 6-20 digits' })
  accountNumber: string;

  @IsString()
  @MaxLength(140)
  accountName: string;

  @Matches(/^[A-Za-z0-9]{3,15}$/, { message: 'bankCode must be 3-15 alphanumeric characters' })
  bankCode: string;
}

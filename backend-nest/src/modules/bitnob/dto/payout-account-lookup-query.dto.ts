import { Transform } from 'class-transformer';
import { IsIn, IsOptional, Matches } from 'class-validator';

/**
 * Query params for the raw admin `GET /api/bitnob/payouts/account-lookup`
 * (name-from-account-number oracle). Declared as a validated DTO so the
 * global `forbidNonWhitelisted` pipe accepts these known keys; the service
 * `encodeURIComponent`-escapes every value into the Bitnob request path.
 */
export class PayoutAccountLookupQueryDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/, { message: 'country must be an ISO-3166-1 alpha-2 code' })
  country: string;

  @Matches(/^[A-Za-z0-9]{3,15}$/, { message: 'bankCode must be 3-15 alphanumeric characters' })
  bankCode: string;

  @Matches(/^\d{6,20}$/, { message: 'accountNumber must be 6-20 digits' })
  accountNumber: string;

  @IsOptional()
  @IsIn(['mobile_money'])
  type?: string;
}

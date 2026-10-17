import { IsNumberString, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Query params for `GET /bitnob/exchange-rates/convert`. All three
 * (`from`, `to`, `amount`) are required in practice — the controller returns
 * a `BadRequestException` if any is missing, and a second one if `amount`
 * does not parse to a strictly-positive number.
 *
 * `amount` is in DISPLAY units (not the smallest-unit convention used for
 * balances/transactions) and is kept as a string so it is forwarded to
 * Bitnob verbatim. `@IsNumberString` + `@Matches` reject `abc` / `-5` /
 * signed / exponent forms locally instead of round-tripping to Bitnob.
 */
export class ConvertQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsNumberString()
  @Matches(/^\d*\.?\d+$/, { message: 'amount must be a positive number (no sign, no exponent)' })
  amount?: string;
}

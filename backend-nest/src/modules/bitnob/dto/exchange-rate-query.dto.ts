import { IsOptional, IsString } from 'class-validator';

/**
 * Query params for `GET /bitnob/exchange-rates`. Either `base` (all pairs
 * off one base currency) OR both `from`+`to` (a single pair) — the two modes
 * are mutually exclusive and the controller enforces that one of them is
 * fully supplied. Declared as a validated DTO so the global
 * `forbidNonWhitelisted` pipe accepts these known keys.
 */
export class ExchangeRateQueryDto {
  @IsOptional()
  @IsString()
  base?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

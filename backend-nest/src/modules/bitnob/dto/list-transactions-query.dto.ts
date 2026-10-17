import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Verified Bitnob transaction `state` values, reused as the `?status=`
 * filter vocabulary on `GET /api/transactions` (Bitnob calls the query param
 * `status` even though the body field is `state`).
 */
export const BITNOB_TRANSACTION_STATUSES = ['PENDING', 'IN_PROGRESS', 'SETTLED', 'FAILED', 'REVERSED'] as const;

/**
 * Query params for `GET /bitnob/transactions`. Declared as a validated DTO so
 * the global `forbidNonWhitelisted` pipe accepts these known keys instead of
 * 400ing. `type` is an open string per Bitnob docs (no enum). `limit`
 * arrives as a string on the query and is coerced by the global
 * `transform: true` pipe.
 */
export class ListTransactionsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn([...BITNOB_TRANSACTION_STATUSES])
  status?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  currency?: string;
}

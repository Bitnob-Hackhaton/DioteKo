import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Query params for the raw admin `GET /api/bitnob/payouts` (proxied to
 * Bitnob's `GET /api/payouts`, which uses OFFSET pagination). Declared as a
 * validated DTO so the global `forbidNonWhitelisted` pipe accepts these
 * known keys. Beneficiary data is stripped from each item before the
 * response is returned.
 */
export class ListPayoutsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsIn(['QUOTE', 'INITIATED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED'])
  status?: string;
}

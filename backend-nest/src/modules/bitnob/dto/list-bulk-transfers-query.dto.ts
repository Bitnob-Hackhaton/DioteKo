import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Query params for `GET /api/bitnob/bulk-transfers` (proxied to Bitnob's
 * `GET /api/bulk-transfers`). Declared as a validated DTO so the global
 * `forbidNonWhitelisted` pipe accepts these known keys.
 *
 * Bitnob's list response is `data.batches[]` + `data.next_page_token`
 * (verified by the Phase 1 probe). The REQUEST param name for the token is
 * NOT verified (bulk write paths are disabled on the sandbox) — `page_token`
 * is the assumption; adjust if a live batch list contradicts it.
 */
export class ListBulkTransfersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pageToken?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(['draft', 'pending', 'processing', 'completed', 'failed', 'cancelled'])
  status?: string;
}

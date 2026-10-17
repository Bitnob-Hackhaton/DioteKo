import { Type } from 'class-transformer';
import { IsInt, IsString, Matches, Max, Min } from 'class-validator';
import { BULK_MAX_ITEMS } from '../bitnob-chains.constants';

/**
 * Body for `POST /api/bitnob/bulk-transfers/:id/confirm` — the IRREVERSIBLE
 * disbursement of every item in the batch.
 *
 * `expectedTotal` (base-unit integer string) and `expectedItemCount` are a
 * mandatory review gate (MUST-FIX 2c): the service recomputes the sum + count
 * over the PERSISTED items and refuses to confirm on any mismatch, BEFORE it
 * calls Bitnob. This makes "confirm exactly the batch I reviewed" enforceable
 * — a batch mutated between review and confirm can't slip through.
 *
 * `expectedTotal` allows up to 25 digits: 50 items * 18-digit max amounts.
 */
export class ConfirmBulkTransferDto {
  @IsString()
  @Matches(/^[1-9]\d{0,24}$/, {
    message: 'expectedTotal must be a positive base-unit integer string (up to 25 digits)',
  })
  expectedTotal: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BULK_MAX_ITEMS)
  expectedItemCount: number;
}

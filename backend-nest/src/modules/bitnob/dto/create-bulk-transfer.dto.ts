import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { BULK_DESCRIPTION_MAX_LENGTH, BULK_MAX_ITEMS, BULK_MIN_ITEMS } from '../bitnob-chains.constants';
import { PAYMENT_REASON_SINGLE_LINE } from '../payouts.constants';
import { BulkTransferItemDto } from './bulk-transfer-item.dto';

/**
 * Body for `POST /api/bitnob/bulk-transfers` (raw admin). Creates a DRAFT
 * batch — nothing is disbursed until `POST /api/bitnob/bulk-transfers/:id/
 * confirm`.
 *
 * `idempotencyKey` is optional; without it the batch is not deduplicated
 * (matching Bitnob). When present it is enforced unique locally via
 * `UQ_bitnob_bulk_batches_idempotency_key` and forwarded to Bitnob.
 *
 * Intra-batch duplicate destination addresses are rejected by
 * `BitnobBulkTransfersService.createDraft` (a bulk payout that pays the same
 * address twice is almost always a mistake — `@security-analyst` advisory).
 */
export class CreateBulkTransferDto {
  /** OFF-CHAIN internal label only (see `CreateWithdrawalDto.description`). */
  @IsOptional()
  @IsString()
  @MaxLength(BULK_DESCRIPTION_MAX_LENGTH)
  @Matches(PAYMENT_REASON_SINGLE_LINE, { message: 'description must be a single line' })
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[A-Za-z0-9:._-]{8,200}$/, {
    message: 'idempotencyKey must be 8-200 chars of [A-Za-z0-9:._-]',
  })
  idempotencyKey?: string;

  @IsArray()
  @ArrayMinSize(BULK_MIN_ITEMS)
  @ArrayMaxSize(BULK_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => BulkTransferItemDto)
  items: BulkTransferItemDto[];
}

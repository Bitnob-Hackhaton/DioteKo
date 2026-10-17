import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';
import { BULK_MAX_ITEMS } from '../bitnob-chains.constants';

/**
 * Body for `POST /api/bitnob/bulk-transfers/:id/retry` — re-send the named
 * FAILED items of an already-confirmed batch. Money-moving.
 *
 * `itemIds` are OUR local `bitnob_bulk_batch_items.id` UUIDs (not Bitnob's
 * item ids); the service maps them to `bitnob_item_id` before calling Bitnob.
 */
export class RetryBulkItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(BULK_MAX_ITEMS)
  @IsUUID('4', { each: true })
  itemIds: string[];
}

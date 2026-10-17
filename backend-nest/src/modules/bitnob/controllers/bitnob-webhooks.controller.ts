import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { BitnobWebhookSignatureGuard, WebhookRequest } from '../guards/bitnob-webhook-signature.guard';
import { BitnobWebhookService } from '../services/bitnob-webhook.service';

/**
 * `/api/bitnob/webhooks` — Bitnob-initiated callbacks. NOT guarded by
 * `JwtAuthGuard`/`RolesGuard` (Bitnob has no app JWT to present) but IS
 * guarded by `BitnobWebhookSignatureGuard` (`@UseGuards`, class-level): the
 * `x-bitnob-signature` HMAC-SHA512 is verified before any handler runs.
 *
 * `@UseGuards` here is a deliberate, documented deviation from the repo's
 * global-`APP_GUARD` pattern — this check is route-scoped and must run before
 * the handler and before `BitnobWebhookService` touches the database.
 *
 * Bitnob delivers EVERY event family (payouts, `transfer.*`, `deposit.*`,
 * cards) to the ONE global webhook URL configured in the dashboard, so the
 * catch-all `@Post()` dispatches by the `event` name. `@Post('cards')` is
 * kept for any dashboard config still pointed at the old sub-path; the payout
 * `callback_url` sent on `initialize` now points at the catch-all.
 */
@ApiTags('bitnob-webhooks')
@Controller('bitnob/webhooks')
@Public()
@UseGuards(BitnobWebhookSignatureGuard)
export class BitnobWebhooksController {
  constructor(private readonly webhookService: BitnobWebhookService) {}

  /** Catch-all: Bitnob delivers every event family here. Always 200 (Bitnob retries any non-2xx). */
  @Post()
  @HttpCode(200)
  async receive(@Req() req: WebhookRequest, @Body() payload: Record<string, unknown>) {
    return this.webhookService.handleWebhookRequest(payload, req.bitnobSignatureValid === true);
  }

  /**
   * Legacy alias — the catch-all `@Post()` above is the real path now (card
   * events also arrive there via the one global URL). Kept for any dashboard
   * config still pointed at `/bitnob/webhooks/cards`.
   */
  @Post('cards')
  @HttpCode(200)
  async cards(@Req() req: WebhookRequest, @Body() payload: Record<string, unknown>) {
    return this.webhookService.handleCardWebhook(payload, req.bitnobSignatureValid === true);
  }
}

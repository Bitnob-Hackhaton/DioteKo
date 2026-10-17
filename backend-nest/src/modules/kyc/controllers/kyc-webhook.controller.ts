import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import { Public } from '../../../common/decorators/public.decorator';
import { IdswyftWebhookSignatureGuard, KycWebhookRequest } from '../guards/idswyft-webhook-signature.guard';
import { KycWebhookService } from '../services/kyc-webhook.service';

/**
 * `/api/kyc/webhook/idswyft` — Idswyft-initiated callbacks. Not behind `JwtAuthGuard` (Idswyft has no app JWT)
 * but behind `IdswyftWebhookSignatureGuard` (HMAC-SHA256 on the raw body), the same deliberate, route-scoped
 * `@UseGuards` as `BitnobWebhooksController`. Answers 200 unless a retry is wanted (the service throws 503):
 * Idswyft retries only 5xx and network errors, and treats any 4xx as delivered.
 */
@ApiTags('kyc-webhooks')
@Controller('kyc/webhook')
@Public()
@UseGuards(IdswyftWebhookSignatureGuard)
export class KycWebhookController {
  constructor(private readonly webhookService: KycWebhookService) {}

  @Post('idswyft')
  @HttpCode(200)
  async receive(
    @Req() req: KycWebhookRequest,
    @Body() payload: Record<string, unknown>,
    @Headers('x-idswyft-webhook-id') webhookId: string | string[] | undefined,
  ) {
    // The unique `event_id` is the idempotency key, so it must never be NULL (a NULL is unique to itself):
    // without a delivery id header, derive one from the raw bytes.
    const headerId = typeof webhookId === 'string' && webhookId.length > 0 ? webhookId.slice(0, 100) : null;
    const deliveryId = headerId ?? (Buffer.isBuffer(req.rawBody) ? `body:${crypto.createHash('sha256').update(req.rawBody).digest('hex')}` : null);
    return this.webhookService.handle(deliveryId, payload, req.kycSignatureValid === true);
  }
}

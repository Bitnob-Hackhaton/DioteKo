import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../identity/entities/user.entity';
import { ConsentModule } from '../consent/consent.module';
import { KycController } from './controllers/kyc.controller';
import { KycReviewController } from './controllers/kyc-review.controller';
import { KycWebhookController } from './controllers/kyc-webhook.controller';
import { KycDocument } from './entities/kyc-document.entity';
import { KycRecordRef } from './entities/kyc-record-ref.entity';
import { KycVerification } from './entities/kyc-verification.entity';
import { KycWebhookEvent } from './entities/kyc-webhook-event.entity';
import { IdswyftWebhookSignatureGuard } from './guards/idswyft-webhook-signature.guard';
import { IdswyftEngineClientService } from './services/idswyft-engine-client.service';
import { IdswyftHttpClientService } from './services/idswyft-http-client.service';
import { KycDocumentVaultService } from './services/kyc-document-vault.service';
import { KycReviewService } from './services/kyc-review.service';
import { KycWebhookService } from './services/kyc-webhook.service';
import { KycService } from './services/kyc.service';

/**
 * Identity verification (KYC) through a self-hosted Idswyft. `KycService` is exported: the certificate flow asks
 * it whether a holder may file a request that needs a verified identity (`assertVerifiedFor`). `KycRecordRef`
 * is the older placeholder table of the domain shell and is left as is.
 */
@Module({
  imports: [TypeOrmModule.forFeature([KycRecordRef, KycVerification, KycWebhookEvent, KycDocument, User]), ConsentModule],
  controllers: [KycController, KycReviewController, KycWebhookController],
  providers: [
    IdswyftHttpClientService,
    IdswyftEngineClientService,
    KycDocumentVaultService,
    KycService,
    KycReviewService,
    KycWebhookService,
    IdswyftWebhookSignatureGuard,
  ],
  exports: [KycService],
})
export class KycDomainModule {}

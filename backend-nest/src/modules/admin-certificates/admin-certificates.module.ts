import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConsentModule } from '../consent/consent.module';
import { DidVcModule } from '../did-vc/did-vc.module';
import { Organization } from '../identity/entities/organization.entity';
import { User } from '../identity/entities/user.entity';
import { BitnobModule } from '../bitnob/bitnob.module';
import { KycDomainModule } from '../kyc/kyc-domain.module';
import { BitnobPayout } from '../bitnob/entities/bitnob-payout.entity';
import { Payment } from '../lightning/entities/payment.entity';
import { LightningModule } from '../lightning/lightning.module';
import { AdminCertificatesController } from './controllers/admin-certificates.controller';
import { AdminCertificateRef } from './entities/admin-certificate-ref.entity';
import { AdminCertificateRequest } from './entities/admin-certificate-request.entity';
import { AdminCertificatesService } from './services/admin-certificates.service';
import { CertificateAnchorService } from './services/certificate-anchor.service';
import { CertificatePdfService } from './services/certificate-pdf.service';
import { CertificateFileLinkService } from './services/certificate-file-link.service';

/**
 * The one domain module built to feel production-complete this round (see
 * the plan). Imports `LightningModule` (for `LightningInvoicesService`, the
 * payment step before issuance) and `DidVcModule` (for `DidService`,
 * `CredentialIssuanceService`, `CredentialVerificationService`).
 *
 * Registers its own two owned tables (`AdminCertificateRequest`,
 * `AdminCertificateRef`) via `TypeOrmModule.forFeature`, plus two read-side
 * repositories this module needs but doesn't own: `Organization` (to
 * resolve the issuing municipality/ministry by `type` — `IdentityModule`
 * only exports services, not a raw repository, and none of its services
 * expose an org-by-type lookup) and `Payment` (to bridge
 * `AdminCertificateRequest.paymentId` -> its linked `LightningInvoice.
 * paymentHash`, since `LightningInvoicesService` only exposes lookup by
 * paymentHash, not by payment id). Both are standard TypeORM cross-module
 * repository registrations against tables owned by other modules — nothing
 * here mutates those tables' schemas or bypasses the owning module's
 * services for writes.
 *
 * Also imports `ConsentModule` (plan build order step 8) for
 * `AccessLogService`, injected into `AdminCertificatesService` to write an
 * `access_logs` row on every `verifyCertificate` call — see that service's
 * constructor and the (now resolved) `TODO(audit/consent round)`.
 *
 * Also imports `BitnobModule` for `BitnobPayoutsService`, injected into
 * `AdminCertificatesService` for the certificate-scoped payout flow
 * (quote -> initialize, then a separate admin-only finalize / reconcile).
 * `BitnobPayout` is registered here too (`forFeature`) so the service owns
 * the transactional local writes — the row insert + `payments` ledger row +
 * the deterministic `reference` — rather than `BitnobPayoutsService` (which
 * is deliberately repository-free).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([AdminCertificateRequest, AdminCertificateRef, Organization, Payment, BitnobPayout, User]),
    LightningModule,
    DidVcModule,
    ConsentModule,
    BitnobModule,
    KycDomainModule,
  ],
  controllers: [AdminCertificatesController],
  providers: [AdminCertificatesService, CertificateAnchorService, CertificatePdfService, CertificateFileLinkService],
  exports: [AdminCertificatesService],
})
export class AdminCertificatesModule {}

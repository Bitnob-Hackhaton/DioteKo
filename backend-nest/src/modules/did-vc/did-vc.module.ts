import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CredentialsController } from './controllers/credentials.controller';
import { DidController } from './controllers/did.controller';
import { PresentationsController } from './controllers/presentations.controller';
import { Did } from './entities/did.entity';
import { VerifiableCredential } from './entities/verifiable-credential.entity';
import { VerifiablePresentation } from './entities/verifiable-presentation.entity';
import { CredentialIssuanceService } from './services/credential-issuance.service';
import { CredentialVerificationService } from './services/credential-verification.service';
import { DidService } from './services/did.service';
import { IssuancePolicyService } from './services/issuance-policy.service';
import { RevocationService } from './services/revocation.service';

/**
 * Generic DID/VC layer — no domain-specific business logic (no PDFs, no QR
 * codes, no payment linkage; that's `modules/admin-certificates`, a later
 * round). Exports its services so future domain modules can issue/verify
 * credentials and `modules/identity` can find-or-create holder DIDs at login
 * without this module ever importing `IdentityModule` back (see
 * `DidService`'s doc comment).
 */
@Module({
  imports: [TypeOrmModule.forFeature([Did, VerifiableCredential, VerifiablePresentation])],
  controllers: [DidController, CredentialsController, PresentationsController],
  providers: [
    DidService,
    CredentialIssuanceService,
    CredentialVerificationService,
    RevocationService,
    IssuancePolicyService,
  ],
  exports: [DidService, CredentialIssuanceService, CredentialVerificationService, IssuancePolicyService, RevocationService],
})
export class DidVcModule {}

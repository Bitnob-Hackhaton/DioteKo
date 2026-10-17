import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoleCode } from '../../identity/entities/role.entity';
import { CredentialVerificationService } from '../services/credential-verification.service';
import { RevocationService } from '../services/revocation.service';

/**
 * Internal/debug endpoints for `verifiable_credentials`
 * (`/api/did-vc/credentials`). `GET /:id` doubles as a live verify — it
 * runs the full `CredentialVerificationService.verify()` check rather than
 * a raw row fetch, since "is this credential still good" is the useful
 * debug question. `POST /:id/revoke` is issuer/admin only.
 */
@ApiTags('did-vc')
@ApiBearerAuth()
@Controller('did-vc/credentials')
export class CredentialsController {
  constructor(
    private readonly credentialVerificationService: CredentialVerificationService,
    private readonly revocationService: RevocationService,
  ) {}

  @Get(':id')
  async findById(@Param('id') id: string) {
    const result = await this.credentialVerificationService.verify(id);
    return { success: true, ...result };
  }

  @Post(':id/revoke')
  @Roles(RoleCode.ISSUER, RoleCode.ADMIN)
  async revoke(@Param('id') id: string) {
    // TODO: cross-tenant revoke authorization not yet enforced — any
    // issuer can revoke any org's credentials system-wide. Fixing this
    // needs `organizationId` on the JWT payload (currently just
    // `sub`/`roles`/`did` — see `JwtPayload`), threaded through
    // `AuthService.mintTokens` and `JwtStrategy.validate`, plus
    // `RevocationService.revoke` loading the credential's issuer DID's
    // `controllerOrganizationId` and comparing it against the caller's org
    // (admin bypasses, issuer does not). Deferred as out of scope for this
    // pass — see security review.
    const credential = await this.revocationService.revoke(id);
    return { success: true, credential };
  }
}

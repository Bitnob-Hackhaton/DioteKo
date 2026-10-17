import { Body, Controller, NotFoundException, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { DidService } from '../../../modules/did-vc/services/did.service';
import { CreateConsentDto } from '../dto/create-consent.dto';
import { ConsentService } from '../services/consent.service';

/**
 * `/api/audit/consents` — holder-initiated consent grants. Per the plan's
 * "consentements du holder" wording, the HOLDER grants consent (not the
 * issuer/verifier), so both routes are scoped to the authenticated caller's
 * own DID, resolved server-side via `DidService.findByController(currentUser.
 * sub)` — never accepted from the request body or a query param. This is the
 * concrete answer to the task's open authorization question: a client can
 * never grant or list consent on someone else's behalf here.
 *
 * `GET /` deliberately does NOT accept a `subjectDid` query param in this
 * pass, even though the plan's endpoint list shows one — see the task's own
 * "keep it simple, holder-only for this pass" guidance. Accepting-but-
 * ignoring a query param would be more confusing than not accepting it;
 * admin/verifier-facing querying-by-subject already exists on the audit
 * side (`AccessLogsController`) and can be extended to consents later if
 * needed.
 *
 * No `@Roles(...)` guard beyond `JwtAuthGuard` — same convention as
 * `AdminCertificatesController.createRequest` ("any authenticated holder"
 * enforced implicitly by requiring a linked DID, not by role metadata),
 * since only holders have a personal DID via `DidService.findByController`.
 */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit/consents')
export class ConsentController {
  constructor(
    private readonly consentService: ConsentService,
    private readonly didService: DidService,
  ) {}

  @Post()
  async create(@CurrentUser() currentUser: JwtPayload, @Body() dto: CreateConsentDto) {
    const holderDid = await this.resolveOwnDid(currentUser.sub);

    const consent = await this.consentService.grant({
      holderDidId: holderDid.id,
      verifierOrganizationId: dto.verifierOrganizationId,
      resourceType: dto.resourceType,
      scope: dto.scope,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    });

    return { success: true, consent };
  }

  @Get()
  async list(@CurrentUser() currentUser: JwtPayload) {
    const holderDid = await this.resolveOwnDid(currentUser.sub);
    const consents = await this.consentService.findForHolder(holderDid.id);
    return { success: true, consents };
  }

  private async resolveOwnDid(userId: string) {
    const did = await this.didService.findByController(userId);
    if (!did) {
      throw new NotFoundException('No DID linked to the current user — only a holder with a linked DID can manage consent');
    }
    return did;
  }
}

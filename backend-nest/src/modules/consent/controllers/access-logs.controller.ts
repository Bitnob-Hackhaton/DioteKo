import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RoleCode } from '../../../modules/identity/entities/role.entity';
import { DidService } from '../../../modules/did-vc/services/did.service';
import { AccessLogService } from '../services/access-log.service';

/**
 * `/api/audit/access-logs` — sensitive audit-trail reads. Admin/verifier
 * only (per the plan/task: "this is sensitive audit data, don't leave it
 * publicly readable"), unlike `consents.controller.ts`'s holder-scoped
 * endpoints. `subjectDid` is the external DID string (`did:dioteko:...`,
 * the same form as `Did.did`/`JwtPayload.did`), resolved here to the
 * internal uuid FK value via `DidService.findByDid` before being passed to
 * `AccessLogService.findForSubject` — the service layer never deals in raw
 * DID strings. Omitting `subjectDid` lists the full audit trail (optionally
 * narrowed by `resourceType` alone), which is intentional: an admin
 * auditing "everything that happened to `verifiable_credential`s today" is
 * as legitimate a query as "everything about this one holder".
 */
@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit/access-logs')
@Roles(RoleCode.ADMIN, RoleCode.VERIFIER)
export class AccessLogsController {
  constructor(
    private readonly accessLogService: AccessLogService,
    private readonly didService: DidService,
  ) {}

  @Get()
  async list(@Query('subjectDid') subjectDid?: string, @Query('resourceType') resourceType?: string) {
    let subjectDidId: string | undefined;

    if (subjectDid) {
      const did = await this.didService.findByDid(subjectDid);
      if (!did) {
        throw new NotFoundException('No DID found matching subjectDid');
      }
      subjectDidId = did.id;
    }

    const accessLogs = await this.accessLogService.findForSubject(subjectDidId, { resourceType });
    return { success: true, accessLogs };
  }
}

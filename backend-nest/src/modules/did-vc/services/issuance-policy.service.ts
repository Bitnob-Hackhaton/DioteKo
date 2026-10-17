import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Organization, OrganizationType } from '../../identity/entities/organization.entity';

/**
 * Static map of which VC `type` strings each `OrganizationType` is allowed
 * to issue (e.g. "a hospital can't issue diplomas" — see the plan's Auth
 * design section). Only `municipality`/`ministry` -> `AdminCertificate` is
 * wired up in this round, since `modules/admin-certificates` is the only
 * domain built so far. Every other org type intentionally maps to an empty
 * array so a future domain module (health, kyc, education, transport,
 * employment, social-aid, merchant) just appends its own VC type string to
 * the matching org type's array, instead of inventing a new mechanism.
 */
const ALLOWED_VC_TYPES_BY_ORG_TYPE: Record<OrganizationType, string[]> = {
  [OrganizationType.MUNICIPALITY]: ['AdminCertificate'],
  [OrganizationType.MINISTRY]: ['AdminCertificate'],
  [OrganizationType.HOSPITAL]: [],
  [OrganizationType.BANK]: [],
  [OrganizationType.UNIVERSITY]: [],
  [OrganizationType.NGO]: [],
  [OrganizationType.MERCHANT]: [],
};

/**
 * Called explicitly by each domain service before issuance (not a generic
 * route guard, since the allowed VC type depends on the request, not just
 * the route) — see `CredentialIssuanceService` callers.
 */
@Injectable()
export class IssuancePolicyService {
  private readonly logger = new Logger(IssuancePolicyService.name);

  assertCanIssue(organization: Organization, vcType: string): void {
    const allowedTypes = ALLOWED_VC_TYPES_BY_ORG_TYPE[organization.type] ?? [];

    if (!allowedTypes.includes(vcType)) {
      this.logger.warn(
        `[RESULT] issuance denied organizationId=${organization.id} organizationType=${organization.type} vcType=${vcType}`,
      );
      throw new ForbiddenException(
        `Organizations of type "${organization.type}" are not allowed to issue "${vcType}" credentials`,
      );
    }

    this.logger.log(
      `[RESULT] issuance allowed organizationId=${organization.id} organizationType=${organization.type} vcType=${vcType}`,
    );
  }
}

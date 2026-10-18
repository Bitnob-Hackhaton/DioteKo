import { ROLES_KEY } from '../../../common/decorators/roles.decorator';
import { RoleCode } from '../../identity/entities/role.entity';
import { KycReviewController } from './kyc-review.controller';

/**
 * Role scoping of the agent review routes. The detail route now carries what the automatic check read on the document
 * (name, birth date, document number): it must stay staff-only, apart from the holder's `/kyc/*` routes.
 */
describe('KycReviewController role scoping', () => {
  const proto = KycReviewController.prototype as unknown as Record<string, unknown>;

  it.each(['list', 'get', 'document', 'decide'])('%s is reserved to issuers and admins', (handler) => {
    const roles = Reflect.getMetadata(ROLES_KEY, proto[handler] as object) as string[];
    expect(roles).toEqual([RoleCode.ISSUER, RoleCode.ADMIN]);
    expect(roles).not.toContain(RoleCode.HOLDER);
  });

  it('is mounted apart from the holder routes', () => {
    expect(Reflect.getMetadata('path', KycReviewController)).toBe('kyc/review');
  });
});

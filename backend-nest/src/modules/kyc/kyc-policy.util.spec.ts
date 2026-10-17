import { ADMIN_CERTIFICATE_TYPES, getCertificateTypeDefinition } from '../admin-certificates/admin-certificates.constants';
import { isKycEnforced } from './kyc-policy.util';

describe('isKycEnforced', () => {
  const residence = { id: 'residence', kyc: 'required' as const };
  const birth = { id: 'birth', kyc: 'planned' as const };

  it.each([
    // [type, enforcement, enforcedTypes, expected]
    [residence, true, [], true],
    [residence, true, ['birth'], true],
    [residence, false, [], false],
    [birth, true, [], false],
    [birth, true, ['birth'], true],
    [birth, true, ['marriage', 'death'], false],
    [birth, false, ['birth'], false],
  ])('%j enforcement=%p enforcedTypes=%j -> %p', (type, enforcement, enforcedTypes, expected) => {
    expect(isKycEnforced(type, { enforcement, enforcedTypes })).toBe(expected);
  });

  describe('catalog', () => {
    it('blocks residence and identity by default, leaves birth, marriage and death non-blocking', () => {
      const settings = { enforcement: true, enforcedTypes: [] };
      const blocked = ADMIN_CERTIFICATE_TYPES.filter((type) => isKycEnforced(type, settings)).map((type) => type.id);
      expect(blocked.sort()).toEqual(['identity', 'residence']);
    });

    it('blocks the planned types once KYC_ENFORCED_TYPES lists them', () => {
      const settings = { enforcement: true, enforcedTypes: ['birth', 'marriage', 'death'] };
      expect(ADMIN_CERTIFICATE_TYPES.every((type) => isKycEnforced(type, settings))).toBe(true);
    });

    it('keeps every type open when enforcement is off', () => {
      const settings = { enforcement: false, enforcedTypes: ['birth', 'marriage', 'death'] };
      expect(ADMIN_CERTIFICATE_TYPES.some((type) => isKycEnforced(type, settings))).toBe(false);
    });

    it('declares a kyc policy on every type', () => {
      expect(getCertificateTypeDefinition('birth')?.kyc).toBe('planned');
      expect(getCertificateTypeDefinition('residence')?.kyc).toBe('required');
    });
  });
});

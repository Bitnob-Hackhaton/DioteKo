/**
 * Whether a certificate type requires a `verified` KYC record from the holder.
 *
 * - `required`: always (residence, identity).
 * - `planned`: the target is "mandatory" but not blocking yet (birth, marriage, death). It becomes blocking by
 *   listing the type in `KYC_ENFORCED_TYPES`, and permanently by changing its `kyc` value to `required` in the
 *   catalog — nothing else changes.
 * - `enforcement` false (`KYC_ENFORCEMENT=off`, dev only) lifts the check for every type.
 */
export type KycPolicy = 'required' | 'planned';

export interface KycEnforcementSettings {
  enforcement: boolean;
  enforcedTypes: readonly string[];
}

export function isKycEnforced(type: { id: string; kyc: KycPolicy }, settings: KycEnforcementSettings): boolean {
  if (!settings.enforcement) return false;
  if (type.kyc === 'required') return true;
  return settings.enforcedTypes.includes(type.id);
}

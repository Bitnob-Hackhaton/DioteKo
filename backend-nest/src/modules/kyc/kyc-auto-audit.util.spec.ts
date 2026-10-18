import { describeAutoAudit, parseAutoAudit } from './kyc-auto-audit.util';

const NOW = new Date('2026-10-18T10:00:00Z');

describe('parseAutoAudit', () => {
  // The case observed on 2026-10-18: another person's document accepted in sandbox mode, face 0.905 for a 0.55 threshold.
  const body = {
    verification_id: 'v-1',
    status: 'COMPLETE',
    final_result: 'verified',
    is_sandbox: true,
    ocr_data: { full_name: 'Awa Diallo', date_of_birth: '1994-03-02', id_number: 'SN1234567', expiry_date: '2031-01-01' },
    face_match_results: { similarity: 0.905, threshold: 0.55, passed: true, embedding: [0.1, 0.2] },
    liveness_results: { liveness_score: 0.91, passed: true },
    cross_validation_results: {
      verdict: 'PASS',
      overall_score: 0.88,
      validation_results: [
        { field: 'date_of_birth', passed: true, score: 1, front_value: '1994-03-02', back_value: '1994-03-02' },
        { field: 'id_number', passed: true, score: 0.95, front_value: 'SN1234567', back_value: 'SN1234567' },
        { field: 'expiry_date', passed: false, score: 0.4 },
      ],
    },
    document_expired: false,
  };

  it('keeps the verdict, the scores with their threshold, the per-field pass/fail and the sandbox flag', () => {
    expect(parseAutoAudit(body, NOW)).toEqual({
      version: 1,
      readAt: NOW.toISOString(),
      providerVerdict: 'verified',
      isSandbox: true,
      faceMatch: { score: 0.905, threshold: 0.55, passed: true },
      liveness: { score: 0.91, threshold: null, passed: true },
      crossValidation: {
        verdict: 'PASS',
        passed: null,
        score: 0.88,
        checks: [
          { name: 'date_of_birth', passed: true, score: 1 },
          { name: 'id_number', passed: true, score: 0.95 },
          { name: 'expiry_date', passed: false, score: 0.4 },
        ],
      },
      documentExpired: false,
    });
  });

  it('contains no personal data: not one value read on the document, not the name, not a raw provider key', () => {
    const serialized = JSON.stringify(parseAutoAudit(body, NOW));
    for (const personal of ['Awa', 'Diallo', '1994', 'SN1234567', '2031', 'embedding', 'front_value', 'ocr']) {
      expect(serialized).not.toContain(personal);
    }
  });

  it('accepts the checks as a map and refuses a check name that could be a value (spaces, capitals)', () => {
    const audit = parseAutoAudit(
      { cross_validation_results: { fields: { date_of_birth: true, name: { passed: true, score: 80 }, 'Awa Diallo': true, DIALLO: { passed: true }, id_number: 'SN1234567' } } },
      NOW,
    )!;
    expect(audit.crossValidation?.checks).toEqual([
      { name: 'date_of_birth', passed: true, score: null },
      { name: 'name', passed: true, score: 0.8 },
    ]);
  });

  it('leaves unknown things as null instead of inventing them (shapes are not pinned)', () => {
    const audit = parseAutoAudit({ final_result: 'verified' }, NOW)!;
    expect(audit).toMatchObject({ providerVerdict: 'verified', isSandbox: null, faceMatch: null, liveness: null, crossValidation: null, documentExpired: null });
  });

  it('drops a provider verdict that is not a short code, and a non-boolean sandbox flag', () => {
    const audit = parseAutoAudit({ final_result: 'verified for Awa Diallo', is_sandbox: 'maybe', cross_validation_results: { verdict: 'x'.repeat(80), passed: false } }, NOW)!;
    expect(audit.providerVerdict).toBeNull();
    expect(audit.isSandbox).toBeNull();
    expect(audit.crossValidation).toEqual({ verdict: null, passed: false, score: null, checks: [] });
  });

  it('bounds the number of checks', () => {
    const many = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`field_${index}`, true]));
    expect(parseAutoAudit({ cross_validation_results: { checks: many } }, NOW)?.crossValidation?.checks).toHaveLength(20);
  });

  it('returns null for a body that is not an object', () => {
    expect(parseAutoAudit(null, NOW)).toBeNull();
    expect(parseAutoAudit(undefined, NOW)).toBeNull();
  });
});

describe('describeAutoAudit', () => {
  it('says flags and counts only', () => {
    const audit = parseAutoAudit({ final_result: 'verified', is_sandbox: true, face_match_results: { similarity: 0.9 } }, NOW)!;
    expect(describeAutoAudit(audit)).toBe('sandbox=true face=true liveness=false crossChecks=0');
  });
});

import { assessmentDigest, assessmentHasData, assessmentHasReadings, describeAssessment, normalizeUnit, parseAssessment } from './kyc-assessment.util';

const NOW = new Date('2026-10-18T09:00:00Z');

describe('parseAssessment', () => {
  it('keeps the stable rejection code of a real hard rejection, with no OCR and no score', () => {
    // Real answer of the dev stack (2026-10-17), trimmed to the keys the parser looks at.
    const assessment = parseAssessment(
      {
        verification_id: 'v-1',
        status: 'HARD_REJECTED',
        ocr_data: null,
        rejection_reason: 'FRONT_OCR_FAILED',
        rejection_detail: 'No required OCR fields could be read from the document',
        final_result: 'failed',
        retry_available: true,
      },
      NOW,
    );

    expect(assessment).toMatchObject({
      version: 1,
      readAt: NOW.toISOString(),
      providerStep: 'HARD_REJECTED',
      finalResult: 'failed',
      rejectionCode: 'FRONT_OCR_FAILED',
      rejectionDetail: 'No required OCR fields could be read from the document',
      ocr: null,
      crossValidation: null,
      faceMatch: null,
      liveness: null,
      riskScore: null,
    });
    expect(assessmentHasReadings(assessment!)).toBe(false);
    expect(assessmentHasData(assessment!)).toBe(true);
  });

  it('reads the OCR fields with their confidence (overall and per field) and the scores', () => {
    const assessment = parseAssessment(
      {
        status: 'COMPLETE',
        final_result: 'manual_review',
        ocr_data: {
          full_name: 'Awa Diallo',
          date_of_birth: '1994-03-02',
          id_number: 'SN1234567',
          expiry_date: '2031-01-01',
          nationality: 'SEN',
          confidence: 0.82,
          confidence_scores: { full_name: 0.91, id_number: 55 },
          raw_text: 'must never be kept',
          unknown_key: 'must never be kept',
        },
        cross_validation_results: { score: 0.7, passed: false, verdict: 'REVIEW', debug: 'dropped' },
        face_match_results: { similarity: 87, is_match: true },
        liveness_results: { liveness_score: 0.95, passed: true },
        risk_score: 0.31,
      },
      NOW,
    )!;

    expect(assessment.ocr?.confidence).toBe(0.82);
    expect(assessment.ocr?.fields).toEqual([
      { key: 'full_name', value: 'Awa Diallo', confidence: 0.91 },
      { key: 'date_of_birth', value: '1994-03-02', confidence: null },
      { key: 'id_number', value: 'SN1234567', confidence: 0.55 },
      { key: 'expiry_date', value: '2031-01-01', confidence: null },
      { key: 'nationality', value: 'SEN', confidence: null },
    ]);
    expect(assessment.crossValidation).toEqual({ score: 0.7, passed: false, verdict: 'REVIEW' });
    expect(assessment.faceMatch).toEqual({ score: 0.87, passed: true, verdict: null });
    expect(assessment.liveness).toEqual({ score: 0.95, passed: true, verdict: null });
    expect(assessment.riskScore).toBe(0.31);
    const serialized = JSON.stringify(assessment);
    expect(serialized).not.toContain('must never be kept');
    expect(serialized).not.toContain('dropped');
  });

  it('accepts a field given as { value, confidence } and aliases of the provider keys', () => {
    const assessment = parseAssessment({ ocr_data: { name: { value: 'Awa Diallo', confidence: 0.4 }, document_number: 'X1', dob: '1990-01-01' } }, NOW)!;
    expect(assessment.ocr?.fields).toEqual([
      { key: 'full_name', value: 'Awa Diallo', confidence: 0.4 },
      { key: 'date_of_birth', value: '1990-01-01', confidence: null },
      { key: 'id_number', value: 'X1', confidence: null },
    ]);
  });

  it('returns null when the answer carries nothing (so an empty read never overwrites a richer one)', () => {
    expect(parseAssessment({ status: 'AWAITING_BACK', ocr_data: null, final_result: null }, NOW)).toBeNull();
    expect(parseAssessment({ ocr_data: {}, cross_validation_results: {} }, NOW)).toBeNull();
    expect(parseAssessment(null, NOW)).toBeNull();
  });

  it('bounds and cleans what it keeps', () => {
    const assessment = parseAssessment({ rejection_reason: 'has spaces and <html>', rejection_detail: 'x'.repeat(1000), ocr_data: { full_name: `${'a'.repeat(500)}\u0000\n` } }, NOW)!;
    expect(assessment.rejectionCode).toBeNull();
    expect(assessment.rejectionDetail).toHaveLength(300);
    expect(assessment.ocr?.fields[0]?.value).toHaveLength(200);
  });

  it('normalizes scores to 0..1 and refuses nonsense', () => {
    expect(normalizeUnit(0.5)).toBe(0.5);
    expect(normalizeUnit(50)).toBe(0.5);
    expect(normalizeUnit(-1)).toBeNull();
    expect(normalizeUnit(1000)).toBeNull();
    expect(normalizeUnit('0.5')).toBeNull();
    expect(normalizeUnit(Number.NaN)).toBeNull();
  });
});

describe('assessment logging helpers', () => {
  const assessment = parseAssessment({ ocr_data: { full_name: 'Awa Diallo', id_number: 'SN1234567' }, rejection_reason: 'BACK_MRZ_FAILED' }, NOW)!;

  it('describes an assessment with counts and a code only, never a value', () => {
    const line = describeAssessment(assessment);
    expect(line).toBe('ocrFields=2 scores=0 risk=false rejectionCode=BACK_MRZ_FAILED');
    expect(line).not.toContain('Awa');
    expect(line).not.toContain('SN1234567');
  });

  it('fingerprints the content without the read date', () => {
    const later = { ...assessment, readAt: '2027-01-01T00:00:00.000Z' };
    expect(assessmentDigest(later)).toBe(assessmentDigest(assessment));
    expect(assessmentDigest({ ...assessment, riskScore: 0.9 })).not.toBe(assessmentDigest(assessment));
  });
});

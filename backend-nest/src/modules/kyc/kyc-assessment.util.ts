/**
 * Automatic-check assessment: what Idswyft read on the document and how it scored, kept (encrypted, see
 * `KycDocumentVaultService.storeAssessment`) so the agent who takes over a dossier does not decide blind.
 *
 * Personal data: `ocr.fields[].value` is a name, a birth date, a document number. This object therefore never goes
 * anywhere but the vault and the agent review route; it is never logged, never put in a holder-facing view, and
 * `describeAssessment` is the only thing a log line may print about it (counts and booleans).
 *
 * The provider's `cross_validation_results`, `face_match_results` and `liveness_results` shapes are not pinned by a
 * recorded sample, so the parsing below is deliberately lenient (several key aliases) and strict on what it keeps:
 * a fixed set of OCR keys, bounded strings, numbers and booleans. Anything else is dropped.
 */

export const KYC_ASSESSMENT_VERSION = 1;

/** OCR keys kept, in display order. */
export const KYC_OCR_FIELD_KEYS = [
  'full_name',
  'date_of_birth',
  'id_number',
  'expiry_date',
  'nationality',
  'sex',
  'place_of_birth',
  'issue_date',
  'issuing_country',
] as const;
export type KycOcrFieldKey = (typeof KYC_OCR_FIELD_KEYS)[number];

export interface KycAssessmentOcrField {
  key: KycOcrFieldKey;
  value: string;
  /** 0..1, or `null` when the provider gave no confidence for this field. */
  confidence: number | null;
}

export interface KycAssessmentScore {
  /** 0..1, or `null` when the provider gave none. */
  score: number | null;
  passed: boolean | null;
  /** Short provider verdict code (e.g. `PASS`), `null` when absent. */
  verdict: string | null;
}

export interface KycAssessment {
  version: number;
  /** When we read it (ISO 8601). */
  readAt: string;
  /** Provider session step at that moment (`HARD_REJECTED`, `COMPLETE`, `AWAITING_BACK`...). */
  providerStep: string | null;
  /** `verified` | `failed` | `manual_review`, `null` while in progress. */
  finalResult: string | null;
  /** Stable provider code (e.g. `FRONT_OCR_FAILED`); `null` when none. */
  rejectionCode: string | null;
  /** Provider sentence behind the code; staff only. */
  rejectionDetail: string | null;
  ocr: { fields: KycAssessmentOcrField[]; confidence: number | null } | null;
  crossValidation: KycAssessmentScore | null;
  faceMatch: KycAssessmentScore | null;
  liveness: KycAssessmentScore | null;
  /** Provider risk score as given (scale not pinned: shown as is). */
  riskScore: number | null;
}

const OCR_ALIASES: Record<KycOcrFieldKey, readonly string[]> = {
  full_name: ['full_name', 'fullName', 'name'],
  date_of_birth: ['date_of_birth', 'dateOfBirth', 'dob', 'birth_date'],
  id_number: ['id_number', 'idNumber', 'document_number', 'documentNumber', 'national_id_number', 'personal_number'],
  expiry_date: ['expiry_date', 'expiryDate', 'expiration_date', 'date_of_expiry'],
  nationality: ['nationality'],
  sex: ['sex', 'gender'],
  place_of_birth: ['place_of_birth', 'placeOfBirth'],
  issue_date: ['issue_date', 'issueDate', 'date_of_issue'],
  issuing_country: ['issuing_country', 'issuingCountry', 'country_code', 'country'],
};

const OVERALL_CONFIDENCE_KEYS = ['confidence', 'overall_confidence', 'ocr_confidence', 'average_confidence'];
const FIELD_CONFIDENCE_MAPS = ['confidence_scores', 'field_confidences', 'field_confidence', 'confidences'];
const SCORE_KEYS = ['score', 'overall_score', 'similarity', 'similarity_score', 'match_score', 'liveness_score', 'confidence'];
const PASSED_KEYS = ['passed', 'is_match', 'match', 'is_live', 'live', 'is_valid', 'valid', 'success'];
const VERDICT_KEYS = ['verdict', 'result', 'status'];

const MAX_VALUE_LENGTH = 200;
const MAX_DETAIL_LENGTH = 300;
const CODE_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** A bounded printable string, else `null`. Control characters are dropped. */
function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text.slice(0, max) : null;
}

/** 0..1 from either a unit score or a percentage; anything else (negative, huge, NaN) is `null`. */
export function normalizeUnit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return value;
  if (value <= 100) return value / 100;
  return null;
}

const firstOf = (source: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
};

function parseOcr(raw: unknown): KycAssessment['ocr'] {
  if (!isRecord(raw)) return null;
  const overall = normalizeUnit(firstOf(raw, OVERALL_CONFIDENCE_KEYS));
  const perField = FIELD_CONFIDENCE_MAPS.map((key) => raw[key]).find(isRecord) ?? {};

  const fields: KycAssessmentOcrField[] = [];
  for (const key of KYC_OCR_FIELD_KEYS) {
    const candidate = firstOf(raw, OCR_ALIASES[key]);
    // `{ value, confidence }` is accepted next to a bare string.
    const value = cleanText(isRecord(candidate) ? candidate.value : candidate, MAX_VALUE_LENGTH);
    if (value === null) continue;
    const own = isRecord(candidate) ? normalizeUnit(candidate.confidence) : null;
    const mapped = normalizeUnit(firstOf(perField, OCR_ALIASES[key]));
    fields.push({ key, value, confidence: own ?? mapped });
  }
  if (fields.length === 0 && overall === null) return null;
  return { fields, confidence: overall };
}

function parseScore(raw: unknown): KycAssessmentScore | null {
  if (!isRecord(raw)) return null;
  const passedRaw = firstOf(raw, PASSED_KEYS);
  const verdictRaw = cleanText(firstOf(raw, VERDICT_KEYS), 32);
  const result: KycAssessmentScore = {
    score: normalizeUnit(firstOf(raw, SCORE_KEYS)),
    passed: typeof passedRaw === 'boolean' ? passedRaw : null,
    verdict: verdictRaw !== null && CODE_RE.test(verdictRaw) ? verdictRaw : null,
  };
  return result.score === null && result.passed === null && result.verdict === null ? null : result;
}

function parseRisk(raw: unknown): number | null {
  const value = isRecord(raw) ? firstOf(raw, ['score', 'risk_score', 'value']) : raw;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Whether the provider actually read or scored something (a rejection code alone is not a reading). */
export function assessmentHasReadings(assessment: KycAssessment): boolean {
  return (
    (assessment.ocr?.fields.length ?? 0) > 0 ||
    assessment.ocr?.confidence != null ||
    assessment.crossValidation !== null ||
    assessment.faceMatch !== null ||
    assessment.liveness !== null ||
    assessment.riskScore !== null
  );
}

/** Worth keeping: readings, or at least the reason the provider gave. */
export function assessmentHasData(assessment: KycAssessment): boolean {
  return assessmentHasReadings(assessment) || assessment.rejectionCode !== null || assessment.rejectionDetail !== null;
}

/**
 * Builds the assessment from the raw `GET /api/v2/verify/:id/status` body. Returns `null` when the body carries nothing
 * of it at all (so an in-progress read with no data does not overwrite an earlier, richer assessment).
 */
export function parseAssessment(body: Record<string, unknown> | null | undefined, readAt: Date): KycAssessment | null {
  if (!isRecord(body)) return null;
  const code = cleanText(body.rejection_reason, 64);
  const assessment: KycAssessment = {
    version: KYC_ASSESSMENT_VERSION,
    readAt: readAt.toISOString(),
    providerStep: cleanText(body.status, 40),
    finalResult: cleanText(body.final_result, 40),
    rejectionCode: code !== null && CODE_RE.test(code) ? code : null,
    rejectionDetail: cleanText(body.rejection_detail, MAX_DETAIL_LENGTH),
    ocr: parseOcr(body.ocr_data),
    crossValidation: parseScore(body.cross_validation_results),
    faceMatch: parseScore(body.face_match_results),
    liveness: parseScore(body.liveness_results),
    riskScore: parseRisk(body.risk_score),
  };
  return assessmentHasData(assessment) ? assessment : null;
}

/** Stable fingerprint without the read date, to skip rewriting an identical assessment on every poll. */
export function assessmentDigest(assessment: KycAssessment): string {
  const { readAt: _readAt, ...rest } = assessment;
  return JSON.stringify(rest);
}

/** The only thing a log line may say about an assessment: counts and flags, never a value. */
export function describeAssessment(assessment: KycAssessment): string {
  return `ocrFields=${assessment.ocr?.fields.length ?? 0} scores=${[assessment.crossValidation, assessment.faceMatch, assessment.liveness].filter(Boolean).length} risk=${assessment.riskScore !== null} rejectionCode=${assessment.rejectionCode ?? 'none'}`;
}

export type KycAssessmentState = 'available' | 'no_data' | 'unavailable' | 'not_run';

/** What the agent route returns. `assessment` is present for `available` and `no_data`. */
export interface KycAssessmentView {
  state: KycAssessmentState;
  assessment: KycAssessment | null;
}

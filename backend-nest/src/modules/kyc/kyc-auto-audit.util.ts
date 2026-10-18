import { normalizeUnit } from './kyc-assessment.util';

/**
 * Audit record of a dossier the provider verified BY ITSELF (no agent involved). Kept so an agent can look back at how
 * the automatic check decided, without keeping anything about the person: no photo, no OCR text, no name, no number, no
 * date of birth. Only scores, thresholds, pass/fail flags, short provider codes and the names of the checks (never a
 * value). Built straight from the raw `GET /api/v2/verify/:id/status` body, not from the OCR assessment, so a personal
 * value cannot slip in: every kept string is a bounded identifier matching a strict pattern.
 *
 * The shapes of `cross_validation_results`, `face_match_results` and `liveness_results` are not pinned by a recorded
 * sample (docs/KYC.md §12), so the reading is tolerant (several key names) and an absent value stays `null`.
 */

export const KYC_AUTO_AUDIT_VERSION = 1;

export interface KycAutoAuditScore {
  /** 0..1, `null` when the provider gave none. */
  score: number | null;
  /** Minimum the provider required to pass (0..1), `null` when it did not say. */
  threshold: number | null;
  passed: boolean | null;
}

export interface KycAutoAuditCheck {
  /** Name of the compared field (e.g. `date_of_birth`), never its value. */
  name: string;
  passed: boolean | null;
  score: number | null;
}

export interface KycAutoAudit {
  version: number;
  /** When we read it (ISO 8601). */
  readAt: string;
  /** `final_result` of the provider (`verified`). */
  providerVerdict: string | null;
  /** The provider ran in sandbox mode: its verdict is not reliable for production. `null` when it did not say. */
  isSandbox: boolean | null;
  /** Face match between the selfie and the document: `score` is the similarity. */
  faceMatch: KycAutoAuditScore | null;
  liveness: KycAutoAuditScore | null;
  crossValidation: { verdict: string | null; passed: boolean | null; score: number | null; checks: KycAutoAuditCheck[] } | null;
  /** The provider flagged the document as expired. `null` when it did not say. */
  documentExpired: boolean | null;
}

/** What the agent route returns: `unavailable` = nothing kept (older dossier, no key, expired, key rotated). */
export type KycAutoAuditState = 'available' | 'unavailable';
export interface KycAutoAuditView {
  state: KycAutoAuditState;
  audit: KycAutoAudit | null;
}

const SCORE_KEYS = ['similarity', 'similarity_score', 'score', 'overall_score', 'match_score', 'liveness_score', 'confidence'];
const THRESHOLD_KEYS = ['threshold', 'similarity_threshold', 'match_threshold', 'min_similarity', 'required_similarity', 'min_score', 'liveness_threshold'];
const PASSED_KEYS = ['passed', 'is_match', 'match', 'is_live', 'live', 'is_valid', 'valid', 'success'];
const VERDICT_KEYS = ['verdict', 'result', 'status'];
const CHECK_CONTAINER_KEYS = ['checks', 'field_results', 'fields', 'validation_results', 'results', 'details', 'comparisons', 'field_checks'];
const CHECK_NAME_KEYS = ['field', 'name', 'check', 'key', 'type'];
const EXPIRED_KEYS = ['document_expired', 'is_expired', 'expired', 'is_document_expired'];

const MAX_CHECKS = 20;
/** A provider code (`PASS`, `REVIEW`). */
const CODE_RE = /^[A-Za-z0-9_.:-]{1,32}$/;
/** A check name: a lowercase identifier. Spaces, capitals and anything a person's name looks like are refused. */
const CHECK_NAME_RE = /^[a-z][a-z0-9_.-]{0,39}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const firstOf = (source: Record<string, unknown>, keys: readonly string[]): unknown => {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
};

const boolOrNull = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : null);

function codeOrNull(value: unknown): string | null {
  return typeof value === 'string' && CODE_RE.test(value.trim()) ? value.trim() : null;
}

function parseScore(raw: unknown): KycAutoAuditScore | null {
  if (!isRecord(raw)) return null;
  const result: KycAutoAuditScore = {
    score: normalizeUnit(firstOf(raw, SCORE_KEYS)),
    threshold: normalizeUnit(firstOf(raw, THRESHOLD_KEYS)),
    passed: boolOrNull(firstOf(raw, PASSED_KEYS)),
  };
  return result.score === null && result.threshold === null && result.passed === null ? null : result;
}

function parseCheck(name: unknown, raw: unknown): KycAutoAuditCheck | null {
  if (typeof name !== 'string' || !CHECK_NAME_RE.test(name)) return null;
  // A bare boolean / number is the pass flag / score; a record carries both. Anything else (a text value) is dropped.
  const passed = isRecord(raw) ? boolOrNull(firstOf(raw, PASSED_KEYS)) : boolOrNull(raw);
  const score = isRecord(raw) ? normalizeUnit(firstOf(raw, SCORE_KEYS)) : normalizeUnit(raw);
  return passed === null && score === null ? null : { name, passed, score };
}

function parseChecks(raw: Record<string, unknown>): KycAutoAuditCheck[] {
  const checks: KycAutoAuditCheck[] = [];
  const container = CHECK_CONTAINER_KEYS.map((key) => raw[key]).find((value) => Array.isArray(value) || isRecord(value));
  if (Array.isArray(container)) {
    for (const entry of container) {
      if (!isRecord(entry)) continue;
      const parsed = parseCheck(firstOf(entry, CHECK_NAME_KEYS), entry);
      if (parsed) checks.push(parsed);
    }
  } else if (isRecord(container)) {
    for (const [name, value] of Object.entries(container)) {
      const parsed = parseCheck(name, value);
      if (parsed) checks.push(parsed);
    }
  }
  return checks.slice(0, MAX_CHECKS);
}

function parseCrossValidation(raw: unknown): KycAutoAudit['crossValidation'] {
  if (!isRecord(raw)) return null;
  const result = {
    verdict: codeOrNull(firstOf(raw, VERDICT_KEYS)),
    passed: boolOrNull(firstOf(raw, PASSED_KEYS)),
    score: normalizeUnit(firstOf(raw, SCORE_KEYS)),
    checks: parseChecks(raw),
  };
  return result.verdict === null && result.passed === null && result.score === null && result.checks.length === 0 ? null : result;
}

/** Reduced audit from the raw status body; `null` only when the body is not an object. */
export function parseAutoAudit(body: Record<string, unknown> | null | undefined, readAt: Date): KycAutoAudit | null {
  if (!isRecord(body)) return null;
  return {
    version: KYC_AUTO_AUDIT_VERSION,
    readAt: readAt.toISOString(),
    providerVerdict: codeOrNull(body.final_result),
    isSandbox: boolOrNull(body.is_sandbox),
    faceMatch: parseScore(body.face_match_results),
    liveness: parseScore(body.liveness_results),
    crossValidation: parseCrossValidation(body.cross_validation_results),
    documentExpired: boolOrNull(firstOf(body, EXPIRED_KEYS)),
  };
}

/** The only thing a log line may say about an audit: flags and counts. */
export function describeAutoAudit(audit: KycAutoAudit): string {
  return `sandbox=${audit.isSandbox ?? 'unknown'} face=${audit.faceMatch !== null} liveness=${audit.liveness !== null} crossChecks=${audit.crossValidation?.checks.length ?? 0}`;
}

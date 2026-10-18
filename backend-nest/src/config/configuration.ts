import { parseCorsOrigins } from './cors-origins';
/**
 * Typed configuration factory consumed by ConfigModule.forRoot({ load: [configuration] }).
 * Every value here has a matching raw env var documented in `.env.example`.
 *
 * Grouped by feature area so downstream modules can do
 * `configService.get('bitnob.clientId')` etc. instead of poking at
 * `process.env` directly.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  /** Browser origins allowed by CORS (see `cors-origins.ts`); empty = none. */
  corsOrigins: string[];
  app: {
    baseUrl: string;
  };
  database: {
    host: string;
    port: number;
    username: string;
    password: string;
    name: string;
    url?: string;
  };
  jwt: {
    secret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  vc: {
    issuer: string;
    signingSecret: string;
    validityDays: number;
  };
  bitnob: {
    clientId: string;
    clientSecret: string;
    baseUrl: string;
    environment: string;
    webhookSecret: string;
    /** Background invoice reconciler period in ms; 0 disables it. */
    invoiceReconcileIntervalMs: number;
    payoutBeneficiary: {
      accountNumber: string;
      accountName: string;
      bankCode: string;
      country: string;
    };
  };
  payments: {
    /**
     * Dev only: exposes a route that marks a request's invoice paid without any real payment. Never true in
     * production (`env.validation.ts` refuses to boot).
     */
    simulation: boolean;
  };
  certificates: {
    /** Automatic issuance of the types that need no review. Off by default when live (`NODE_ENV` or `BITNOB_ENVIRONMENT` = production), see `resolveAutoIssue`. */
    autoIssue: boolean;
  };
  appwrite: {
    endpoint: string;
    projectId: string;
    apiKey: string;
    requireGoogleIdentity: boolean;
  };
  kyc: {
    /** Idswyft API origin. In the dev stack the container uses `http://idswyft-api:3001` (set by docker-compose.dev.yml). */
    idswyftBaseUrl: string;
    idswyftApiKey: string;
    idswyftWebhookSecret: string;
    /** Idswyft ML engine origin for the pre-upload photo check; empty = check disabled. */
    engineUrl: string;
    /** `false` lifts the identity check everywhere (dev only; always `true` in production). */
    enforcement: boolean;
    /** Certificate types whose KYC policy is `planned` but that are enforced anyway (e.g. `birth,marriage,death`). */
    enforcedTypes: string[];
    /** New verification sessions a holder may open per rolling 24 h. */
    maxSessionsPerDay: number;
    /** Pre-upload MRZ check: `strict` refuses an unreadable MRZ, `warn` lets the holder send it anyway, `off` skips it. Always `strict` in production. */
    mrzPrecheck: KycMrzPrecheckMode;
    /** On: a provider rejection or outage sends the dossier to an agent (`manual_review`) instead of failing it. */
    fallbackManualReview: boolean;
    /** `manual_only`: Idswyft is not called, every dossier is decided by an agent. Always `idswyft` in production. */
    providerMode: KycProviderMode;
    /** 64 hex chars (AES-256 key) encrypting the document copies kept for agent review; empty = no copy is kept. */
    docEncryptionKey: string;
    /** Days an undecided copy is kept (they are deleted at the decision). */
    docRetentionDays: number;
  };
}

/**
 * Fail-closed parse of APPWRITE_REQUIRE_GOOGLE_IDENTITY: required unless the
 * var is exactly the lowercase string `false` (surrounding whitespace
 * tolerated) AND we are not in production. Anything else (unset, blank,
 * `False`, `0`, typo, `true`) keeps the gate on; production ignores `false`
 * (a boot warning is emitted from `env.validation.ts`).
 */
/**
 * `CERT_AUTO_ISSUE`: types that need no review are accepted (then issued after payment) without an agent, and
 * the data is only declared by the holder. On when not live unless the var is `false`; when live
 * (`NODE_ENV=production` or `BITNOB_ENVIRONMENT=production`) it is OFF unless the var is exactly `true`.
 */
export function resolveAutoIssue(
  nodeEnv: string | undefined,
  bitnobEnvironment: string | undefined,
  raw: string | undefined,
): boolean {
  // "Live" = production code path OR real-money Bitnob. The live-payment guide only sets BITNOB_ENVIRONMENT, so
  // NODE_ENV alone must not decide: a live deployment must never auto-issue unreviewed data by default.
  const live = nodeEnv === 'production' || bitnobEnvironment === 'production';
  return live ? raw === 'true' : raw !== 'false';
}

export function parseRequireGoogleIdentity(nodeEnv: string, raw: string | undefined): boolean {
  if (nodeEnv === 'production') return true;
  return (raw ?? '').trim() !== 'false';
}

/**
 * `KYC_ENFORCEMENT`: the identity check on certificate requests. On unless the var is exactly `off` AND we are not
 * in production (same fail-closed shape as `parseRequireGoogleIdentity`; a boot warning is emitted from
 * `env.validation.ts` when `off` is ignored).
 */
export function parseKycEnforcement(nodeEnv: string, raw: string | undefined): boolean {
  if (nodeEnv === 'production') return true;
  return (raw ?? '').trim() !== 'off';
}

/** `KYC_ENFORCED_TYPES`: comma-separated certificate type ids; blanks dropped, lowercased. */
export function parseKycEnforcedTypes(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

export type KycMrzPrecheckMode = 'strict' | 'warn' | 'off';
export type KycProviderMode = 'idswyft' | 'manual_only';

/**
 * `KYC_MRZ_PRECHECK`: `strict` unless the var is exactly `warn` or `off` AND we are not in production (fail-closed, same shape
 * as `parseKycEnforcement`; a boot warning is emitted from `env.validation.ts` when the relaxation is ignored).
 */
export function parseKycMrzPrecheck(nodeEnv: string, raw: string | undefined): KycMrzPrecheckMode {
  if (nodeEnv === 'production') return 'strict';
  const value = (raw ?? '').trim();
  return value === 'warn' || value === 'off' ? value : 'strict';
}

/** `KYC_FALLBACK_MANUAL_REVIEW`: off unless the var is exactly `on`. Allowed in production (it is then a real review process). */
export function parseKycFallbackManualReview(raw: string | undefined): boolean {
  return (raw ?? '').trim() === 'on';
}

/** `KYC_PROVIDER_MODE`: `idswyft` unless the var is exactly `manual_only` AND we are not in production. */
export function parseKycProviderMode(nodeEnv: string, raw: string | undefined): KycProviderMode {
  if (nodeEnv === 'production') return 'idswyft';
  return (raw ?? '').trim() === 'manual_only' ? 'manual_only' : 'idswyft';
}

/** `KYC_DOC_ENCRYPTION_KEY`: exactly 64 hex characters, else empty (no copy is ever kept with a malformed key). */
export function parseKycDocEncryptionKey(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  return /^[0-9a-fA-F]{64}$/.test(value) ? value : '';
}

const DEFAULT_KYC_DOC_RETENTION_DAYS = 30;

/** Unset/blank/invalid -> 30; integer in [1, 365] -> itself. */
export function parseKycDocRetentionDays(raw: string | undefined): number {
  const parsed = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 365
    ? parsed
    : DEFAULT_KYC_DOC_RETENTION_DAYS;
}

const DEFAULT_KYC_MAX_SESSIONS_PER_DAY = 5;

/** Unset/blank/invalid -> default; integer in [1, 50] -> itself. */
export function parseKycMaxSessionsPerDay(raw: string | undefined): number {
  const parsed = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 50
    ? parsed
    : DEFAULT_KYC_MAX_SESSIONS_PER_DAY;
}

const DEFAULT_INVOICE_RECONCILE_INTERVAL_MS = 60000;

const MAX_INVOICE_RECONCILE_INTERVAL_MS = 86_400_000;

/**
 * Unset/blank -> default 60000; integer in [0, 86400000] -> itself (0 = disabled); anything else -> default.
 * The 5000 ms floor for positive values is applied by the reconciler at startup (with a warn), not here.
 */
export function parseReconcileInterval(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_INVOICE_RECONCILE_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_INVOICE_RECONCILE_INTERVAL_MS
    ? parsed
    : DEFAULT_INVOICE_RECONCILE_INTERVAL_MS;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3003', 10),
  corsOrigins: parseCorsOrigins(process.env.CORS_ORIGINS, process.env.NODE_ENV || 'development'),

  app: {
    // Public origin of this API. Used to build the Bitnob payout
    // `callback_url` (`${baseUrl}/api/bitnob/webhooks`). Required at
    // boot (see `env.validation.ts`); the HTTPS constraint is only enforced
    // when `bitnob.environment === 'production'` (see `BitnobPayoutsService`).
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:3003',
  },

  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5442', 10),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    name: process.env.DB_NAME || 'dioteko_dev_bitnob',
    url: process.env.DATABASE_URL,
  },

  jwt: {
    // No `|| ''` fallback: `env.validation.ts` requires JWT_SECRET at boot
    // (`@IsNotEmpty()`), so by the time this factory runs the value is
    // guaranteed present. An empty-string fallback here would only mask
    // that guarantee and let tokens get signed with an empty secret.
    secret: process.env.JWT_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  },

  vc: {
    issuer: process.env.VC_ISSUER || 'dioteko-backend-nest',
    // No `|| ''` fallback: `env.validation.ts` requires VC_SIGNING_SECRET at
    // boot (`@IsNotEmpty()`), same tier as JWT_SECRET — a blank signing
    // secret would let anyone forge a validly-signed VC JWT.
    signingSecret: process.env.VC_SIGNING_SECRET as string,
    validityDays: parseInt(process.env.CERTIFICATE_VALIDITY_DAYS || '365', 10),
  },

  bitnob: {
    clientId: process.env.BITNOB_CLIENT_ID || '',
    clientSecret: process.env.BITNOB_CLIENT_SECRET || '',
    // Same host for sandbox and prod — the environment is keyed by the API
    // key, not the URL.
    baseUrl: process.env.BITNOB_BASE_URL || 'https://api.bitnob.com',
    // `sandbox` | `production`. Gates real money movement: when
    // `production`, `BitnobPayoutsService.finalizePayout` is disabled
    // outright (Increment 3 interim state) and the payout `callback_url`
    // must be HTTPS.
    environment: process.env.BITNOB_ENVIRONMENT || 'sandbox',
    // Secret Bitnob signs inbound webhook payloads with (HMAC-SHA512 over the
    // raw body, `x-bitnob-signature` header). Distinct construction from the
    // outbound request-signing secret, so the fallback to `BITNOB_CLIENT_SECRET`
    // is safe (no cross-forge) — but confirm in the Bitnob dashboard which
    // secret webhooks actually use. `env.validation.ts` warns when the fallback
    // is taken. Empty (neither var set) + `production` => the guard rejects all
    // deliveries (fail closed); empty + non-prod => verification is skipped.
    webhookSecret:
      process.env.BITNOB_WEBHOOK_SECRET || process.env.BITNOB_CLIENT_SECRET || '',
    // Period of the background pending-invoice reconciler (BITNOB_INVOICE_RECONCILE_INTERVAL_MS).
    // Default 60000; 0 disables; positive values below 5000 are raised to 5000 by the reconciler.
    // Anything unparsable, negative or above 86400000 falls back to the default
    // (`env.validation.ts` rejects it at boot anyway).
    invoiceReconcileIntervalMs: parseReconcileInterval(process.env.BITNOB_INVOICE_RECONCILE_INTERVAL_MS),
    // Server-side resolved bank beneficiary for certificate-scoped payouts —
    // the certificate payout DTO deliberately carries NO beneficiary. Absent
    // values surface as a 500 at payout time (see
    // `AdminCertificatesService.resolvePayoutBeneficiary`), not at boot.
    payoutBeneficiary: {
      accountNumber: process.env.BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NUMBER || '',
      accountName: process.env.BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NAME || '',
      bankCode: process.env.BITNOB_PAYOUT_BENEFICIARY_BANK_CODE || '',
      country: process.env.BITNOB_PAYOUT_BENEFICIARY_COUNTRY || '',
    },
  },

  payments: {
    // Fail-closed: only the exact string 'true' enables it.
    simulation: process.env.PAYMENT_SIMULATION === 'true',
  },

  certificates: {
    // Types without review are issued automatically after payment. Fail-closed when live: see `resolveAutoIssue`.
    autoIssue: resolveAutoIssue(process.env.NODE_ENV, process.env.BITNOB_ENVIRONMENT, process.env.CERT_AUTO_ISSUE),
  },

  appwrite: {
    endpoint: process.env.APPWRITE_ENDPOINT || '',
    projectId: process.env.APPWRITE_PROJECT_ID || '',
    apiKey: process.env.APPWRITE_API_KEY || '',
    // Fail closed: the Appwrite account must carry a Google identity unless
    // explicitly relaxed outside production (E2E seed user is email+password).
    requireGoogleIdentity: parseRequireGoogleIdentity(
      process.env.NODE_ENV || 'development',
      process.env.APPWRITE_REQUIRE_GOOGLE_IDENTITY,
    ),
  },

  kyc: {
    // Host-run Nest reaches the dev Idswyft on its published port; the backend container gets
    // http://idswyft-api:3001 from docker-compose.dev.yml.
    idswyftBaseUrl: process.env.IDSWYFT_BASE_URL || 'http://localhost:8010',
    idswyftApiKey: process.env.IDSWYFT_API_KEY || '',
    // Shared secret Idswyft signs webhook deliveries with (HMAC-SHA256, `X-Idswyft-Signature`). Empty + production
    // => the guard rejects every delivery (fail closed); empty + non-prod => verification is skipped.
    idswyftWebhookSecret: process.env.IDSWYFT_WEBHOOK_SECRET || '',
    // The container gets http://idswyft-ml-engine:3002 from docker-compose.dev.yml. Empty (default): no photo precheck.
    engineUrl: process.env.IDSWYFT_ENGINE_URL || '',
    enforcement: parseKycEnforcement(process.env.NODE_ENV || 'development', process.env.KYC_ENFORCEMENT),
    enforcedTypes: parseKycEnforcedTypes(process.env.KYC_ENFORCED_TYPES),
    maxSessionsPerDay: parseKycMaxSessionsPerDay(process.env.KYC_MAX_SESSIONS_PER_DAY),
    mrzPrecheck: parseKycMrzPrecheck(process.env.NODE_ENV || 'development', process.env.KYC_MRZ_PRECHECK),
    fallbackManualReview: parseKycFallbackManualReview(process.env.KYC_FALLBACK_MANUAL_REVIEW),
    providerMode: parseKycProviderMode(process.env.NODE_ENV || 'development', process.env.KYC_PROVIDER_MODE),
    docEncryptionKey: parseKycDocEncryptionKey(process.env.KYC_DOC_ENCRYPTION_KEY),
    docRetentionDays: parseKycDocRetentionDays(process.env.KYC_DOC_RETENTION_DAYS),
  },
});

import { plainToInstance } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Vars that are important for real functionality but genuinely don't exist
 * yet (Bitnob credentials — see plan: user adds them later). We
 * don't fail boot over these; we just warn loudly so it's obvious why a
 * Bitnob call will fail later, instead of a silent misconfiguration.
 */
const OPTIONAL_WARN_VARS = [
  'BITNOB_CLIENT_ID',
  'BITNOB_CLIENT_SECRET',
  'BITNOB_WEBHOOK_SECRET',
  'BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NUMBER',
  'BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NAME',
  'BITNOB_PAYOUT_BENEFICIARY_BANK_CODE',
  'BITNOB_PAYOUT_BENEFICIARY_COUNTRY',
  'APPWRITE_ENDPOINT',
  'APPWRITE_PROJECT_ID',
  'APPWRITE_API_KEY',
  'IDSWYFT_API_KEY',
  'IDSWYFT_WEBHOOK_SECRET',
] as const;

/**
 * Startup env contract. Required fields make the app refuse to boot with a
 * clear error instead of failing confusingly later (e.g. TypeORM connecting
 * with an empty password, or JWTs signed with an empty secret).
 */
class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment = Environment.Development;

  @IsInt()
  @Min(0)
  @Max(65535)
  PORT: number = 3003;

  // Public origin of this API — required at boot. Feeds the Bitnob payout
  // `callback_url`; the HTTPS constraint on that URL is only enforced when
  // BITNOB_ENVIRONMENT=production (see BitnobPayoutsService).
  @IsString()
  @IsNotEmpty()
  APP_BASE_URL: string;

  @IsString()
  @IsNotEmpty()
  DB_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DB_PORT: number;

  @IsString()
  @IsNotEmpty()
  DB_USERNAME: string;

  @IsString()
  @IsNotEmpty()
  DB_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DB_NAME: string;

  @IsOptional()
  @IsString()
  DATABASE_URL?: string;

  @IsString()
  @IsNotEmpty()
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  JWT_ACCESS_TTL?: string;

  @IsOptional()
  @IsString()
  JWT_REFRESH_TTL?: string;

  @IsOptional()
  @IsString()
  VC_ISSUER?: string;

  @IsString()
  @IsNotEmpty()
  VC_SIGNING_SECRET: string;

  @IsOptional()
  @IsInt()
  CERTIFICATE_VALIDITY_DAYS?: number;

  // Bitnob — credentials optional/warn-only (sandbox key is checked in later),
  // but BITNOB_ENVIRONMENT has a safe default and is strictly validated: an
  // unrecognized value must fail boot rather than silently behave as sandbox.
  @IsOptional() @IsString() BITNOB_CLIENT_ID?: string;
  @IsOptional() @IsString() BITNOB_CLIENT_SECRET?: string;
  // Inbound webhook signing secret (HMAC-SHA512 over the raw body). Optional:
  // falls back to BITNOB_CLIENT_SECRET when unset (see configuration.ts). A
  // dedicated warn fires in validate() when that fallback is taken.
  @IsOptional() @IsString() BITNOB_WEBHOOK_SECRET?: string;
  @IsOptional() @IsString() BITNOB_BASE_URL?: string;
  @IsIn(['sandbox', 'production']) BITNOB_ENVIRONMENT: string = 'sandbox';
  // Background pending-invoice reconciler period in ms (default 60000, 0 = disabled, max 86400000;
  // positive values below 5000 are accepted here and raised to 5000 by the reconciler).
  @IsOptional() @IsInt() @Min(0) @Max(86_400_000) BITNOB_INVOICE_RECONCILE_INTERVAL_MS?: number;
  @IsOptional() @IsString() BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NUMBER?: string;
  @IsOptional() @IsString() BITNOB_PAYOUT_BENEFICIARY_ACCOUNT_NAME?: string;
  @IsOptional() @IsString() BITNOB_PAYOUT_BENEFICIARY_BANK_CODE?: string;
  @IsOptional() @IsString() BITNOB_PAYOUT_BENEFICIARY_COUNTRY?: string;

  // Dev only: lets the request holder (or its organization's staff) mark an invoice paid without paying. A
  // string on purpose (see APPWRITE_REQUIRE_GOOGLE_IDENTITY); refused in production in validate().
  @IsOptional() @IsIn(['true', 'false']) PAYMENT_SIMULATION?: string;
  // Automatic issuance for types that need no review (birth, marriage, death). Default: on outside production,
  // OFF in production (every request then goes through an agent) until set to 'true' explicitly.
  @IsOptional() @IsIn(['true', 'false']) CERT_AUTO_ISSUE?: string;
  // Comma-separated exact browser origins allowed by CORS (the web console). Default: localhost:3000 outside
  // production, none in production. Malformed entries and wildcards are dropped (see cors-origins.ts).
  @IsOptional() @IsString() CORS_ORIGINS?: string;
  // Period of the background pass that resumes paid-but-not-issued requests (ms, default 60000, 0 = off).
  @IsOptional() @IsInt() @Min(0) @Max(86_400_000) ADMIN_CERTIFICATES_RESUME_INTERVAL_MS?: number;

  // Appwrite — optional/warn-only, credentials aren't set up yet (mobile
  // client, Phase E, isn't built yet either).
  @IsOptional() @IsString() APPWRITE_ENDPOINT?: string;
  @IsOptional() @IsString() APPWRITE_PROJECT_ID?: string;
  @IsOptional() @IsString() APPWRITE_API_KEY?: string;
  // Kept as a string on purpose: with `enableImplicitConversion` a `boolean`
  // type would turn the string "false" into `true`. Parsed (fail-closed) in
  // configuration.ts.
  @IsOptional() @IsIn(['true', 'false']) APPWRITE_REQUIRE_GOOGLE_IDENTITY?: string;
  // Consumed only by `npm run seed:appwrite` / the Appwrite-login E2E — never
  // by the running app, so not in OPTIONAL_WARN_VARS.
  @IsOptional() @IsString() APPWRITE_TEST_USER_EMAIL?: string;
  @IsOptional() @IsString() APPWRITE_TEST_USER_PASSWORD?: string;

  // KYC (Idswyft, self-hosted). Credentials are warn-only like Bitnob's. KYC_ENFORCEMENT is a string on purpose
  // (see APPWRITE_REQUIRE_GOOGLE_IDENTITY); `off` is ignored in production (warned in validate()).
  @IsOptional() @IsString() IDSWYFT_BASE_URL?: string;
  @IsOptional() @IsString() IDSWYFT_API_KEY?: string;
  @IsOptional() @IsString() IDSWYFT_WEBHOOK_SECRET?: string;
  @IsOptional() @IsString() IDSWYFT_ENGINE_URL?: string;
  @IsOptional() @IsIn(['on', 'off']) KYC_ENFORCEMENT?: string;
  @IsOptional() @IsString() KYC_ENFORCED_TYPES?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) KYC_MAX_SESSIONS_PER_DAY?: number;
  // Manual review (docs/PLAN_KYC_MANUAL_REVIEW.md). Strings on purpose, like KYC_ENFORCEMENT; the relaxing values are
  // ignored in production (warned in validate()).
  @IsOptional() @IsIn(['strict', 'warn', 'off']) KYC_MRZ_PRECHECK?: string;
  @IsOptional() @IsIn(['on', 'off']) KYC_FALLBACK_MANUAL_REVIEW?: string;
  @IsOptional() @IsIn(['idswyft', 'manual_only']) KYC_PROVIDER_MODE?: string;
  @IsOptional() @IsString() KYC_DOC_ENCRYPTION_KEY?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) KYC_DOC_RETENTION_DAYS?: number;
}

/**
 * Passed to ConfigModule.forRoot({ validate }). Throws (and prevents boot)
 * when a var that's required for the app to make sense at all is missing;
 * warns via console for vars that are only required for specific
 * not-yet-configured integrations.
 */
export function validate(config: Record<string, unknown>): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`[env.validation] Invalid environment configuration:\n${errors.toString()}`);
  }

  // The committed .env.test.example ships usable throwaway signing secrets so
  // `npm run test:e2e` works out of the box. They are only safe while
  // NODE_ENV=test (never set on a deployed instance) — refuse them anywhere
  // else so a copy-paste into .env / .env.prod fails closed.
  if (validatedConfig.NODE_ENV !== Environment.Test) {
    const testOnlyPrefix = 'e2e-test-only-';
    for (const key of ['JWT_SECRET', 'VC_SIGNING_SECRET'] as const) {
      if (String(config[key] ?? '').startsWith(testOnlyPrefix)) {
        throw new Error(
          `[env.validation] ${key} is a test-only value ("${testOnlyPrefix}…") but NODE_ENV=${validatedConfig.NODE_ENV}. ` +
            'Use a real secret outside the test environment.',
        );
      }
    }
  }

  // Payment simulation bypasses payment. Whitelist, not blacklist: it boots only with a dev-like NODE_ENV AND an
  // EXPLICIT BITNOB_ENVIRONMENT=sandbox (the default value would hide a misconfigured deployment).
  if (validatedConfig.PAYMENT_SIMULATION === 'true') {
    const devLike = validatedConfig.NODE_ENV === Environment.Development || validatedConfig.NODE_ENV === Environment.Test;
    if (!devLike || String(config.BITNOB_ENVIRONMENT ?? '') !== 'sandbox') {
      throw new Error(
        '[env.validation] PAYMENT_SIMULATION=true is only allowed with NODE_ENV=development|test AND an explicit ' +
          'BITNOB_ENVIRONMENT=sandbox. Remove it: simulated payments must never run against real money.',
      );
    }
    // eslint-disable-next-line no-console
    console.warn('[ENV][WARN] PAYMENT_SIMULATION=true: any holder can mark their own invoice paid. Dev only.');
  }

  if (
    validatedConfig.NODE_ENV === Environment.Production &&
    String(config.APPWRITE_REQUIRE_GOOGLE_IDENTITY ?? '').trim().toLowerCase() === 'false'
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ENV][WARN] APPWRITE_REQUIRE_GOOGLE_IDENTITY=false is ignored when NODE_ENV=production — ' +
        'the Google-identity requirement stays enforced.',
    );
  }

  if (validatedConfig.KYC_ENFORCEMENT === 'off') {
    // eslint-disable-next-line no-console
    console.warn(
      validatedConfig.NODE_ENV === Environment.Production
        ? '[ENV][WARN] KYC_ENFORCEMENT=off is ignored when NODE_ENV=production — the identity check stays enforced.'
        : '[ENV][WARN] KYC_ENFORCEMENT=off: certificate requests are NOT identity-checked. Dev only.',
    );
  }

  const isProduction = validatedConfig.NODE_ENV === Environment.Production;
  for (const [name, relaxed] of [
    ['KYC_MRZ_PRECHECK', validatedConfig.KYC_MRZ_PRECHECK === 'warn' || validatedConfig.KYC_MRZ_PRECHECK === 'off'],
    ['KYC_PROVIDER_MODE', validatedConfig.KYC_PROVIDER_MODE === 'manual_only'],
  ] as const) {
    if (!relaxed) continue;
    // eslint-disable-next-line no-console
    console.warn(
      isProduction
        ? `[ENV][WARN] ${name} is ignored when NODE_ENV=production — the strict behaviour stays enforced.`
        : `[ENV][WARN] ${name} is relaxed: identity documents are checked less strictly or by an agent only. Not for production.`,
    );
  }
  const keepsCopies = validatedConfig.KYC_FALLBACK_MANUAL_REVIEW === 'on' || (!isProduction && validatedConfig.KYC_PROVIDER_MODE === 'manual_only');
  if (keepsCopies && !/^[0-9a-fA-F]{64}$/.test((validatedConfig.KYC_DOC_ENCRYPTION_KEY ?? '').trim())) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ENV][WARN] KYC manual review is on but KYC_DOC_ENCRYPTION_KEY is not 64 hex characters — no document copy can be kept, agents will have nothing to review.',
    );
  }

  for (const key of OPTIONAL_WARN_VARS) {
    if (!config[key]) {
      // eslint-disable-next-line no-console
      console.warn(`[ENV][WARN] ${key} is not set — features depending on it will fail until configured.`);
    }
  }

  // One-time startup warn: the Bitnob webhook guard is verifying signatures
  // with the outbound request-signing secret because no dedicated webhook
  // secret was provided. The two constructions don't cross-forge (safe), but
  // confirm in the Bitnob dashboard which secret webhooks are actually signed
  // with before relying on this in production.
  if (!config.BITNOB_WEBHOOK_SECRET && config.BITNOB_CLIENT_SECRET) {
    // eslint-disable-next-line no-console
    console.warn(
      '[ENV][WARN] BITNOB_WEBHOOK_SECRET is not set — falling back to BITNOB_CLIENT_SECRET ' +
        'for Bitnob webhook signature verification. Confirm the correct secret in the Bitnob dashboard.',
    );
  }

  return validatedConfig;
}

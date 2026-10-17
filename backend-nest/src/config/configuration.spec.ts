import configuration, {
  parseKycDocEncryptionKey,
  parseKycDocRetentionDays,
  parseKycEnforcedTypes,
  parseKycEnforcement,
  parseKycFallbackManualReview,
  parseKycMaxSessionsPerDay,
  parseKycMrzPrecheck,
  parseKycProviderMode,
  parseReconcileInterval,
  parseRequireGoogleIdentity,
  resolveAutoIssue,
} from './configuration';

describe('parseReconcileInterval', () => {
  it.each([
    [undefined, 60000],
    ['', 60000],
    ['  ', 60000],
    ['0', 0],
    ['5000', 5000],
    ['86400000', 86_400_000],
    ['86400001', 60000],
    ['-1', 60000],
    ['1.5', 60000],
    ['abc', 60000],
    ['1e3', 1000],
  ])('%p -> %p', (raw, expected) => {
    expect(parseReconcileInterval(raw)).toBe(expected);
  });
});

describe('parseRequireGoogleIdentity (fail-closed)', () => {
  it.each(['test', 'development'])('only an explicit "false" relaxes the gate in NODE_ENV=%s', (env) => {
    expect(parseRequireGoogleIdentity(env, 'false')).toBe(false);
    expect(parseRequireGoogleIdentity(env, ' false ')).toBe(false);
  });

  it('production ignores "false" (always required)', () => {
    expect(parseRequireGoogleIdentity('production', 'false')).toBe(true);
    expect(parseRequireGoogleIdentity('production', ' false ')).toBe(true);
  });

  it.each(['production', 'test', 'development'])('unset / blank keeps the gate on in NODE_ENV=%s', (env) => {
    expect(parseRequireGoogleIdentity(env, undefined)).toBe(true);
    expect(parseRequireGoogleIdentity(env, '')).toBe(true);
    expect(parseRequireGoogleIdentity(env, '   ')).toBe(true);
  });

  it.each(['False', 'FALSE', '0', 'no', 'off', 'flase', 'fals'])(
    'non-exact value %p keeps the gate on outside production',
    (raw) => {
      expect(parseRequireGoogleIdentity('test', raw)).toBe(true);
      expect(parseRequireGoogleIdentity('development', raw)).toBe(true);
    },
  );

  it.each(['production', 'test', 'development'])('"true" is required in NODE_ENV=%s', (env) => {
    expect(parseRequireGoogleIdentity(env, 'true')).toBe(true);
  });
});

describe('configuration(): appwrite.requireGoogleIdentity wiring', () => {
  const saved = {
    nodeEnv: process.env.NODE_ENV,
    raw: process.env.APPWRITE_REQUIRE_GOOGLE_IDENTITY,
  };

  function resolve(nodeEnv: string | undefined, raw: string | undefined): boolean {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    if (raw === undefined) delete process.env.APPWRITE_REQUIRE_GOOGLE_IDENTITY;
    else process.env.APPWRITE_REQUIRE_GOOGLE_IDENTITY = raw;
    return configuration().appwrite.requireGoogleIdentity;
  }

  afterEach(() => {
    if (saved.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = saved.nodeEnv;
    if (saved.raw === undefined) delete process.env.APPWRITE_REQUIRE_GOOGLE_IDENTITY;
    else process.env.APPWRITE_REQUIRE_GOOGLE_IDENTITY = saved.raw;
  });

  it('reads NODE_ENV and APPWRITE_REQUIRE_GOOGLE_IDENTITY from the environment', () => {
    expect(resolve('test', 'false')).toBe(false);
    expect(resolve('production', 'false')).toBe(true);
    expect(resolve('test', 'True')).toBe(true);
  });

  it('unset NODE_ENV defaults to development (explicit "false" relaxes, unset requires)', () => {
    expect(resolve(undefined, 'false')).toBe(false);
    expect(resolve(undefined, undefined)).toBe(true);
  });
});

describe('resolveAutoIssue (fail-closed when live)', () => {
  it.each([
    // [NODE_ENV, BITNOB_ENVIRONMENT, CERT_AUTO_ISSUE, expected]
    ['development', 'sandbox', undefined, true],
    ['development', 'sandbox', 'false', false],
    ['test', undefined, undefined, true],
    ['production', 'sandbox', undefined, false],
    ['production', 'production', undefined, false],
    ['production', 'production', 'true', true],
    ['development', 'production', undefined, false], // live Bitnob with the default NODE_ENV: the CodeRabbit case
    ['development', 'production', 'false', false],
    ['development', 'production', 'true', true],
    [undefined, 'production', undefined, false],
    ['production', 'production', 'TRUE', false], // only the exact string 'true' opens it
  ])('NODE_ENV=%p BITNOB_ENVIRONMENT=%p CERT_AUTO_ISSUE=%p -> %p', (nodeEnv, bitnobEnv, raw, expected) => {
    expect(resolveAutoIssue(nodeEnv, bitnobEnv, raw)).toBe(expected);
  });
});

describe('configuration(): certificates.autoIssue wiring', () => {
  const keys = ['NODE_ENV', 'BITNOB_ENVIRONMENT', 'CERT_AUTO_ISSUE'] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  function resolve(nodeEnv: string | undefined, bitnobEnv: string | undefined, raw: string | undefined): boolean {
    const values = { NODE_ENV: nodeEnv, BITNOB_ENVIRONMENT: bitnobEnv, CERT_AUTO_ISSUE: raw };
    for (const k of keys) {
      if (values[k] === undefined) delete process.env[k];
      else process.env[k] = values[k];
    }
    return configuration().certificates.autoIssue;
  }

  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('is on by default when not live', () => {
    expect(resolve('development', 'sandbox', undefined)).toBe(true);
  });

  it('is off by default when Bitnob is live even with the default NODE_ENV (the CodeRabbit case)', () => {
    expect(resolve('development', 'production', undefined)).toBe(false);
    expect(resolve(undefined, 'production', undefined)).toBe(false);
  });

  it('is off by default in production, and an explicit true re-enables it', () => {
    expect(resolve('production', 'sandbox', undefined)).toBe(false);
    expect(resolve('development', 'production', 'true')).toBe(true);
  });
});

describe('KYC settings', () => {
  it.each([
    ['development', undefined, true],
    ['development', 'on', true],
    ['development', 'off', false],
    ['development', ' off ', false],
    ['development', 'OFF', true],
    ['test', 'off', false],
    ['production', 'off', true],
    ['production', undefined, true],
  ])('NODE_ENV=%p KYC_ENFORCEMENT=%p -> enforced=%p (off is ignored in production)', (nodeEnv, raw, expected) => {
    expect(parseKycEnforcement(nodeEnv, raw)).toBe(expected);
  });

  it('parses KYC_ENFORCED_TYPES: trimmed, lowercased, blanks dropped', () => {
    expect(parseKycEnforcedTypes(undefined)).toEqual([]);
    expect(parseKycEnforcedTypes(' Birth, marriage ,, DEATH ')).toEqual(['birth', 'marriage', 'death']);
  });

  it.each([
    [undefined, 5],
    ['', 5],
    ['abc', 5],
    ['0', 5],
    ['51', 5],
    ['1', 1],
    ['50', 50],
  ])('KYC_MAX_SESSIONS_PER_DAY=%p -> %p', (raw, expected) => {
    expect(parseKycMaxSessionsPerDay(raw)).toBe(expected);
  });

  it('exposes the kyc block with the host-run default Idswyft address', () => {
    const previous = process.env.IDSWYFT_BASE_URL;
    delete process.env.IDSWYFT_BASE_URL;
    try {
      expect(configuration().kyc.idswyftBaseUrl).toBe('http://localhost:8000');
    } finally {
      if (previous !== undefined) process.env.IDSWYFT_BASE_URL = previous;
    }
  });
});

describe('KYC manual review settings', () => {
  it.each([
    ['development', undefined, 'strict'],
    ['development', 'strict', 'strict'],
    ['development', 'warn', 'warn'],
    ['development', ' off ', 'off'],
    ['development', 'WARN', 'strict'],
    ['development', 'garbage', 'strict'],
    ['production', 'warn', 'strict'],
    ['production', 'off', 'strict'],
  ])('NODE_ENV=%p KYC_MRZ_PRECHECK=%p -> %p (relaxing is ignored in production)', (nodeEnv, raw, expected) => {
    expect(parseKycMrzPrecheck(nodeEnv, raw)).toBe(expected);
  });

  it.each([
    [undefined, false],
    ['', false],
    ['off', false],
    ['ON', false],
    ['true', false],
    ['on', true],
    [' on ', true],
  ])('KYC_FALLBACK_MANUAL_REVIEW=%p -> %p (on only when exactly "on")', (raw, expected) => {
    expect(parseKycFallbackManualReview(raw)).toBe(expected);
  });

  it.each([
    ['development', undefined, 'idswyft'],
    ['development', 'manual_only', 'manual_only'],
    ['test', ' manual_only ', 'manual_only'],
    ['development', 'Manual_Only', 'idswyft'],
    ['production', 'manual_only', 'idswyft'],
  ])('NODE_ENV=%p KYC_PROVIDER_MODE=%p -> %p (manual_only is ignored in production)', (nodeEnv, raw, expected) => {
    expect(parseKycProviderMode(nodeEnv, raw)).toBe(expected);
  });

  it('accepts only a 64-hex-character encryption key', () => {
    const key = 'ab'.repeat(32);
    expect(parseKycDocEncryptionKey(key)).toBe(key);
    expect(parseKycDocEncryptionKey(` ${key} `)).toBe(key);
    expect(parseKycDocEncryptionKey(undefined)).toBe('');
    expect(parseKycDocEncryptionKey('ab'.repeat(31))).toBe('');
    expect(parseKycDocEncryptionKey('zz'.repeat(32))).toBe('');
  });

  it.each([
    [undefined, 30],
    ['', 30],
    ['0', 30],
    ['366', 30],
    ['abc', 30],
    ['1', 1],
    ['365', 365],
  ])('KYC_DOC_RETENTION_DAYS=%p -> %p', (raw, expected) => {
    expect(parseKycDocRetentionDays(raw)).toBe(expected);
  });

  it('exposes the review settings in the kyc block with safe defaults', () => {
    const saved = { ...process.env };
    for (const key of ['KYC_MRZ_PRECHECK', 'KYC_FALLBACK_MANUAL_REVIEW', 'KYC_PROVIDER_MODE', 'KYC_DOC_ENCRYPTION_KEY', 'KYC_DOC_RETENTION_DAYS']) {
      delete process.env[key];
    }
    try {
      expect(configuration().kyc).toMatchObject({
        mrzPrecheck: 'strict',
        fallbackManualReview: false,
        providerMode: 'idswyft',
        docEncryptionKey: '',
        docRetentionDays: 30,
      });
    } finally {
      process.env = saved;
    }
  });
});

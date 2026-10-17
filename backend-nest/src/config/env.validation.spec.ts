import 'reflect-metadata';
import { validate } from './env.validation';

const base = {
  PORT: '3001',
  APP_BASE_URL: 'http://localhost:3001',
  DB_HOST: 'localhost',
  DB_PORT: '5435',
  DB_USERNAME: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'd',
  JWT_SECRET: 'a-real-looking-secret',
  VC_SIGNING_SECRET: 'another-real-looking-secret',
};

describe('validate — PAYMENT_SIMULATION (payment bypass, dev only)', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('is accepted with a dev-like NODE_ENV and an explicit sandbox', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() => validate({ ...base, NODE_ENV, PAYMENT_SIMULATION: 'true', BITNOB_ENVIRONMENT: 'sandbox' })).not.toThrow();
    }
  });

  it('is off by default and when "false"', () => {
    expect(() => validate({ ...base, NODE_ENV: 'production' })).not.toThrow();
    expect(() => validate({ ...base, NODE_ENV: 'production', PAYMENT_SIMULATION: 'false' })).not.toThrow();
  });

  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production', BITNOB_ENVIRONMENT: 'sandbox' }],
    ['BITNOB_ENVIRONMENT=production', { NODE_ENV: 'development', BITNOB_ENVIRONMENT: 'production' }],
    ['an implicit (defaulted) BITNOB_ENVIRONMENT', { NODE_ENV: 'development' }],
  ])('refuses to boot with %s', (_label, env) => {
    expect(() => validate({ ...base, PAYMENT_SIMULATION: 'true', ...env })).toThrow(/PAYMENT_SIMULATION/);
  });

  it.each(['TRUE', ' true', '1', 'yes'])('rejects the non-exact value %p at boot', (value) => {
    expect(() =>
      validate({ ...base, NODE_ENV: 'development', BITNOB_ENVIRONMENT: 'sandbox', PAYMENT_SIMULATION: value }),
    ).toThrow();
  });
});

describe('validate — CERT_AUTO_ISSUE (automatic issuance switch)', () => {
  it.each(['true', 'false'])('accepts %p, also in production', (value) => {
    expect(() => validate({ ...base, NODE_ENV: 'production', CERT_AUTO_ISSUE: value })).not.toThrow();
  });

  it('is optional', () => {
    expect(() => validate({ ...base, NODE_ENV: 'production' })).not.toThrow();
  });

  it.each(['TRUE', '1', 'yes'])('rejects the non-exact value %p at boot', (value) => {
    expect(() => validate({ ...base, CERT_AUTO_ISSUE: value })).toThrow(/CERT_AUTO_ISSUE/);
  });
});

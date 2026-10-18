/**
 * Bitnob connectivity smoke test — `npm run smoke:bitnob`.
 *
 * Deliberately does NOT bootstrap `AppModule`: this is a pure HTTP/HMAC
 * connectivity probe and must not drag in a Postgres dependency. It builds a
 * minimal stub `ConfigService` from `process.env` and drives
 * `BitnobHttpClientService` directly.
 *
 * Part A (offline): recompute one signature with node crypto and assert the
 *   util agrees — catches a broken signing pipeline before any network call.
 * Part B (live): drive the read-only Bitnob services
 *   (`BitnobIdentityService` / `BitnobBalancesService` / `BitnobRatesService`
 *   / `BitnobTransactionsService`) against the sandbox and print ONLY the
 *   unwrapped `data` each returns. On error, print `status` + `responseBody`
 *   from `BitnobApiError` — never headers, never the secret, never the
 *   string-to-sign.
 */
import 'reflect-metadata';
import 'dotenv/config';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { BitnobBalancesService } from '../src/modules/bitnob/services/bitnob-balances.service';
import { BitnobApiError, BitnobHttpClientService } from '../src/modules/bitnob/services/bitnob-http-client.service';
import { buildAuthHeaders } from '../src/modules/bitnob/services/bitnob-hmac.util';
import { BitnobIdentityService } from '../src/modules/bitnob/services/bitnob-identity.service';
import { BitnobPayoutsService } from '../src/modules/bitnob/services/bitnob-payouts.service';
import { BitnobRatesService } from '../src/modules/bitnob/services/bitnob-rates.service';
import { BitnobTransactionsService } from '../src/modules/bitnob/services/bitnob-transactions.service';
import { BitnobWithdrawalsService } from '../src/modules/bitnob/services/bitnob-withdrawals.service';

type Envelope = { data?: unknown };

function makeConfigStub(): ConfigService {
  const values: Record<string, string | undefined> = {
    'bitnob.clientId': process.env.BITNOB_CLIENT_ID,
    'bitnob.clientSecret': process.env.BITNOB_CLIENT_SECRET,
    'bitnob.baseUrl': process.env.BITNOB_BASE_URL || 'https://api.bitnob.com',
    'bitnob.environment': process.env.BITNOB_ENVIRONMENT || 'sandbox',
    'app.baseUrl': process.env.APP_BASE_URL || 'http://localhost:3003',
  };
  return {
    get: (key: string, defaultValue?: unknown): unknown =>
      key in values && values[key] !== undefined ? values[key] : defaultValue,
  } as unknown as ConfigService;
}

function printData(label: string, res: unknown): void {
  const envelope = res as Envelope;
  const data = envelope && typeof envelope === 'object' && envelope.data !== undefined ? envelope.data : res;
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
}

function printError(label: string, err: unknown): void {
  console.log(`\n=== ${label} (FAILED) ===`);
  if (err instanceof BitnobApiError) {
    console.log(`status: ${err.status ?? 'n/a'}`);
    console.log(`responseBody: ${JSON.stringify(err.responseBody, null, 2)}`);
  } else {
    console.log(err instanceof Error ? err.message : String(err));
  }
}

function selfCheck(): void {
  const clientId = 'fixed-id';
  const secret = 'fixed-secret';
  const payload = '{"a":1}';
  const headers = buildAuthHeaders(clientId, secret, payload);
  const stringToSign = `${clientId}:${headers['X-Auth-Timestamp']}:${headers['X-Auth-Nonce']}:${payload}`;
  const recomputed = crypto.createHmac('sha256', secret).update(stringToSign).digest('hex');

  if (headers['X-Auth-Signature'] !== recomputed) {
    throw new Error(
      'Part A self-check FAILED: buildAuthHeaders signature does not match a node-crypto HMAC-SHA256 recomputation. ' +
        'The signing pipeline is broken — aborting before any network call.',
    );
  }
  console.log('Part A self-check OK: buildAuthHeaders signature matches node-crypto recomputation.');
}

async function main(): Promise<void> {
  // --- Part A: offline self-check ---
  selfCheck();

  if (!process.env.BITNOB_CLIENT_ID || !process.env.BITNOB_CLIENT_SECRET) {
    console.log('\nBITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET not set — skipping Part B (live probe).');
    return;
  }

  // --- Part B: live sandbox probe ---
  const config = makeConfigStub();
  const http = new BitnobHttpClientService(config);
  const identity = new BitnobIdentityService(http);
  const balances = new BitnobBalancesService(http);
  const rates = new BitnobRatesService(http);
  const transactions = new BitnobTransactionsService(http);
  const payouts = new BitnobPayoutsService(http, config);
  const withdrawals = new BitnobWithdrawalsService(http, config, transactions);

  try {
    printData('identity.whoami()', await identity.whoami());
  } catch (err) {
    printError('identity.whoami()', err);
  }

  try {
    printData('balances.list()', await balances.list());
  } catch (err) {
    printError('balances.list()', err);
  }

  try {
    printData("rates.getPair('USDT', 'NGN')", await rates.getPair('USDT', 'NGN'));
  } catch (err) {
    printError("rates.getPair('USDT', 'NGN')", err);
  }

  try {
    printData('transactions.list({ limit: 3 })', await transactions.list({ limit: 3 }));
  } catch (err) {
    printError('transactions.list({ limit: 3 })', err);
  }

  // Payout QUOTE only — safe (pure pricing lookup, no money movement, no
  // initialize/finalize). Confirms the payout wire contract still holds.
  try {
    printData(
      'payouts.createQuote(NGN 500)',
      await payouts.createQuote({
        fromAsset: 'USDT',
        toCurrency: 'NGN',
        country: 'NG',
        settlementAmount: '500',
        reference: `smoke-${Date.now()}`,
        source: 'offchain',
      }),
    );
  } catch (err) {
    printError('payouts.createQuote(NGN 500)', err);
  }

  // Address VALIDATION only — read-only, no money movement. Confirms the
  // Increment 4 `POST /api/addresses/validate` wire contract
  // (`data.{ valid, address, chain, error? }`). NEVER a withdrawal / bulk
  // create in the smoke script.
  try {
    printData(
      "withdrawals.validateAddress('0xd043…', 'ethereum')",
      await withdrawals.validateAddress('0xd0438C776d03df4FCfF69db78B97e2E6B5Cf033b', 'ethereum'),
    );
  } catch (err) {
    printError('withdrawals.validateAddress', err);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });

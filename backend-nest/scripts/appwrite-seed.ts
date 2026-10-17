/**
 * Appwrite test-user seed — `npm run seed:appwrite`.
 *
 * Ensures one email/password user exists in the configured Appwrite project so
 * the Appwrite-login E2E (`test/appwrite-login.e2e-spec.ts`) has something to
 * sign in as. Idempotent (tolerates a concurrent run).
 *
 * Appwrite has NO headless project/API-key creation — that first step is a
 * one-time console task (see docs/DEV_WORKFLOW.md "Appwrite first-run"). Until
 * APPWRITE_PROJECT_ID + APPWRITE_API_KEY are set this script exits 0 with a
 * clear [SKIP] so it can be wired into db:setup without breaking it.
 *
 * Never logs the password or the API key.
 */
import 'reflect-metadata';
import '../src/config/load-env';
import { AppwriteException, Client, ID, Query, Users } from 'node-appwrite';

const endpoint = process.env.APPWRITE_ENDPOINT || '';
const projectId = process.env.APPWRITE_PROJECT_ID || '';
const apiKey = process.env.APPWRITE_API_KEY || '';
const email = process.env.APPWRITE_TEST_USER_EMAIL || 'appwrite-e2e@dioteko.local';
const password = process.env.APPWRITE_TEST_USER_PASSWORD || '';

function describeError(error: unknown): string {
  if (error instanceof AppwriteException) {
    return JSON.stringify({ code: error.code, type: error.type, message: error.message });
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.log('[SKIP] seed:appwrite is dev/test only (NODE_ENV=production).');
    return;
  }
  if (!projectId || !apiKey) {
    console.log(
      '[SKIP] Appwrite not configured (APPWRITE_PROJECT_ID / APPWRITE_API_KEY empty). ' +
        'Do the one-time console setup — see docs/DEV_WORKFLOW.md "Appwrite first-run".',
    );
    return;
  }
  if (!password) {
    console.log('[SKIP] APPWRITE_TEST_USER_PASSWORD is empty — set it in the active env file to seed the test user.');
    return;
  }

  console.log(`[START] appwrite seed endpoint=${endpoint} project=${projectId} email=${email}`);
  const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);
  const users = new Users(client);

  // Users created through the server API start with emailVerification=false,
  // and the backend refuses unverified accounts at login — so the seed user is
  // marked verified (also on the already-present path, to repair older seeds).
  const markVerified = async (userId: string): Promise<void> => {
    await users.updateEmailVerification({ userId, emailVerification: true });
    console.log(`[STATE] appwrite test user email marked verified id=${userId}`);
  };

  const existing = await users.list([Query.equal('email', [email])]);
  if (existing.total > 0) {
    const existingId = existing.users[0].$id;
    console.log(`[RESULT] appwrite test user already present id=${existingId}`);
    await markVerified(existingId);
    return;
  }

  try {
    const created = await users.create(ID.unique(), email, undefined, password, 'DioteKo E2E');
    console.log(`[RESULT] appwrite test user created id=${created.$id}`);
    await markVerified(created.$id);
  } catch (error) {
    // TOCTOU: another run created it between the list and here.
    if (error instanceof AppwriteException && error.type === 'user_already_exists') {
      console.log('[RESULT] appwrite test user already present (created concurrently)');
      const raced = await users.list([Query.equal('email', [email])]);
      if (raced.total > 0) await markVerified(raced.users[0].$id);
      return;
    }
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(`[RESULT] appwrite seed failed: ${describeError(error)}`);
    process.exit(1);
  });

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Account, AppwriteException, Client, Query } from 'node-appwrite';

export interface AppwriteVerifiedIdentity {
  appwriteUserId: string;
  email: string | null;
  name: string | null;
  /** Appwrite `emailVerification` — Google-verified email on the OAuth path. */
  emailVerified: boolean;
  /** Appwrite `status` — false when the account is blocked/disabled. */
  accountActive: boolean;
  /** Google `sub` (Appwrite identity `providerUid`), null when none is linked. */
  googleId: string | null;
}

const GENERIC_AUTH_FAILURE = 'Invalid or expired Appwrite session';

/**
 * Verifies a short-lived Appwrite JWT minted client-side (mobile app, after
 * Google OAuth via a self-hosted Appwrite project) by handing it back to
 * Appwrite's own `/account` endpoint rather than trusting a locally-decoded
 * token. Besides `account.get()` it reads the caller's own identities
 * (`account.listIdentities`, allowed with the client JWT) to extract the Google
 * `sub`; provider access/refresh tokens on those identities are never read,
 * logged or returned. With `appwrite.requireGoogleIdentity` (fail closed,
 * always on in production) an account without a Google identity is rejected.
 * Only the client-JWT verification path is built here; the admin-key
 * (`.setKey()`) server client is scaffold-later, not needed until a use case
 * requires calling Appwrite's server-side Users API directly.
 */
@Injectable()
export class AppwriteService {
  private readonly logger = new Logger(AppwriteService.name);

  constructor(private readonly configService: ConfigService) {}

  async verifyClientJwt(appwriteJwt: string): Promise<AppwriteVerifiedIdentity> {
    this.logger.log('[START] AppwriteService.verifyClientJwt');
    const requireGoogleIdentity = this.configService.get<boolean>('appwrite.requireGoogleIdentity', true);

    let account: Account;
    let user: Awaited<ReturnType<Account['get']>>;
    try {
      const client = new Client()
        .setEndpoint(this.configService.get<string>('appwrite.endpoint', ''))
        .setProject(this.configService.get<string>('appwrite.projectId', ''))
        .setJWT(appwriteJwt);
      account = new Account(client);
      this.logger.log('[CALL] AppwriteService.verifyClientJwt account.get');
      user = await account.get();
    } catch (error) {
      this.logger.error(`[RESULT] AppwriteService.verifyClientJwt failed detail=${this.describeError(error)}`);
      throw new UnauthorizedException(GENERIC_AUTH_FAILURE);
    }

    this.logger.log(`[ENTITY] appwriteUserId=${user.$id}`);

    // The SDK is newer than the 1.5.4 server — read optional fields defensively.
    const emailVerified = user.emailVerification === true;
    const accountActive = user.status === true;

    let googleId: string | null = null;
    let identitiesFailed = false;
    try {
      this.logger.log(`[CALL] AppwriteService.verifyClientJwt account.listIdentities appwriteUserId=${user.$id}`);
      const identities = await account.listIdentities({ queries: [Query.equal('provider', 'google')] });
      // Only `provider` + `providerUid` are read: the identity also carries
      // providerAccessToken/providerRefreshToken, which must never leave here.
      const google = (identities?.identities ?? []).find((identity) => identity?.provider === 'google');
      googleId = typeof google?.providerUid === 'string' && google.providerUid ? google.providerUid : null;
    } catch (error) {
      identitiesFailed = true;
      this.logger.error(
        `[RESULT] AppwriteService.verifyClientJwt listIdentities failed appwriteUserId=${user.$id} detail=${this.describeError(error)}`,
      );
    }

    if (requireGoogleIdentity && !googleId) {
      this.logger.warn(
        `[RESULT] AppwriteService.verifyClientJwt rejected appwriteUserId=${user.$id} reason=${
          identitiesFailed ? 'identities_lookup_failed' : 'no_google_identity'
        }`,
      );
      throw new UnauthorizedException(GENERIC_AUTH_FAILURE);
    }

    if (!googleId) {
      this.logger.warn(
        `[RESULT] AppwriteService.verifyClientJwt no Google identity (allowed: requireGoogleIdentity=false) appwriteUserId=${user.$id}`,
      );
    }

    this.logger.log(
      `[RESULT] AppwriteService.verifyClientJwt success appwriteUserId=${user.$id} emailVerified=${emailVerified} accountActive=${accountActive} googleLinked=${googleId !== null}`,
    );
    return {
      appwriteUserId: user.$id,
      email: user.email || null,
      name: user.name || null,
      emailVerified,
      accountActive,
      googleId,
    };
  }

  private describeError(error: unknown): string {
    if (error instanceof AppwriteException) {
      return JSON.stringify({ message: error.message, code: error.code, type: error.type });
    }
    return error instanceof Error ? error.message : String(error);
  }
}

import * as crypto from 'crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { IsNull, QueryFailedError, Raw, Repository } from 'typeorm';
import { parseDurationToMs } from '../../../common/utils/duration.util';
import { JwtPayload } from '../../../common/interfaces/jwt-payload.interface';
import { DidService } from '../../did-vc/services/did.service';
import { AppwriteVerifiedIdentity } from './appwrite.service';
import { Role, RoleCode } from '../entities/role.entity';
import { AuthUserDto, toAuthUserDto } from '../dto/auth-user.dto';
import { Session } from '../entities/session.entity';
import { AccountStatus, User } from '../entities/user.entity';
import { UserRole } from '../entities/user-role.entity';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const BCRYPT_SALT_ROUNDS = 10;

// Deliberately vague: never tell a caller *why* sign-in was refused
// (suspended, unverified, identity mismatch).
const SIGN_IN_REFUSED_MESSAGE = 'This account is not allowed to sign in';
const EMAIL_TAKEN_MESSAGE = 'An account with this email already exists. Please sign in using your original method.';
// Used when a unique violation has no identifiable winner: the colliding column
// (email vs google_id) is unknown, so the message must not name any of them.
const IDENTITY_CONFLICT_MESSAGE =
  'An account with these details already exists. Please sign in using your original method.';
// Same neutral wording for password registration: never name the colliding column or the original method.
const REGISTER_CONFLICT_MESSAGE = 'An account with these details already exists.';

// Compared against when the user (or its hash) is missing, so a login for an unknown
// email costs the same bcrypt work as a bad password and does not leak account existence by timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dioteko-dummy-password', BCRYPT_SALT_ROUNDS);

/** Postgres unique_violation, surfaced by TypeORM as a QueryFailedError. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError && (error.driverError as { code?: string } | undefined)?.code === '23505'
  );
}

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized ? normalized : null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
    @InjectRepository(Role) private readonly rolesRepository: Repository<Role>,
    @InjectRepository(UserRole) private readonly userRolesRepository: Repository<UserRole>,
    @InjectRepository(Session) private readonly sessionsRepository: Repository<Session>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly didService: DidService,
  ) {}

  /**
   * Called by AuthController on a successful Appwrite JWT verification
   * (mobile client, Google OAuth via self-hosted Appwrite). Find-or-create
   * by `appwrite_user_id`, ensure the `holder` role, mint our own app JWT +
   * refresh token, plus the Google-identity rules:
   *  - refused up front (no side effect) if the Appwrite account is disabled
   *    or its email is unverified, or the local account is suspended;
   *  - `users.google_id` is set once and never overwritten — a different or
   *    missing Google identity on an already-linked user is refused;
   *  - `users.email` is never re-synced from Appwrite for an existing user;
   *  - an email already held by another user stays a 409 (no auto-link, see
   *    docs/DECISIONS.md), matched case-insensitively.
   * Returns a safe `AuthUserDto`, never the entity.
   */
  async completeAppwriteLogin(identity: AppwriteVerifiedIdentity): Promise<TokenPair & { user: AuthUserDto }> {
    const appwriteUserId = identity.appwriteUserId;
    this.logger.log(`[START] completeAppwriteLogin appwriteUserId=${appwriteUserId ?? 'missing'}`);

    if (!appwriteUserId) {
      throw new UnauthorizedException('Appwrite identity is missing "appwriteUserId"');
    }

    if (!identity.accountActive || !identity.emailVerified) {
      this.logger.warn(
        `[RESULT] completeAppwriteLogin refused appwriteUserId=${appwriteUserId} accountActive=${identity.accountActive} emailVerified=${identity.emailVerified}`,
      );
      throw new ForbiddenException(SIGN_IN_REFUSED_MESSAGE);
    }

    let user = await this.usersRepository.findOne({ where: { appwriteUserId } });
    let created = false;

    if (user) {
      this.assertActive(user);
      this.logger.log(`[RESULT] Matched existing user from Appwrite login userId=${user.id}`);
    } else {
      ({ user, created } = await this.createAppwriteUser(identity));
      this.assertActive(user);
    }

    if (!created) {
      user = await this.syncExistingAppwriteUser(user, identity);
    }

    await this.ensureRole(user.id, RoleCode.HOLDER);

    let did = await this.didService.findByController(user.id);
    if (!did) {
      did = await this.didService.createDid(user.id);
      this.logger.log(`[RESULT] created DID for holder userId=${user.id} did=${did.did}`);
    }

    const roles = await this.getRoleCodes(user.id);
    const tokens = await this.mintTokens(user, roles, did.did);

    this.logger.log(`[STATE] Appwrite login complete userId=${user.id} roles=${roles.join(',')} did=${did.did}`);

    return { ...tokens, user: toAuthUserDto(user, roles, did.did) };
  }

  /**
   * First Appwrite login for this `appwrite_user_id`. Blocks (409) when the
   * email already belongs to another user. If a concurrent first login wins
   * the insert race (unique violation), re-reads the winner and continues as
   * a normal login instead of surfacing a 500.
   */
  private async createAppwriteUser(identity: AppwriteVerifiedIdentity): Promise<{ user: User; created: boolean }> {
    const appwriteUserId = identity.appwriteUserId;
    const email = normalizeEmail(identity.email);

    if (email) {
      const existingByEmail = await this.usersRepository.findOne({
        where: { email: Raw((alias) => `lower(trim(${alias})) = :email`, { email }) },
      });
      if (existingByEmail) {
        this.logger.warn(
          `[RESULT] completeAppwriteLogin blocked: email already registered to userId=${existingByEmail.id}`,
        );
        throw new ConflictException(EMAIL_TAKEN_MESSAGE);
      }
    }

    try {
      const user = await this.usersRepository.save(
        this.usersRepository.create({
          appwriteUserId,
          googleId: identity.googleId,
          email,
          phone: null,
          displayName: identity.name ?? null,
          emailVerified: identity.emailVerified,
          accountStatus: AccountStatus.ACTIVE,
          lastLoginAt: new Date(),
        }),
      );
      this.logger.log(`[RESULT] Created new user from Appwrite login userId=${user.id}`);
      return { user, created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const winner = await this.usersRepository.findOne({ where: { appwriteUserId } });
      if (winner) {
        this.logger.warn(
          `[RESULT] completeAppwriteLogin concurrent first login, continuing as existing userId=${winner.id}`,
        );
        return { user: winner, created: false };
      }
      // The collision was on email / google_id of a *different* user: the
      // column is unknown here, so answer with the neutral message (409).
      this.logger.warn(
        `[RESULT] completeAppwriteLogin blocked: unique collision on create appwriteUserId=${appwriteUserId}`,
      );
      throw new ConflictException(IDENTITY_CONFLICT_MESSAGE);
    }
  }

  /**
   * Login bookkeeping for an existing user. `google_id` is link-once: set it
   * when empty, accept it when identical, refuse (never overwrite) otherwise.
   * `users.email` is intentionally not touched.
   */
  private async syncExistingAppwriteUser(user: User, identity: AppwriteVerifiedIdentity): Promise<User> {
    if (identity.googleId) {
      if (!user.googleId) {
        user.googleId = identity.googleId;
        this.logger.log(`[STATE] linking Google identity once userId=${user.id}`);
      } else if (user.googleId !== identity.googleId) {
        this.logger.warn(`[RESULT] completeAppwriteLogin refused userId=${user.id} reason=google_id_mismatch`);
        throw new ForbiddenException(SIGN_IN_REFUSED_MESSAGE);
      }
    } else if (user.googleId) {
      this.logger.warn(`[RESULT] completeAppwriteLogin refused userId=${user.id} reason=google_identity_missing`);
      throw new ForbiddenException(SIGN_IN_REFUSED_MESSAGE);
    }

    user.emailVerified = identity.emailVerified;
    user.lastLoginAt = new Date();

    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // google_id already linked to another user (email is never updated here).
      this.logger.warn(`[RESULT] completeAppwriteLogin refused userId=${user.id} reason=google_id_taken`);
      throw new ForbiddenException(SIGN_IN_REFUSED_MESSAGE);
    }
  }

  /**
   * Public self-registration of a citizen with email + password. Creates a
   * `holder` only (never another role, never an organization), with
   * `emailVerified=false` (no SMTP yet), then mints a session exactly like the
   * Google flow so the mobile app can treat both identically.
   * An email already held by any user stays a neutral 409 (no auto-link).
   */
  async register(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<TokenPair & { user: AuthUserDto }> {
    this.logger.log('[START] register');

    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
      throw new ConflictException(REGISTER_CONFLICT_MESSAGE);
    }

    const existing = await this.usersRepository.findOne({
      where: { email: Raw((alias) => `lower(trim(${alias})) = :email`, { email: normalizedEmail }) },
    });
    if (existing) {
      this.logger.warn(`[RESULT] register blocked: email already registered to userId=${existing.id}`);
      throw new ConflictException(REGISTER_CONFLICT_MESSAGE);
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

    let user: User;
    try {
      user = await this.usersRepository.save(
        this.usersRepository.create({
          email: normalizedEmail,
          phone: null,
          passwordHash,
          displayName: displayName?.trim() || null,
          appwriteUserId: null,
          googleId: null,
          emailVerified: false,
          accountStatus: AccountStatus.ACTIVE,
          organizationId: null,
          lastLoginAt: new Date(),
        }),
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Concurrent registration of the same email won the insert race.
      this.logger.warn('[RESULT] register blocked: unique collision on create');
      throw new ConflictException(REGISTER_CONFLICT_MESSAGE);
    }
    this.logger.log(`[ENTITY] register created userId=${user.id}`);

    await this.ensureRole(user.id, RoleCode.HOLDER);

    let did = await this.didService.findByController(user.id);
    if (!did) {
      did = await this.didService.createDid(user.id);
      this.logger.log(`[RESULT] created DID for holder userId=${user.id} did=${did.did}`);
    }

    const roles = await this.getRoleCodes(user.id);
    const tokens = await this.mintTokens(user, roles, did.did);

    this.logger.log(`[STATE] register complete userId=${user.id} roles=${roles.join(',')}`);

    return { ...tokens, user: toAuthUserDto(user, roles, did.did) };
  }

  /**
   * Conventional email+password login: staff accounts (issuer/verifier/admin,
   * seed/admin-created) and citizens created by `register`. Grants no role and
   * no DID: it only reads what the account already has.
   */
  async login(email: string, password: string): Promise<TokenPair & { user: AuthUserDto }> {
    this.logger.log('[START] login');

    const normalizedEmail = normalizeEmail(email);
    const user = normalizedEmail
      ? await this.usersRepository.findOne({
          where: { email: Raw((alias) => `lower(trim(${alias})) = :email`, { email: normalizedEmail }) },
        })
      : null;

    // Always run one bcrypt compare, even without a user, to keep the timing uniform.
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (!user || !user.passwordHash) {
      this.logger.warn('[RESULT] login failed reason=no_such_user_or_no_password');
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!passwordMatches) {
      this.logger.warn(`[RESULT] login failed userId=${user.id} reason=bad_password`);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Same response as a bad password: do not reveal that the account exists
    // but is suspended.
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      this.logger.warn(`[RESULT] login failed userId=${user.id} reason=account_${user.accountStatus}`);
      throw new UnauthorizedException('Invalid email or password');
    }

    user.lastLoginAt = new Date();
    await this.usersRepository.save(user);

    const roles = await this.getRoleCodes(user.id);
    // Read-only, like `refresh`: staff have no personal DID and must not get one here.
    const did = await this.didService.findByController(user.id);
    const tokens = await this.mintTokens(user, roles, did?.did);
    this.logger.log(`[STATE] login success userId=${user.id}`);
    return { ...tokens, user: toAuthUserDto(user, roles, did?.did ?? null) };
  }

  /**
   * Validates the refresh token against the matching `sessions` row and
   * rotates it: the used session is revoked and a fresh pair is minted.
   * The refresh token string is `${sessionId}.${opaqueSecret}` — the id
   * gives O(1) lookup, the secret is what's actually verified via
   * `bcrypt.compare` against `sessions.refresh_token_hash`.
   */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const [sessionId, secret] = this.splitRefreshToken(refreshToken);

    const session = await this.sessionsRepository.findOne({ where: { id: sessionId } });
    if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
      this.logger.warn(`[RESULT] refresh rejected sessionId=${sessionId} reason=missing_revoked_or_expired`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const matches = await bcrypt.compare(secret, session.refreshTokenHash);
    if (!matches) {
      this.logger.warn(`[RESULT] refresh rejected sessionId=${sessionId} reason=hash_mismatch`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Atomic, conditional revoke — closes a TOCTOU race where two concurrent
    // requests both pass the checks above using the same refresh token and
    // both then try to mint a fresh pair from it. The `WHERE revokedAt IS
    // NULL` makes exactly one of them win the actual DB row flip; the loser
    // sees `affected === 0` and is rejected the same as any other invalid
    // refresh token, instead of also succeeding off a session someone else
    // just rotated out.
    const revokeResult = await this.sessionsRepository.update(
      { id: session.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    if (revokeResult.affected !== 1) {
      this.logger.warn(`[RESULT] refresh rejected sessionId=${sessionId} reason=concurrent_reuse`);
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersRepository.findOne({ where: { id: session.userId } });
    if (!user) {
      throw new UnauthorizedException('User no longer exists');
    }

    const roles = await this.getRoleCodes(user.id);
    // Re-attach the holder's DID (if any) so a token rotation doesn't
    // silently drop the `did` claim mid-session. Staff users (no personal
    // DID) naturally get `null` back here — no role branching needed.
    const did = await this.didService.findByController(user.id);
    this.logger.log(`[STATE] refresh rotated userId=${user.id} oldSessionId=${session.id}`);
    return this.mintTokens(user, roles, did?.did);
  }

  async logout(refreshToken: string): Promise<void> {
    const [sessionId] = this.splitRefreshToken(refreshToken);
    const session = await this.sessionsRepository.findOne({ where: { id: sessionId } });

    if (session && !session.revokedAt) {
      session.revokedAt = new Date();
      await this.sessionsRepository.save(session);
      this.logger.log(`[STATE] session revoked sessionId=${session.id}`);
    }
  }

  private async mintTokens(user: User, roles: string[], did?: string): Promise<TokenPair> {
    // Central backstop shared by every login flavour and refresh: a suspended
    // account can never obtain (or rotate into) a new token pair.
    this.assertActive(user);

    const payload: JwtPayload = { sub: user.id, roles, ...(did ? { did } : {}) };
    const accessTtl = this.configService.get<string>('jwt.accessTtl', '15m');
    const refreshTtl = this.configService.get<string>('jwt.refreshTtl', '30d');

    // jsonwebtoken's `expiresIn` only accepts a `number` (seconds) or its
    // branded `ms`-package string literal type, not a plain `string` — so
    // the TTL config string ("15m") is converted to seconds first.
    const accessTokenExpiresInSeconds = Math.floor(parseDurationToMs(accessTtl) / 1000);
    const accessToken = await this.jwtService.signAsync(payload, { expiresIn: accessTokenExpiresInSeconds });

    const refreshSecret = crypto.randomBytes(48).toString('hex');
    const refreshTokenHash = await bcrypt.hash(refreshSecret, BCRYPT_SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + parseDurationToMs(refreshTtl));

    const session = await this.sessionsRepository.save(
      this.sessionsRepository.create({ userId: user.id, refreshTokenHash, expiresAt }),
    );

    const refreshToken = `${session.id}.${refreshSecret}`;

    this.logger.log(`[RESULT] minted tokens userId=${user.id} sessionId=${session.id}`);

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTokenExpiresInSeconds,
    };
  }

  private async ensureRole(userId: string, code: RoleCode): Promise<void> {
    const role = await this.rolesRepository.findOne({ where: { code } });
    if (!role) {
      throw new Error(
        `[AuthService] Role "${code}" is not seeded — run the roles seed before allowing logins`,
      );
    }

    const existing = await this.userRolesRepository.findOne({ where: { userId, roleId: role.id } });
    if (!existing) {
      try {
        await this.userRolesRepository.save(this.userRolesRepository.create({ userId, roleId: role.id }));
      } catch (error) {
        // Concurrent first login already granted the role (UQ user_id+role_id).
        if (!isUniqueViolation(error)) throw error;
        this.logger.warn(`[RESULT] ensureRole concurrent grant tolerated userId=${userId} role=${code}`);
      }
    }
  }

  private assertActive(user: User): void {
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      this.logger.warn(`[RESULT] sign-in refused userId=${user.id} reason=account_${user.accountStatus}`);
      throw new ForbiddenException(SIGN_IN_REFUSED_MESSAGE);
    }
  }

  private async getRoleCodes(userId: string): Promise<string[]> {
    const userRoles = await this.userRolesRepository.find({ where: { userId }, relations: ['role'] });
    return userRoles.map((userRole) => userRole.role.code);
  }

  private splitRefreshToken(refreshToken: string): [string, string] {
    const separatorIndex = refreshToken.indexOf('.');
    if (separatorIndex <= 0 || separatorIndex === refreshToken.length - 1) {
      throw new UnauthorizedException('Malformed refresh token');
    }
    return [refreshToken.slice(0, separatorIndex), refreshToken.slice(separatorIndex + 1)];
  }
}

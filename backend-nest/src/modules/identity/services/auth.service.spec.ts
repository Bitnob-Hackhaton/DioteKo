import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { FindOperator, QueryFailedError } from 'typeorm';
import { AccountStatus, User } from '../entities/user.entity';
import { AppwriteVerifiedIdentity } from './appwrite.service';
import { AuthService } from './auth.service';

const HASH_SECRET = 'bcrypt-hash-must-not-leak';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'jane@example.com',
    phone: '+221000000',
    passwordHash: HASH_SECRET,
    displayName: 'Jane',
    appwriteUserId: 'aw-1',
    googleId: 'google-sub-1',
    emailVerified: true,
    accountStatus: AccountStatus.ACTIVE,
    lastLoginAt: null,
    organizationId: 'org-secret',
    ...overrides,
  } as User;
}

function makeIdentity(overrides: Partial<AppwriteVerifiedIdentity> = {}): AppwriteVerifiedIdentity {
  return {
    appwriteUserId: 'aw-1',
    email: 'jane@example.com',
    name: 'Jane',
    emailVerified: true,
    accountActive: true,
    googleId: 'google-sub-1',
    ...overrides,
  };
}

function uniqueViolation(): QueryFailedError {
  // detail would normally carry the conflicting email — must never be surfaced.
  return new QueryFailedError('INSERT ...', [], { code: '23505', detail: 'Key (email)=(jane@example.com) exists' } as never);
}

describe('AuthService', () => {
  let users: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let roles: { findOne: jest.Mock };
  let userRoles: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; find: jest.Mock };
  let sessions: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; update: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  let didService: { findByController: jest.Mock; createDid: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    users = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: Partial<User>) => ({ ...data })),
      save: jest.fn(async (data: Partial<User>) => ({ id: 'user-new', ...data })),
    };
    roles = { findOne: jest.fn().mockResolvedValue({ id: 'role-holder', code: 'holder' }) };
    userRoles = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: unknown) => data),
      find: jest.fn().mockResolvedValue([{ role: { code: 'holder' } }]),
    };
    sessions = {
      findOne: jest.fn(),
      create: jest.fn((data: unknown) => data),
      save: jest.fn(async (data: object) => ({ id: 'session-1', ...data })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.access.token') };
    didService = {
      findByController: jest.fn().mockResolvedValue(null),
      createDid: jest.fn().mockResolvedValue({ did: 'did:dioteko:abc' }),
    };
    const config = { get: jest.fn((_key: string, fallback?: string) => fallback) };

    service = new AuthService(
      users as never,
      roles as never,
      userRoles as never,
      sessions as never,
      jwt as never,
      config as never,
      didService as never,
    );
  });

  /** `findOne` router: by appwriteUserId vs by (Raw) email. */
  function mockLookups(opts: { byAppwriteId?: User | null; byEmail?: User | null }) {
    users.findOne.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      'appwriteUserId' in where ? (opts.byAppwriteId ?? null) : (opts.byEmail ?? null),
    );
  }

  describe('completeAppwriteLogin - new user', () => {
    it('creates the user with Google fields, lowercased email and returns a safe DTO', async () => {
      const result = await service.completeAppwriteLogin(makeIdentity({ email: '  Jane@Example.COM ' }));

      const created = users.create.mock.calls[0][0];
      expect(created).toMatchObject({
        appwriteUserId: 'aw-1',
        googleId: 'google-sub-1',
        email: 'jane@example.com',
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
      });
      expect(created.lastLoginAt).toBeInstanceOf(Date);

      expect(result.accessToken).toBe('signed.access.token');
      expect(result.refreshToken).toMatch(/^session-1\./);
      expect(result.user).toEqual({
        id: 'user-new',
        email: 'jane@example.com',
        displayName: 'Jane',
        emailVerified: true,
        accountStatus: 'active',
        googleLinked: true,
        roles: ['holder'],
        did: 'did:dioteko:abc',
      });
      expect(didService.createDid).toHaveBeenCalledWith('user-new');
    });

    it('response never contains passwordHash / appwriteUserId / googleId', async () => {
      mockLookups({ byAppwriteId: makeUser({ organizationId: 'org-secret' }) });

      const result = await service.completeAppwriteLogin(makeIdentity());
      const serialized = JSON.stringify(result);

      for (const forbidden of ['passwordHash', HASH_SECRET, 'appwriteUserId']) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(serialized).not.toContain('google-sub-1');
      expect(serialized).not.toContain('org-secret');
      expect(serialized).not.toContain('+221000000');
      expect(Object.keys(result.user).sort()).toEqual(
        ['accountStatus', 'did', 'displayName', 'email', 'emailVerified', 'googleLinked', 'id', 'roles'].sort(),
      );
    });

    it('409 when the email already belongs to another user (case-insensitive, trimmed lookup)', async () => {
      mockLookups({ byAppwriteId: null, byEmail: makeUser({ id: 'other-user', appwriteUserId: 'aw-other' }) });

      const error = await service
        .completeAppwriteLogin(makeIdentity({ email: '  JANE@Example.com ' }))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      // Generic message: no hint about which method the other account uses, nor its id or email.
      expect((error as ConflictException).message).toBe(
        'An account with this email already exists. Please sign in using your original method.',
      );
      expect(JSON.stringify((error as ConflictException).getResponse())).not.toContain('other-user');

      // Second lookup is the email one: it must use a Raw lower(trim()) operator on the normalized value.
      const emailWhere: unknown = users.findOne.mock.calls[1][0].where.email;
      expect(emailWhere).toBeInstanceOf(FindOperator);
      const operator = emailWhere as FindOperator<string>;
      expect(operator.type).toBe('raw');
      expect(operator.objectLiteralParameters).toEqual({ email: 'jane@example.com' });
      expect(operator.getSql?.('"u"."email"')).toBe('lower(trim("u"."email")) = :email');
      expect(users.save).not.toHaveBeenCalled();
      expect(userRoles.save).not.toHaveBeenCalled();
      expect(didService.createDid).not.toHaveBeenCalled();
    });

    it('concurrent first login: unique violation on insert re-reads the winner and logs in normally', async () => {
      const winner = makeUser({ id: 'winner-id' });
      let appwriteLookups = 0;
      users.findOne.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
        if ('appwriteUserId' in where) {
          appwriteLookups += 1;
          return appwriteLookups === 1 ? null : winner;
        }
        return null;
      });
      users.save.mockRejectedValueOnce(uniqueViolation());

      const result = await service.completeAppwriteLogin(makeIdentity());

      expect(result.user.id).toBe('winner-id');
      expect(result.accessToken).toBe('signed.access.token');
    });

    it('new-user 23505 with no winner (email/google_id of someone else) -> neutral 409, no PII / column names, nothing minted', async () => {
      users.save.mockRejectedValueOnce(uniqueViolation());

      const error = await service.completeAppwriteLogin(makeIdentity()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      const serialized = JSON.stringify((error as ConflictException).getResponse());
      expect(serialized).not.toContain('jane@example.com');
      // The colliding column is unknown (email vs google_id): never claim either.
      expect(serialized.toLowerCase()).not.toContain('email');
      expect(serialized.toLowerCase()).not.toContain('google');
      expect(userRoles.save).not.toHaveBeenCalled();
      expect(didService.createDid).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
      expect(sessions.save).not.toHaveBeenCalled();
    });

    it('non-unique DB errors are not swallowed', async () => {
      users.save.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.completeAppwriteLogin(makeIdentity())).rejects.toThrow('connection lost');
    });

    it('ensureRole tolerates a concurrent grant (23505)', async () => {
      userRoles.save.mockRejectedValueOnce(uniqueViolation());
      const result = await service.completeAppwriteLogin(makeIdentity());
      expect(result.user.roles).toEqual(['holder']);
    });
  });

  describe('completeAppwriteLogin - refusals before any side effect', () => {
    it('refuses an unverified Appwrite email', async () => {
      await expect(
        service.completeAppwriteLogin(makeIdentity({ emailVerified: false })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(users.findOne).not.toHaveBeenCalled();
      expect(users.save).not.toHaveBeenCalled();
      expect(didService.createDid).not.toHaveBeenCalled();
    });

    it('refuses an inactive (blocked) Appwrite account', async () => {
      await expect(
        service.completeAppwriteLogin(makeIdentity({ accountActive: false })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(users.findOne).not.toHaveBeenCalled();
      expect(users.save).not.toHaveBeenCalled();
    });

    it('refuses a locally suspended user with no role / DID / session created', async () => {
      mockLookups({ byAppwriteId: makeUser({ accountStatus: AccountStatus.SUSPENDED }) });

      await expect(service.completeAppwriteLogin(makeIdentity())).rejects.toBeInstanceOf(ForbiddenException);

      expect(users.save).not.toHaveBeenCalled();
      expect(userRoles.save).not.toHaveBeenCalled();
      expect(didService.createDid).not.toHaveBeenCalled();
      expect(sessions.save).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('completeAppwriteLogin - google_id link-once', () => {
    it('refuses a different Google identity and never overwrites google_id / saves', async () => {
      const existing = makeUser({ googleId: 'google-old' });
      mockLookups({ byAppwriteId: existing });

      await expect(
        service.completeAppwriteLogin(makeIdentity({ googleId: 'google-new' })),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(existing.googleId).toBe('google-old');
      expect(users.save).not.toHaveBeenCalled();
      expect(sessions.save).not.toHaveBeenCalled();
    });

    it('refuses when the stored user has a Google id but the identity has none', async () => {
      const existing = makeUser({ googleId: 'google-old' });
      mockLookups({ byAppwriteId: existing });

      await expect(
        service.completeAppwriteLogin(makeIdentity({ googleId: null })),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(existing.googleId).toBe('google-old');
      expect(users.save).not.toHaveBeenCalled();
    });

    it('links google_id once when the stored value is null, updates lastLoginAt, never touches email', async () => {
      const existing = makeUser({ googleId: null, email: 'kept@example.com', emailVerified: false });
      mockLookups({ byAppwriteId: existing });

      const result = await service.completeAppwriteLogin(
        makeIdentity({ googleId: 'google-new', email: 'changed-upstream@example.com' }),
      );

      const saved = users.save.mock.calls[0][0] as User;
      expect(saved.googleId).toBe('google-new');
      expect(saved.emailVerified).toBe(true);
      expect(saved.lastLoginAt).toBeInstanceOf(Date);
      expect(saved.email).toBe('kept@example.com');
      expect(result.user.email).toBe('kept@example.com');
      expect(result.user.googleLinked).toBe(true);
    });

    it('google_id_taken: existing-user sync save() rejecting with 23505 -> 403, no tokens / role / DID, no email in message', async () => {
      const existing = makeUser({ googleId: null });
      mockLookups({ byAppwriteId: existing });
      users.save.mockRejectedValueOnce(uniqueViolation());

      const error = await service
        .completeAppwriteLogin(makeIdentity({ googleId: 'google-taken' }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      const serialized = JSON.stringify((error as ForbiddenException).getResponse());
      expect(serialized).not.toContain('jane@example.com');
      expect(serialized.toLowerCase()).not.toContain('email');
      expect(jwt.signAsync).not.toHaveBeenCalled();
      expect(sessions.save).not.toHaveBeenCalled();
      expect(userRoles.save).not.toHaveBeenCalled();
      expect(didService.createDid).not.toHaveBeenCalled();
    });

    it('existing-user sync: non-unique save errors are not swallowed', async () => {
      mockLookups({ byAppwriteId: makeUser({ googleId: null }) });
      users.save.mockRejectedValueOnce(new Error('connection lost'));
      await expect(service.completeAppwriteLogin(makeIdentity())).rejects.toThrow('connection lost');
    });

    it('same Google id is accepted and lastLoginAt refreshed', async () => {
      const existing = makeUser();
      mockLookups({ byAppwriteId: existing });

      await service.completeAppwriteLogin(makeIdentity());

      expect(existing.lastLoginAt).toBeInstanceOf(Date);
      expect(existing.googleId).toBe('google-sub-1');
    });
  });

  describe('central status backstop', () => {
    it('refresh() of a suspended user: session is rotated out but no token, role or DID is produced', async () => {
      const secret = 'opaque-secret';
      sessions.findOne.mockResolvedValue({
        id: 'session-9',
        userId: 'user-1',
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        refreshTokenHash: await bcrypt.hash(secret, 4),
      });
      users.findOne.mockResolvedValue(makeUser({ accountStatus: AccountStatus.SUSPENDED }));

      await expect(service.refresh(`session-9.${secret}`)).rejects.toBeInstanceOf(ForbiddenException);

      expect(sessions.update).toHaveBeenCalledTimes(1); // old session revoked first
      expect(jwt.signAsync).not.toHaveBeenCalled();
      expect(sessions.save).not.toHaveBeenCalled();
      expect(userRoles.save).not.toHaveBeenCalled();
      expect(didService.createDid).not.toHaveBeenCalled();
    });

    it('login() of a suspended user returns the same generic error as a bad password', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      users.findOne.mockResolvedValue(makeUser({ passwordHash, accountStatus: AccountStatus.SUSPENDED }));

      const error = await service.login('jane@example.com', 'correct-password').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe('Invalid email or password');
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('login() of an active user still mints tokens', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      users.findOne.mockResolvedValue(makeUser({ passwordHash }));

      const tokens = await service.login('jane@example.com', 'correct-password');

      expect(tokens.accessToken).toBe('signed.access.token');
    });
  });
});

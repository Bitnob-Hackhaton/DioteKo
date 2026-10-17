import { UnauthorizedException } from '@nestjs/common';
import { AppwriteService } from './appwrite.service';

const mockGet = jest.fn();
const mockListIdentities = jest.fn();

jest.mock('node-appwrite', () => {
  class AppwriteException extends Error {
    constructor(
      message: string,
      public code = 0,
      public type = '',
    ) {
      super(message);
    }
  }
  class Client {
    setEndpoint() {
      return this;
    }
    setProject() {
      return this;
    }
    setJWT() {
      return this;
    }
  }
  class Account {
    get = (...args: unknown[]) => mockGet(...args);
    listIdentities = (...args: unknown[]) => mockListIdentities(...args);
  }
  return { Account, Client, AppwriteException, Query: { equal: (a: string, b: string) => `equal(${a},${b})` } };
});

function makeService(requireGoogleIdentity: boolean): AppwriteService {
  const config = {
    get: jest.fn((key: string, fallback?: unknown) =>
      key === 'appwrite.requireGoogleIdentity' ? requireGoogleIdentity : fallback,
    ),
  };
  return new AppwriteService(config as never);
}

const appwriteUser = {
  $id: 'aw-1',
  email: 'jane@example.com',
  name: 'Jane',
  emailVerification: true,
  status: true,
};

describe('AppwriteService.verifyClientJwt', () => {
  beforeEach(() => {
    mockGet.mockReset().mockResolvedValue(appwriteUser);
    mockListIdentities.mockReset();
  });

  it('returns verification flags and the Google sub, and drops provider tokens', async () => {
    mockListIdentities.mockResolvedValue({
      total: 1,
      identities: [
        {
          provider: 'google',
          providerUid: 'google-sub-1',
          providerEmail: 'jane@example.com',
          providerAccessToken: 'ya29.secret-access',
          providerRefreshToken: 'secret-refresh',
        },
      ],
    });

    const identity = await makeService(true).verifyClientJwt('jwt');

    expect(identity).toEqual({
      appwriteUserId: 'aw-1',
      email: 'jane@example.com',
      name: 'Jane',
      emailVerified: true,
      accountActive: true,
      googleId: 'google-sub-1',
    });
    expect(JSON.stringify(identity)).not.toContain('secret');
    // object-param overload, not the deprecated positional one
    expect(mockListIdentities).toHaveBeenCalledWith({ queries: ['equal(provider,google)'] });
  });

  it('fails closed (401) when a Google identity is required and none is linked', async () => {
    mockListIdentities.mockResolvedValue({ total: 0, identities: [] });
    await expect(makeService(true).verifyClientJwt('jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed (401) when listIdentities errors and a Google identity is required', async () => {
    mockListIdentities.mockRejectedValue(new Error('boom'));
    await expect(makeService(true).verifyClientJwt('jwt')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('defaults to requiring a Google identity when nothing is configured (ConfigService returns the fallback)', async () => {
    mockListIdentities.mockResolvedValue({ total: 0, identities: [] });
    const unconfigured = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };
    const service = new AppwriteService(unconfigured as never);

    await expect(service.verifyClientJwt('jwt')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(unconfigured.get).toHaveBeenCalledWith('appwrite.requireGoogleIdentity', true);
  });

  it('allows a missing Google identity (googleId null) only when the requirement is relaxed', async () => {
    mockListIdentities.mockResolvedValue({ total: 0, identities: [] });
    const identity = await makeService(false).verifyClientJwt('jwt');
    expect(identity.googleId).toBeNull();
    expect(identity.emailVerified).toBe(true);
  });

  it('reads status fields defensively (missing fields => not verified / not active)', async () => {
    mockGet.mockResolvedValue({ $id: 'aw-2', email: '', name: '' });
    mockListIdentities.mockResolvedValue({ identities: [] });
    const identity = await makeService(false).verifyClientJwt('jwt');
    expect(identity).toMatchObject({ emailVerified: false, accountActive: false, email: null, name: null });
  });

  it('401 when account.get() rejects the JWT', async () => {
    mockGet.mockRejectedValue(new Error('401'));
    await expect(makeService(true).verifyClientJwt('jwt')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mockListIdentities).not.toHaveBeenCalled();
  });
});

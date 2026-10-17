/**
 * Jest config for backend-nest.
 *
 * Scoped to src spec files (ts-jest, no Nest test harness required for the
 * pure-function / stubbed-DI specs that live here). The Bitnob HMAC signing
 * path (bitnob-hmac.util.ts + bitnob-http-client.service.ts) is
 * security-sensitive and must keep automated coverage — see its spec files.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
};

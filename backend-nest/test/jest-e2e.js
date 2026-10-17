/**
 * E2E Jest config (separate from the src-only unit `jest.config.js`).
 *
 * `transformIgnorePatterns` whitelists `jose` for transformation: jose v6 is
 * ESM-only (`dist/webapi/index.js`), and this jest's CommonJS runtime can't
 * `require()` it. The AppModule boot graph pulls jose in via did-vc. If a
 * SECOND ESM-only dependency ever enters that graph and you see
 * "SyntaxError: Unexpected token 'export'" from node_modules, add it here:
 *   transformIgnorePatterns: ['/node_modules/(?!(jose|the-new-dep)/)']
 * The `.js` rule below transpiles those whitelisted packages with ts-jest.
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testRegex: '.e2e-spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 30000,
  transform: {
    '^.+\\.ts$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { isolatedModules: true, tsconfig: { allowJs: true, checkJs: false } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!jose/)'],
};

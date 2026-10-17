import { parseCorsOrigins } from './cors-origins';

describe('parseCorsOrigins (fail-closed)', () => {
  it('allows the local console by default outside production', () => {
    for (const env of ['development', 'test']) {
      expect(parseCorsOrigins(undefined, env)).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
      expect(parseCorsOrigins('  ', env)).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    }
  });

  it('allows NO browser origin by default in production', () => {
    expect(parseCorsOrigins(undefined, 'production')).toEqual([]);
    expect(parseCorsOrigins('', 'production')).toEqual([]);
  });

  it('uses the configured list, trimmed and de-duplicated', () => {
    expect(parseCorsOrigins(' https://console.example.org , http://localhost:3000,https://console.example.org', 'production')).toEqual([
      'https://console.example.org',
      'http://localhost:3000',
    ]);
  });

  it.each(['*', 'https://*.example.org', 'https://console.example.org/', 'https://console.example.org/app', 'console.example.org', 'ftp://x', 'null'])(
    'drops the unsafe or malformed entry %p instead of widening access',
    (entry) => {
      expect(parseCorsOrigins(entry, 'production')).toEqual([]);
      expect(parseCorsOrigins(`${entry},https://ok.example.org`, 'production')).toEqual(['https://ok.example.org']);
    },
  );
});

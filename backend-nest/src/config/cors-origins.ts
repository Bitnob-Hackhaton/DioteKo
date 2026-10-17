/** Origins the web console (`frontweb`, Vite/TanStack on port 3000) is served from during development. */
const DEV_DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Browser origins allowed to call the API (CORS). `raw` is the `CORS_ORIGINS` env var: a comma-separated list of
 * exact origins (`https://console.example.org`). Fail-closed:
 *  - only `http(s)://host[:port]` entries are kept, with no path, no wildcard (`*`) and no trailing slash — anything
 *    else is dropped, so a typo can never open the API to every site;
 *  - when nothing is configured, development and test allow the local console; production allows NO browser origin
 *    (the mobile app and server-to-server calls are not subject to CORS).
 */
export function parseCorsOrigins(raw: string | undefined, nodeEnv: string): string[] {
  const configured = (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => /^https?:\/\/[^\s/*]+$/i.test(entry));
  if (configured.length > 0) {
    return [...new Set(configured)];
  }
  return nodeEnv === 'production' ? [] : DEV_DEFAULT_ORIGINS;
}

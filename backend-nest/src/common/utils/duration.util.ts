/**
 * Minimal duration-string parser for JWT/session TTL config values such as
 * "15m", "30d", "1h" (see `configuration.ts`'s `jwt.accessTtl`/`refreshTtl`).
 * Not a full "ms"-library port — just enough for the s/m/h/d formats this
 * project actually uses, needed wherever a TTL string has to become a
 * concrete `Date`/millisecond value (e.g. `sessions.expires_at`).
 */
const UNIT_TO_MS: Record<string, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

export function parseDurationToMs(duration: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(duration.trim());

  if (!match) {
    throw new Error(`[duration.util] Unable to parse duration "${duration}"`);
  }

  const value = parseInt(match[1], 10);
  const unit = (match[2] || 'ms').toLowerCase();

  if (unit === 'ms') {
    return value;
  }

  return value * UNIT_TO_MS[unit];
}

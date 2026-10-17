/**
 * Deterministically stringify a value with object keys sorted recursively
 * (arrays keep their order — order is semantically meaningful there).
 *
 * Needed anywhere a signature or hash must stay stable regardless of the
 * key insertion order a caller happened to use — currently VC content
 * hashing in modules/did-vc (credential issuance, credential verification,
 * and the presentations controller).
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (isPlainObject(value)) {
    const sortedEntries = Object.keys(value)
      .sort()
      .map((key) => [key, sortKeysDeep(value[key])] as const);
    return Object.fromEntries(sortedEntries);
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !(value instanceof Date) && !(value instanceof Buffer);
}

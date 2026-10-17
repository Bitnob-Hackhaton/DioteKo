/**
 * Bitnob wraps every successful response in a fixed envelope shape:
 * `{ success: boolean, message: string, data: <object>, timestamp: string }`
 * (newer endpoints additionally carry `data.metadata?.request_id`).
 *
 * `BitnobHttpClientService.get()/post()` return axios's `response.data`, i.e.
 * that whole envelope — so services call
 * `unwrapBitnob<T>(await this.http.get(...))` to reach the actual payload.
 *
 * Behaviour:
 *  - envelope shape + `success: true`  -> returns `data`;
 *  - envelope shape + `success: false` -> throws `Error(message)` (a 2xx body
 *    that still reports failure — do not hand callers a `null` `data`);
 *  - anything else (e.g. `GET /api/transactions/:id`, which appears to return
 *    the resource object directly with no envelope) -> returned unchanged.
 *
 * Pure function apart from the thrown error on `success: false`.
 */
export function unwrapBitnob<T>(response: unknown): T {
  if (
    response !== null &&
    typeof response === 'object' &&
    'success' in response &&
    'data' in response &&
    'timestamp' in response
  ) {
    const envelope = response as { success: unknown; message?: unknown; data: T };
    if (envelope.success === false) {
      const message = typeof envelope.message === 'string' && envelope.message.length > 0
        ? envelope.message
        : 'Bitnob returned success: false';
      throw new Error(message);
    }
    return envelope.data;
  }
  return response as T;
}

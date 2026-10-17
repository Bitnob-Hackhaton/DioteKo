import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { buildAuthHeaders } from './bitnob-hmac.util';

/** Upper bound for any single Bitnob call. */
export const BITNOB_REQUEST_TIMEOUT_MS = 15000;

/**
 * Thrown by `BitnobHttpClientService` in place of a raw axios error, so
 * callers (services, controllers, the global exception filter) never have
 * to know axios's error shape. `status`/`responseBody` are preserved when
 * Bitnob returned an HTTP response (even an error one); both are `null` for
 * network-level failures (DNS, timeout, connection refused).
 */
export class BitnobApiError extends Error {
  readonly status: number | null;
  readonly responseBody: unknown;

  constructor(message: string, status: number | null, responseBody: unknown) {
    super(message);
    this.name = 'BitnobApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Thin axios wrapper for the Bitnob API. Auth headers are computed PER
 * REQUEST via `buildAuthHeaders` — deliberately NOT wired up as a global
 * axios request interceptor.
 *
 * `request()` serializes the body to a `payload` string ONCE, then hands
 * that same string to both `buildAuthHeaders` (as the signed payload) and
 * axios (as the POST body). The `transformRequest: [(data) => data]`
 * identity fn stops axios from re-serializing / trimming / reordering the
 * string on its way to the wire, so the bytes signed are byte-for-byte the
 * bytes sent — the only thing an HMAC-signed API will accept. The object is
 * never passed to `axios.post` directly.
 *
 * Note: Bitnob's signature does NOT cover the query string, so nothing
 * security-relevant may be carried in `params` — those values are protected
 * only by TLS in transit.
 */
@Injectable()
export class BitnobHttpClientService {
  private readonly logger = new Logger(BitnobHttpClientService.name);
  private readonly http: AxiosInstance;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor(private readonly configService: ConfigService) {
    this.clientId = this.configService.get<string>('bitnob.clientId', '');
    this.clientSecret = this.configService.get<string>('bitnob.clientSecret', '');
    this.http = axios.create({
      baseURL: this.configService.get<string>('bitnob.baseUrl', ''),
      // A hung Bitnob must not stall webhook handling or status reads (both await a Bitnob call).
      timeout: BITNOB_REQUEST_TIMEOUT_MS,
    });
  }

  async get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    return this.request<T>('get', path, undefined, params);
  }

  async post<T>(path: string, body?: object): Promise<T> {
    return this.request<T>('post', path, body);
  }

  private async request<T>(
    method: 'get' | 'post',
    path: string,
    body?: object,
    params?: Record<string, string | number>,
  ): Promise<T> {
    // Fail fast with an actionable message rather than letting Bitnob bounce
    // an empty-credential request back as an opaque 401.
    if (!this.clientId || !this.clientSecret) {
      this.logger.error(
        `[RESULT] Bitnob ${method.toUpperCase()} ${path} aborted: credentials not configured`,
      );
      throw new BitnobApiError(
        'Bitnob credentials not configured (BITNOB_CLIENT_ID / BITNOB_CLIENT_SECRET)',
        null,
        null,
      );
    }

    // Serialized ONCE and reused for both the signature and the actual wire
    // send below. A GET has no body (signed as ''); a POST signs and sends
    // the exact same `payload` string — never the object — so axios can't
    // re-serialize it into something that no longer matches the signature.
    const payload = method === 'get' ? '' : JSON.stringify(body ?? {});
    const headers = buildAuthHeaders(this.clientId, this.clientSecret, payload);

    this.logger.log(`[CALL] Bitnob ${method.toUpperCase()} ${path}`);
    try {
      const response =
        method === 'get'
          ? await this.http.get<T>(path, { headers, params })
          : await this.http.post<T>(path, payload, { headers, transformRequest: [(data) => data] });

      this.logger.log(`[RESULT] Bitnob ${method.toUpperCase()} ${path} succeeded status=${response.status}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? null;
        const responseBody = error.response?.data ?? null;
        this.logger.error(
          `[RESULT] Bitnob ${method.toUpperCase()} ${path} failed status=${status ?? 'n/a'} detail=${this.summarizeBitnobError(responseBody, error.message)}`,
        );
        // The BitnobApiError message never interpolates the body — Bitnob's
        // RFC 7807 `detail` can echo a submitted account number. Callers that
        // need to branch on the error get `status` + the raw `responseBody`,
        // and are responsible for their own scrubbing before persisting/logging.
        throw new BitnobApiError(`Bitnob API request failed: ${error.message}`, status, responseBody);
      }

      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[RESULT] Bitnob ${method.toUpperCase()} ${path} failed detail=${message}`);
      throw new BitnobApiError(`Bitnob API request failed: ${message}`, null, null);
    }
  }

  /**
   * PII-safe one-liner for the `[RESULT] ... failed` log. Bitnob error
   * bodies are RFC 7807 (`type`/`title`/`status`/`detail`/`code`/
   * `correlation_id`/`request_id`/`extensions`), and `detail` / `message`
   * frequently echo the offending input (e.g. the beneficiary account
   * number). We log ONLY the non-sensitive discriminators (`code`/
   * `statusCode`/`title`/`type`) — deliberately NOT `message`/`error`/
   * `detail` — consistent with `summarizePayoutError`. The operator
   * correlates the rest via Bitnob's dashboard using `code`/`title`. When the
   * body isn't an object, fall back to the axios error message (never the
   * body).
   */
  private summarizeBitnobError(body: unknown, fallbackMessage: string): string {
    if (body !== null && typeof body === 'object') {
      const source = body as Record<string, unknown>;
      const picked: Record<string, unknown> = {};
      for (const key of ['code', 'statusCode', 'title', 'type']) {
        if (source[key] !== undefined) {
          picked[key] = source[key];
        }
      }
      return JSON.stringify(picked);
    }
    return fallbackMessage;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { KycAssessment, parseAssessment } from '../kyc-assessment.util';
import { KycAutoAudit, parseAutoAudit } from '../kyc-auto-audit.util';

/** Upper bound for a status read or a session initialisation. */
export const IDSWYFT_REQUEST_TIMEOUT_MS = 45000;

/**
 * Upper bound for a photo upload: Idswyft answers only once the photo is analysed (several OCR passes, tamper and face
 * checks). A full-resolution phone photo took 48.6 s on 2026-10-16, past the old 45 s limit that every call shared.
 * Must stay below the app's own timeout for this route (`PHOTO_TIMEOUT_MS` in frontmobile/services/kyc.ts).
 */
export const IDSWYFT_UPLOAD_TIMEOUT_MS = 150000;

/** `http`: Idswyft answered with an error status; `timeout`: no answer in time; `network`: no connection at all. */
export type IdswyftErrorKind = 'http' | 'timeout' | 'network';

/** Upload steps of the v2 verification pipeline, with the multipart field Idswyft expects for each. */
export const IDSWYFT_UPLOAD_STEPS = {
  front: { path: 'front-document', field: 'document' },
  back: { path: 'back-document', field: 'document' },
  selfie: { path: 'live-capture', field: 'selfie' },
} as const;
export type IdswyftUploadStep = keyof typeof IDSWYFT_UPLOAD_STEPS;

/**
 * Thrown in place of a raw axios error. `status` is the HTTP status Idswyft answered with (`null` for network
 * failures). The message and `code` never carry Idswyft's response body: it can echo what was read from a
 * document. Only `providerCode` (Idswyft's own error code, e.g. `VALIDATION_ERROR`) is kept.
 */
export class IdswyftApiError extends Error {
  readonly status: number | null;
  readonly providerCode: string | null;
  readonly kind: IdswyftErrorKind;
  /** Node/axios error code of a failure with no HTTP answer (`ECONNABORTED`, `ECONNREFUSED`, `ENOTFOUND`…). */
  readonly networkCode: string | null;

  constructor(
    message: string,
    status: number | null,
    providerCode: string | null,
    kind?: IdswyftErrorKind,
    networkCode: string | null = null,
  ) {
    super(message);
    this.name = 'IdswyftApiError';
    this.status = status;
    this.providerCode = providerCode;
    this.kind = kind ?? (status === null ? 'network' : 'http');
    this.networkCode = networkCode;
  }
}

/**
 * What we keep of `GET /api/v2/verify/:id/status`. The scalar fields are safe to log. `assessment` carries what the
 * automatic check READ (`ocr_data`: personal data) and how it scored: it goes to the encrypted vault only, never to a
 * log, a holder-facing view or a webhook row. `barcode_data` is still dropped.
 */
export interface IdswyftStatusView {
  /** The `verification_id` echoed by the provider; the caller checks it is the one it asked about. */
  verificationId: string | null;
  /** Session step, e.g. `AWAITING_FRONT`, `COMPLETE`, `HARD_REJECTED`. */
  status: string | null;
  /** `verified` | `failed` | `manual_review`, `null` while in progress. */
  finalResult: string | null;
  /** Short provider reason (code or sentence) when failed / sent to review; `null` otherwise. */
  reason: string | null;
  retryAvailable: boolean;
  /** OCR fields as read, confidences, scores and the stable rejection code; `null` when the answer carries none of it. PII. */
  assessment: KycAssessment | null;
  /** Scores, thresholds and flags only (no OCR text, no name): what is kept for a dossier the provider verifies by itself. */
  autoAudit?: KycAutoAudit | null;
}

/**
 * Thin axios wrapper for the self-hosted Idswyft API (`X-API-Key` auth). Logs carry the verification id, the
 * path and the status only — never a body, a file name or a document field.
 */
@Injectable()
export class IdswyftHttpClientService {
  private readonly logger = new Logger(IdswyftHttpClientService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('kyc.idswyftApiKey', '');
    this.http = axios.create({
      baseURL: this.configService.get<string>('kyc.idswyftBaseUrl', ''),
      timeout: IDSWYFT_REQUEST_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
      // Any non-2xx answer becomes an IdswyftApiError (status + provider code only, never the body).
      validateStatus: (status) => status >= 200 && status < 300,
    });
  }

  /** Opens a verification session bound to our user id (Idswyft requires a UUID). Returns its id. */
  async initialize(params: { userId: string; documentType: string; issuingCountry?: string }): Promise<string> {
    const body = {
      user_id: params.userId,
      document_type: params.documentType,
      ...(params.issuingCountry ? { issuing_country: params.issuingCountry } : {}),
    };
    const data = await this.request<{ verification_id?: unknown }>('post', '/api/v2/verify/initialize', body);
    if (typeof data?.verification_id !== 'string' || data.verification_id.length === 0) {
      this.logger.error('[RESULT] Idswyft initialize returned no verification_id');
      throw new IdswyftApiError('Idswyft initialize returned no verification_id', null, null);
    }
    return data.verification_id;
  }

  /** Streams one photo (kept in memory by the caller) to the given step. The buffer is never written anywhere. */
  async upload(
    verificationId: string,
    step: IdswyftUploadStep,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<void> {
    const { path, field } = IDSWYFT_UPLOAD_STEPS[step];
    const form = new FormData();
    form.append(field, new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), `${step}.${file.mimetype === 'image/png' ? 'png' : 'jpg'}`);
    // Deliberately NO `document_type` / `country_code` form fields (tested 2026-10-16 on a CEDEAO ID card): with
    // `document_type=national_id` the same photo is rejected (FRONT_OCR_FAILED) and takes as long (~38 s), whereas the
    // default "auto" classification reads it (national_id, confidence 0.85) and passes gate 1.
    await this.request('post', `/api/v2/verify/${encodeURIComponent(verificationId)}/${path}`, form, IDSWYFT_UPLOAD_TIMEOUT_MS);
  }

  async getStatus(verificationId: string): Promise<IdswyftStatusView> {
    const data = await this.request<Record<string, unknown>>(
      'get',
      `/api/v2/verify/${encodeURIComponent(verificationId)}/status`,
    );
    const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
    return {
      verificationId: text(data?.verification_id),
      status: text(data?.status),
      finalResult: text(data?.final_result),
      reason: text(data?.failure_reason) ?? text(data?.rejection_reason) ?? text(data?.manual_review_reason),
      retryAvailable: data?.retry_available === true,
      assessment: parseAssessment(data, new Date()),
      autoAudit: parseAutoAudit(data, new Date()),
    };
  }

  private async request<T>(method: 'get' | 'post', path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    if (!this.apiKey) {
      this.logger.error(`[RESULT] Idswyft ${method.toUpperCase()} ${this.redact(path)} aborted: IDSWYFT_API_KEY not configured`);
      throw new IdswyftApiError('Idswyft API key not configured (IDSWYFT_API_KEY)', null, null);
    }

    const label = `${method.toUpperCase()} ${this.redact(path)}`;
    this.logger.log(`[CALL] Idswyft ${label}`);
    const startedAt = Date.now();
    try {
      const response = await this.http.request<T>({
        method,
        url: path,
        data: body,
        headers: { 'X-API-Key': this.apiKey },
        ...(timeoutMs ? { timeout: timeoutMs } : {}),
      });
      this.logger.log(`[RESULT] Idswyft ${label} succeeded status=${response.status} elapsedMs=${Date.now() - startedAt}`);
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? null;
        const providerCode = this.extractProviderCode(error.response?.data);
        const networkCode = typeof error.code === 'string' && /^[A-Z0-9_]{3,40}$/.test(error.code) ? error.code : null;
        const timedOut = networkCode === 'ECONNABORTED' || networkCode === 'ETIMEDOUT';
        const kind: IdswyftErrorKind = status !== null ? 'http' : timedOut ? 'timeout' : 'network';
        // The old line printed `status=n/a code=n/a` for a timeout and for a refused connection alike.
        this.logger.error(
          `[RESULT] Idswyft ${label} failed kind=${kind} status=${status ?? 'n/a'} code=${providerCode ?? networkCode ?? 'n/a'} elapsedMs=${Date.now() - startedAt}`,
        );
        throw new IdswyftApiError(`Idswyft request failed (${status ?? kind})`, status, providerCode, kind, networkCode);
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[RESULT] Idswyft ${label} failed detail=${message}`);
      throw new IdswyftApiError('Idswyft request failed', null, null);
    }
  }

  /** `error.code` / `code` from Idswyft's error body when it is a short identifier; anything else is dropped. */
  private extractProviderCode(body: unknown): string | null {
    if (body === null || typeof body !== 'object') return null;
    const source = body as Record<string, unknown>;
    const nested = source.error && typeof source.error === 'object' ? (source.error as Record<string, unknown>).code : undefined;
    const candidate = source.code ?? nested;
    return typeof candidate === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(candidate) ? candidate : null;
  }

  /** Collapses the verification id so every call to a route logs the same line; callers log the id on their own `[ENTITY]` line. */
  private redact(path: string): string {
    return path.replace(/\/verify\/[^/]+/, '/verify/:id');
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

/** A precheck is a quick "is there something to read?" question, not an analysis: it gives up after this long. */
export const IDSWYFT_ENGINE_TIMEOUT_MS = 30000;

export interface EngineTextRead {
  rawText: string;
  detectedType: string | null;
  confidence: number | null;
  /** MRZ legibility reported by the DioteKo overlay of the engine; null on an engine without it. */
  mrz: { shapedLikeTd1: boolean; checkDigitsValid: boolean } | null;
}

/**
 * Thin client for Idswyft's ML engine (`/extract/ocr`, `/extract/live`), reached on the compose network. Used ONLY for
 * the pre-upload photo check ("is there a document / a face in this picture?"), so that a photo of a wall or a ceiling is
 * refused before it reaches the verification session — Idswyft hard-rejects a session on one unreadable front, which then
 * costs one of the holder's daily sessions. It decides nothing: every real gate stays in Idswyft's API.
 *
 * The engine API is an internal one (not versioned by Idswyft). Disabled when `IDSWYFT_ENGINE_URL` is empty, and any
 * failure makes the precheck answer "skipped" (the photo is then sent as usual). The text it reads is returned to the
 * caller for the keyword test only: never logged, never stored.
 */
@Injectable()
export class IdswyftEngineClientService {
  private readonly logger = new Logger(IdswyftEngineClientService.name);
  private readonly http: AxiosInstance;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('kyc.engineUrl', '');
    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: IDSWYFT_ENGINE_TIMEOUT_MS,
      maxRedirects: 0,
      maxContentLength: 2 * 1024 * 1024,
    });
  }

  get enabled(): boolean {
    return this.baseUrl !== '';
  }

  /** OCR only (no tamper analysis): the text of the picture and what the engine thinks the document is. */
  async readText(file: { buffer: Buffer; mimetype: string }): Promise<EngineTextRead> {
    const data = await this.post<{ result?: Record<string, unknown>; dioteko_mrz?: Record<string, unknown> }>('/extract/ocr', file, {
      document_type: 'auto',
    });
    const result = data?.result ?? {};
    const mrz = data?.dioteko_mrz;
    return {
      rawText: typeof result.raw_text === 'string' ? result.raw_text : '',
      detectedType: typeof result.detected_document_type === 'string' ? result.detected_document_type : null,
      confidence: typeof result.classification_confidence === 'number' ? result.classification_confidence : null,
      mrz:
        mrz && typeof mrz.shaped_like_td1 === 'boolean' && typeof mrz.check_digits_valid === 'boolean'
          ? { shapedLikeTd1: mrz.shaped_like_td1, checkDigitsValid: mrz.check_digits_valid }
          : null,
    };
  }

  /** Whether the engine finds a face in the picture. */
  async detectFace(file: { buffer: Buffer; mimetype: string }): Promise<boolean> {
    const data = await this.post<{ result?: Record<string, unknown> }>('/extract/live', file);
    const confidence = data?.result?.face_confidence;
    return typeof confidence === 'number' && confidence > 0;
  }

  private async post<T>(route: string, file: { buffer: Buffer; mimetype: string }, fields: Record<string, string> = {}): Promise<T> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), `probe.${file.mimetype === 'image/png' ? 'png' : 'jpg'}`);
    for (const [key, value] of Object.entries(fields)) form.append(key, value);

    const startedAt = Date.now();
    try {
      const response = await this.http.post<T>(route, form);
      this.logger.log(`[RESULT] engine POST ${route} succeeded elapsedMs=${Date.now() - startedAt}`);
      return response.data;
    } catch (error) {
      const code = axios.isAxiosError(error) ? (error.code ?? error.response?.status ?? 'n/a') : 'n/a';
      this.logger.warn(`[RESULT] engine POST ${route} failed code=${String(code)} elapsedMs=${Date.now() - startedAt}`);
      throw error;
    }
  }
}

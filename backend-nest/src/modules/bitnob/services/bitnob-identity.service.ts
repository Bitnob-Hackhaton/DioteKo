import { Injectable, Logger } from '@nestjs/common';
import { unwrapBitnob } from '../common/bitnob-envelope.util';
import { BitnobHttpClientService } from './bitnob-http-client.service';

/**
 * `data` shape of `GET /api/whoami`. `permissions` is `null` on the current
 * sandbox; `environment` echoes which Bitnob environment the configured API
 * key belongs to (`sandbox` vs `live`).
 */
export interface WhoamiData {
  active: boolean;
  active_company_id: string;
  auth_method: string;
  client_id: string;
  client_name: string;
  environment: 'sandbox' | 'live';
  permissions: null;
}

/**
 * Read-only identity/credentials probe for the configured Bitnob API key.
 * Replaces the old `BitnobService.whoami()` connectivity check. The path is
 * fixed (`/api/whoami`, no `/api/v1` prefix). The HMAC signing that gates
 * this call lives in `BitnobHttpClientService` and is unaffected.
 */
@Injectable()
export class BitnobIdentityService {
  private readonly logger = new Logger(BitnobIdentityService.name);

  constructor(private readonly http: BitnobHttpClientService) {}

  async whoami(): Promise<WhoamiData> {
    this.logger.log('[START] whoami');
    const data = unwrapBitnob<WhoamiData>(await this.http.get('/api/whoami'));
    this.logger.log('[RESULT] whoami ok');
    return data;
  }
}

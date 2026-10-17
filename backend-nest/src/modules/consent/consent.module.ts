import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DidVcModule } from '../../modules/did-vc/did-vc.module';
import { AccessLogsController } from './controllers/access-logs.controller';
import { ConsentController } from './controllers/consent.controller';
import { AccessLog } from './entities/access-log.entity';
import { Consent } from './entities/consent.entity';
import { AccessLogService } from './services/access-log.service';
import { ConsentService } from './services/consent.service';

/**
 * `audit/consent` — the plan's step 8 module: `consents` +
 * `access_logs`, built minimally-but-real (see both entities' doc
 * comments). Imports `DidVcModule` for `DidService` (resolving a caller's
 * own DID from their JWT `sub`, and resolving a query-supplied DID string to
 * its internal uuid — see both controllers). Exports `AccessLogService` (and
 * `ConsentService`, for symmetry / any future consent-aware module) so other
 * domain modules — `domains/admin-certificates` first, via
 * `AdminCertificatesModule` importing this module — can write audit-trail
 * rows from their own flows without owning the `access_logs` table
 * themselves.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Consent, AccessLog]), DidVcModule],
  controllers: [AccessLogsController, ConsentController],
  providers: [AccessLogService, ConsentService],
  exports: [AccessLogService, ConsentService],
})
export class ConsentModule {}

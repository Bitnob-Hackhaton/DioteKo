import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccessLog, AccessLogAction, AccessLogActorType, AccessLogResult } from '../entities/access-log.entity';

export interface RecordAccessLogParams {
  actorType: AccessLogActorType;
  actorOrganizationId?: string;
  actorUserId?: string;
  subjectDidId?: string;
  resourceType: string;
  resourceId: string;
  action: AccessLogAction;
  result: AccessLogResult;
  metadata?: Record<string, unknown>;
}

export interface FindAccessLogsFilters {
  resourceType?: string;
}

/**
 * Write-mostly audit trail for `access_logs` — the modern, generalized home
 * of the old Prisma `VerificationLog`. Deliberately simple: `record(...)` is
 * a plain create+save, no batching, no async queue, no retry logic. Domain
 * modules (`domains/admin-certificates` first, via `AdminCertificatesModule`
 * importing `ConsentModule`) call this inline from their own flows — this
 * service never initiates a write on its own.
 */
@Injectable()
export class AccessLogService {
  private readonly logger = new Logger(AccessLogService.name);

  constructor(
    @InjectRepository(AccessLog)
    private readonly accessLogsRepository: Repository<AccessLog>,
  ) {}

  async record(params: RecordAccessLogParams): Promise<AccessLog> {
    this.logger.log(
      `[START] record actorType=${params.actorType} resourceType=${params.resourceType} resourceId=${params.resourceId} action=${params.action}`,
    );

    const entry = await this.accessLogsRepository.save(
      this.accessLogsRepository.create({
        actorType: params.actorType,
        actorOrganizationId: params.actorOrganizationId ?? null,
        actorUserId: params.actorUserId ?? null,
        subjectDidId: params.subjectDidId ?? null,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        action: params.action,
        result: params.result,
        metadata: params.metadata ?? null,
      }),
    );

    this.logger.log(
      `[RESULT] record success accessLogId=${entry.id} action=${params.action} result=${params.result}`,
    );
    return entry;
  }

  /**
   * `subjectDidId` is optional so admins/verifiers can also list the full
   * audit trail (optionally narrowed by `resourceType` alone) rather than
   * only ever querying one subject at a time — see
   * `AccessLogsController.list`'s doc comment for the query-param shape this
   * backs.
   */
  async findForSubject(subjectDidId?: string, filters: FindAccessLogsFilters = {}): Promise<AccessLog[]> {
    return this.accessLogsRepository.find({
      where: {
        ...(subjectDidId ? { subjectDidId } : {}),
        ...(filters.resourceType ? { resourceType: filters.resourceType } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }
}

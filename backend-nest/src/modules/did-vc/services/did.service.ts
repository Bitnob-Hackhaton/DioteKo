import * as crypto from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Did } from '../entities/did.entity';

/**
 * Creates and looks up app-local DIDs (`did:dioteko:<uuid>` — see the doc
 * comment on `Did` for why this is a placeholder, not a spec-compliant DID
 * method). Deliberately has no dependency on `modules/identity`'s module graph
 * — callers just pass a plain `controllerUserId`/`controllerOrganizationId`
 * string, so `modules/identity` can import `DidVcModule` without a circular
 * module dependency.
 */
@Injectable()
export class DidService {
  private readonly logger = new Logger(DidService.name);

  constructor(@InjectRepository(Did) private readonly didsRepository: Repository<Did>) {}

  /**
   * Exactly one of `controllerUserId` / `controllerOrganizationId` must be
   * provided — a DID belongs to either a holder (person) or an
   * issuing/verifying organization, never both, never neither.
   */
  async createDid(controllerUserId?: string, controllerOrganizationId?: string): Promise<Did> {
    this.assertExactlyOneController(controllerUserId, controllerOrganizationId);

    this.logger.log(
      `[START] createDid controllerUserId=${controllerUserId ?? '-'} controllerOrganizationId=${controllerOrganizationId ?? '-'}`,
    );

    const did = `did:dioteko:${crypto.randomUUID()}`;
    const document = {
      id: did,
      controller: did,
      created: new Date().toISOString(),
    };

    const entity = await this.didsRepository.save(
      this.didsRepository.create({
        did,
        controllerUserId: controllerUserId ?? null,
        controllerOrganizationId: controllerOrganizationId ?? null,
        document,
      }),
    );

    this.logger.log(`[RESULT] created DID id=${entity.id} did=${entity.did}`);
    return entity;
  }

  /**
   * Looks up the DID for a given controller. Returns `null` (not a 404) when
   * none exists yet — callers like `AuthService.completeAppwriteLogin`
   * treat "no DID yet" as a normal find-or-create branch, not an error.
   */
  async findByController(controllerUserId?: string, controllerOrganizationId?: string): Promise<Did | null> {
    this.assertExactlyOneController(controllerUserId, controllerOrganizationId);

    if (controllerUserId) {
      return this.didsRepository.findOne({ where: { controllerUserId } });
    }

    return this.didsRepository.findOne({ where: { controllerOrganizationId } });
  }

  async findById(id: string): Promise<Did> {
    const did = await this.didsRepository.findOne({ where: { id } });
    if (!did) {
      throw new NotFoundException('DID not found');
    }
    return did;
  }

  /**
   * Looks up a DID by its external string form (`did:dioteko:<uuid>`), the
   * same value carried in `JwtPayload.did` and returned as `Did.did`.
   * Returns `null` (not a 404) when none exists — same "let the caller
   * decide" convention as `findByController`. Added for `modules/consent`,
   * which needs to resolve a caller-supplied DID string (e.g.
   * `GET /audit/access-logs?subjectDid=`) down to the internal uuid FK
   * value without exposing raw DID string filtering wired into the entity
   * relations everywhere.
   */
  async findByDid(did: string): Promise<Did | null> {
    return this.didsRepository.findOne({ where: { did } });
  }

  private assertExactlyOneController(controllerUserId?: string, controllerOrganizationId?: string): void {
    const hasUser = Boolean(controllerUserId);
    const hasOrganization = Boolean(controllerOrganizationId);

    if (hasUser === hasOrganization) {
      throw new BadRequestException(
        'A DID must have exactly one controller: either controllerUserId or controllerOrganizationId',
      );
    }
  }
}

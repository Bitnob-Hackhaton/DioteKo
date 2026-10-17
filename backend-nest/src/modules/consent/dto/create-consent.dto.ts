import { IsISO8601, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * Body for `POST /audit/consents`. Deliberately has NO `holderDidId` field —
 * the holder granting consent is always the authenticated caller, resolved
 * server-side from their own JWT (`sub` -> their DID via `DidService`), never
 * accepted from the request body. See `ConsentController.create`'s doc
 * comment for why: accepting `holderDidId` here would let any authenticated
 * caller grant consent on someone else's behalf.
 */
export class CreateConsentDto {
  @IsUUID()
  verifierOrganizationId: string;

  @IsString()
  @IsNotEmpty()
  resourceType: string;

  @IsObject()
  @IsNotEmpty()
  scope: Record<string, unknown>;

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}

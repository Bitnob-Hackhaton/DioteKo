import { CreateDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Shared base for every entity that has the standard `id` (uuid PK) +
 * `created_at`/`updated_at` (timestamptz) shape. Column names/types match
 * exactly what was already used repeated across entities before this was
 * extracted, so extending this does NOT change the generated schema.
 *
 * Not every entity qualifies — some lack `updatedAt` (append-only/audit-log
 * style rows, e.g. `AccessLog`, `AdminCertificateRef`), have no timestamps
 * at all (e.g. `Role`, `UserRole`), or use a differently-named timestamp
 * column (e.g. `BitnobWebhookEvent.receivedAt`). Those entities deliberately
 * do NOT extend `BaseEntity` and keep declaring their own columns.
 */
export abstract class BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

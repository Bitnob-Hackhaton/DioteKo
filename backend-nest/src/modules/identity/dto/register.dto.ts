import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

/** bcrypt only hashes the first 72 *bytes*; a longer password would be silently truncated. */
export const PASSWORD_MAX_BYTES = 72;

function MaxUtf8Bytes(max: number, options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: target.constructor,
      propertyName,
      constraints: [max],
      options: { message: `${propertyName} must not exceed ${max} bytes`, ...options },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= max,
      },
    });
}

/**
 * Public self-registration of a citizen (holder) with email + password.
 * Only these fields are accepted: the global ValidationPipe uses
 * `forbidNonWhitelisted`, so a body carrying `roles`, `organizationId`,
 * `emailVerified` or `accountStatus` is rejected with 400.
 */
export class RegisterDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(8)
  @MaxUtf8Bytes(PASSWORD_MAX_BYTES)
  password: string;

  // Shown in the agent console: letters, digits, spaces and a few name punctuation marks only.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  @Matches(/^[\p{L}\p{N} .,'’-]+$/u, { message: 'displayName contains invalid characters' })
  displayName?: string;
}

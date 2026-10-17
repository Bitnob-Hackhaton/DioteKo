import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * Conventional email+password login for staff accounts
 * (issuer/verifier/admin orgs). Seed/admin-created only in this pass — no
 * public self-registration endpoint exists for these roles.
 */
export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  password: string;
}

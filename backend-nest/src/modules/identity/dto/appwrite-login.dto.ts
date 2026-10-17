import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Mobile-client Appwrite/Google OAuth login. The client authenticates with
 * Google via a self-hosted Appwrite project and obtains a short-lived
 * Appwrite JWT (`account.createJWT()`), which is POSTed here and verified
 * against Appwrite by `AppwriteService.verifyClientJwt` — same shape as
 * `LoginDto`, one field.
 */
export class AppwriteLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  appwriteJwt: string;
}

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RefreshTokenDto {
  // `${sessionUuid}.${96-hex-char secret}` is ~133 chars; 512 leaves headroom.
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  refreshToken: string;
}

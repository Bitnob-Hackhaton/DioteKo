import { ValidationPipe } from '@nestjs/common';
import { RegisterDto } from './register.dto';

describe('RegisterDto', () => {
  // Same options as the global pipe (apply-global-app-config.ts).
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: RegisterDto });

  it('normalizes the email and accepts a valid body', async () => {
    const dto = (await validate({ email: '  Jane@Example.COM ', password: 'correct-password', displayName: 'Awa Diop' })) as RegisterDto;
    expect(dto.email).toBe('jane@example.com');
  });

  it('rejects a short password', async () => {
    await expect(validate({ email: 'jane@example.com', password: 'short' })).rejects.toBeDefined();
  });

  it('rejects a password over 72 bytes even when under 72 characters', async () => {
    // 40 x "é" = 40 characters but 80 UTF-8 bytes: bcrypt would silently truncate it.
    await expect(validate({ email: 'jane@example.com', password: 'é'.repeat(40) })).rejects.toBeDefined();
  });

  it.each(['roles', 'organizationId', 'emailVerified', 'accountStatus'])('rejects the privileged field %s', async (field) => {
    await expect(
      validate({ email: 'jane@example.com', password: 'correct-password', [field]: 'admin' }),
    ).rejects.toBeDefined();
  });

  it('rejects markup in displayName', async () => {
    await expect(
      validate({ email: 'jane@example.com', password: 'correct-password', displayName: '<script>x</script>' }),
    ).rejects.toBeDefined();
  });
});

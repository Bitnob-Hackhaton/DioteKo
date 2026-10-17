import { BadRequestException } from '@nestjs/common';
import { sniffImage } from './kyc-upload.util';

describe('sniffImage', () => {
  it('recognises a JPEG and a PNG from their leading bytes', () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toEqual({ mimetype: 'image/jpeg' });
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toEqual({ mimetype: 'image/png' });
  });

  it.each([
    ['an empty file', Buffer.alloc(0)],
    ['a missing file', undefined],
    ['a PDF', Buffer.from('%PDF-1.7')],
    ['a script renamed .jpg', Buffer.from('<script>alert(1)</script>')],
    ['a truncated PNG header', Buffer.from([0x89, 0x50, 0x4e])],
    ['a GIF', Buffer.from('GIF89a')],
  ])('refuses %s', (_label, buffer) => {
    expect(() => sniffImage(buffer as Buffer | undefined)).toThrow(BadRequestException);
  });
});

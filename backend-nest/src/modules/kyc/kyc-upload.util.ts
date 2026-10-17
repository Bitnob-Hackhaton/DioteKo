import { BadRequestException } from '@nestjs/common';

export type SniffedImage = { mimetype: 'image/jpeg' | 'image/png' };

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (buffer: Buffer, magic: number[]): boolean =>
  buffer.length >= magic.length && magic.every((byte, index) => buffer[index] === byte);

/**
 * Identifies an upload by its leading bytes, never by the client-declared `mimetype` or file name (both are
 * attacker-controlled). Only JPEG and PNG pass; anything else, or an empty file, is a 400.
 */
export function sniffImage(buffer: Buffer | undefined): SniffedImage {
  if (!buffer || buffer.length === 0) {
    throw new BadRequestException('A photo is required (field "file").');
  }
  if (startsWith(buffer, JPEG_MAGIC)) return { mimetype: 'image/jpeg' };
  if (startsWith(buffer, PNG_MAGIC)) return { mimetype: 'image/png' };
  throw new BadRequestException('Only JPEG or PNG photos are accepted.');
}

// DioteKo addition (no upstream equivalent). MIT-compatible, see docker/idswyft/README.md.
//
// Collects the tag ids present in the main IFD (IFD0) and in the Exif sub-IFD of a raw EXIF buffer: an optional
// "Exif\0\0" prefix, then a TIFF header ("II" little endian or "MM" big endian). Only ids are read, never values.
// Any malformed structure simply stops the walk: the caller then scores what was found.

const EXIF_SUB_IFD_POINTER = 0x8769; // ExposureTime, FocalLength and Flash live in that sub-IFD

export function readExifTagIds(exif: Buffer): Set<number> {
  const ids = new Set<number>();
  const base = exif.length >= 6 && exif.toString('latin1', 0, 4) === 'Exif' ? 6 : 0;
  if (exif.length < base + 8) return ids;

  const order = exif.toString('latin1', base, base + 2);
  const little = order === 'II';
  if (!little && order !== 'MM') return ids;
  const u16 = (o: number): number => (little ? exif.readUInt16LE(o) : exif.readUInt16BE(o));
  const u32 = (o: number): number => (little ? exif.readUInt32LE(o) : exif.readUInt32BE(o));

  const walk = (ifdOffset: number, depth: number): void => {
    const at = base + ifdOffset;
    if (depth > 2 || ifdOffset < 8 || at + 2 > exif.length) return;
    const count = Math.min(u16(at), 256);
    for (let i = 0; i < count; i++) {
      const entry = at + 2 + i * 12;
      if (entry + 12 > exif.length) return;
      const tag = u16(entry);
      ids.add(tag);
      if (tag === EXIF_SUB_IFD_POINTER) walk(u32(entry + 8), depth + 1);
    }
  };

  walk(u32(base + 4), 0);
  return ids;
}

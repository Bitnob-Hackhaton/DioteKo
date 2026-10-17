// Test de readExifTagIds sur des structures EXIF fabriquees (aucune donnee reelle).
// node --experimental-strip-types --no-warnings docker/idswyft/tests/exifTags.test.mjs
import assert from 'node:assert/strict';
import { readExifTagIds } from '../overlay/shared/src/providers/liveness/exifTags.ts';

// Construit un EXIF: IFD0 {Make, Model, ExifPointer} + sous-IFD {ExposureTime, FocalLength, Flash}.
function build({ little, prefix, withSub = true, ifd0Tags = [0x010f, 0x0110] }) {
  const w16 = (b, o, v) => (little ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b, o, v) => (little ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  const tags0 = withSub ? [...ifd0Tags, 0x8769] : ifd0Tags;
  const ifd0Size = 2 + tags0.length * 12 + 4;
  const subTags = [0x829a, 0x920a, 0x9209];
  const subOffset = 8 + ifd0Size;
  const size = withSub ? subOffset + 2 + subTags.length * 12 + 4 : 8 + ifd0Size;
  const tiff = Buffer.alloc(size);
  tiff.write(little ? 'II' : 'MM', 0, 'latin1');
  w16(tiff, 2, 42);
  w32(tiff, 4, 8);
  w16(tiff, 8, tags0.length);
  tags0.forEach((t, i) => {
    const o = 10 + i * 12;
    w16(tiff, o, t);
    w16(tiff, o + 2, 4);
    w32(tiff, o + 4, 1);
    if (t === 0x8769) w32(tiff, o + 8, subOffset);
  });
  if (withSub) {
    w16(tiff, subOffset, subTags.length);
    subTags.forEach((t, i) => w16(tiff, subOffset + 2 + i * 12, t));
  }
  return prefix ? Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]) : tiff;
}

let n = 0;
const check = (label, fn) => { fn(); n += 1; console.log('ok  ' + label); };

for (const little of [true, false]) {
  for (const prefix of [true, false]) {
    const tag = (little ? 'II' : 'MM') + (prefix ? ' avec prefixe Exif' : ' sans prefixe');
    check('balises appareil photo lues (' + tag + ')', () => {
      const ids = readExifTagIds(build({ little, prefix }));
      for (const t of [0x010f, 0x0110, 0x829a, 0x920a, 0x9209]) assert.ok(ids.has(t), 'tag ' + t.toString(16));
    });
  }
}
check('sans sous-IFD: pas de focale ni de pose', () => {
  const ids = readExifTagIds(build({ little: true, prefix: true, withSub: false }));
  assert.ok(ids.has(0x010f) && !ids.has(0x920a) && !ids.has(0x829a));
});
check('EXIF sans Make/Model (logiciel de retouche): pas de signal appareil', () => {
  const ids = readExifTagIds(build({ little: true, prefix: false, withSub: false, ifd0Tags: [0x0131] }));
  assert.ok(!ids.has(0x010f) && !ids.has(0x0110));
});
check('buffer vide, trop court, en-tete inconnu: ensemble vide, sans exception', () => {
  assert.equal(readExifTagIds(Buffer.alloc(0)).size, 0);
  assert.equal(readExifTagIds(Buffer.from('Exif\0\0II', 'latin1')).size, 0);
  assert.equal(readExifTagIds(Buffer.from('ZZ\0\0\0\0\0\0\0\0\0\0', 'latin1')).size, 0);
});
check('structure tronquee ou boucle: pas d exception', () => {
  const buf = build({ little: true, prefix: true });
  readExifTagIds(buf.subarray(0, 20));
  const loop = Buffer.from(buf);
  loop.writeUInt32LE(8, 6 + 10 + 2 * 12 + 8); // le pointeur du sous-IFD revient sur IFD0
  readExifTagIds(loop);
});
check('les noms textuels ne comptent pas (l ancien comportement)', () => {
  const ids = readExifTagIds(Buffer.from('Exif\0\0IIMake Model FocalLength ExposureTime Flash', 'latin1'));
  assert.ok(!ids.has(0x010f) && !ids.has(0x920a));
});
console.log('\ntout est bon (' + n + ' verifications)');

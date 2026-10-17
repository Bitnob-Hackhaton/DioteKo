// DioteKo addition (no upstream equivalent). MIT-compatible, see docker/idswyft/README.md.
//
// OCR often drops ONE character from a TD1 machine-readable line (3 lines x 30 characters, mostly made of `<` fillers),
// and the upstream detector then ignores the whole block because it insists on exactly 30 characters per line.
//
// This module only PROPOSES candidate triples of 30-character lines, by re-inserting one missing `<` filler. It validates
// nothing by itself: the caller must run every candidate through the real `mrz` parser and keep a candidate only if ALL its
// check digits are valid (document number, birth date, expiry date and the composite digit over lines 1 and 2). The name
// line (line 3) has no check digit by design; for it the only candidate is "append one filler", which cannot alter a name
// that was read correctly, and the names are cross-checked against the front of the card afterwards.
// Nothing is loosened: an MRZ whose check digits fail is still rejected, whatever the repair.

const TD1_LENGTH = 30;
const MAX_CANDIDATES = 24;

const cleanLine = (line: string): string => line.replace(/\s+/g, '').toUpperCase();

/** Every way to insert one `<` at the edge of a run of fillers (or at the very end) of a line that is one char short. */
function insertOneFiller(line: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i <= line.length; i++) {
    const isEdge = (i > 0 && line[i - 1] === '<') || line[i] === '<';
    if (isEdge) out.add(line.slice(0, i) + '<' + line.slice(i));
  }
  return [...out];
}

const isFirstLine = (l: string): boolean => /^[IAC][A-Z<][A-Z]{3}/.test(l);
const isSecondLine = (l: string): boolean => /\d{6}\d[MF<]\d{6}\d/.test(l);
const isNameLine = (l: string): boolean => /^[A-Z<]+$/.test(l) && l.includes('<<');

/**
 * Candidate TD1 triples (each line exactly 30 characters) built from OCR text in which one of the lines is one character
 * short. Returns [] when the text already holds a complete block or holds nothing that looks like a TD1 block.
 */
export function td1RepairCandidates(rawText: string): string[][] {
  const lines = (rawText || '')
    .split('\n')
    .map(cleanLine)
    .filter((l) => l.length >= TD1_LENGTH - 1 && l.length <= TD1_LENGTH && /^[A-Z0-9<]+$/.test(l) && l.includes('<'));

  const first = lines.filter(isFirstLine);
  const second = lines.filter(isSecondLine);
  const names = lines.filter((l) => isNameLine(l) && !isFirstLine(l) && !isSecondLine(l));
  if (!first.length || !second.length || !names.length) return [];

  const variants = (line: string, nameLine: boolean): string[] => {
    if (line.length === TD1_LENGTH) return [line];
    return nameLine ? [line + '<'] : insertOneFiller(line);
  };

  const out: string[][] = [];
  for (const a of variants(first[0], false)) {
    for (const b of variants(second[0], false)) {
      for (const c of variants(names[0], true)) {
        out.push([a, b, c]);
        if (out.length >= MAX_CANDIDATES) return out;
      }
    }
  }
  // A block that is already complete needs no repair.
  const alreadyComplete = out.length === 1 && out[0].every((l, i) => l === [first[0], second[0], names[0]][i]);
  return alreadyComplete ? [] : out;
}

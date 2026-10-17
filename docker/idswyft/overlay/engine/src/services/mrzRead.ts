// DioteKo addition (no upstream equivalent). MIT-compatible, see docker/idswyft/README.md.
//
// One place that reads a TD1 MRZ out of OCR text, used by /extract/back (to extract the fields) and /extract/ocr (to tell the
// mobile app, BEFORE the photo is uploaded, whether the machine-readable zone is legible).
// A block is accepted only when the real `mrz` parser validates every check digit; the repair in mrzRepair.ts merely
// re-inserts one dropped filler character before that validation, it never relaxes it.

import { extractMRZFromText, parseMRZLines } from '@/services/mrz.js';
import type { MRZParseResult } from '@/services/mrz.js';
import { td1RepairCandidates } from '@/services/mrzRepair.js';

export interface Td1Reading {
  /** The parsed MRZ, only when a block was found AND (for a repaired one) all check digits are valid. */
  result: MRZParseResult | null;
  /** True when a filler character had to be re-inserted. */
  repaired: boolean;
  /** True when the text contains lines shaped like a TD1 block (even if they are not valid). */
  shapedLikeTd1: boolean;
}

export function readTd1Mrz(rawText: string): Td1Reading {
  const direct = rawText ? extractMRZFromText(rawText) : null;
  if (direct) return { result: direct, repaired: false, shapedLikeTd1: true };

  const candidates = rawText ? td1RepairCandidates(rawText) : [];
  for (const candidate of candidates) {
    const parsed = parseMRZLines(candidate);
    if (parsed?.check_digits_valid) return { result: parsed, repaired: true, shapedLikeTd1: true };
  }
  return { result: null, repaired: false, shapedLikeTd1: candidates.length > 0 };
}

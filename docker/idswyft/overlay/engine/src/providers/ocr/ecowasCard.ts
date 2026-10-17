/**
 * ECOWAS (CEDEAO) identity card reader.
 *
 * Added by DioteKo on top of Idswyft v1.12.19 (MIT, Copyright (c) 2025-present Team Idswyft; see docker/idswyft/README.md).
 * New file, not part of upstream.
 *
 * Why: Idswyft's national-ID extractor is built for US documents. On a Senegalese ECOWAS card the OCR reads the whole
 * page correctly (title lines, then a block "N° de la carte d'identité <number> Prénoms <given> Nom <surname> Date de
 * naissance Sexe Taille <date> <sex> <height> Lieu de naissance ... <issue date> <expiry date>"), but the label/value
 * extractor fills none of the fields. With no field filled, the orientation routine preferred a garbled upside-down read.
 * This parser fills `name`, `date_of_birth`, `expiration_date` and `document_number` from that block, only where the engine
 * left them empty, and only for text that is clearly an ECOWAS card.
 *
 * Nothing here lowers a threshold or accepts a document: it only supplies values the engine failed to extract; the
 * cross-validation against the back side still has to match.
 */

const NOW_YEAR = () => new Date().getFullYear();

/** Upper-case text without accents, single-spaced: the form every regex below works on. */
const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** True for the text of an ECOWAS identity card (title in French / English / Portuguese, or the republic + card title). */
export function looksLikeEcowasCard(rawText: string): boolean {
  const text = normalize(rawText);
  if (/\bCEDEAO\b|\bECOWAS\b/.test(text)) return true;
  return /REPUBLIQUE/.test(text) && /CARTE D'?\s?IDENTITE/.test(text);
}

export interface EcowasCardFields {
  name?: string;
  date_of_birth?: string;
  expiration_date?: string;
  document_number?: string;
}

const NAME_CHARS = "[A-Z' -]{2,60}?";

/** `dd/mm/yyyy` (also `-` and `.`) to ISO `yyyy-mm-dd`, or null when it is not a real date. */
const toIso = (day: string, month: string, year: string): string | null => {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > NOW_YEAR() + 40) return null;
  return `${year}-${month}-${day}`;
};

/** All plausible dates of the text, in reading order. */
function findDates(text: string): string[] {
  const dates: string[] = [];
  for (const m of text.matchAll(/\b(\d{2})[/.-](\d{2})[/.-](\d{4})\b/g)) {
    const iso = toIso(m[1], m[2], m[3]);
    if (iso) dates.push(iso);
  }
  return dates;
}

/**
 * Reads the fields of an ECOWAS card from the OCR raw text. Returns only what it could read with confidence; an
 * unreadable field is left out rather than guessed.
 */
export function parseEcowasCard(rawText: string): EcowasCardFields {
  const text = normalize(rawText);
  const fields: EcowasCardFields = {};

  const given = text.match(new RegExp(`PRENOMS?\\s+(${NAME_CHARS})\\s+NOM\\b`))?.[1]?.trim();
  const surname = text.match(new RegExp(`\\bNOM\\s+(${NAME_CHARS})\\s+(?:DATE|SEXE|TAILLE|LIEU)\\b`))?.[1]?.trim();
  if (given && surname) fields.name = `${given} ${surname}`;

  // Card number: the digits between the label and the first name label ("19920010306 000012" and spaced variants).
  const numberBlock = text.match(/CARTE D'?\s?IDENTITE\s+(.{8,60}?)\s+(?:PRENOMS?|NOM\b)/)?.[1];
  if (numberBlock) {
    const digits = numberBlock.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 20) fields.document_number = digits;
  }

  // Dates appear in a fixed order on the card: birth, then issue, then expiry.
  const dates = findDates(text);
  if (dates.length >= 3) {
    const [birth, issue, expiry] = dates;
    if (birth < issue && issue < expiry) {
      fields.date_of_birth = birth;
      fields.expiration_date = expiry;
    }
  } else if (dates.length === 2) {
    // Only two readable: keep the pair if it looks like (birth, expiry) or (issue, expiry), never guess which is which.
    const [first, second] = dates;
    if (first < second && Number(first.slice(0, 4)) <= NOW_YEAR() - 14) fields.date_of_birth = first;
  }
  return fields;
}

/**
 * Fills the fields the engine left empty. Returns the same object (mutated) so it can be used inline. `confidence_scores`
 * get a moderate value (0.7): the values come from a text parse, not a per-field box read.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEcowasLayout(ocr: any): any {
  if (!ocr || typeof ocr.raw_text !== 'string' || !looksLikeEcowasCard(ocr.raw_text)) return ocr;

  const parsed = parseEcowasCard(ocr.raw_text);
  ocr.confidence_scores = ocr.confidence_scores || {};
  for (const [field, value] of Object.entries(parsed)) {
    if (!value || ocr[field]) continue;
    ocr[field] = value;
    ocr.confidence_scores[field] = 0.7;
  }
  // A keyword-recognised ECOWAS card is a national ID, whatever the default fallback said on a noisy pass.
  if (ocr.detected_document_type !== 'national_id') {
    ocr.detected_document_type = 'national_id';
    ocr.classification_confidence = 0.85;
  }
  return ocr;
}

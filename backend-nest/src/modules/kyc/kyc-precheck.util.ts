/**
 * Answer of the pre-upload photo check. `mrz_unreadable` = the back shows a machine-readable zone but it cannot be read with valid
 * check digits (blur, glare, cut off). `skipped` = could not check (engine off or failing): the photo is sent as usual.
 */
export type KycPrecheckResult = 'ok' | 'no_document' | 'no_face' | 'mrz_unreadable' | 'skipped';

/** What the engine says about the machine-readable zone of the text it just read (absent on an engine without the DioteKo overlay). */
export interface MrzReading {
  shapedLikeTd1: boolean;
  checkDigitsValid: boolean;
}

// Words that appear on identity documents (French and English), compared without accents or case. One word counts once.
const DOCUMENT_WORDS = [
  'republique', 'republic', 'carte', 'card', 'identite', 'identity', 'cedeao', 'ecowas', 'passeport', 'passport',
  'nom', 'prenom', 'prenoms', 'surname', 'given', 'naissance', 'birth', 'nationalite', 'nationality',
  'delivrance', 'issue', 'expiration', 'expiry', 'validite', 'sexe', 'taille', 'signature', 'adresse', 'domicile',
  'centre', 'commissariat',
];

const normalize = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Number of distinct identity-document words found in the text. */
export function countDocumentWords(rawText: string): number {
  const text = normalize(rawText);
  return DOCUMENT_WORDS.filter((word) => new RegExp(`\\b${word}\\b`).test(text)).length;
}

/**
 * Front of a document: enough identity-document wording, or the engine itself classed it as an ID / passport with
 * confidence. Deliberately tolerant (a card shot slightly blurred still passes): the real checks happen in Idswyft.
 */
export function looksLikeDocumentFront(rawText: string, detectedType: string | null, confidence: number | null): boolean {
  if (countDocumentWords(rawText) >= 3) return true;
  return (detectedType === 'national_id' || detectedType === 'passport') && (confidence ?? 0) >= 0.8;
}

/**
 * Back of a document: some wording, a machine-readable zone (long runs of `<`), or enough text and digits. Backs carry
 * less text than fronts and OCR reads them worse, so this is the most tolerant rule.
 */
export function looksLikeDocumentBack(rawText: string): boolean {
  if (countDocumentWords(rawText) >= 2) return true;
  if ((rawText.match(/</g) ?? []).length >= 8) return true;
  const alphanumeric = rawText.replace(/[^A-Za-z0-9]/g, '');
  const digitGroups = rawText.match(/\d{4,}/g) ?? [];
  return alphanumeric.length >= 80 && digitGroups.length >= 2;
}

/**
 * Verdict for the back of a document. A back that shows a machine-readable zone (long runs of `<`, or lines shaped like a TD1
 * block) must also be legible: Idswyft hard-rejects the whole session when it cannot read that zone, and the holder then
 * loses the session. A back without any machine-readable zone is judged as before (wording / text), so ID cards that have
 * none are not blocked. When the engine gives no MRZ reading, the old rule applies unchanged.
 */
export function backPrecheckVerdict(rawText: string, mrz: MrzReading | null): KycPrecheckResult {
  if (!looksLikeDocumentBack(rawText)) return 'no_document';
  const mrzVisible = (rawText.match(/</g) ?? []).length >= 8 || mrz?.shapedLikeTd1 === true;
  if (mrz && mrzVisible && !mrz.checkDigitsValid) return 'mrz_unreadable';
  return 'ok';
}

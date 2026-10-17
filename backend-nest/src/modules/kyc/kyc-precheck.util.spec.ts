import { backPrecheckVerdict, countDocumentWords, looksLikeDocumentBack, looksLikeDocumentFront } from './kyc-precheck.util';

describe('kyc precheck rules', () => {
  const frontText = "REPUBLIQUE DU SENEGAL CARTE D'IDENTITE CEDEAO ECOWAS IDENTITY CARD N de la carte Prenoms Nom Date de naissance Sexe Taille";

  it('counts identity-document words once, without accents or case', () => {
    expect(countDocumentWords(frontText)).toBeGreaterThanOrEqual(8);
    expect(countDocumentWords('République  DATE DE NAISSANCE')).toBe(2);
    expect(countDocumentWords('')).toBe(0);
  });

  it('accepts a front with enough document wording', () => {
    expect(looksLikeDocumentFront(frontText, 'drivers_license', 0.5)).toBe(true);
  });

  it('accepts a front the engine classed as an ID with confidence, even if the text is thin', () => {
    expect(looksLikeDocumentFront('few words', 'national_id', 0.85)).toBe(true);
    expect(looksLikeDocumentFront('few words', 'passport', 0.9)).toBe(true);
  });

  it.each([
    ['empty text', '', null, null],
    ['noise', 'a  b  o  I', 'drivers_license', 0.5],
    ['a weak id classification', 'few words', 'national_id', 0.5],
    ['a driver licence fallback with unrelated words', 'table chaise fenetre', 'drivers_license', 0.5],
  ])('refuses %s', (_label, text, type, confidence) => {
    expect(looksLikeDocumentFront(text as string, type as string | null, confidence as number | null)).toBe(false);
  });

  it('accepts a back with wording, a machine-readable zone, or lots of text and digits', () => {
    expect(looksLikeDocumentBack("Adresse du domicile Centre d'enregistrement")).toBe(true);
    expect(looksLikeDocumentBack('IDSEN<<<<<<<<<<<<<<<<<<<<<<<<<<<<')).toBe(true);
    expect(looksLikeDocumentBack('ABC '.repeat(10) + '1234567 98765432 ' + 'XYZ '.repeat(20))).toBe(true);
  });

  it('refuses a back with nothing to read', () => {
    expect(looksLikeDocumentBack('')).toBe(false);
    expect(looksLikeDocumentBack('a b c')).toBe(false);
  });
});

describe('backPrecheckVerdict', () => {
  const mrzText = 'IDSEN' + '<'.repeat(25) + '\n' + 'X'.repeat(10) + '<'.repeat(20);

  it('refuses a back with nothing to read', () => {
    expect(backPrecheckVerdict('a b c', null)).toBe('no_document');
  });

  it('accepts a back whose machine-readable zone has valid check digits', () => {
    expect(backPrecheckVerdict(mrzText, { shapedLikeTd1: true, checkDigitsValid: true })).toBe('ok');
  });

  it('waits when the zone is visible but not legible (blur, glare, cut off)', () => {
    expect(backPrecheckVerdict(mrzText, { shapedLikeTd1: true, checkDigitsValid: false })).toBe('mrz_unreadable');
    expect(backPrecheckVerdict(mrzText, { shapedLikeTd1: false, checkDigitsValid: false })).toBe('mrz_unreadable');
  });

  it('does not block a card without any machine-readable zone', () => {
    expect(backPrecheckVerdict("Adresse du domicile Centre d'enregistrement", { shapedLikeTd1: false, checkDigitsValid: false })).toBe('ok');
  });

  it('keeps the old rule when the engine gives no MRZ reading', () => {
    expect(backPrecheckVerdict(mrzText, null)).toBe('ok');
  });
});

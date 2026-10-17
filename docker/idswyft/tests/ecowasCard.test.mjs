// Lancer : node --experimental-strip-types --no-warnings docker/idswyft/tests/ecowasCard.test.mjs
// Test de l'analyseur ECOWAS sur des textes FICTIFS qui reproduisent la mise en page de la carte (aucune donnee reelle).
import { applyEcowasLayout, looksLikeEcowasCard, parseEcowasCard } from '../overlay/engine/src/providers/ocr/ecowasCard.ts';

const clean = `REPUBLIQUE DU SENEGAL
CARTE D'IDENTITE CEDEAO
ECOWAS IDENTITY CARD / BILHETE DE IDENTIDADE CEDEAO
 N de la carte didentite 12345678901 000012 Prenoms MARIE JOSEPHINE Nom SECK Date de naissance Sexe Taille 01/02/1990 F 160 cm
Lieu de naissance
DAKAR (SENEGAL)
Date de delvrance Date d'expiration
25/06/2018 24/06/2028
Centre denregistrement
COMMISSARIAT DU POINT E
Adresse du domicile
LOT 15 NGOR`;

const noisy = `
REPUBLIQUE DU SENEGAL
CARTE D'IDENTITE CEDEAO
 N° de la carte d'identite ABCD 1 23 45678901 00001 2
Nom
SECK
Date de naissance
01/02/1990 Sexe Taille
F 160 cm
25/06/2018 Date de delivrance Date d'expiration
24/06/2028`;

const junk = `3 i 10 B al a N Ak 118 DDA`;
const licence = `DRIVER LICENSE DOB 01/02/1990 EXP 01/02/2030 DLN 123456789`;

let failures = 0;
const check = (label, cond) => { console.log((cond ? 'OK   ' : 'FAIL ') + label); if (!cond) failures += 1; };

check('reconnait une carte CEDEAO', looksLikeEcowasCard(clean) && looksLikeEcowasCard(noisy));
check('ne prend pas du bruit pour une carte', !looksLikeEcowasCard(junk));
check('ne prend pas un permis americain pour une carte', !looksLikeEcowasCard(licence));

const a = parseEcowasCard(clean);
check('nom = prenoms + nom', a.name === 'MARIE JOSEPHINE SECK');
check('date de naissance ISO', a.date_of_birth === '1990-02-01');
check("date d'expiration ISO", a.expiration_date === '2028-06-24');
check('numero de carte = chiffres seuls', a.document_number === '12345678901000012');

const b = parseEcowasCard(noisy);
check('texte bruite : numero malgre les lettres parasites', b.document_number === '12345678901000012');
check('texte bruite : prenoms absents donc pas de nom invente', b.name === undefined);
check('texte bruite : dates', b.date_of_birth === '1990-02-01' && b.expiration_date === '2028-06-24');

const ocr = { raw_text: clean, detected_document_type: 'drivers_license', classification_confidence: 0.5, confidence_scores: {} };
applyEcowasLayout(ocr);
check('remplit les champs vides et corrige le type', ocr.name === 'MARIE JOSEPHINE SECK' && ocr.detected_document_type === 'national_id' && ocr.classification_confidence === 0.85);

const filled = { raw_text: clean, name: 'DEJA LU', detected_document_type: 'national_id', classification_confidence: 0.9, confidence_scores: { name: 0.9 } };
applyEcowasLayout(filled);
check("n'ecrase jamais un champ deja lu", filled.name === 'DEJA LU' && filled.confidence_scores.name === 0.9);

const other = { raw_text: licence, detected_document_type: 'drivers_license', classification_confidence: 1 };
applyEcowasLayout(other);
check('laisse un autre document intact', other.detected_document_type === 'drivers_license' && other.name === undefined);

const dateOrder = parseEcowasCard(`CEDEAO NOM X Date de naissance 25/06/2018 24/06/2028 01/02/1990`);
check("refuse des dates dans un ordre incoherent", dateOrder.date_of_birth === undefined);

console.log(failures === 0 ? '\ntout est bon' : `\n${failures} echec(s)`);
process.exit(failures === 0 ? 0 : 1);

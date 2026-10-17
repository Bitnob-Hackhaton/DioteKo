# Idswyft : ce qu'on a modifié (overlay DioteKo)

DioteKo utilise le moteur open source **Idswyft v1.12.19** (MIT, Copyright (c) 2025-present Team Idswyft). Ce dossier contient
**uniquement les fichiers que nous avons changés**, posés par-dessus la release amont au moment de la construction de l'image.
Le nom et le logo « Idswyft » restent la propriété de Team Idswyft (voir leur `TRADEMARK.md`) ; seul le code est sous licence MIT.

## Pourquoi
Mesuré sur une carte d'identité CEDEAO sénégalaise (détail dans `docs/KYC.md` §12 et §15) : le moteur est pensé
pour des pièces américaines. Sans correction : type « permis de conduire », noms et dates absents, visage non trouvé, et la
validation croisée recto/verso échoue. **Aucun seuil n'est modifié.**

## Fichiers
| Fichier | Origine | Changement |
|---|---|---|
| `overlay/engine/src/routes/extract.ts` | amont `engine/src/routes/extract.ts` | `scoreExtraction` : une classification par **mot-clé** (confiance ≥ 0,8) l'emporte sur une lecture à l'envers classée par repli (`default_fallback`, 0,5) ; appel de l'analyseur ECOWAS avant le calcul du score. Effet mesuré : **1 passe de lecture au lieu de 4**, type `national_id`, visage détecté. |
| `overlay/engine/src/routes/extract.ts` (route `/back`) | idem | Si la passe code-barres ne donne pas de MRZ aux contrôles valides, relit le verso avec PaddleOCR (qui reconnaît `<`) et passe le texte au même analyseur `mrz`. Une MRZ valide complète les champs vides et remplace le numéro du code-barres. Contrôles inchangés. |
| `overlay/engine/src/services/mrzRepair.ts`, `mrzRead.ts` | aucun (ajout) | Réinsère **un** caractère `<` perdu par l'OCR dans une ligne TD1, puis exige que le vrai analyseur valide tous les chiffres de contrôle. `/extract/ocr` expose aussi `dioteko_mrz` (zone visible / lisible) pour le pré-contrôle de l'app. Contrôles inchangés. |
| `overlay/engine/src/providers/ocr/ecowasCard.ts` | **nouveau** | Lit nom, date de naissance, expiration et numéro d'une carte CEDEAO depuis le texte brut (là où l'extracteur américain ne remplit rien). Ne remplit que des champs vides, jamais ne remplace un champ lu. |
| `overlay/shared/src/providers/liveness/{EnhancedHeuristicProvider,exifTags}.ts` | amont `shared/.../EnhancedHeuristicProvider.ts` + **nouveau** `exifTags.ts` | Le score EXIF de la vivacité passive cherchait les **noms** `Make`, `FocalLength`… absents d'un EXIF binaire. Il lit maintenant les vrais identifiants de balises (tests : `tests/exifTags.test.mjs`, 9 vérifications). Seuils et poids inchangés. **Mesuré : sans effet sur les selfies de l'app** (`expo-camera` n'écrit pas Make/Model/focale). |
| `engine.Dockerfile` | amont `engine/Dockerfile` | Même fichier, mais les sources viennent du contexte nommé `upstream` (le tag Idswyft) et `overlay/engine/src/` est posé par-dessus. |
| `tests/ecowasCard.test.mjs` | nouveau | 14 vérifications de l'analyseur sur des textes **fictifs** : `node --experimental-strip-types --no-warnings docker/idswyft/tests/ecowasCard.test.mjs` |
| `migrations.Dockerfile` | nouveau | Copie les migrations SQL de la release (l'image API n'en contient pas). |

## Reconstruire
```bash
DEV_UP_GUARD=1 docker compose --env-file .env.dev -f docker-compose.dev.yml build idswyft-ml-engine
DEV_UP_GUARD=1 docker compose --env-file .env.dev -f docker-compose.dev.yml up -d idswyft-ml-engine
```
`npm run dev:up` le fait aussi. Première construction : plusieurs minutes (modèles téléchargés par `download-models.js`).

## Passer à une nouvelle version d'Idswyft
1. Changer `IDSWYFT_VERSION` (`.env.dev`).
2. Comparer chaque fichier de `overlay/` avec le même fichier de la nouvelle release (`git diff v1.12.19 vX engine/src/routes/extract.ts`) et reporter nos changements (cherchez « DioteKo »).
3. Rejouer le test de l'analyseur et le flux complet (`docs/KYC.md` §12).
Si un fichier amont a trop changé, mieux vaut refaire la modification à la main que fusionner.

## Pas fait (voir `docs/KYC.md` §15)
Défi de vivacité actif (« tourner la tête », vidéo de 8 s minimum) : demande un build de développement, pas Expo Go. Lecture NFC de la puce : idem.
**Aucun seuil ni contrôle d'intégrité n'a été assoupli.**

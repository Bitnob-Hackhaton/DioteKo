# Bitnob — Playground (outils navigateur)

Source : section `https://bitnob.dev/docs/playground`. Tous les outils tournent côté navigateur, sans envoi de données au serveur (affirmation de la doc). Pas d'API : ce sont des pages d'outils. Les entrées/sorties ci-dessous viennent des libellés des pages ; les valeurs par défaut ou options non listées sont « non précisées dans la doc ».

## Sommaire

- [Aperçu et avertissement de sécurité](#aperçu-et-avertissement-de-sécurité)
- [Hash & Crypto](#hash--crypto) : [SHA-256](#sha-256-generator), [HMAC](#hmac-generator), [Hash File Checker](#hash-file-checker), [Bitcoin Address Validator](#bitcoin-address-validator), [UUID](#uuid-generator), [Random String](#random-string-generator), [Private Key](#private-key-generator)
- [JSON Tools](#json-tools) : [Formatter](#json-formatter), [Minifier](#json-minifier), [Validator](#json-validator), [Diff](#json-diff-checker), [JSONPath](#jsonpath-tester), [JSON to CSV](#json-to-csv)
- [Text & Binary](#text--binary) : [ASCII Binary](#ascii-binary-converter), [Base32](#base32-converter), [Base64 Encoder](#base64-encoder), [Base64 Decoder](#base64-decoder), [Hex Encoder](#hex-encoder), [Hex Decoder](#hex-decoder), [UTF-8 Encoder](#utf-8-encoder), [UTF-8 Decoder](#utf-8-decoder), [String Byte Inspector](#string-byte-inspector), [ROT13](#rot13-cipher), [URL Encoder](#url-encoder), [URL Decoder](#url-decoder)
- [Anomalies de la doc](#anomalies-de-la-doc)
- [Outils utiles au développement DioteKo](#outils-utiles-au-développement-dioteko)

La catégorisation suit les URL de la navigation (`hash-crypto`, `json-tools`, `text-binary`).

## Aperçu et avertissement de sécurité

### Playground Overview

Liens : https://bitnob.dev/docs/playground et https://bitnob.dev/docs/playground/overview (contenu identique).

Présente la catégorie « Hash & Cryptographic Tools ». Regroupement affiché : Hash Generators (SHA-256, SHA-1, MD5, HMAC), File Tools (Hash File Checker), Bitcoin Tools (Bitcoin Address Validator), Key Generation (Bitcoin Address Generator, Random String Generator, Private Key Generator).

Avertissements de la doc : ne jamais utiliser de clés générées dans un navigateur pour stocker de vrais cryptos ; hardware wallet ou génération hors ligne en production ; les hachages « legacy » (SHA-1, MD5) ne servent pas à la sécurité ; tout s'exécute dans le navigateur.

## Hash & Crypto

### SHA-256 Generator

Lien : https://bitnob.dev/docs/playground/hash-crypto/sha256-generator

- Rôle : hachage SHA-256 d'un texte (fonction de Bitcoin).
- Entrée : « Text to Hash ». Sortie : « SHA-256 Hash », 64 caractères hexadécimaux (256 bits).
- Propriétés citées : déterministe, sortie fixe, effet avalanche, sens unique. Usages : blocs Bitcoin, signatures, intégrité, arbres de Merkle.

### HMAC Generator

Lien : https://bitnob.dev/docs/playground/hash-crypto/hmac-generator

- Rôle : calculer un HMAC pour authentification de message, signature d'API et vérification de webhook.
- Entrées : « Secret Key », « Algorithm », « Message to Sign ». Sortie : « HMAC Signature ». Algorithmes mentionnés : SHA-256 ou SHA-1 (liste exacte des options non précisée).
- Bonnes pratiques de la doc : secret confidentiel et aléatoire, préférer HMAC-SHA256 à HMAC-SHA1, comparaison en temps constant.
- Note : la page contient un résidu de rendu (`http://localhost:3000/...`) dans la liste d'usages.

### Hash File Checker

Lien : https://bitnob.dev/docs/playground/hash-crypto/hash-file-checker

- Rôle : empreinte d'un fichier téléversé (vérification d'intégrité, détection de modification). Le fichier n'est pas envoyé à un serveur.
- Entrées : fichier (glisser-déposer) ; « Hash Algorithm ». Sortie : empreinte.
- Algorithmes (tableau de la doc) : SHA-256 (64 caractères, sécurité haute), SHA-1 (40, faible, compatibilité), MD5 (32, cassé, checksums non sécuritaires).
- Exemple : vérifier une release Bitcoin Core contre `SHA256SUMS`.
- Les pages « SHA-1 Generator » et « MD5 Generator » de l'aperçu pointent vers cette même page (pas de page distincte).

### Bitcoin Address Validator

Lien : https://bitnob.dev/docs/playground/hash-crypto/bitcoin-address-validator

- Rôle : valider le format d'une adresse Bitcoin, identifier le type et le réseau (mainnet/testnet). Ne vérifie **pas** l'existence sur la blockchain ni le solde.
- Entrée : « Bitcoin Address ». Sortie : « Validation Result » (type, réseau, validité).
- Fonctions : format (jeu de caractères, structure), checksum, détection du type, détection du réseau.
- Formats : P2PKH (`1...`), P2SH (`3...`), P2WPKH Bech32 (`bc1`, 42 caractères), P2WSH Bech32 (`bc1`, 62 caractères) ; testnet : `m`/`n` (P2PKH), `2` (P2SH), `tb1` (Bech32). Taproot (`bc1p`) n'est pas mentionné.
- Exemples : `1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa`, `3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy`, `bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4`.
- Pas de validation d'invoice Lightning (BOLT11).

### UUID Generator

Lien : https://bitnob.dev/docs/playground/hash-crypto/uuid-generator

- Rôle : générer des UUID v4 aléatoires cryptographiquement sûrs.
- Entrée : aucune documentée (bouton de génération). Sortie : « Generated UUID », format `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` (36 caractères, 2^122 valeurs).
- Exemples : `crypto.randomUUID()`, `gen_random_uuid()` en PostgreSQL. Non adapté au tri par date de création.
- L'aperçu l'appelle « Bitcoin Address Generator » avec la description « Generate unique identifiers » : voir Anomalies.

### Random String Generator

Lien : https://bitnob.dev/docs/playground/hash-crypto/random-string-generator

- Rôle : chaînes aléatoires (mots de passe, clés API, tokens, nonces) via `crypto.getRandomValues()`.
- Entrées : « Length » (curseur ; défaut 32, bornes 8 à 128), « Include Numbers (0-9) », « Include Symbols ». Sortie : « Generated String ».
- Jeux de caractères : lettres (52), alphanumérique (62), avec symboles (94).
- Longueurs recommandées : mots de passe 12 min / 16+ ; clés API 32 / 64+ ; sessions 32 / 40+ ; CSRF 24 / 32+ ; fichiers temp 8 / 12+.
- Repli : si `crypto.getRandomValues()` est indisponible, l'outil utilise `Math.random()` avec un avertissement.

### Private Key Generator

Lien : https://bitnob.dev/docs/playground/hash-crypto/private-key-generator

- Rôle : génération de clés privées **à but éducatif uniquement** (ne jamais utiliser pour de vrais fonds).
- Entrée : « Key Format » : Hexadecimal (64 caractères), Base64 (44), WIF-style (simplifié, 51-52). Sortie : « Generated Private Key ».
- Une clé privée est un nombre de 256 bits. Risques cités : entropie navigateur, exposition mémoire, vulnérabilités navigateur. Éviter `Math.random()`, générateurs en ligne, stockage en clair.

## JSON Tools

### JSON Formatter

Lien : https://bitnob.dev/docs/playground/json-tools/json-formatter

Entrée « Minified JSON Input » -> sortie « Formatted JSON Output » (indentation, retours à la ligne, coloration). Détecte aussi les erreurs de syntaxe. Conseil : 2 espaces pour la doc, 4 si imposé par un linter.

### JSON Minifier

Lien : https://bitnob.dev/docs/playground/json-tools/json-minifier

Entrée « Formatted JSON Input » -> sortie « Minified JSON Output » (supprime espaces, tabs, retours). Si échec, le JSON n'est pas valide : passer par le Validator.

### JSON Validator

Lien : https://bitnob.dev/docs/playground/json-tools/json-validator

Entrée « JSON Input » -> « Validation Results » : erreurs de syntaxe avec numéro de ligne, structure (objets/tableaux), taille (caractères, octets), comptage des types. Référence RFC 8259. Syntaxe uniquement (pas de JSON Schema).

### JSON Diff Checker

Lien : https://bitnob.dev/docs/playground/json-tools/json-diff-checker

Entrées « JSON Object 1 (Original) » et « JSON Object 2 (Comparison) » -> « Comparison Results » : ajouts, suppressions, valeurs ou types modifiés, comparaison profonde. L'ordre des clés est ignoré. Usage cité : audit de payload webhook contre la forme attendue.

### JSONPath Tester

Lien : https://bitnob.dev/docs/playground/json-tools/jsonpath-tester

Entrées « JSON Data » et « JSONPath Expression » -> « Query Results ». Syntaxe listée : `$`, `$.property`, `$.array[0]`, `$.array[*]`, `$.nested.deep.property` ; la section explicative cite aussi `..` et les filtres `[?(...)]`. Les implémentations JSONPath varient selon les langages.

### JSON to CSV

Lien : https://bitnob.dev/docs/playground/json-tools/json-to-csv

Entrée « JSON Input » -> « CSV Output ». Tableau d'objets = lignes/colonnes ; objet seul = une ligne ; objets imbriqués aplatis en notation pointée (`user.name`) ; tableaux dans les valeurs convertis en chaînes JSON. Valeurs avec virgules ou retours à la ligne entre guillemets.

## Text & Binary

### ASCII Binary Converter

Lien : https://bitnob.dev/docs/playground/text-binary/ascii-binary-converter

Deux sens : texte ASCII -> binaire (8 bits par caractère) et binaire (groupes de 8 bits) -> texte. Exemple : `Hello` = `01001000 01100101 01101100 01101100 01101111`. Limité à ASCII 0-127.

### Base32 Converter

Lien : https://bitnob.dev/docs/playground/text-binary/base32-converter

Texte <-> Base32, standard RFC 4648 (alphabet A-Z, 2-7, padding `=` sur multiples de 8). Insensible à la casse ; usages : secrets TOTP, adresses onion Tor v3, DNS.

### Base64 Encoder

Lien : https://bitnob.dev/docs/playground/text-binary/base64-encoder

« Input Text » -> « Base64 Output ». Alphabet A-Z a-z 0-9 + / ; sortie ~33 % plus grande. Ce n'est pas du chiffrement. Variante URL-safe (Base64url) : `-` et `_`, non fournie par l'outil d'après la doc.

### Base64 Decoder

Lien : https://bitnob.dev/docs/playground/text-binary/base64-decoder

« Base64 Input » -> « Decoded Text ». Espaces retirés automatiquement, padding `=` optionnel. Pour du Base64url, remplacer `-` par `+` et `_` par `/` avant. Usage cité : inspecter header/payload d'un JWT.

### Hex Encoder

Lien : https://bitnob.dev/docs/playground/text-binary/hex-encoder

« Input Text » -> « Hex Output » : hexadécimal des octets UTF-8 (deux chiffres par octet).

### Hex Decoder

Lien : https://bitnob.dev/docs/playground/text-binary/hex-decoder

« Hex Input » -> « Decoded Text » (UTF-8). Exigences : caractères 0-9 A-F (insensible à la casse), longueur paire, UTF-8 valide, espaces retirés. Retirer le préfixe `0x` avant.

### UTF-8 Encoder

Lien : https://bitnob.dev/docs/playground/text-binary/utf8-encoder

« Input Text » -> « UTF-8 Bytes (Decimal) » : tableau d'octets en décimal (0-255). Un point de code peut occuper jusqu'à 4 octets.

### UTF-8 Decoder

Lien : https://bitnob.dev/docs/playground/text-binary/utf8-decoder

« UTF-8 Bytes (Decimal) » -> « Decoded Text ». Formats acceptés : séparés par virgules (`72, 101, 108, 108, 111`) ou espaces ; chaque nombre 0-255 ; séquences UTF-8 valides.

### String Byte Inspector

Lien : https://bitnob.dev/docs/playground/text-binary/string-byte-inspector

« Input Text » -> « Byte Analysis » : code UTF-16, octets UTF-8, valeurs hex, description du caractère (ASCII, Unicode, contrôle). Révèle les caractères invisibles (U+200B, BOM U+FEFF). Utile pour reproduire exactement les octets passés à un hash/HMAC.

### ROT13 Cipher

Lien : https://bitnob.dev/docs/playground/text-binary/rot13-cipher

« Input Text » -> « ROT13 Output ». Décalage de 13 lettres, symétrique (deux passes = original), casse préservée, chiffres et symboles inchangés. `Hello World` -> `Uryyb Jbeyq`. Pas de sécurité réelle.

### URL Encoder

Lien : https://bitnob.dev/docs/playground/text-binary/url-encoder

« Input Text » -> « URL Encoded Text » (pourcentage, RFC 3986 : non réservés A-Z a-z 0-9 `-_.~`). Espace = `%20`, `&` = `%26`. Encoder les valeurs, pas l'URL entière.

### URL Decoder

Lien : https://bitnob.dev/docs/playground/text-binary/url-decoder

« URL Encoded Text » -> « Decoded Text ». Exemples : `Hello%20World!`, `user%40example.com`, `price%3D%2410`. Séquences `%` invalides = erreur. `+` = espace seulement en contexte formulaire/query.

## Anomalies de la doc

- Aperçu : « SHA-1 Generator » et « MD5 Generator » renvoient vers `hash-file-checker` ; « Bitcoin Address Generator » renvoie vers `uuid-generator` avec la description « Generate unique identifiers » (aucun générateur d'adresse Bitcoin n'existe dans le lot).
- L'aperçu ne décrit que la catégorie Hash & Crypto ; JSON Tools et Text & Binary n'ont pas de page d'aperçu dans le lot.
- Hash File Checker : texte d'aide « SVG, PNG, JPG or GIF (max. 800x400px) » incohérent avec un outil de hachage de fichiers quelconques (probable gabarit).
- UTF-8 Decoder : la description d'en-tête parle de « hex values » mais l'entrée est en décimal.
- HMAC Generator : résidu `http://localhost:3000/...` dans le texte.
- Private Key Generator : l'encart parle de WIF « Bitcoin-specific » mais le format est « WIF-style (Simplified) ».

## Outils utiles au développement DioteKo

| Besoin | Outil | Remarque |
| --- | --- | --- |
| Reproduire/vérifier une signature HMAC (`X-Auth-Signature`, signature webhook) | HMAC Generator + String Byte Inspector | Algorithmes proposés : SHA-256 / SHA-1 ; la sortie (hex ou autre) n'est pas précisée, comparer avec le code. Ne jamais coller de vrai secret de production dans un outil tiers, même annoncé client-side. |
| Valider une adresse on-chain Bitcoin | Bitcoin Address Validator | Format seulement, pas de BOLT11 Lightning. |
| Hash d'un document (ancrage, intégrité) | SHA-256 Generator, Hash File Checker | Utile pour contrôler l'empreinte d'un certificat. |
| Inspecter payloads webhook / réponses API | JSON Formatter, Validator, Diff Checker, JSONPath Tester | Diff pour comparer un payload reçu à l'attendu. |
| Décoder un JWT (Appwrite) ou un champ Base64 | Base64 Decoder | Remplacer `-`/`_` pour du Base64url. |
| Idempotency keys / nonces | UUID Generator, Random String Generator | UUID v4 ; `crypto.randomUUID()` suffit en code. |
| Debug d'encodage de query | URL Encoder/Decoder, Hex, UTF-8 | Pour signatures dépendant des octets exacts. |

Peu utiles : ROT13, ASCII Binary, Base32 (hors TOTP), Private Key Generator (éducatif, à ne pas utiliser pour de vrais fonds).

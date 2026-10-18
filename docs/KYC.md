# Vérification d'identité (KYC) — DioteKo

> **Statut :** code sur `feat/kyc-idswyft` (backend `kyc/`, migration `1789000000000-CreateKycVerifications`, écrans et services mobiles). **Le spike B0 est partiel** (CNI sénégalaise évaluée, passeport non évalué, voir §12). Tout ce qui touche aux réponses du prestataire non mesurées est marqué « à vérifier ».
> **Source de vérité :** `backend-nest/src/modules/kyc/**`, `backend-nest/src/modules/admin-certificates/` (points d'appel de la porte), `frontmobile/app/kyc.tsx`, `frontmobile/services/kyc.ts`.

---

## 1. But et périmètre

Le KYC sert à prouver **qui demande** un certificat : la personne qui s'inscrit est bien celle dont la pièce d'identité et le selfie correspondent. Il ne prouve **pas** les données écrites dans l'acte.

Politique par type (`kyc` dans `admin-certificates.constants.ts`) :

| Type | Politique | Aujourd'hui | Cible |
|---|---|---|---|
| `residence` | `required` | bloquant | bloquant |
| `identity` | `required` | bloquant | bloquant |
| `birth` | `planned` | non bloquant (sauf si listé dans `KYC_ENFORCED_TYPES`) | obligatoire |
| `marriage` | `planned` | idem | obligatoire |
| `death` | `planned` | idem | obligatoire |

**Passer un type `planned` en bloquant**, dans l'ordre :
1. par configuration : ajouter le type à `KYC_ENFORCED_TYPES` (ex. `birth,marriage,death`), sans redéployer le code ;
2. pour de bon : changer sa valeur `kyc` en `'required'` dans le catalogue. `isKycEnforced` (`kyc-policy.util.ts`) ne change pas.

**Pourquoi les parents restent déclarés par le titulaire.** La CNI ne porte ni le nom du père ni celui de la mère. Ces champs restent donc saisis par le titulaire et passent par le flux existant `needs_info` (complément demandé par l'agent). Aucun nom vérifié n'est stocké : la décision D3 (source du nom) reste ouverte.

---

## 2. Architecture

Composants (tous dans `backend-nest/src/modules/kyc/`) :

- `controllers/kyc.controller.ts` : routes du titulaire (JWT). Une seule photo à la fois par titulaire.
- `controllers/kyc-webhook.controller.ts` : webhook Idswyft, public, protégé par signature.
- `services/kyc.service.ts` : machine d'états, porte `assertVerifiedFor`, relecture chez le prestataire.
- `services/kyc-webhook.service.ts` : enregistrement, dédoublonnage, relecture.
- `services/idswyft-http-client.service.ts` : client HTTP (`X-API-Key`, timeout 45 s).
- `guards/idswyft-webhook-signature.guard.ts` : HMAC-SHA256 sur le corps brut.
- `kyc-policy.util.ts`, `kyc-upload.util.ts`, `kyc.constants.ts` : politique, contrôle des octets, constantes.
- `entities/kyc-verification.entity.ts`, `entities/kyc-webhook-event.entity.ts` : deux tables (voir `DATABASE_MODEL.md` §7.7).

### 2.1 Ouverture de session et envoi des photos

```mermaid
sequenceDiagram
  autonumber
  actor H as Titulaire
  participant M as App mobile kyc.tsx
  participant N as backend-nest KycService
  participant D as PostgreSQL
  participant I as Idswyft auto-hébergé

  M->>N: POST /api/kyc/sessions (documentType)
  N->>I: POST /api/v2/verify/initialize (user_id = users.id)
  I-->>N: verification_id
  N->>D: insert kyc_verifications status pending
  N-->>M: kyc status pending et sessionId
  loop recto, verso si CNI, puis selfie
    M->>N: POST /api/kyc/sessions/:sessionId/:step (multipart file)
    N->>D: attempts plus 1 (atomique, plafond 8)
    N->>I: front-document, back-document ou live-capture
  end
```

### 2.2 Verdict : selfie, webhook et relecture

Le webhook n'est qu'un **signal**. Le statut est toujours relu chez Idswyft avant d'être écrit.

```mermaid
sequenceDiagram
  autonumber
  participant I as Idswyft auto-hébergé
  participant N as backend-nest KycWebhookService
  participant D as PostgreSQL
  participant M as App mobile

  N->>I: GET /api/v2/verify/:id/status (après le selfie)
  I-->>N: final_result
  N->>D: transition conditionnelle (dossier encore ouvert)
  I->>N: POST /api/kyc/webhook/idswyft (X-Idswyft-Signature)
  N->>N: garde HMAC sur le corps brut
  N->>D: insert kyc_webhook_events (id de livraison unique)
  N->>I: GET /api/v2/verify/:id/status (relecture)
  I-->>N: final_result
  N->>D: transition conditionnelle
  N-->>I: 200 ou 503 si la relecture échoue (Idswyft réessaie)
  M->>N: GET /api/kyc/status (écran ouvert, toutes les ~4 s)
  N->>I: relecture si le dossier est encore ouvert (filet)
```

---

## 3. Points d'entrée

| Méthode et route | Accès | Corps ou fichier | Réponse utile |
|---|---|---|---|
| `POST /api/kyc/sessions` | JWT titulaire | JSON `{ documentType }` : `national_id` ou `passport` | `{ success, kyc }` ; idempotent (un dossier actif ou vérifié est renvoyé tel quel) |
| `POST /api/kyc/sessions/:sessionId/front` | JWT titulaire | multipart, champ `file` | `{ success, kyc }` |
| `POST /api/kyc/sessions/:sessionId/back` | JWT titulaire | multipart, champ `file` ; refusé (400) pour un passeport | `{ success, kyc }` |
| `POST /api/kyc/sessions/:sessionId/selfie` | JWT titulaire | multipart, champ `file` ; ferme la session, le verdict est relu avant la réponse | `{ success, kyc }` |
| `GET /api/kyc/status` | JWT titulaire | aucun | `{ success, kyc }` ; `not_started` s'il n'y a pas de dossier |
| `POST /api/kyc/webhook/idswyft` | public, signature HMAC obligatoire | JSON Idswyft | `{ received: true }` (200) ; 503 si la relecture échoue |

Un dossier d'un autre titulaire répond **404**, comme un dossier inexistant. La vue renvoyée au titulaire ne contient jamais l'identifiant du prestataire, l'identifiant utilisateur ni rien lu sur la pièce.

---

## 4. Limites

| Limite | Valeur | Où |
|---|---|---|
| Sessions par titulaire | 5 sur 24 h glissantes (`KYC_MAX_SESSIONS_PER_DAY`, entre 1 et 50) | `kyc.service.ts`, `startSession` |
| Photos par session | 8 (envois, reprises comprises ; jamais remboursés) | `KYC_MAX_UPLOADS_PER_SESSION` |
| Taille d'une photo | 5 Mo maximum | `KYC_UPLOAD_MAX_BYTES`, multer |
| Formats | JPEG ou PNG, détectés sur les premiers octets (jamais le nom ni le type déclaré) | `kyc-upload.util.ts` |
| Champs texte multipart | aucun (`fields: 0`), un seul fichier | `kyc.controller.ts` |
| Dossiers actifs par titulaire | un seul (`pending` ou `manual_review`), imposé par index unique partiel | `UQ_kyc_verifications_one_active_per_user` |
| Upload en vol | un seul par titulaire, **en mémoire du processus** | `KycController.uploading` |
| Délai d'un appel Idswyft | 45 s côté backend ; 60 s côté mobile | `IDSWYFT_REQUEST_TIMEOUT_MS`, `PHOTO_TIMEOUT_MS` |
| Dossier `pending` abandonné | fermé en `failed` (raison `other`) à la reprise, après 24 h | `STALE_PENDING_MS` |

---

## 4 bis. Parcours mobile (écran `/kyc`)

Le parcours reprend l'ordre du flow Didit (source : documentation publique de Didit, relevée à la conception). Didit ne publie
ni captures ni textes d'écran : l'**ordre** et les règles de reprise viennent de Didit, les **textes, le cadre de capture et
l'écran de relecture** sont des choix de DioteKo.

```mermaid
flowchart TD
  A["Accueil: étapes, durée, consentement"] --> B["Pays de délivrance"]
  B --> C["Type de pièce"]
  C --> D["Photo recto"]
  D --> E{"Pièce à deux faces?"}
  E -->|"carte d'identité"| F["Photo verso"]
  E -->|"passeport"| G["Intro selfie"]
  F --> G
  G --> H["Selfie dans l'ovale, compte à rebours"]
  H --> I["Vérification en cours"]
  I --> J["Identité vérifiée"]
  I --> K["Dossier en cours d'examen"]
  I --> L["Vérification non aboutie: réessayer"]
  L --> C
  classDef ok fill:#d4edda,stroke:#28a745
  classDef wait fill:#fff3cd,stroke:#ffc107
  classDef ko fill:#f8d7da,stroke:#dc3545
  class J ok
  class K wait
  class L ko
```

- Chaque photo passe par une **relecture** (« Utiliser cette photo » / « Reprendre ») avant l'envoi ; un refus du serveur
  (photo illisible, trop lourde) reste sur cet écran avec le message.
- Bouton fermer avec confirmation, barre de progression, « Photo X sur N ». Caméra arrière pour les pièces, avant pour le selfie,
  bouton de bascule. Déclencheur manuel (pas de capture automatique) ; compte à rebours de 3 s pour le selfie.
- Reprise : si un dossier est déjà ouvert, l'accueil propose « Reprendre » et repart de la photo que le prestataire attend
  (`nextStep` renvoyé par `/kyc/status`).
- Le pays choisi est envoyé en code ISO (`issuingCountry`) et transmis à Idswyft (`issuing_country`).
- Le résultat suit toujours le statut relu par le serveur ; si la relecture après le selfie échoue, l'écran « Vérification en
  cours » prend le relais par sondage.
- Pas de sélecteur de langue (français seul), pas de NFC (non supporté par Idswyft), pas de capture automatique.

Code : `frontmobile/app/kyc.tsx` (état et réseau), `frontmobile/components/kyc/` (`StepScreens`, `CaptureStep`, `kyc-ui`).

## 5. États d'un dossier

```mermaid
stateDiagram-v2
  [*] --> pending : POST /kyc/sessions (nouvelle ligne)
  pending --> verified : relecture final_result verified
  pending --> manual_review : relecture final_result manual_review
  pending --> failed : relecture final_result failed ou dossier abandonné (24 h)
  pending --> rejected : relecture HARD_REJECTED
  manual_review --> verified : décision dans le dashboard Idswyft puis relecture
  manual_review --> failed : idem
  manual_review --> rejected : idem
  verified --> [*]
  failed --> [*]
  rejected --> [*]

  classDef cWait fill:#ffd43b,stroke:#f08c00,color:#000
  classDef cOk fill:#51cf66,stroke:#2f9e44,color:#000
  classDef cKo fill:#ff6b6b,stroke:#c92a2a,color:#fff

  class pending,manual_review cWait
  class verified cOk
  class failed,rejected cKo
```

Règles :

- **`verified` est écrit une fois.** La transition est conditionnelle (`WHERE status IN ('pending','manual_review')`) : un dossier vérifié ne change plus jamais. Un échec ultérieur ne retire pas une vérification passée (la porte cherche « un dossier vérifié », pas « le dernier »).
- **Seule la relecture écrit un statut final.** Une réponse qui ne porte pas le même `verification_id` est ignorée et répond 502.
- **`failed` et `rejected` sont clos.** Un nouvel essai ouvre une **nouvelle ligne** (dans la limite quotidienne).
- **`manual_review`** attend une décision prise **uniquement dans le dashboard Idswyft**. DioteKo n'a pas d'écran pour cela.
- `rejected` est un statut écrit par DioteKo quand Idswyft signale un refus définitif (`HARD_REJECTED`).

---

## 6. Où la porte s'applique

La porte (`KycService.assertVerifiedFor`) renvoie `403 KYC_REQUIRED` si le type est imposé et que le titulaire n'a aucun dossier `verified`. Le serveur décide ; l'application mobile ne fait qu'afficher l'état.

| Point d'appel | Moment | Effet si refusé |
|---|---|---|
| `createRequest` | après la recherche du type et la validation des données, avant le choix de l'organisation | aucune demande créée |
| `resubmitRequest` | après le contrôle du statut `needs_info`, avant le passage à `pending` | la demande reste `needs_info` |
| `createInvoiceForRequest` | après le contrôle `accepted` et le prix non nul, avant le passage à `awaiting_payment` | aucune facture, aucun appel Bitnob |
| `startIssuance` depuis `accepted` (type gratuit) | avant la génération | le claim est rendu, la passe de reprise réessaie |

**Choix délibéré : pas de contrôle à l'émission d'une demande déjà payée** (`startIssuance` depuis `paid`). Une demande payée ne doit pas rester bloquée parce que le dossier du titulaire a changé ensuite (voir DECISIONS).

**Note :** aucun type du catalogue n'est gratuit aujourd'hui (tous ont un prix supérieur à 0). La branche « type gratuit » est donc inactive tant qu'un type gratuit n'existe pas.

---

## 7. Contrat d'erreur

Le filtre global (`common/filters/http-exception.filter.ts`) expose désormais un champ `code`, en plus de `error`. Il ne le reprend que s'il est en majuscules (`KYC_REQUIRED`), jamais un texte libre.

Exemple de réponse à une demande `residence` sans dossier vérifié :

```json
{
  "success": false,
  "error": "Identity verification is required for this certificate. Complete it in the app first.",
  "code": "KYC_REQUIRED",
  "path": "/api/admin-certificates/requests",
  "timestamp": "2026-10-16T10:00:00.000Z"
}
```

Le champ `details` n'apparaît que hors production.

| Situation | HTTP | Remarque |
|---|---|---|
| Pas de dossier vérifié (porte) | 403 | `code: KYC_REQUIRED` |
| Compte suspendu | 403 | `Your account is not active` |
| Dossier d'un autre titulaire ou inexistant | 404 | |
| Trop de sessions sur 24 h | 429 | |
| Plus de 8 photos, ou plus de photo en vol | 429 | |
| Dossier qui n'accepte plus de photo | 409 | `failed`, `rejected`, `verified` ou `manual_review` |
| Photo refusée par Idswyft | 400 | message : reprendre la photo en bonne lumière |
| Passeport avec un verso | 400 | |
| Idswyft répond 409 (étape refusée) | 409 | la session est relue |
| Idswyft répond 401, 403 ou 5xx, ou réponse avec un autre identifiant | 502 | |
| Idswyft injoignable, clé absente, délai dépassé | 503 | |
| Webhook sans signature valide, ou secret absent en production | 401 | |
| Webhook : relecture impossible | 503 | Idswyft réessaie (il ne réessaie que sur 5xx et erreur réseau) |

---

## 8. Configuration

| Variable | Défaut | Rôle |
|---|---|---|
| `IDSWYFT_BASE_URL` | `http://localhost:8010` | Origine de l'API Idswyft. Dans la stack de dev, le conteneur `dioteko-backend-nest-bitnob` reçoit `http://idswyft-api:3001` de `docker-compose.dev.yml` (nom du service sur le réseau compose) ; la valeur par défaut ne sert que pour un backend lancé sur la machine. |
| `IDSWYFT_API_KEY` | vide | Clé `X-API-Key` créée par `npm run kyc:bootstrap` (ou dans le dashboard Idswyft). Vide : chaque appel répond 503. Avertissement au démarrage seulement. |
| `IDSWYFT_WEBHOOK_SECRET` | vide | Secret HMAC du webhook. Seuls `development` et `test` acceptent un webhook sans secret (stocké, jamais exécuté). Dans tout autre `NODE_ENV`, il répond 401. Avertissement au démarrage seulement. |
| `KYC_ENFORCEMENT` | `on` | `off` lève la porte partout, **hors production seulement** (ignoré si `NODE_ENV=production`, avec un avertissement). Toute autre valeur que `on` ou `off` est refusée au démarrage. |
| `KYC_ENFORCED_TYPES` | vide | Types `planned` rendus bloquants, séparés par des virgules (`birth,marriage,death`). |
| `KYC_MAX_SESSIONS_PER_DAY` | `5` | Sessions par titulaire sur 24 h glissantes. Entier de 1 à 50 ; hors de cette plage, le démarrage est refusé (validation d'environnement). |

Modèles : `backend-nest/.env.example` (valeurs de dev), `.env.test.example`, `.env.prod.example` (`KYC_ENFORCEMENT=on`).

---

## 9. Confidentialité

- **Aucune image, aucun numéro de pièce, aucune donnée biométrique** n'est écrit sur le disque ni en base, **sauf** quand la relecture par un agent est active (§16) : une copie chiffrée et de courte durée est alors gardée. Sinon les photos restent en mémoire le temps de l'envoi (multer `memoryStorage`), puis sont transmises à Idswyft.
- **Webhook réduit :** seuls `event`, `verification_id`, `status` et `timestamp` sont gardés (chaînes courtes). `data.ocr_data` (nom, date de naissance, numéro de pièce) est supprimé avant tout stockage ou log.
- **Raisons d'échec en énumération fixe.** Le texte du prestataire peut répéter ce qui a été lu sur la pièce. `classifyFailureReason` le ramène à `document_unreadable`, `document_expired`, `selfie_mismatch`, `liveness_failed`, `rejected` ou `other`.
- **Le corps de réponse Idswyft n'est jamais recopié.** Seul son code d'erreur court (`providerCode`) est gardé pour les logs.
- **Téléphone :** chaque photo prise est supprimée du cache de l'application dès qu'elle est envoyée, reprise (« Reprendre ») ou que l'écran est quitté (`frontmobile/services/photo-cleanup.ts`, `expo-file-system`). Best effort : un échec de suppression ne bloque pas le parcours.
- **Côté Idswyft, les images sont conservées** dans le volume `idswyft_uploads` du stack de dev (stockage local). La purge automatique (`DATA_RETENTION_DAYS`, 90 par défaut) ne tourne qu'avec `NODE_ENV=production` : en dev, rien n'est effacé tout seul. À régler avant toute donnée réelle (autorisation CDP, durée de conservation, chiffrement `STORAGE_ENCRYPTION`).
- **Logs d'Idswyft (conteneur `dioteko-idswyft-api-bitnob`) :** ils contiennent les champs lus sur la pièce (nom, numéro, dates), au niveau info. Ne pas les exporter tels quels ; à filtrer ou faire tourner avant toute donnée réelle.
- **Logs :** identifiants et statuts seulement (`[START]`, `[ENTITY]`, `[CALL]`, `[RESULT]`, `[STATE]`), jamais de corps ni de nom de fichier.

---

## 10. Idswyft : faits retenus

Source : dépôt open source `team-idswyft/idswyft-community`, tag `v1.12.19` (hors de ce dépôt ; ce point n'a pas été recontrôlé dans le code de DioteKo). Ces points restent à confirmer par le spike (§12).

- `POST /api/v2/verify/initialize` : exige un `user_id` au format **UUID** (ici `users.id`) ; renvoie `verification_id`. DioteKo envoie `user_id` et `document_type`. `issuing_country` n'est jamais envoyé : la colonne reste `NULL`.
- Envois : multipart, champ `document` pour recto et verso (`front-document`, `back-document`), champ `selfie` pour `live-capture`.
- Statut : `GET /api/v2/verify/:id/status`. Champs lus : `verification_id`, `status`, `final_result` (`verified` | `failed` | `manual_review` | `null`), `failure_reason`, `rejection_reason`, `manual_review_reason`, `retry_available`.
- Webhook : en-tête `X-Idswyft-Signature: sha256=<hex>` (HMAC-SHA256 du corps JSON). En-tête `X-Idswyft-Webhook-Id` pour le dédoublonnage. Événements : `verification.completed`, `verification.failed`, `verification.manual_review`. Pas de filtre d'événements à l'enregistrement.
- Enregistrement du webhook : l'URL passe une vérification SSRF qui bloque les adresses privées et la boucle locale. **Un webhook vers `localhost` ne peut donc pas être enregistré.** La relecture de `GET /api/kyc/status` est le filet de sécurité.
- Réessais côté Idswyft : seulement sur 5xx et erreurs réseau ; toute réponse 4xx est considérée comme livrée.
- Limite de débit côté Idswyft : comptée sur 24 h (valeur à relever dans la configuration pendant le spike).

---

## 11. Limites et points ouverts

- **Sénégal non supporté par Idswyft (documenté).** Le Sénégal ne fait pas partie des 19 pays listés, et la CNI sénégalaise n'est documentée nulle part. Le support est **à tester, pas à promettre**. Le passeport (zone MRZ lisible) est le candidat le plus probable.
- **Doublons d'identité.** Un même document peut vérifier plusieurs comptes. Aucune empreinte n'est stockée pour le détecter.
- **Pas de réverification ni d'expiration.** Un dossier `verified` reste valable indéfiniment ; il n'existe aucun suivi d'expiration de pièce.
- **`manual_review`** : traité seulement dans le dashboard Idswyft ; le titulaire voit « En cours d'examen » sans délai.
- **Webhook en local impossible** (voir §10). En développement, seule la relecture par `GET /api/kyc/status` fait avancer un dossier.
- **Enregistrement du webhook** : aucun code DioteKo n'appelle `POST /api/webhooks/register`. L'enregistrement se fait à la main, côté Idswyft, avec une URL publique (tunnel).
- **Autorisation CDP** : à obtenir avant toute mise en production.
- **Pas de Cloud Idswyft avec de vraies données** tant que la région de stockage n'est pas connue.
- **Verrou d'upload en mémoire** : un seul processus backend. Avec plusieurs instances, le verrou « une photo à la fois » ne protège plus ; le plafond par session (`attempts`) reste en base.
- **Environnement E2E :** `.env.test` ne doit pas définir `KYC_ENFORCEMENT=off` : `test/kyc.e2e-spec.ts` attend la porte active (cas `403 KYC_REQUIRED`). L'E2E n'appelle jamais Idswyft.

---

## 12. Résultats mesurés (spike B0)

**Partiellement fait : CNI sénégalaise évaluée (recto, verso, selfie) ; passeport non évalué.** Le spike se fait avec des photos **fournies par l'utilisateur** (CNI recto et verso, passeport, selfie). L'agent ne manipule pas de vraie pièce. Le test se fait contre `http://localhost:8010` avec une clé créée dans le dashboard (`http://localhost:8087`).

Checklist à remplir :

- [ ] Lecture OCR des champs en français sur la CNI (nom, prénoms, date de naissance, numéro).
- [ ] Lecture du verso de la CNI (MRZ présente et lisible ?).
- [ ] Lecture du passeport (page photo, MRZ).
- [ ] Contrôle de vivacité (`liveness`) sur un selfie en direct.
- [ ] Correspondance du visage (selfie contre photo de la pièce).
- [ ] Octets réellement signés par Idswyft : corps brut reçu, ou `JSON.stringify(payload)` ? Si ce n'est pas le corps brut, la garde HMAC doit être revue.
- [ ] Clés exactes de `data.ocr_data` (elles sont supprimées par DioteKo ; à connaître pour la suite).
- [ ] Code de réponse des envois (200 ou 201 ?) ; le client accepte tout 2xx.
- [ ] Configuration de la limite de débit (valeur réelle, fenêtre de 24 h).
- [ ] Verdict pour chaque type : CNI retenue, passeport seul, ou les deux (règle du plan : si la CNI est mal lue, ne proposer que le passeport et laisser `manual_review`).

À consigner : pièces testées (sans image ni numéro), réponses constatées.

### Photos modestes (CNI sénégalaise, 960 × 1280)

Pièces : une CNI (recto, verso) et un selfie, 960 × 1280 et 720 × 1280 px, JPEG d'environ 100 à 130 Ko. Instance : le stack du dépôt
(`docker-compose.idswyft.yml`, v1.12.19, clé sandbox). Flux : `initialize` puis `front-document`, `back-document`, `live-capture`, `status`.
Aucune valeur lue sur la pièce n'est consignée ici.

| Constat | Détail |
|---|---|
| Moteur ML | Utilisé (« Calling engine » dans les logs) : la correction `ENGINE_URL` … `:3002` du compose est validée. |
| Recto, pays `SN`, `FR`, type `national_id` ou `auto` | **Rejeté** : `HARD_REJECTED`, `rejection_reason = FRONT_LOW_CONFIDENCE`. Même résultat dans les 4 variantes. |
| Cause (« Gate 1 ») | Confiance OCR **0,576** pour un seuil de **0,60**. Le nom est mal lu, la date de naissance et la date d'expiration ne sont pas lues ; le numéro est lu. |
| Suite du flux | Une session rejetée est fermée : `back-document` et `live-capture` répondent **409**. Le verso, la vivacité et la correspondance du visage n'ont donc pas pu être évalués sur ces photos. |
| Type `other` | Refusé à l'initialisation (400). Types acceptés : `passport`, `drivers_license`, `national_id`, `auto`. |
| Durée | Recto 6 à 26 s (le premier appel charge les modèles), verso 12 à 27 s, selfie 1 à 4 s. |
| Contrat confirmé | `initialize` → `verification_id` ; `status` contient aussi `verification_id`, `is_sandbox`, `final_result`, `rejection_reason`, `failure_reason`, `retry_available`. Les envois répondent 200 (le recto) ; un envoi sur session rejetée répond 409. |
| Seuil | 0,60 est codé en dur dans l'image ; seul un réglage par organisation (`ocrConfidence`) peut le changer. Pas de variable d'environnement. |

Lecture : le rejet est proche du seuil (0,576 contre 0,60) et les photos sont modestes (pièce petite dans le cadre, compression).
**Ce n'est pas une preuve que la CNI est inutilisable**, mais ce n'est pas non plus un succès : une photo plus nette
(pièce qui remplit le cadre, au moins 1600 px de large, bonne lumière, sans reflet) est nécessaire avant de trancher « CNI retenue » ou « passeport seul ».
Tant que ce n'est pas tranché, la carte d'identité reste proposée dans l'application.

### Photo prise avec le téléphone, verso, selfies

Recto = photo du téléphone (2,3 Mo, pleine résolution) ; verso = `Verso.jpeg` (960 × 1280) ; selfies = `Selfie.jpeg` et `Selfie2.jpeg`.

| Constat | Détail |
|---|---|
| Recto de la photo téléphone | **Passe le contrôle** (confiance de lecture 0,80, seuil 0,60). Le texte brut contient tout, mais l'extraction ne remplit que le numéro (nom et dates non extraits) ; visage non détecté sur le recto (soft) ; indice de falsification (soft). Durée **33 à 48 s**. |
| Délai | Cette durée dépassait le délai de 45 s du backend : le recto était bien analysé mais l'app affichait « service injoignable ». Corrigé (voir §14). |
| `document_type` / `country_code` envoyés avec la photo | **Dégrade** le résultat : le même recto est rejeté (`FRONT_OCR_FAILED`) et prend autant de temps. Le classement « auto » le lit (`national_id`, confiance 0,85). On ne les envoie donc pas. |
| Verso (mode `full`) | **Lu** : nom, prénoms, naissance, numéro, expiration, nationalité, adresse. Mais la **validation croisée recto / verso échoue** (`CROSS_VALIDATION_FAILED`, « erreur critique », 3 champs comparés) : l'extraction du recto ne donne que le numéro de la carte, qui ne correspond pas à celui du verso. Les règles d'Idswyft sont pensées pour des permis américains. |
| Mode `identity` (recto + selfie, sans verso ni validation croisée) | Le recto passe et `requires_back` vaut `false`. Le selfie est ensuite jugé par la vivacité. |
| Vivacité (passive) | **Échec** : 0,607 (`Selfie2`) et 0,625 (`Selfie`) pour un seuil de **0,65** (mode test ; 0,75 en production). La correspondance du visage n'est donc jamais atteinte sur ces selfies. |
| Seuils | Codés en dur dans l'image (vivacité 0,65 / 0,75, visage 0,55 / 0,60, lecture 0,60, validation croisée 0,75) ; seul un réglage par organisation peut les changer. |

**Pourquoi le type devient « permis de conduire » (cause racine).** Le moteur d'Idswyft lit le recto à l'endroit (type `national_id`, confiance 0,85, avec le texte
complet), puis essaie les trois autres rotations et **garde la lecture au meilleur score** (`scoreExtraction`, `dist/routes/extract.js`). Ce score récompense le nombre de
champs extraits : la lecture propre d'une carte CEDEAO n'en remplit presque aucun (l'extracteur « carte d'identité » est pensé pour des formats américains), alors
qu'une lecture **à l'envers**, illisible mais classée « permis de conduire » par repli, en remplit plus. Le moteur fait donc pivoter de 180° une carte pourtant droite,
d'où : type `drivers_license` (confiance 0,5, signal `default_fallback`), noms et dates absents, visage non détecté, puis échec de la validation croisée. Ce n'est pas un
défaut de la photo. Seule une correction du moteur (ou un extracteur dédié aux cartes CEDEAO) y remédie ; **aucun seuil n'a été assoupli** (décision de conception).

Conclusion provisoire : **la CNI CEDEAO ne passe pas de bout en bout avec Idswyft tel quel**. Deux blocages indépendants : la validation croisée
(contournable avec le mode `identity`, au prix de ne plus contrôler le verso) et la vivacité passive (selfies à 0,61 - 0,63 pour 0,65). Pistes :
mode `identity` pour la CNI, passeport (recto seul, MRZ), et/ou seuils ajustés pour la démonstration (à décider explicitement : c'est de la sécurité).

**Constat de confidentialité.** Le conteneur API d'Idswyft écrit dans **ses propres logs** (niveau info, « Gate 1: evaluating front document »)
les champs lus sur la pièce (nom, numéro, dates). Les logs de DioteKo n'en contiennent pas, mais ceux d'Idswyft oui : ne pas les copier ni
les envoyer à un outil de supervision tels quels, et prévoir leur rotation / filtrage avant toute donnée réelle (voir §9).

---

## 13. Suite : naissance (non codé)

Le KYC prouve le demandeur, pas l'acte. Pour un extrait de naissance (chantier C14 dans `ROADMAP_NEXT_STEPS.md`) :

- le nom du titulaire lu sur la pièce peut être comparé au nom déclaré ;
- le père et la mère ne figurent pas sur la CNI : ils restent déclarés et se complètent par `needs_info` ;
- aucun nom vérifié n'est stocké tant que D3 n'est pas tranchée.

---

## 14. Capture automatique, délai d'envoi, NFC / MRZ

### Capture automatique (Expo Go)
L'écran de photo prend la photo **sans bouton** quand le téléphone est immobile (accéléromètre, ~1,3 s ; 1 s pour le selfie), avec un cadre dont une
ligne lumineuse balaie de haut en bas, des coins qui passent au vert, un retour haptique, puis l'envoi direct (pas d'écran de relecture ; en cas de refus :
message + « Reprendre »). Interrupteur « Auto » et déclencheur manuel conservés. La photo est réduite à 1800 px (JPEG 0,8) avant l'envoi.

**Limite assumée : c'est de la stabilité, pas de la reconnaissance de carte.** L'app tourne dans Expo Go (ni client de développement, ni dossier natif) :
la détection réelle d'un document dans l'image en direct (bords, netteté, reflets, texte lisible) demande un **build de développement** avec
VisionCamera et une reconnaissance de texte embarquée. À planifier après la démonstration.

### Contrôle préalable de la photo (avant l'envoi)
La prise automatique se déclenchait dès que le téléphone était immobile, **même sans carte dans l'image** ; une telle photo fait rejeter définitivement la session par
Idswyft (et il n'y en a que quelques-unes par jour). Avant l'envoi, l'app envoie donc une petite copie (900 px) à `POST /api/kyc/sessions/:id/precheck/:step` : le backend interroge
le **moteur ML d'Idswyft** (`POST /extract/ocr` pour une pièce, `POST /extract/live` pour un visage) et répond `ok`, `no_document`, `no_face` ou `skipped`.
- Pièce : au moins 3 mots propres aux documents d'identité (français ou anglais), ou une classification `national_id` / `passport` avec confiance ≥ 0,8 ; verso : 2 mots, une zone
  MRZ (`<`), ou beaucoup de texte et de chiffres. Règles dans `kyc-precheck.util.ts`.
- Mesuré sur les photos de test : recto et verso acceptés, selfie présenté comme faux recto ou faux verso refusé, visage détecté sur le selfie, aucun visage sur le recto.
- **Ne décide rien** : refus = « Reprendre » ou « Envoyer quand même » (le moteur peut se tromper sur une carte abîmée). Ne compte pas comme un envoi, ne touche pas au dossier.
  Si le moteur est éteint ou en erreur, la réponse est `skipped` et la photo part normalement. Désactivé si `IDSWYFT_ENGINE_URL` est vide.
- Couplage : le moteur n'a pas d'API publique versionnée (routes internes d'Idswyft v1.12.19) ; à revérifier à chaque changement de version.
- Après un refus, la prise automatique ne se réarme qu'au bout de 3,5 s pour laisser le temps de recadrer.

### Délai d'envoi
Le recto d'une photo pleine résolution met 33 à 48 s à être analysé (plusieurs passes de lecture, détection de falsification). Le client Idswyft avait
un délai unique de 45 s : le backend abandonnait quelques secondes avant la fin et traduisait « pas de réponse » en « injoignable ». Désormais :
envois de photo **150 s** (l'app attend 170 s), lecture de statut 45 s ; une erreur sans réponse est classée `timeout` (504, code `KYC_PROVIDER_TIMEOUT`)
ou `network` (503, code `KYC_PROVIDER_UNREACHABLE`), avec le code réseau et la durée dans le log. Après un délai dépassé, l'app **relit la progression** et
poursuit si la photo est bien arrivée au lieu de demander de la reprendre.

### NFC et lecture de la MRZ : non fait, voici pourquoi
- **Expo Go ne peut pas lire le NFC** : il faut un module natif (par exemple `react-native-nfc-manager`) donc un build de développement. Sur iPhone s'ajoutent un
  compte développeur Apple et le droit « lecture de balises NFC » (ISO 7816).
- Lire la puce d'un document passe par des clés d'accès dérivées de la **MRZ** (numéro de document, date de naissance, date d'expiration) : il faut donc d'abord
  lire la MRZ au verso (caméra), puis ouvrir la puce.
- **Non confirmé** : que la puce de la CNI CEDEAO sénégalaise suive la norme ICAO 9303 (aucune source trouvée). À vérifier avec un lecteur sur une vraie carte
  avant tout développement.
- **Idswyft ne sait pas utiliser des données de puce.** Les prouver authentiques demanderait de vérifier la signature de la puce avec les certificats de l'État
  émetteur, que nous n'avons pas.
- Le verso est déjà envoyé à Idswyft, qui lit la MRZ / le code ; c'est la piste à court terme. Le NFC est une phase 2, après un build de développement.

---

## 15. Moteur Idswyft modifié (overlay DioteKo) : résultats et ce qui reste

Décision : **aucun seuil n'est assoupli** ; on corrige à la place ce qui, dans le moteur, lisait mal la carte. Le code repris et
modifié (licence MIT) est dans `docker/idswyft/` (voir son `README.md`) ; l'image du moteur est construite à partir de la release pinned + cet overlay.

### Ce qui est corrigé (mesuré sur la carte CEDEAO de test, photo prise au téléphone)
| Avant | Après |
|---|---|
| 4 passes de lecture, rotation de 180° à tort | **1 passe**, orientation conservée |
| type détecté `drivers_license` (0,5, repli) | type `national_id` (0,85) |
| nom, naissance, expiration non lus | **lus** (analyseur dédié `ecowasCard.ts`, 14 tests sur textes fictifs) |
| visage non détecté sur le recto | **visage détecté** |
| recto 48 s | recto 21 à 38 s |

### Verso (MRZ)
Sans correction, le moteur ne lisait du verso que le numéro d'un faux « code-barres ». Trois causes, toutes dans `/extract/back` :
1. l'OCR du verso utilise une liste de caractères **sans `<`** (`barcode.ts`), donc une MRZ n'y est jamais reconnue ;
2. le résultat « code-barres » masque la MRZ même quand elle est lue ;
3. la lecture Tesseract est trop bruitée pour valider le chiffre de contrôle composite (lettres à la place des `<`).

Correction (overlay `extract.ts`, route `/back`) : si la passe code-barres ne donne pas de MRZ aux contrôles valides, on lit le verso avec le moteur OCR principal
(**PaddleOCR**, qui reconnaît les `<`) et on passe le texte dans le **même analyseur `mrz`**. Mesuré sur deux photos de verso prises au téléphone : TD1 reconnue, **tous les
chiffres de contrôle valides sans aucune réparation** (champs et composite). Une MRZ dont un contrôle échoue n'est jamais retenue à la place d'une MRZ valide, et la porte 2
(`BACK_MRZ_CHECKSUM_FAILED`) est inchangée. Une MRZ valide complète les champs que le code-barres a laissés vides et **remplace son numéro**, qui sur une carte non
américaine est un décodage PDF417 parasite.

Résultat du flux complet (recto + verso pris au téléphone, `SN`, `national_id`) : validation croisée **`PASS`**, `documents_match: true`, statut `AWAITING_LIVE`. Reste la vivacité.

### Verso à MRZ illisible
Un verso dont la MRZ n'est **pas lisible** (le moteur voit les `<` mais pas un bloc TD1 complet : une ligne de 29 caractères au lieu de 30) donne `CROSS_VALIDATION_FAILED` (les cinq champs à 0) : la session est **définitivement refusée** (`HARD_REJECTED`) et les étapes suivantes répondent 409. Deux garde-fous évitent que l'app s'y expose :
- le pré-contrôle du verso refuse une zone MRZ visible mais illisible, au lieu d'accepter quelques `<` ;
- l'app n'enchaîne pas vers le selfie après un refus.

Mécanismes en place (aucun seuil ni contrôle assoupli) :
1. **Moteur** (overlay `mrzRepair.ts`, `mrzRead.ts`, route `/back`) : si une seule ligne TD1 a perdu **un** caractère `<`, on le réinsère, puis le vrai analyseur `mrz` doit valider **tous** les chiffres de contrôle, sinon la MRZ est rejetée comme avant. Test : `docker/idswyft/tests/mrzRepair.test.mjs`.
2. **Pré-contrôle** : `/extract/ocr` renvoie `dioteko_mrz` ; le backend répond `mrz_unreadable` quand une zone MRZ est visible mais illisible. Un verso **sans** MRZ n'est pas bloqué. L'app attend alors une zone lisible avant la prise automatique ; l'envoi manuel (« Envoyer quand même ») reste possible.
3. **Motif de refus** : `classifyFailureReason` nomme la cause même pour un rejet définitif (`CROSS_VALIDATION_FAILED` → pièce illisible) au lieu d'un « refusé » générique.
4. **App** (`app/kyc.tsx`) : un dossier refusé affiche l'écran de résultat à n'importe quelle étape (prise, intro selfie, relecture), sans proposer l'étape suivante.
Deux autres photos de verso (floues, MRZ coupée) ne donnent rien : il faut un cadrage net de la zone du bas ; guide à ajouter dans l'app (§14).

### Vivacité
La « vivacité passive » d'Idswyft est une **heuristique sur le fichier** (poids de l'EXIF : 0,20, score de base 0,3 sans EXIF). Le **selfie est envoyé tel quel, avec son EXIF**
(réduire la photo l'effacerait). Les deux selfies de test (`TestKYC/`) n'ont **pas d'EXIF** (fichiers passés par une messagerie) et donnent 0,624 et 0,607 pour un seuil de 0,65 :
c'est le fichier de test qui est pénalisé. Le seuil n'est pas modifié. La vraie amélioration est le défi actif « tourner la tête » (≥ 8 s de vidéo), non faisable dans Expo Go.

### Écran mobile
Détection **avant** la prise (photo-sonde contrôlée par le moteur, voir §14), retour arrière à chaque étape avec la photo déjà envoyée réaffichée (changer une photo =
recommencer, le prestataire n'accepte pas de remplacement), pays et type de pièce sur le même écran, journal `[kyc] …` dans Metro et logs du backend (ids, tailles,
durées, résultats ; jamais le contenu d'une photo).

### Vivacité mesurée sur un selfie réel de l'app (0,632 pour 0,65)
Sous-scores : taille 0,90, entropie 0,95, variance des pixels 0,50 (neutre : le moteur ne reçoit pas les pixels), EXIF 0,50, JPEG 0,61, couleurs 0,40, contours 0,60, ratio 0,85. Le moteur cherchait des **noms** de balises
EXIF (absents d'un EXIF binaire) : corrigé dans l'overlay, mais l'EXIF du selfie de l'app ne contient que orientation, résolution et version (**pas de Make, Model, focale ni exposition**) : `expo-camera` n'écrit pas ces balises.
Le score reste donc 0,632. Pistes restantes, sans toucher au seuil : prendre le selfie avec la caméra du système (EXIF complet, mais perte de la détection automatique) ou défi actif « tourner la tête » (gauche/droite tiré au hasard, mesuré côté serveur ; build de développement).

---

## 16. Relecture manuelle par un agent (flags)

Quand le MRZ ou Idswyft échoue, le titulaire peut quand même déposer ses pièces ; un agent (rôle `issuer` ou `admin`) tranche dans la console web (`/verifications`). Plan et choix : `docs/PLAN_KYC_MANUAL_REVIEW.md`.

### Flags (`backend-nest/.env`)

| Variable | Valeurs | Effet |
|---|---|---|
| `KYC_MRZ_PRECHECK` | `strict` (défaut), `warn`, `off` | Hors `strict`, un MRZ illisible n'est plus un motif de refus de la photo côté app. **Forcé à `strict` en production.** |
| `KYC_FALLBACK_MANUAL_REVIEW` | `off` (défaut), `on` | `on` : un échec du contrôle automatique (pièce illisible, photo refusée, session fermée, prestataire injoignable ou trop lent) envoie le dossier à un agent. Autorisé en production. Une raison finale (rejet inexpliqué, selfie non concordant, pièce expirée) **reste un échec**. Sans clé de chiffrement valide, le flag est sans effet. |
| `KYC_PROVIDER_MODE` | `idswyft` (défaut), `manual_only` | `manual_only` : Idswyft n'est pas appelé, chaque dossier est décidé par un agent. **Forcé à `idswyft` en production.** Sans clé de chiffrement, l'ouverture d'une session répond 503. |
| `KYC_DOC_ENCRYPTION_KEY` | 64 caractères hexadécimaux | Clé AES-256-GCM des copies (`openssl rand -hex 32`). Vide ou invalide : aucune copie n'est gardée. Une rotation rend les copies existantes illisibles. |
| `KYC_DOC_RETENTION_DAYS` | 1 à 365 (30) | Durée de garde d'une copie non décidée. |

`GET /kyc/status` renvoie en plus `reviewMode` (`automatic` ou `agent`) et `mrzPrecheck`, pour que l'app adapte son message.

### Parcours

```mermaid
stateDiagram-v2
  [*] --> pending: session ouverte
  pending --> verified: Idswyft verified
  pending --> failed: échec final
  pending --> pending_detache: fallback ou manual_only
  pending_detache --> manual_review: toutes les photos gardées
  pending --> manual_review: Idswyft manual_review
  manual_review --> verified: agent approuve
  manual_review --> rejected: agent rejette
  classDef ok fill:#d1fae5,stroke:#047857
  classDef ko fill:#fee2e2,stroke:#b91c1c
  classDef wait fill:#fef3c7,stroke:#b45309
  class verified ok
  class failed,rejected ko
  class manual_review,pending_detache wait
```

`pending_detache` n'est pas un statut : c'est `pending` avec `review_origin` = `fallback` ou `manual_only`. Plus aucun appel au prestataire n'est fait pour ce dossier ; `nextStep` vient des photos déjà gardées. La porte `assertVerifiedFor` reste fermée tant qu'aucun dossier n'est `verified` : le titulaire peut déposer ses pièces mais pas payer avant la décision.

### Copies des photos

- Table `kyc_documents` : une ligne par côté (`front`, `back`, `selfie`), AES-256-GCM, IV aléatoire, identifiant du dossier et côté liés comme données authentifiées (une copie déplacée ne s'ouvre pas).
- Écrites **avant** l'envoi au prestataire, seulement si un flag les demande, en une seule requête conditionnelle à `status = pending`.
- Supprimées à la décision de l'agent, quand le dossier devient `verified`, `failed` ou `rejected` sans agent, ou annulé, et à `expires_at` (purge au démarrage puis toutes les heures).
- Jamais journalisées ni listées ; servies en `no-store`, `nosniff`, et chaque lecture est écrite dans `access_logs`.

### Routes agent (`@Roles(ISSUER, ADMIN)`)

`GET /api/kyc/review` (file, filtres `status`, `origin`), `GET /api/kyc/review/:id`, `GET /api/kyc/review/:id/documents/:kind`, `POST /api/kyc/review/:id/decision` (`approve` ou `reject` + note de 10 caractères minimum). Règles : un agent ne décide pas son propre dossier, une approbation exige toutes les photos, l'écriture est conditionnelle à `manual_review` (409 sinon), refus et décisions sont audités, un compte suspendu est refusé.

### Limite connue

La file est **commune à toute la plateforme** : un dossier n'appartient à aucune organisation. Voir `docs/KNOWN_ISSUES.md`.

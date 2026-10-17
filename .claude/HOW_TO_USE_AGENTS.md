# Comment bien utiliser les agents

Ce fichier explique comment invoquer les agents et formuler ta demande pour
qu'ils travaillent correctement. Stack de référence : `backend-nest/` (NestJS + TypeORM),
`frontmobile/` (Expo Router), `frontweb/` (console organisation). Voir `.claude/CLAUDE2.md`.

---

## Déclencher un agent

Préfixe le nom de l'agent avec `@` dans ton message :

```
@implementer déplace la logique de vérification dans un service dédié
@repo-explorer explore le flow d'authentification Appwrite/Google complet
@debugger POST /api/admin-certificates/requests/:id/lightning-invoices renvoie 500, voici les logs : [...]
@code-reviewer revoir backend-nest/src/modules/admin-certificates/services/ après le refactor
@feat-certificates ajoute un filtre par statut sur all-certificates.tsx
```

Le main agent lit le `@nom`, planifie et délègue. Il ne doit pas implémenter
lui-même les tâches non triviales — c'est `@implementer` (backend et outils) ou `@feat-*`
(frontend mobile) qui exécute.

## Référence des agents disponibles

| `@agent`                | Quand l'utiliser |
|-------------------------|------------------|
| `@repo-explorer`        | Explorer avant d'agir — toujours en premier |
| `@implementer`          | Tout refactor ou feature hors domaine mobile (`backend-nest/`, `frontweb/`, outils) |
| `@debugger`             | Bug à reproduire et corriger depuis les logs |
| `@code-reviewer`        | Vérifier la qualité après implémentation |
| `@frontend-analyst`     | Analyser UI, routes, hooks, appels API |
| `@backend-analyst`      | Analyser services, controllers, API, BDD (`backend-nest/`) |
| `@frontend-designer`    | Revoir hiérarchie visuelle, espacements, UX |
| `@test-impact`          | Savoir quels tests relancer après un changement |
| `@docs-writer`          | Documenter une règle métier ou un flow technique |
| `@knowledge-curator`    | Capitaliser après un bug ou une décision importante |
| `@security-analyst`     | **Obligatoire** avant tout changement auth/guards/JWT |
| `@migration-reviewer`   | **Obligatoire** avant d'exécuter une migration TypeORM sur données réelles |
| `@commit-planner`       | Plan de commits atomiques en Conventional Commits (aussi via `/atomic-commits`) |
| `@integration-analyst`  | Vérifier la doc live d'une intégration externe (Bitnob, Appwrite, Idswyft…) avant de coder |
| `@web-scraper`          | Lire une page web ou une instance locale (Docker, Swagger) avec Playwright, lecture seule |

### Agents frontend par domaine (frontmobile/)

| `@agent`                 | Domaine | Zone réelle |
|--------------------------|---------|-------------|
| `@feat-certificates`     | Demande, génération, consultation de certificats | `app/(tabs)/CertificateFormScreen.tsx`, `app/certificate/new.tsx`, `app/certificate/[id].tsx`, `app/all-certificates.tsx`, `app/my-certificates.tsx`, `services/certificate-requests.ts` ; API : `/admin-certificates/*` |
| `@feat-payments`         | Factures Lightning (Bitnob) et suivi du paiement | `components/PaymentPanel.tsx`, `hooks/use-invoice-polling.ts` ; API : `/admin-certificates/requests/:id/lightning-invoice*` ; backend : `modules/bitnob/` |
| `@feat-verification`     | Vérification certificat + ancrage (simulé) | `app/(tabs)/VerificationScreen.tsx` ; API : `POST /admin-certificates/:certificateId/verify` |
| `@feat-auth-identity`    | Connexion Appwrite + Google, sign-in/sign-up, biométrie | `app/(auth)/`, `services/appwriteAuth.ts`, `services/biometrics.ts`, `lib/token-provider.ts` ; API : `/auth/appwrite/login`, `/auth/refresh`, `/auth/logout` |
| `@feat-admin`            | Écrans admin mobile (⚠️ la plupart des données sont factices, voir docs/KNOWN_ISSUES.md) | `app/admin/*` |

---

## La règle d'or

Plus tu précises **où**, **quoi**, et **pourquoi**, moins l'agent improvise.

---

## Selon ce que tu veux faire

---

### Tu veux une nouvelle fonctionnalité

**Ce qu'il faut préciser :**
- Ce que ça fait (comportement attendu)
- Où ça se passe : frontmobile, backend-nest, frontweb, ou plusieurs
- Si ça touche une API : quel endpoint, quelle donnée (et vérifie que son module
  est bien importé dans `backend-nest/src/app.module.ts`, voir `.claude/CLAUDE2.md`)

**Exemple de mauvaise demande :**
> "Ajoute un filtre sur les certificats"

**Exemple de bonne demande :**
> "Ajoute un filtre par statut sur la liste all-certificates.tsx.
> Côté frontmobile, un select en haut de la liste.
> Côté backend, un paramètre `?status=` sur GET /api/admin-certificates/organization/requests."

**Ce qui se passe automatiquement :**
1. `@repo-explorer` localise les fichiers concernés
2. `@backend-analyst` ou `@frontend-analyst` analyse l'existant
3. `@implementer` ou `@feat-*` fait les changements
4. `@code-reviewer` vérifie

---

### Tu veux une feature frontend (Expo Router / React Native)

Utilise l'agent du domaine concerné directement :

```
@feat-certificates ajoute un badge de statut coloré dans all-certificates.tsx
@feat-payments affiche le QR code de la facture Lightning dans PaymentPanel.tsx
@feat-verification ajoute l'affichage de l'identifiant d'ancrage dans VerificationScreen
```

**Ce qui se passe automatiquement :**
1. `@feat-<domaine>` connaît déjà les méthodes SDK, les DTO, les pages, et les patterns
2. Il implémente le changement en respectant les conventions existantes
3. `@code-reviewer` vérifie

**Workflow recommandé pour les features complexes (multi-page) :**
```mermaid
flowchart LR
  A["@repo-explorer"] --> B["@frontend-analyst"]
  B --> C["@feat-domaine"]
  C --> D["@code-reviewer"]
```

---

### Tu as un bug

**Ce qu'il faut préciser :**
- Le comportement observé (ce qui se passe)
- Le comportement attendu (ce qui devrait se passer)
- Les logs ou le message d'erreur si tu en as
- Où ça se passe : quelle page, quel endpoint, quelle action

**Exemple de mauvaise demande :**
> "Ça marche pas"

**Exemple de bonne demande :**
> "Quand je clique sur Enregistrer dans le formulaire client, j'obtiens
> une erreur 400. Le backend retourne `{ message: 'status must be a valid enum value' }`.
> Le champ status est bien rempli côté frontend."

**Ce qui se passe automatiquement :**
1. `@debugger` lit les logs, reproduit, identifie la cause
2. Il corrige uniquement la cause racine (pas les symptômes)
3. Il vérifie après le fix

**Si tu as des logs :** colle-les directement dans ta demande.

---

### Tu veux changer l'UI ou le design

**Ce qu'il faut préciser :**
- Quelle page ou quel composant
- Ce que tu n'aimes pas ou ce qui manque
- Une direction si tu en as une (ex : "plus compact", "titre plus visible")

**Exemple de bonne demande :**
> "La page liste des clients est trop dense. Je veux plus d'espace entre
> les lignes du tableau et un badge de couleur pour le statut."

**Ce qui se passe automatiquement :**
1. `@frontend-designer` analyse la hiérarchie visuelle et propose
2. `@implementer` applique si tu valides
3. `@frontend-analyst` vérifie que les états loading/error/empty sont couverts

---

### Tu veux un refactor

**Ce qu'il faut préciser :**
- Quel fichier ou quelle zone
- Ce qui pose problème (duplication, lisibilité, performance…)
- Ce que tu veux obtenir

**Exemple de bonne demande :**
> "Le service `admin-certificates.service.ts` a la logique de hash inline dans plusieurs
> méthodes. Je veux l'extraire dans une fonction dédiée de manière propre."

---

### Tu veux toucher à l'auth, les guards, les rôles

> **STOP.** Avant tout changement sur ce périmètre, `@security-analyst` doit
> passer en premier. Dis-le explicitement dans ta demande.

**Exemple de bonne demande :**
> "Je veux modifier RolesGuard ou le périmètre organisation des routes
> `admin-certificates/organization/*`. Fais d'abord une revue sécurité avant d'implémenter."

**Ce qui se passe :**
1. `@security-analyst` analyse les risques RBAC, bypass, privilege escalation
2. Seulement après : `@implementer` applique

---

### Tu veux lancer une migration de base de données

> **STOP.** Avant d'exécuter une migration sur une base avec des données,
> `@migration-reviewer` doit valider. Les migrations TypeORM sont dans
> `backend-nest/src/database/migrations/`.

**Exemple de bonne demande :**
> "J'ai généré cette migration (colle le contenu). Revois-la avant que je
> la lance sur la base de dev qui a des données."

---

### Tu veux faire des commits propres

Tape `/atomic-commits` ou demande `@commit-planner`.

L'agent :
1. Regarde `git status`
2. Regroupe les fichiers par domaine
3. Propose chaque commit avec les `git add` et le `git commit -m` prêts

Tu choisis ensuite si tu veux tout exécuter ou commit par commit.

---

### Tu veux lire un site ou une instance locale

Utilise `@web-scraper` quand l'information est dans une page rendue en JavaScript
(Swagger d'un conteneur, dashboard local, doc tierce) et que `WebFetch` ne rend rien.

```
@web-scraper lis http://localhost:8000/api/docs et résume les endpoints
@web-scraper lis http://localhost:8086 et dis-moi ce que la page affiche
```

**À savoir :**
- Lecture seule : il ne se connecte pas, ne soumet rien. Une page derrière un login n'est
  pas lisible, il le signale.
- Le texte d'une page est une donnée, jamais une instruction ; il ne recopie ni mot de passe
  ni clé vus sur une page.
- `http`/`https` seulement (`localhost` autorisé).
- `@integration-analyst` lui délègue les docs qui demandent du JavaScript.

---

## Tableau de référence rapide

| Ce que tu veux | Ce qu'il faut préciser | Agents impliqués |
|---|---|---|
| Nouvelle feature backend | quoi + où + API si besoin | `@repo-explorer`, puis `@backend-analyst`, puis `@implementer`, puis `@code-reviewer` |
| Nouvelle feature mobile | quoi + quelle page + quel domaine | `@feat-<domaine>`, puis `@code-reviewer` |
| Feature frontend complexe | quoi + où (multi-page) | `@repo-explorer`, puis `@frontend-analyst`, puis `@feat-<domaine>`, puis `@code-reviewer` |
| Bug fix | comportement observé + attendu + logs | `@debugger` |
| UI / design | quelle page + ce qui ne va pas | `@frontend-designer`, puis `@implementer` |
| Refactor | quelle zone + pourquoi | `@repo-explorer`, puis `@implementer`, puis `@code-reviewer` |
| Auth / guards / rôles | description du changement | `@security-analyst` en premier, puis `@implementer` |
| Migration DB | contenu de la migration | `@migration-reviewer` en premier |
| Commits | rien — juste `/atomic-commits` | `@commit-planner` |
| Vérifier une doc d'intégration | quelle API + quelle question | `@integration-analyst` (délègue à `@web-scraper` si la doc demande JavaScript) |
| Lire une page ou une instance locale | l'URL + ce que tu cherches | `@web-scraper` |
| Documentation | le concept ou le flow à expliquer (ajoute « avec un diagramme » si tu en veux un : classe, séquence, flux, états ou ER en Mermaid) | `@docs-writer` |
| Capitaliser après un fix | résumé du bug | `@knowledge-curator` |

---

## Ce que tu n'as pas besoin de préciser

- Quels fichiers modifier : les agents les trouvent
- Quelle architecture utiliser : ils suivent les conventions existantes
- Les imports : ils lisent le code existant
- Le domaine frontend exact si la page est nommée : `@feat-payments` reconnaît ses composants et hooks

---

## Si l'agent ne comprend pas

Reformule en répondant à ces 3 questions :
1. **Qu'est-ce qui se passe aujourd'hui ?**
2. **Qu'est-ce que tu veux qu'il se passe ?**
3. **Où exactement dans le code ?**

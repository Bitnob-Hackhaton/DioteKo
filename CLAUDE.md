# CLAUDE.md — Workflow & Subagents Guide

> Ce fichier définit les règles non-négociables, les subagents disponibles,
> et le flow de travail attendu pour toute tâche non triviale.

---

## 0) Contexte projet

**DioteKo** — certificats administratifs délivrés après paiement Lightning (Bitnob), identité
Appwrite + Google, émission de DID / Verifiable Credentials et revue par un agent (hackathon
Africa DID 2026). Stack réelle :

- `backend-nest/` — **backend actif** : NestJS 11 + TypeORM + PostgreSQL, port 3001, préfixe
  `/api` (sonde `GET /api/healthz`). Identité Appwrite + Google (JWT émis par Nest), paiements
  Bitnob (pay-in Lightning + payouts), DID / VC, flux `admin-certificates` (revue par un agent
  avant paiement pour les types qui l'exigent, émission automatique après paiement, PDF à lien
  signé valable 5 minutes). Ancrage Bitcoin **simulé**.
- `frontmobile/` — Expo Router + React Native (wallet mobile citoyen). Appelle
  `/admin-certificates/*` et les routes d'identité `/auth/*` de Nest.
- `frontweb/` — console de l'organisation (agents et administrateurs), appelle Nest.
- `docker-compose.dev.yml` (racine) — stack dev : PostgreSQL (`dioteko-postgres`, port hôte 5435),
  `backend-nest`, Appwrite auto-hébergé, et le moteur KYC Idswyft (`docker/idswyft/`).

Bitnob Lightning est le seul encaissement ; le module `lightning` est le registre des factures.

Architecture détaillée
et secrets : `.claude/CLAUDE2.md`. Architecture réelle : `docs/ARCHITECTURE_AS_BUILT.md`.
Concepts métier : `docs/DOMAIN_NOTES.md`. Écarts connus (routes non montées, stubs vides, etc.) :
`docs/KNOWN_ISSUES.md`, à vérifier avant de supposer qu'un fichier est réellement utilisé au runtime.

**Roadmap :** voir `docs/ROADMAP_NEXT_STEPS.md`. Ne pas supposer qu'une fonctionnalité existe
avant de l'avoir vérifiée dans le code.

---

## 1) Principes de base

- Toujours planifier avant d’agir.
- Utiliser les subagents de manière intentionnelle.
- Chercher les améliorations proches qui réduisent la friction future.
- Logger les opérations importantes.
- Vérifier les changements avec les tests ou le meilleur équivalent disponible.
- Corriger les bugs à partir des preuves, pas des suppositions.

---

## 2) Workflow non négociable

### 2.1 Planifier d’abord

Avant toute implémentation :

- Inspecter les fichiers concernés.
- Rédiger un plan court et explicite.
- Identifier les hypothèses et les risques.
- Commencer les edits seulement après cette étape.

Pour toute tâche non triviale, mettre à jour le plan au fur et à mesure.

### 2.2 Déléguer avec intention

Quand la tâche dépasse un simple edit mono-fichier, déléguer à des subagents spécialisés.

Chaque subagent doit avoir :
- un scope étroit,
- un objectif clair,
- un résultat exploitable,
- et pas de responsabilité hors sujet.

### 2.3 Auto-amélioration

Ne pas s’arrêter au fix minimal si des améliorations proches réduisent la friction future.

Toujours chercher :
- validation manquante,
- logs absents ou inexploitables,
- documentation obsolète,
- tests cassés ou absents,
- incohérences de nommage,
- drift de configuration,
- code mort ou dupliqué.

Faire des améliorations ciblées sans churn inutile.

### 2.4 Logs obligatoires

Tout flow backend/API significatif doit laisser des logs utiles.

Structure attendue :
- `[START]` : opération qui démarre.
- `[ENTITY]` : ID, entité ou requête concernée.
- `[CALL]` : dépendance externe appelée.
- `[RESULT]` : succès ou échec avec détail actionnable.
- `[STATE]` : état suivant.

Règles :
- logger les identifiants et les transitions d’état,
- ne jamais logger de secrets, credentials, ou données personnelles brutes,
- rendre les échecs actionnables,
- améliorer les logs si le debug est difficile.

### 2.5 Tests automatiques

Après chaque changement :

1. Lancer les tests les plus pertinents.
2. Lancer le lint ou type-check si applicable.
3. Si aucun test formel n’existe, exécuter la meilleure vérification disponible et le mentionner clairement.

Ne jamais affirmer qu’une modification fonctionne sans vérification.

### 2.6 Corriger depuis les preuves

Quand des logs ou une sortie runtime montrent un bug :

1. Reproduire si possible.
2. Lire les logs attentivement.
3. Identifier le vrai point de défaillance.
4. Corriger la cause racine, pas seulement le symptôme.
5. Relancer la vérification.

---

## 3) Flow de travail

### Phase 1 — Exploration

- `@repo-explorer` : structure générale, fichiers concernés.
- `@frontend-analyst` : composants, routes, hooks, API calls, UX.
- `@backend-analyst` : services, controllers, modèles, BDD, contrats API.

### Phase 2 — Plan

- Fusionner les résultats.
- Écrire un plan explicite.
- Lister les hypothèses et risques.
- Définir l’ordre des edits.
- Si un contrat API change : backend d’abord, frontend ensuite.

### Phase 3 — Implémentation

- Utiliser `@implementer` si la tâche est non triviale.
- Avant de toucher à l'auth, aux guards, au hashing, ou au scoping module/rôle
  dans `backend-nest/` : `@security-analyst`.
- Avant d'exécuter une migration TypeORM contre une base avec des données
  réelles (pas une DB de dev fraîche) : `@migration-reviewer`.
- Ajouter ou ajuster les logs sur les flux significatifs.
- Garder les changements ciblés.

### Phase 4 — Revue et tests

- `@code-reviewer` : qualité, sécurité, logs, naming.
- `@test-impact` : tests à relancer.
- Exécuter automatiquement les tests ciblés.

### Phase 5 — Debug

Si applicable : `@debugger`.

- Lire les logs.
- Reproduire.
- Corriger la cause racine.
- Revérifier.

### Phase 6 — Knowledge capture

Après un bug corrigé, un incident important, ou une décision sensible :

- Résumer le problème.
- Documenter la cause racine.
- Noter les fichiers touchés.
- Écrire la règle à retenir pour éviter la régression.
- Ajouter la vérification ou le test qui protège désormais ce cas.

Utiliser `@knowledge-curator` pour garder cette mémoire courte, structurée et exploitable.

### Phase 7 — Documentation explicative

Quand une règle métier, un concept technique, ou un flow mérite une explication claire :

- Résumer le sujet ou la question.
- Expliquer simplement ce qu’il faut comprendre.
- Donner les règles importantes, exceptions et exemples utiles.
- Écrire ou mettre à jour un fichier dans `docs/`.

Utiliser `@docs-writer` pour transformer les explications utiles en documentation réutilisable.

### Agents de domaine (frontmobile)

Pour une feature qui touche un domaine spécifique du mobile (certificats, paiements,
vérification, auth/identité, admin), utiliser directement l'agent `feat-*` correspondant
plutôt que `@implementer` générique — voir `.claude/HOW_TO_USE_AGENTS.md` et
`.claude/agents/feat/` pour la liste et le détail de chacun.

---

## 4) Règles frontend

### 4.1 Design et UX

Quand une tâche touche à l’interface utilisateur, ne pas produire une UI générique par défaut.

Objectif : créer des interfaces qui sont :
- cohérentes,
- lisibles,
- modernes,
- accessibles,
- clairement hiérarchisées,
- adaptées au produit et au contexte métier.

Avant d’écrire le code UI :
1. Analyser le besoin produit.
2. Déterminer l’intention visuelle.
3. Identifier les composants à toucher.
4. Vérifier les états manquants.
5. Implémenter ensuite.

Éléments à soigner :
- typographie,
- espacements,
- contrastes,
- couleurs,
- états hover/focus/disabled,
- animations utiles seulement.

Anti-patterns :
- layout générique sans intention,
- copier un design sans l’adapter,
- ignorer les états vide/chargement/erreur,
- négliger l’accessibilité,
- cacher une hiérarchie visuelle faible derrière des effets.

### 4.2 Frontend engineering

- Toujours vérifier que les types de réponse API correspondent aux types utilisés côté client.
- Valider les états de chargement, d’erreur et de succès pour chaque appel réseau.
- Ne pas dupliquer la logique métier déjà présente côté serveur.
- Préférer des appels d’API explicites avec gestion d’erreur plutôt que des silences.
- Ne pas surcharger l’UI avec de la logique serveur répliquée.

---

## 5) Règles backend

- Toute route ou endpoint doit valider ses inputs avant toute logique métier.
- Les erreurs doivent retourner des messages cohérents et des codes HTTP appropriés.
- Les migrations de base de données doivent être réversibles si possible.
- Ne jamais exposer de stack trace en production.
- Les logs doivent permettre de comprendre le cycle de vie d’une requête.

---

## 6) Modèles par défaut pour les subagents

| Subagent | Modèle recommandé | Usage |
|---|---|---|
| `@repo-explorer` | **Haiku** | Exploration rapide et read-only |
| `@test-impact` | **Haiku** | Analyse rapide de l’impact tests |
| `@frontend-analyst` | **Sonnet** | Analyse UI, UX, intégration frontend |
| `@backend-analyst` | **Sonnet** | Analyse services, logique métier, API |
| `@code-reviewer` | **Sonnet** | Revue qualité, sécurité, cohérence |
| `@debugger` | **Sonnet** | Reproduction, triage, correction guidée |
| `@implementer` | **Sonnet** | Implémentation standard |
| `@implementer` | **Opus** | Cas très complexes, refactor majeur, architecture |
| `@frontend-designer` | **Sonnet** | Direction visuelle, cohérence UI, accessibilité |
| `@knowledge-curator` | **Haiku** | Mise à jour des bugs connus, leçons apprises, décisions |
| `@docs-writer` | **Haiku** | Documentation claire des concepts, règles métier et notes techniques |
| `@security-analyst` | **Sonnet** | Revue auth/identité (Appwrite/Google), credential handling, avant tout changement sensible |
| `@migration-reviewer` | **Sonnet** | Revue de migration TypeORM (réversibilité, perte de données) avant exécution |
| `@commit-planner` | **Haiku** | Plan de commits atomiques en Conventional Commits |
| `@integration-analyst` | **Sonnet** | Vérification des docs live d'intégrations PaaS/SaaS externes (Bitnob, Appwrite, etc.) avant implémentation |
| `@web-scraper` | **Haiku** | Lecture de pages web et d'instances locales (Docker, Swagger) via Playwright |

Règles de choix :
- **Haiku** pour lecture rapide, triage, faible latence (dont la lecture de pages web par `@web-scraper`).
- **Sonnet** pour analyse approfondie et implémentation standard.
- **Opus** pour les sujets à fort impact architectural.

---

## 7) Subagents disponibles

### `repo-explorer`

```yaml
***
name: repo-explorer
description: >
  MUST BE USED at the start of any non-trivial task. Fast, read-only
  codebase exploration. Discovers file structure, locates relevant modules,
  finds patterns and conventions. Returns a concise map — not full file contents.
model: haiku
tools: Read, Grep, Glob
permissionMode: plan
memory: project
color: cyan
***
```

### `frontend-analyst`

```yaml
***
name: frontend-analyst
description: >
  Analyze frontend structure, UI flows, component contracts, state management,
  routing, API usage, and UX risks. Return concise, actionable findings.
model: sonnet
tools: Read, Grep, Glob
permissionMode: plan
memory: project
color: purple
***
```

### `backend-analyst`

```yaml
***
name: backend-analyst
description: >
  Analyze backend services, controllers, models, database flow, API contracts,
  validation, and logging. Return concise, actionable findings.
model: sonnet
tools: Read, Grep, Glob
permissionMode: plan
memory: project
color: blue
***
```

### `frontend-designer`

```yaml
***
name: frontend-designer
description: >
  Analyze and improve UI quality, visual hierarchy, accessibility, spacing,
  typography, responsiveness, and interaction states. Do not write code unless asked.
model: sonnet
tools: Read, Grep, Glob
permissionMode: plan
memory: project
color: magenta
***
```

### `test-impact`

```yaml
***
name: test-impact
description: >
  Identify the smallest relevant test, lint, and type-check scope impacted by
  the requested change. Be precise and conservative.
model: haiku
tools: Read, Grep, Glob
permissionMode: plan
memory: project
color: green
***
```

### `code-reviewer`

```yaml
***
name: code-reviewer
description: >
  Review recent changes for correctness, security, naming, maintainability,
  logging, and alignment with project conventions.
model: sonnet
tools: Read, Grep, Glob
permissionMode: plan
memory: project
color: orange
***
```

### `debugger`

```yaml
***
name: debugger
description: >
  Investigate bugs from logs, runtime symptoms, and failing tests. Reproduce,
  isolate root cause, propose and apply the minimum correct fix, then verify.
model: sonnet
tools: Read, Grep, Glob, Edit, Bash
permissionMode: default
memory: project
color: red
***
```

### `implementer`

```yaml
***
name: implementer
description: >
  Execute the approved implementation plan with focused edits, tests, and
  verification. Prefer minimal, correct, maintainable changes.
model: sonnet
tools: Read, Grep, Glob, Edit, Write, Bash
permissionMode: default
memory: project
color: yellow
***
```

### `knowledge-curator`

```yaml
***
name: knowledge-curator
description: >
  Identify what should be remembered after significant bug fixes, incidents,
  regressions, or architectural decisions. Update project knowledge files with
  concise, structured, actionable entries.
model: haiku
tools: Read, Grep, Glob, Edit, Write
permissionMode: default
memory: project
color: teal
***
```

### `docs-writer`

```yaml
***
name: docs-writer
description: >
  Write clear project documentation for concepts, unclear topics, business rules,
  implementation notes, and technical explanations. Save concise, structured
  markdown files in the docs folder.
model: haiku
tools: Read, Grep, Glob, Edit, Write
permissionMode: default
memory: project
color: indigo
***
```

### `security-analyst`

```yaml
***
name: security-analyst
description: >
  MUST BE USED before any change touching auth, JWT, password hashing,
  guards, or module/role scoping in backend-nest/. Reviews for RBAC bypass,
  privilege escalation, and credential handling issues. Does not write code.
model: sonnet
tools: Read, Grep, Glob
permissionMode: plan
memory: project
color: red
***
```

### `migration-reviewer`

```yaml
***
name: migration-reviewer
description: >
  MUST BE USED before running a new TypeORM migration against a database
  that has real data (not a fresh dev DB). Reviews generated migrations for
  reversibility, data loss risk, and correctness against the TypeORM entities and migrations. Does
  not write code.
model: sonnet
tools: Read, Grep, Glob
permissionMode: plan
memory: project
color: yellow
***
```

### `commit-planner`

Plan de commits atomiques en Conventional Commits pour ce repo — voir
`.claude/agents/commit-planner.md` pour le détail complet (règles `git add`,
regroupement par domaine). Invocable aussi via `/atomic-commits`.

### `integration-analyst`

```yaml
***
name: integration-analyst
description: >
  Research external PaaS/SaaS API docs (Bitnob, Appwrite, and future integrations)
  against their live documentation before implementation work relies on them. Does not write code.
model: sonnet
tools: Read, Grep, Glob, WebFetch, WebSearch
permissionMode: plan
memory: project
color: cyan
***
```

### `web-scraper`

```yaml
***
name: web-scraper
description: >
  Read web pages and local service instances (Docker dashboards, Swagger/OpenAPI UIs, third-party
  docs rendered with JavaScript) through the Playwright skill (headless Chromium) and return a
  structured summary. Read-only: never writes code, never submits forms, never logs in.
model: haiku
tools: Read, Grep, Glob, Bash
permissionMode: default
memory: project
color: cyan
***
```

### Agents `feat-*` (domaine mobile)

Cinq agents spécialisés par domaine de `frontmobile/` : `feat-certificates`,
`feat-payments`, `feat-verification`, `feat-auth-identity`, `feat-admin`. Détail complet
dans `.claude/agents/feat/` et `.claude/HOW_TO_USE_AGENTS.md`.

---

## 8) Commandes rapides

```bash
# Lancer une exploration complète
@repo-explorer explore the authentication flow

# Analyser le frontend avant un changement
@frontend-analyst analyze the dashboard UI, loading states, and API usage

# Analyser l’expérience visuelle
@frontend-designer review the page hierarchy, spacing, typography, and accessibility

# Analyser le backend
@backend-analyst trace the request lifecycle for POST /api/payments

# Revue après implémentation
@code-reviewer review recent changes in src/services/

# Impact tests
@test-impact identify the minimal test scope for this change

# Debug depuis les logs
@debugger the payment webhook is returning 500, here are the logs: [...]

# Capitaliser après un fix important
@knowledge-curator document what should be retained from this bug fix

# Écrire une documentation explicative
@docs-writer explain this business rule and write it in docs/

# Revue sécurité avant un changement auth/identité
@security-analyst review this change to the Appwrite/Google login flow (POST /api/auth/appwrite/login)

# Revue d'une migration avant exécution
@migration-reviewer review this TypeORM migration before I run it against dev data

# Plan de commits atomiques
@commit-planner propose commits for the current git status

# Vérifier une intégration externe avant implémentation
@integration-analyst verify Appwrite's current OAuth2/JWT flow before wiring the login endpoint

# Lire une page ou une instance locale (Playwright)
@web-scraper lis http://localhost:8000/api/docs et résume les endpoints

# Feature sur un domaine mobile spécifique
@feat-certificates add a status badge to all-certificates.tsx
```

---

## 9) Règle d’or

Le main agent ne doit jamais improviser : il doit d’abord comprendre, ensuite planifier, puis déléguer, implémenter, vérifier et seulement après conclure.

---

## 10) Coordination multi-agents

### 10.1 Principe général

Le système doit fonctionner comme une équipe coordonnée, pas comme une collection
d’agents indépendants. La coordination doit être explicite, observable et vérifiable.

### 10.2 Patterns de coordination

Utiliser le pattern le plus simple possible selon le besoin :

- **Orchestrator → Subagents** : pour les tâches découpables avec un pilote central.
- **Parallel exploration** : pour analyser plusieurs zones du code en même temps.
- **Generator → Verifier** : pour les changements sensibles ou les sorties importantes.
- **Sequential pipeline** : quand une étape dépend fortement de la précédente.
- **Shared state / shared notes** : uniquement si le contexte doit être consolidé.
- **Avoid multi-agent** : si une seule analyse suffit, ne pas complexifier inutilement.

### 10.3 Règles de coordination

- Chaque agent doit avoir un rôle unique.
- Chaque sortie d’agent doit être actionnable.
- L’agent principal garde la décision finale.
- Les subagents ne doivent pas se contredire silencieusement.
- Si deux agents divergent, l’agent principal tranche avec preuves.
- Les handoffs doivent être courts, structurés et traçables.

### 10.4 Format de rendu attendu

Chaque subagent doit répondre avec :

- ce qui a été analysé,
- les fichiers ou zones concernées,
- les risques ou problèmes trouvés,
- les recommandations concrètes,
- les ambiguïtés restantes.

Ne pas renvoyer de longs récits inutiles. Un petit diagramme Mermaid peut accompagner
la réponse quand il clarifie un flux ou une relation (voir §12.6).

### 10.5 Quand utiliser plusieurs agents

Utiliser plusieurs subagents seulement si :

- le travail est réellement parallèle,
- plusieurs parties du système doivent être comparées,
- le coût d’exploration centralisée est trop élevé,
- ou le risque de manquer un impact croisé est important.

Sinon, rester simple.

---

## 11) High-stakes workflows

Pour les workflows financiers, de sécurité, ou à fort impact :

- ne jamais exécuter une action irréversible sans validation claire,
- privilégier les suggestions et prévisualisations avant l’exécution,
- conserver des logs détaillés des décisions,
- exiger des tests et vérifications plus stricts,
- signaler toute incertitude au lieu de l’ignorer,
- maintenir une séparation stricte entre analyse, recommandation, et action.

Pour ces cas, la précision et la traçabilité priment sur la vitesse.

---

## 12) Capitalisation de connaissance

Les corrections importantes, incidents, décisions sensibles et régressions évitées
doivent laisser une trace durable dans la documentation du projet.

Le but est de :
- éviter de relire tout le repo pour retrouver un bug déjà compris,
- éviter de corriger plusieurs fois le même problème,
- accélérer les futures implémentations,
- conserver les décisions techniques importantes.

### 12.1 Quand documenter

Documenter après :
- un bug non trivial corrigé,
- une régression identifiée,
- une décision d’architecture importante,
- un problème de sécurité,
- une règle métier sensible découverte,
- une limitation connue non encore corrigée.

### 12.2 Quoi documenter

Documenter au minimum :
- le problème observé,
- le contexte,
- la cause racine,
- le correctif appliqué,
- les fichiers touchés,
- la vérification ou le test ajouté,
- la règle à retenir pour éviter la récidive.

Les entrées doivent être courtes, datées, structurées et actionnables.

### 12.3 Fichiers à maintenir

Maintenir les fichiers suivants si le projet le justifie :

- `docs/KNOWN_ISSUES.md` → bugs connus, limites, contournements temporaires.
- `docs/LESSONS_LEARNED.md` → causes racines, apprentissages, règles à retenir.
- `docs/DECISIONS.md` → décisions d’architecture, arbitrages techniques, choix durables.
- `docs/BUSINESS_RULES.md` → règles métier clarifiées.
- `docs/DOMAIN_NOTES.md` → concepts métier, flows, vocabulaire.
- `docs/IMPLEMENTATION_NOTES.md` → détails techniques utiles à relire plus tard.
- `docs/DEV_WORKFLOW.md` → toutes les commandes de développement (run, migrations,
  seed, reset DB, tests, lint) — à tenir à jour à chaque script ou commande ajoutée.
- `docs/ARCHITECTURE_AS_BUILT.md` → architecture réelle (composants, flux, intégrations
  Bitnob/Appwrite), écarts connus et cible — à tenir à jour avec le code.
- `docs/DATABASE_MODEL.md` → diagrammes de classes/ER, liens entre toutes les tables,
  dictionnaire des colonnes — à tenir à jour à chaque entité ou migration.

### 12.4 Workflow de capitalisation

Après un fix non trivial ou une décision sensible :

1. Corriger et vérifier.
2. Identifier ce qui mérite d’être retenu.
3. Mettre à jour le fichier documentaire approprié.
4. Garder l’entrée concise et facile à relire.
5. Mentionner explicitement le test ou la vérification qui protège désormais ce cas.

### 12.5 Subagents dédiés

Utiliser `@knowledge-curator` après :
- un bug important,
- une modification sensible,
- une décision d’architecture,
- un incident de production,
- ou toute découverte qui doit guider les prochaines implémentations.

Utiliser `@docs-writer` quand :
- une règle métier est complexe,
- un concept n’a pas été bien compris,
- un flow technique mérite une explication durable,
- une réponse utile doit être transformée en documentation dans `docs/`.

### 12.6 Diagrammes en texte (Mermaid)

Quand un diagramme explique mieux qu'un paragraphe (relations entre entités, flux
entre acteurs, états d'un statut, architecture), l'ajouter **dans le `.md`** sous forme
de bloc ```` ```mermaid ```` — jamais d'image ni d'outil externe. Types : `classDiagram`,
`erDiagram`, `sequenceDiagram`, `flowchart`, `stateDiagram-v2`. Ne dessiner que ce que
le code fait réellement (la cible va dans un diagramme séparé), rester petit, et mettre
le diagramme à jour dans le même changement que le code. Détail et pièges de syntaxe :
section « Diagrams » de `.claude/agents/docs-writer.md`.

**Règle absolue : jamais d'ASCII art.** Toute flèche, tout schéma, toute relation,
tout flux ou toute illustration s'écrit en Mermaid — pas de flèches en caractères
(`↓ │ ├──`), pas de caractères de boîte, pas de cadres `+---+`, pas d'arbres en texte.
Les tableaux Markdown restent autorisés pour des données tabulaires ordinaires. Cette
règle vaut pour tout agent qui écrit (docs, rapports, réponses). L'ASCII déjà présent
dans un document qu'on édite se convertit en Mermaid en gardant exactement le même
sens (pas de couleurs ni de style ajoutés) ; les sorties de commandes ou de logs
réels ne sont pas des illustrations et restent en texte.

**Couleurs :** dans un diagramme neuf, les nœuds de statut ou de résultat se colorent
avec la palette du projet (`classDef` en fin de diagramme) : jaune = en attente,
vert = valide / réussi, rouge = erreur / invalide / révoqué, bleu = étape, violet =
autorité, orange = finance. Valeurs exactes dans la section « Diagrams » de
`.claude/agents/docs-writer.md`. Un diagramme converti depuis de l'ASCII ne reçoit pas
de couleurs, sauf demande.
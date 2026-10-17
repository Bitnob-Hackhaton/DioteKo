# Synthèse de la revue CodeRabbit (PR #3) et avis

> PR « Release: Bitnob reconciliation, console web, mobile sur Nest » (#3, `develop`, 190 fichiers, +13 272 / −1 422).

## 1. Ce que CodeRabbit a dit

**Niveaux de risque annoncés :** fusion modérée, architecture de sécurité **élevée**. Un contrôle « pré-merge » est inconclusif (couverture de docstrings 21 % pour 80 % demandés). Le reste est passé.

### 1.1 Risques de sécurité (architecture)

| Niveau | Constat | Verdict |
|---|---|---|
| Haut | L'émission est automatique pour naissance, mariage et décès. Un titulaire qui paie peut saisir des données civiles arbitraires et obtenir un VC signé au nom de la mairie, sans registre ni agent. | Fondé. Ce n'est pas un bug mais un choix produit (tableau Q2) : voir §3. |
| Moyen | L'émission n'est pas idempotente : le VC est enregistré `ACTIVE` avant la génération du PDF, qui est hors du bloc de nettoyage. Un échec du PDF ou un arrêt du processus laisse un VC actif, et le retry automatique en crée un second. | Fondé. Vérifié dans `performIssuance` (`admin-certificates.service.ts` ~1584-1634). |
| Bas | `GET /admin-certificates/:certificateId/file` est public et sert un PDF avec données personnelles à qui connaît l'UUID. | Fondé, déjà noté « MOYENNE » dans `KNOWN_ISSUES`. |

Points salués : organisation lue en base (jamais dans le JWT), 404 pour une demande d'une autre organisation, refus d'auto-revue, paiement validé par relecture chez Bitnob (id, hash, montant), transitions de statut conditionnelles.

### 1.2 Constats de code et de documentation

| # | Fichier | Constat | Statut |
|---|---|---|---|
| 1 | `lightning-invoices.service.ts` (Majeur) | Les 50 factures les plus récentes sont relues à chaque passage : une plus ancienne peut ne jamais être réconciliée. | Fondé |
| 2 | `bitnob-webhook.service.ts` / `bitnob-reference/README.md:147` | Le webhook ne cherche pas par `data.invoice` (BOLT11), seul champ documenté. | Fondé, le réconciliateur rattrape |
| 3 | `BITNOB.md:442` | Mauvais nom de table (`bitnob_lightning_invoices` au lieu de `lightning_invoices` filtrée par `provider='bitnob'`). | Fondé |
| 4 | `BITNOB.md:478`, `LESSONS_LEARNED.md:110` | Affirmation « référence `dkinv_` reconnue par le webhook » : le code ne le fait pas (et l'exemple Bitnob a une référence UUID). | Fondé, retirer |
| 5 | `frontweb/src/lib/api.ts` (`/auth/me`, collision de routes) | `me` casté sans adaptation, routes staff identiques aux routes titulaire. | **Déjà corrigé** (`realMe()`, `/organization/requests`) |
| 6 | `frontweb/src/lib/api.ts` | `toSummary` échoue si `/types` échoue ; `priceSats ?? 0` affiche 0 sat ; `certificateId` perdu dans le détail ; la recherche globale est ignorée en mode réel. | Fondé (4 points mineurs) |
| 7 | `frontmobile/app/certificate/[id].tsx`, `use-my-certificate-requests.ts` | `setError(null)` manque après un chargement réussi : une erreur passagère bloque l'écran. | Fondé |
| 8 | `frontmobile/services/api.ts` | `certificateFileUrl` construit une URL publique du PDF. | Fondé (même sujet que le PDF public) |
| 9 | `ARCHITECTURE_AS_BUILT.md:125,134` | L'avertissement « non scopé par organisation » est périmé (corrigé). | Fondé. Le doc reste aussi périmé sur l'émission manuelle (§5), la machine à états (§5.2) et les écarts n°1, 2, 14. |
| 10 | `KNOWN_ISSUES.md:151` | Le CAS `paid → issued` figure dans « Reste ouvert » alors que le statut `issuing` existe. | Fondé, à déplacer |
| 11 | `LESSONS_LEARNED.md:120` | « Un 404 sur une route existante = image périmée » est trop général : les routes d'organisation répondent 404 par conception. | Fondé |
| 12 | `QUESTIONS_FLOW_CERTIFICAT.md:176,209` | Q6 est vide alors que la règle est décidée. | Fondé |
| 13 | `ROADMAP_NEXT_STEPS.md:149-155` | Le « Constat » dit que le mobile utilise encore des mocks, contredit par l'entrée juste en dessous. | Fondé |
| 14 | `.claude/agent-memory/security-analyst/project_admin_certs_org_scoping.md:11` | Décrit un exploit « facture à 1 sat » qui n'existe plus (préfixe réservé et contrôle du montant en place). | Fondé, marquer résolu |
| 15 | Docstrings | Seuil 80 % non atteint. | Bruit, à ignorer |

## 2. Bilan chiffré

- 13 constats valides, 1 déjà corrigé (n°5), 1 à ignorer (n°15).
- Sur les 13 valides : 5 corrections de code, 1 correction de code de sécurité (idempotence), 1 décision produit, 1 changement d'API sensible (PDF), le reste est de la documentation.
- Aucun constat ne montre une faille exploitable à distance sans compte et sans paiement.

## 3. Mon avis

**La revue est de bonne qualité.** Elle a lu le code, pas seulement le diff : la plupart des points se vérifient à la ligne près. Le seul faux positif est le n°5, déjà traité dans les derniers commits.

**À corriger sans hésiter (petit et sûr)**

1. Idempotence de l'émission : mettre `generatePdf` et le contrôle du buffer dans le `try/discardAttempt`, stocker `requestId` dans le `metadata` du VC, et révoquer au retry les VC actifs orphelins de la même demande. C'est le correctif le plus utile, car le retry automatique est nouveau.
2. Réconciliateur : lire une moitié de factures récentes et une moitié d'anciennes, sans migration.
3. Webhook : ajouter la recherche par BOLT11 (`data.invoice`) avec un `findByPaymentRequestOrNull` restreint au fournisseur Bitnob.
4. Mobile : `setError(null)` après succès, et ne pas remplacer un écran déjà chargé par l'erreur d'un polling.
5. Console : `loadTypeNames` en échec devient une table vide, prix nul affiché `—` (ou prix du catalogue), `certificateId` ajouté au détail, recherche globale masquée en mode réel.
6. Documentation : corriger les points périmés (n°3, 4, 9 à 14). Prévoir une vraie mise à jour de `ARCHITECTURE_AS_BUILT` pour le flow B (statuts `accepted`, `needs_info`, `issuing`, émission automatique).

**Deux décisions qui t'appartiennent**

- **Émission automatique (le « Haut »).** Je ne la supprimerais pas : elle est cohérente avec ton tableau Q2 et indispensable à la démo avec un seul téléphone. Mais « le titulaire paie, la mairie signe ce qu'il a écrit » est la faiblesse de confiance du projet. Recommandation : un interrupteur d'environnement (automatique en démo, vérification par agent par défaut en production) et une mention « informations déclarées, non vérifiées au registre » dans le VC et le PDF. À dire clairement au jury.
- **PDF public.** Remplacer par un lien signé de quelques minutes demandé par le titulaire authentifié (et l'organisation propriétaire). Le mobile garde `WebBrowser` et génère déjà le PDF en local en priorité. La vérification publique reste ouverte car elle ne renvoie aucune donnée personnelle.

**À ne pas faire :** courir après les 80 % de docstrings. Ajouter des docstrings uniquement sur les méthodes non évidentes (réconciliateur, `performIssuance`, fenêtre de reprise `issuing`).

## 4. Ordre de travail proposé

```mermaid
flowchart LR
    A["1. Idempotence<br/>de l'émission"] --> B["2. Réconciliateur<br/>et webhook BOLT11"]
    B --> C["3. Correctifs mobile<br/>et console"]
    C --> D["4. Décisions :<br/>émission auto, lien PDF signé"]
    D --> E["5. Mise à jour<br/>des docs périmées"]

    classDef step fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef decision fill:#ffd43b,stroke:#f08c00,color:#000
    class A,B,C,E step
    class D decision
```

1. Idempotence de l'émission (code + test du cas « PDF en échec »).
2. Réconciliateur et webhook BOLT11 (code + tests).
3. Correctifs mobile et console (petits).
4. Décisions : interrupteur d'émission automatique, lien signé du PDF.
5. Mise à jour des documents périmés (`@docs-writer` / `@knowledge-curator`).

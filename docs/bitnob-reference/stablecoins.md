# Bitnob — Stablecoins et Virtual Accounts (documentation `bitnob.dev/docs`)

> Référence en français, extraite du texte brut des pages de https://bitnob.dev (téléchargées en Markdown, session du 2026-10-08).
> Rien n'est inventé : quand la doc ne dit rien, c'est écrit « non précisé dans la doc ».
> Noms de champs, en-têtes, événements et extraits de code : en anglais, tels que dans la doc.
> Les routes et schémas détaillés (requête/réponse) sont dans `api-reference-core.md` (même dossier).

## Sommaire

1. [Pages couvertes (vérification)](#1-pages-couvertes-vérification)
2. [Stablecoins — vue d'ensemble et concepts](#2-stablecoins--vue-densemble-et-concepts)
3. [Stablecoins — préparation et démarrage](#3-stablecoins--préparation-et-démarrage)
4. [Stablecoins — flux de base (adresses, dépôts, envois, transferts internes)](#4-stablecoins--flux-de-base)
5. [Stablecoins — webhooks](#5-stablecoins--webhooks)
6. [Stablecoins — erreurs, sécurité, réconciliation, opérations, UX](#6-stablecoins--erreurs-sécurité-réconciliation-opérations-ux)
7. [Virtual Accounts (NGN)](#7-virtual-accounts-ngn)
8. [Contradictions et obsolescences relevées](#8-contradictions-et-obsolescences-relevées)
9. [À retenir pour DioteKo](#9-à-retenir-pour-dioteko)

---

## 1) Pages couvertes (vérification)

Lot : `docs__stablecoins*` (19) + `docs__virtual-accounts*` (4) = **23 pages**, toutes avec contenu (aucune page vide). Limite connue : certains blocs de code/JSON de la source sont des placeholders non résolus (`$21`, `$23`…) dans le texte téléchargé ; ils sont signalés « exemple absent de la source » aux endroits concernés.

| Fichier source | Lien | Section ici |
| --- | --- | --- |
| `docs__stablecoins.md` | [https://bitnob.dev/docs/stablecoins](https://bitnob.dev/docs/stablecoins) | §2.1 |
| `docs__stablecoins__overview.md` | [https://bitnob.dev/docs/stablecoins/overview](https://bitnob.dev/docs/stablecoins/overview) | §2.1 |
| `docs__stablecoins__key-concepts.md` | [https://bitnob.dev/docs/stablecoins/key-concepts](https://bitnob.dev/docs/stablecoins/key-concepts) | §2.2 |
| `docs__stablecoins__why-support-stablecoins-on-multiple-chains.md` | [https://bitnob.dev/docs/stablecoins/why-support-stablecoins-on-multiple-chains](https://bitnob.dev/docs/stablecoins/why-support-stablecoins-on-multiple-chains) | §2.3 |
| `docs__stablecoins__preparing-to-work-with-stablecoins.md` | [https://bitnob.dev/docs/stablecoins/preparing-to-work-with-stablecoins](https://bitnob.dev/docs/stablecoins/preparing-to-work-with-stablecoins) | §3.1 |
| `docs__stablecoins__getting-started-with-stablecoins.md` | [https://bitnob.dev/docs/stablecoins/getting-started-with-stablecoins](https://bitnob.dev/docs/stablecoins/getting-started-with-stablecoins) | §3.2 |
| `docs__stablecoins__issuing-stablecoin-addresses.md` | [https://bitnob.dev/docs/stablecoins/issuing-stablecoin-addresses](https://bitnob.dev/docs/stablecoins/issuing-stablecoin-addresses) | §4.1 |
| `docs__stablecoins__receiving-stablecoin-deposits.md` | [https://bitnob.dev/docs/stablecoins/receiving-stablecoin-deposits](https://bitnob.dev/docs/stablecoins/receiving-stablecoin-deposits) | §4.2 |
| `docs__stablecoins__sending-stablecoins.md` | [https://bitnob.dev/docs/stablecoins/sending-stablecoins](https://bitnob.dev/docs/stablecoins/sending-stablecoins) | §4.3 |
| `docs__stablecoins___internal-wallet-to-wallet-transfers.md` | [https://bitnob.dev/docs/stablecoins/_internal-wallet-to-wallet-transfers](https://bitnob.dev/docs/stablecoins/_internal-wallet-to-wallet-transfers) | §4.4 |
| `docs__stablecoins__webhooks.md` | [https://bitnob.dev/docs/stablecoins/webhooks](https://bitnob.dev/docs/stablecoins/webhooks) | §5.1 |
| `docs__stablecoins__handling-webhooks-for-stablecoin-transfers.md` | [https://bitnob.dev/docs/stablecoins/handling-webhooks-for-stablecoin-transfers](https://bitnob.dev/docs/stablecoins/handling-webhooks-for-stablecoin-transfers) | §5.2 |
| `docs__stablecoins__error-handling-and-failure-scenarios.md` | [https://bitnob.dev/docs/stablecoins/error-handling-and-failure-scenarios](https://bitnob.dev/docs/stablecoins/error-handling-and-failure-scenarios) | §6.1 |
| `docs__stablecoins__security-and-reliability-best-practices.md` | [https://bitnob.dev/docs/stablecoins/security-and-reliability-best-practices](https://bitnob.dev/docs/stablecoins/security-and-reliability-best-practices) | §6.2 |
| `docs__stablecoins__advanced-topics-and-best-practices-for-stablecoins.md` | [https://bitnob.dev/docs/stablecoins/advanced-topics-and-best-practices-for-stablecoins](https://bitnob.dev/docs/stablecoins/advanced-topics-and-best-practices-for-stablecoins) | §6.3 |
| `docs__stablecoins__stablecoin-reconciliation-and-ledger-integrity-guide.md` | [https://bitnob.dev/docs/stablecoins/stablecoin-reconciliation-and-ledger-integrity-guide](https://bitnob.dev/docs/stablecoins/stablecoin-reconciliation-and-ledger-integrity-guide) | §6.4 |
| `docs__stablecoins__stablecoin-operations-guide.md` | [https://bitnob.dev/docs/stablecoins/stablecoin-operations-guide](https://bitnob.dev/docs/stablecoins/stablecoin-operations-guide) | §6.5 |
| `docs__stablecoins__blockchain-explorer-guide.md` | [https://bitnob.dev/docs/stablecoins/blockchain-explorer-guide](https://bitnob.dev/docs/stablecoins/blockchain-explorer-guide) | §6.6 |
| `docs__stablecoins__stablecoins-ux-best-practices.md` | [https://bitnob.dev/docs/stablecoins/stablecoins-ux-best-practices](https://bitnob.dev/docs/stablecoins/stablecoins-ux-best-practices) | §6.7 |
| `docs__virtual-accounts.md` | [https://bitnob.dev/docs/virtual-accounts](https://bitnob.dev/docs/virtual-accounts) | §7.1 |
| `docs__virtual-accounts__overview.md` | [https://bitnob.dev/docs/virtual-accounts/overview](https://bitnob.dev/docs/virtual-accounts/overview) | §7.1 |
| `docs__virtual-accounts__getting-started.md` | [https://bitnob.dev/docs/virtual-accounts/getting-started](https://bitnob.dev/docs/virtual-accounts/getting-started) | §7.2 |
| `docs__virtual-accounts__errors.md` | [https://bitnob.dev/docs/virtual-accounts/errors](https://bitnob.dev/docs/virtual-accounts/errors) | §7.3 |

---

## 2) Stablecoins — vue d'ensemble et concepts

### 2.1 Stablecoins Overview (`/docs/stablecoins` et `/docs/stablecoins/overview`)

Source : https://bitnob.dev/docs/stablecoins — https://bitnob.dev/docs/stablecoins/overview (contenu identique).

- **Rôle** : page d'accroche. Bitnob permet d'envoyer (`/api-reference/withdrawal#create-withdrawal`), de recevoir (`/api-reference/addresses#generate-addresses`) et de régler des stablecoins sur plusieurs blockchains, avec soldes et historique en temps réel (`/api-reference/wallets#get-balances`, `/api-reference/transactions#get-all-transactions`).
- Arguments : valeur stable (indexée sur le dollar en général), accessibilité mondiale, programmabilité, règlement en secondes.
- Aucune route, aucun champ, aucune limite sur ces pages.

### 2.2 Key Concepts (`/docs/stablecoins/key-concepts`)

Source : https://bitnob.dev/docs/stablecoins/key-concepts

- **Abstraction de chaîne** : même structure de requête pour toutes les chaînes ; on passe le paramètre `chain` (ex. `ethereum`, `solana`). Liste faisant foi : `GET /api/stablecoins/supported-chains`.
- Chaînes listées « as of now » : Ethereum (ERC-20), Arbitrum (ARB), Binance Smart Chain (BEP-20), Solana (SOL), Tron (TRC-20), Avalanche (AVAX), Base, Optimism (OP), Polygon (POL), Plasma (XPL). (Stellar et Bitcoin ne figurent pas dans cette liste mais apparaissent ailleurs, cf. §8.)
- **Wallet vs adresse** : un wallet est un compte logique qui porte des soldes par stablecoin ; une adresse de dépôt est une adresse on-chain propre à une chaîne et un stablecoin, rattachée au wallet, avec métadonnées (email client, label). Plusieurs adresses possibles par wallet.
- **Confirmations exigées avant crédit** :

| Chaîne | Confirmations | Finalité |
| --- | --- | --- |
| Ethereum | 15 | Probabiliste |
| Arbitrum | 15 | Probabiliste |
| Solana | 1 | Absolue |
| BSC | 15 | Probabiliste |
| Tron | 19 | Probabiliste |
| Avalanche | 1 | Absolue |
| Base | 15 | Probabiliste |
| Optimism | 15 | Probabiliste |
| Polygon | 128 | Probabiliste |
| Plasma | 15 | Probabiliste |

  (Piège : le guide de réconciliation donne Polygon = 15, cf. §8.) La page « Receiving deposits » dit que les nombres exacts sont appliqués en interne.
- **Idempotence et atomicité** : toutes les requêtes qui changent un état (envoi, création d'adresse) « supportent une idempotency key » ; si la même clé est réutilisée **dans une fenêtre de 24 h**, Bitnob renvoie le résultat d'origine. Si un envoi échoue on-chain, le solde interne n'est pas débité (voir précisions dans §6.1/§8). Statut « sent » jamais renvoyé sans réussite complète.
- **Événements** : `deposit.success`, `transfer.success`, `transfer.failed`. Recommandé comme déclencheur principal des mises à jour de solde. Le champ `confirmations` du webhook est censé permettre une progression en UI (la doc des payloads ne montre pourtant aucun champ `confirmations`, cf. §8).

### 2.3 Why Support Stablecoins on Multiple Chains

Source : https://bitnob.dev/docs/stablecoins/why-support-stablecoins-on-multiple-chains

Page conceptuelle (aucune route ni champ). Motivations : frais et débit (Ethereum cher en charge, Solana/BSC/Tron moins chers/rapides), intégration écosystème (DeFi sur Ethereum + L2 Arbitrum/Optimism ; habitudes locales BSC/Tron), résilience (pannes de chaîne), souplesse réglementaire, surface API unifiée, évolutivité (nouvelles chaînes, nouveaux stablecoins). Conseil UI : laisser l'utilisateur choisir le réseau avec frais/temps de confirmation estimés par chaîne.

---

## 3) Stablecoins — préparation et démarrage

### 3.1 Preparing to Work with Stablecoins

Source : https://bitnob.dev/docs/stablecoins/preparing-to-work-with-stablecoins

Page conceptuelle (« le quoi/pourquoi », pas les appels). Points utiles :

- **Testnet vs mainnet** : le même code (retries, confirmations, erreurs) doit se comporter pareil ; faucets au lieu d'actifs réels.
- **Wallet** = conteneur logique de soldes, **ne détient pas de clés** ; lisible via `GET /api/balances`. **Adresses de dépôt** = créées via `POST /api/addresses`, simple mapping interne (aucune transaction on-chain).
- Standards cités : ERC-20 (Ethereum, Arbitrum, BSC), SPL (Solana), TRC-20 (Tron), plus Avalanche, Base, Optimism, Polygon.
- Confirmations : ex. 15 sur Ethereum, 1 sur Solana ; l'UI doit montrer « 1/15 confirmations » puis « confirmed », piloté par le webhook de dépôt ; gérer les reorgs tardifs.
- **Idempotence** : traiter chaque événement métier comme une unité de travail identifiée par une clé unique ; sur l'API, cette clé est le champ `reference` de la requête de retrait.
- **Webhooks vs polling** : webhooks en voie principale ; polling de `GET /api/transactions` = filet de sécurité.
- Trois flux : dépôt (génération d'adresse interne → attente de confirmations asynchrone → un reorg tardif peut invalider un dépôt), retrait (verrou de solde pendant le transfert on-chain ; nettoyage des verrous en cas d'échec), transferts internes (netting : mise à jour de soldes hors chaîne, règlement externe groupé plus tard). Les diagrammes de la source sont absents du texte téléchargé.

### 3.2 Getting Started with Stablecoins

Source : https://bitnob.dev/docs/stablecoins/getting-started-with-stablecoins

**Mise en place du compte** : créer une organisation via le Dashboard ; générer des clés API (clés séparées dev/prod recommandées) ; demander les scopes `wallet:read`, `wallet:write`, `transfer:create`.

| Scope | Ce qu'il permet | Endpoint déverrouillé |
| --- | --- | --- |
| `wallet:read` | Lecture des wallets/soldes | `GET /api/balances` (Get Balances) |
| `wallet:write` | Créer des adresses de dépôt (ne déplace pas de fonds) | `POST /api/addresses` |
| `transfer:create` | Envoyer des stablecoins on-chain (seul scope qui déplace de l'argent) | `POST /api/withdrawals` |

- Une clé sans scope peut s'authentifier mais tout appel à un endpoint derrière un scope est rejeté. Vérifier avec `GET /api/whoami` → `data.permissions` ; **`null` = clé non scopée = accès complet au compte** (acceptable en dev, pas en prod).
- Scope `webhook:read` cité dans la page sécurité (§6.2).
- Ne jamais utiliser une clé maître depuis une app frontend.

**Environnements** : Testnet et Production ont **la même URL de base `https://api.bitnob.com/`** ; ce sont les clés qui déterminent l'environnement. Comportement des testnets « légèrement différent » ; API et webhooks cohérents. (`whoami.data.environment` = `sandbox` ou `live`.)

**Authentification** : HMAC, 4 en-têtes :

| En-tête | Description |
| --- | --- |
| `X-Auth-Client` | Client ID du Dashboard |
| `X-Auth-Timestamp` | Timestamp Unix **en secondes** |
| `X-Auth-Nonce` | Chaîne aléatoire unique par requête |
| `X-Auth-Signature` | HMAC-SHA256 **hex** sur `CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD` |

**Limite de débit** : défaut **60 requêtes/minute par clé** ; rafales tolérées, surcharge soutenue étranglée ; erreur `429 Too Many Requests` ; backoff exponentiel conseillé ; support pour relever la limite.

**Idempotence** : « toutes les requêtes à état (transferts, génération d'adresse) acceptent l'en-tête `Idempotency-Key` » (ex. `Idempotency-Key: 7f3b8f2a-9a3a-4e2c-8f16-01a17f8b2f8b`) ; une clé unique par événement métier ; réutiliser une clé pour une autre action → erreur de validation. (Piège : cet en-tête n'apparaît pas dans la référence API, qui n'utilise que le champ body `reference`, cf. §8.)

**Webhooks (aperçu)** : HTTPS, signés, IP sources fixes, retries à backoff exponentiel « jusqu'à acquittement (2xx) ». Événements : détection de dépôt, changements de statut de retrait, échecs réseau.

---

## 4) Stablecoins — flux de base

### 4.1 Issuing Stablecoin Addresses

Source : https://bitnob.dev/docs/stablecoins/issuing-stablecoin-addresses

- **Route** : `POST /api/addresses` (détail dans `api-reference-core.md`). Adresses déjà émises : `GET /api/addresses`, `GET /api/addresses/:id`.
- **Paramètres cités sur cette page** (la référence API fait foi) :

| Paramètre | Description |
| --- | --- |
| `chain` | Blockchain cible (ex. tron, ethereum, solana, bsc, arbitrum, base, optimism, polygon, avalanche) |
| `customer_email` | Email du client destinataire |
| `label` | Libellé lisible optionnel |

- Une adresse est propre à la chaîne et au token (ex. USDT sur Tron, USDC sur Ethereum). Plusieurs adresses par wallet ; une par utilisateur/chaîne/token possible. Réception depuis tout wallet standard (Metamask, Phantom, TronLink).
- **Bonnes pratiques** : une adresse dédiée par client et par chaîne ; ne créditer qu'après le webhook (l'événement « inclut le nombre de confirmations et un hash externe » — cf. §8 sur l'écart avec les payloads) ; valider une adresse fournie par l'utilisateur avec `POST /api/addresses/validate` ; labels/métadonnées pour support et conformité.
- **Stellar (piège majeur)** : Bitnob attribue **une seule adresse Stellar partagée par entreprise**. L'attribution par utilisateur repose sur un **memo** que **vous** générez et gérez ; Bitnob ne génère ni ne gère les memos. Sans memo, tous les fonds sont traités comme appartenant à votre compte entreprise (réconciliation manuelle).
- Exemple d'usage : remittance, client au Ghana reçoit USDT sur Tron : `chain=tron`, `customer_email=customer@example.com`, `label=Remittance:Order#9283` ; Bitnob attend **19 confirmations** puis déclenche le webhook.

### 4.2 Receiving Stablecoin Deposits

Source : https://bitnob.dev/docs/stablecoins/receiving-stablecoin-deposits

- Après émission d'une adresse, Bitnob la surveille ; une fois les confirmations atteintes, il émet `deposit.success` et crédite le solde du wallet.
- **Minimum : « You cannot deposit less than $1 »** — en dessous, non traité.
- **Sandbox** : financer l'adresse via le faucet Circle `https://faucet.circle.com/`.
- Les nombres de confirmations sont appliqués en interne ; le crédit est visible dans `GET /api/balances`.
- **Route** : `GET /api/stablecoins/supported-chains` → codes de chaîne pour USDT/USDC (exemple de réponse absent de la source, placeholder `$23`).

Chaînes **sandbox** (vérifiées fonctionnelles) :

| Chaîne | Testnet | Stablecoins |
| --- | --- | --- |
| avalanche | Fuji | USDT, USDC |
| base | Base Sepolia | USDC |
| ethereum | Sepolia | USDT, USDC |
| polygon | Amoy | USDT, USDC |
| solana | Devnet | USDT, USDC |
| stellar | Testnet | USDC |

Chaînes **production** : arbitrum (USDT, USDC), avalanche (USDT, USDC), base (USDC), bitcoin (—), bsc (USDT, USDC), ethereum (USDT, USDC), optimism (USDT, USDC), plasma (USDT), polygon (USDT, USDC), solana (USDT, USDC), stellar (USDC), tron (USDT). Production seulement : arbitrum, bsc, plasma, tron. L'endpoint renvoie aussi bitcoin et optimism en sandbox : appeler l'endpoint dans votre environnement pour la liste faisant foi.

```bash
curl --location 'https://api.bitnob.com/api/stablecoins/supported-chains' \
--header 'Content-Type: application/json' \
--header 'x-auth-client: CLIENT_ID' \
--header 'x-auth-timestamp: TIMESTAMP' \
--header 'x-auth-nonce: NONCE' \
--header 'x-auth-signature: SIGNATURE'
```

**Webhook `deposit.success`** (exemple de la page) :

```json
{
  "data": {
    "address": "6AtXPbFNrvg6ZiG4g1j3p8Z7mkpqjtdT2jC5siQC5dqM",
    "amount": "1100000",
    "chain": "solana",
    "currency": "USDC",
    "fee": "0",
    "hash": "3TfBAvqrGBHvHMVzrGMfNbyPZ3Lb1oWYfKtYgzq2qvBDa1DzskqY9V7YgtyUeyb5aA9F4hgPBm3Hp1VpLJMgchYx",
    "reference": "RCV_USDC_d4f075577f6e",
    "timestamp": "2026-05-15T12:03:45Z",
    "transaction_id": "3ac20197-f0c7-4553-ac32-9ead17c7f0a9"
  },
  "event": "deposit.success",
  "event_id": "944a4089-6065-49ca-8f43-fb10f15c59e6"
}
```

Cas d'usage « chaîne dynamique » : construire un sélecteur de réseau, valider qu'une chaîne est supportée avant d'émettre une adresse, optimiser les frais.

### 4.3 Sending Stablecoins

Source : https://bitnob.dev/docs/stablecoins/sending-stablecoins

- **Route** : `POST /api/withdrawals` (retrait on-chain vers une adresse externe).
- **Minimum : « You cannot send less than $1 »**.
- Chaînes d'envoi listées : Tron (TRC20), BSC (BEP20), Ethereum (ERC20), Polygon, Solana, Base, Stellar, Arbitrum, Avalanche, Optimism, Polygon (POL), TON (« coming soon for send »), Plasma (« coming soon for send »). Liste dynamique : `/stablecoins/supported-chains`. (Écart avec la référence API, qui liste 7 chaînes seulement, cf. §8.)
- Stellar : tout memo fourni par la destination doit être transmis **exactement**.

| Paramètre | Type | Requis | Description |
| --- | --- | --- | --- |
| `to_address` | string | Oui | Adresse on-chain du destinataire |
| `amount` | string | Oui | Plus petite unité (ex. `'2000000'` = 2 USDT) |
| `currency` | string | Oui | `USDT`, `USDC` |
| `chain` | string | Oui | ex. tron, ethereum, bsc, polygon, solana |
| `reference` | string | Oui (selon cette page) | Identifiant unique du transfert |
| `description` | string | Non | Note libre |

(La référence API marque `reference` comme **Optional**, ajoute `memo` et la devise `BTC`, cf. §8.)

```bash
curl --location 'https://api.bitnob.com/api/withdrawals' \
--header 'Content-Type: application/json' \
--header 'x-auth-client: CLIENT_ID' \
--header 'x-auth-timestamp: TIMESTAMP' \
--header 'x-auth-nonce: NONCE' \
--header 'x-auth-signature: SIGNATURE' \
--data '{
    "to_address": "TRMPscTMrXg21YuDFuvpXRUkwEbipHEZXN",
    "amount": "2000000",
    "currency": "USDT",
    "chain": "tron",
    "reference": "testing_012",
    "description": "Testing on USDT to binance"
}'
```

Exemple Python de la page (signature correcte selon la page d'authentification) : `string_to_sign = f'{client_id}:{timestamp}:{nonce}:{body_str}'`, `hmac.new(secret, ..., sha256).hexdigest()`, timestamp en secondes, nonce `uuid.uuid4().hex`. **L'exemple JavaScript de la même page est différent et contredit l'authentification officielle** (voir encadré).

> **Piège d'authentification (page sending-stablecoins, exemple JS)** : `timestamp = Date.now().toString()` (**millisecondes**), `signingString = clientId + method + path + timestamp + bodyStr` (sans séparateurs `:`, avec méthode et chemin), `.digest('base64')` (**base64**). Tout cela est en contradiction avec la page d'authentification et avec l'exemple Python de la même page (secondes, `CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD`, hex). Ne pas copier cet exemple JS. Exemple Go : absent de la source (placeholder `$23`).

Réponse exemple (status `pending` attendu) :

```json
{
    "success": true,
    "message": "Transfer initiated successfully",
    "data": {
        "transaction_id": "4a63c979-746b-4e22-99db-dc87d24ff7ed",
        "status": "pending",
        "address": "0x3f9a2009ff751F46DcA810391F1BF804871b13d9",
        "amount": "2000000",
        "currency": "USDC",
        "chain": "bsc",
        "network": "mainnet",
        "reference": "testing_bsc_013",
        "created_at": "2025-12-12T13:49:17Z",
        "description": "Testing on USDT to binance"
    },
    "metadata": { "request_id": "wallet_req_019b12d2-b627-7ca1-9f37-a559d03f8aa4" },
    "timestamp": "2025-12-12T13:49:17.944124046Z"
}
```

(Note : cette réponse contient un champ `network` et le message `Transfer initiated successfully` ; la référence API montre `Withdrawal initiated successfully` sans `network`.)

- **Webhooks** : `transfer.success` (après confirmations suffisantes selon la chaîne), `transfer.failed` (rejeté, reverté ou timeout on-chain).
- **Frais** : **$1 forfaitaire, prélevé sur votre solde EN PLUS du montant envoyé** ; le destinataire reçoit le montant exact demandé ; identique sur toutes les chaînes et pour tout montant. La réponse de création ne contient pas de champ `fee` : lire `fee` via `GET /api/transactions/{id or reference}`.
- Bonnes pratiques : `reference` unique, ne pas poller (utiliser les webhooks), valider l'adresse avec `POST /api/addresses/validate`.

### 4.4 Internal Wallet-to-Wallet Transfers (page `_internal-…`)

Source : https://bitnob.dev/docs/stablecoins/_internal-wallet-to-wallet-transfers

> **Attention : page à préfixe `_internal-` dans l'URL, probablement non publiée/obsolète.** Elle référence un endpoint **`/api/wallets/transfers`** qui n'apparaît dans aucune page de référence API du lot. À ne pas utiliser sans confirmation.

- Prétend que des transferts internes entre wallets du même compte Bitnob sont instantanés, sans frais, sans confirmation blockchain, avec webhooks de même structure que les transferts externes.
- Mécanisme décrit : même endpoint `/api/wallets/transfers`, on fournit l'adresse de dépôt ou l'identifiant du wallet destinataire ; si la destination est interne, le chemin blockchain est contourné ; sinon, routage on-chain.
- Tableau comparatif : interne = pas de délai, pas de frais réseau, statut instantané, pas d'interaction chaîne ; on-chain = délai selon chaîne, frais, `Pending → Confirmed`.
- Conseil : tenir un registre des adresses émises (`GET /api/addresses`) pour détecter les cibles internes ; agréger les fonds par transferts internes avant un règlement on-chain groupé.
- Contradiction : la doc d'envoi parle d'un **frais forfaitaire de $1** et ne mentionne aucune exception pour les transferts internes ; la référence withdrawal ne documente aucun mode interne. Statut : non vérifiable.

---

## 5) Stablecoins — webhooks

### 5.1 Webhooks (`/docs/stablecoins/webhooks`)

Source : https://bitnob.dev/docs/stablecoins/webhooks

- Un webhook = URL de votre serveur recevant les événements de transaction. La page cite aussi (en exemple) l'événement `btc.lightning.received.success` « once a lightning payment is received » — **aucun payload n'est donné** dans ce lot (non précisé dans la doc).
- Renvoyer `200 OK` pour éviter le renvoi.
- **Vérification** : en-tête **`x-bitnob-signature`** ; signature **HMAC SHA512** du payload avec votre clé secrète, en **hex**. Le code montre qu'il faut signer le **corps brut** (`express.raw`), pas du JSON re-sérialisé :

```javascript
const crypto = require('crypto');
const webhookSecret = process.env.BITNOB_WEBHOOK_SECRET;
// Sign the raw body: re-serialising parsed JSON changes the bytes
app.post("/webhook_url", express.raw({ type: 'application/json' }), function(req, res) {
  const hash = crypto.createHmac('sha512', webhookSecret).update(req.body).digest('hex');
  if (hash == req.headers['x-bitnob-signature']) {
    const event = JSON.parse(req.body);
  }
  res.sendStatus(200);
});
```

  (L'exemple utilise `==` ; la page sécurité recommande une comparaison à temps constant, cf. §6.2.)
- **Retries** : si la réponse n'est pas 200, **3 nouvelles tentatives après le premier échec**. Recommandation : prévoir un job qui interroge `GET /api/transactions` si les webhooks échouent.
- **Test local** : ngrok / localtunnel, URL à mettre à jour dans le Dashboard (environnement de test uniquement).

**Payload `deposit.success`** (champs, tous strings) : `event` (toujours `deposit.success`), `event_id` (dédoublonnage), `data.address` (adresse réceptrice), `data.amount` (plus petite unité, ex. `'9000000'` = 9 USDT), `data.chain`, `data.currency`, `data.fee` (typiquement `'0'`), `data.from_address` (expéditeur), `data.hash` (hash on-chain), `data.reference`, `data.timestamp` (ISO 8601), `data.transaction_id` (ID transaction Bitnob).

```json
{
  "event_id": "0b7d6c1e-4f3a-4b8e-9a52-1c2d3e4f5a6b",
  "event": "deposit.success",
  "data": {
    "address": "Cev6GkmDnwSY3PvwhwBofwv65FrwcU1RxvF9Zt9aTJq4",
    "amount": "9000000",
    "chain": "tron",
    "currency": "USDT",
    "fee": "0",
    "from_address": "TQrY8tryqsYVCYS3MFbtffiPp2ccyn4rkr",
    "hash": "2426850248470ae3c24ff8ae62a5efbde325ea0c496475befb63947a65f5c122",
    "reference": "RCV_SBLNC_cc309ba8c361",
    "timestamp": "2025-12-12T20:38:23Z",
    "transaction_id": "8c3d1332-bd52-40f4-972f-768a2c4106f3"
  }
}
```

**`transfer.success`** et **`transfer.failed`** : « même structure que le dépôt » ; exemples de cette page **sans `event_id` ni `transaction_id`** :

```json
{ "event": "transfer.success",
  "data": { "address": "TRMPscTMrXg21YuDFuvpXRUkwEbipHEZXN", "amount": "2000000", "chain": "tron",
            "currency": "USDT", "fee": "1000000",
            "hash": "4ae4308579587370accbd31dbfaebf3a97c8cfc7f68e2128ddec840349cafc60",
            "reference": "SND_SBLNC_80c7895d89e9", "timestamp": "2025-12-12T20:30:18Z" } }
```

```json
{ "event": "transfer.failed",
  "data": { "address": "TKVy2qjGyfxhPMvkeA8AEhv5XvpzLxGA5W", "amount": "2000000", "chain": "tron",
            "currency": "USDT", "fee": "0", "hash": "",
            "reference": "your-transfer-reference", "timestamp": "2025-12-12T20:30:00Z" } }
```

Notes : sur `transfer.success`, `fee` = `"1000000"` = 1 USDT (le forfait $1) ; sur `transfer.failed`, `fee = "0"` et `hash = ""`. La page « Handling webhooks » (§5.2) montre pour `transfer.success` et `transfer.failed` des exemples **avec** `event_id` (et `transaction_id` pour le succès). Conclusion prudente : traiter `event_id` et `transaction_id` comme présents mais optionnels, et dédoublonner aussi sur `reference`/`hash`.

### 5.2 Handling Webhooks for Stablecoin Transfers

Source : https://bitnob.dev/docs/stablecoins/handling-webhooks-for-stablecoin-transfers

- Événements de transfert : `transfer.success` (diffusé et confirmé), `transfer.failed` (erreur : out of gas, revert, adresse invalide).
- Prérequis du endpoint : HTTPS ; **réponse 2xx sous 5 secondes** ; retries avec backoff exponentiel ; si filtrage IP, autoriser les IP sources publiées (`18.171.51.218`, `13.134.154.133`, cf. `api-reference-core.md`/référence addresses webhooks).
- Signature : en-tête `x-bitnob-signature: 5c76a3e6b7c...` ; « vous recevrez la documentation et les secrets dans votre dashboard ».
- Bonnes pratiques : vérifier `event` et faire correspondre `reference` à une transaction interne ; **ne jamais créditer sur `transfer.initiated`, seulement sur `transfer.success`** (note : `transfer.initiated` n'est documenté nulle part ailleurs dans le lot, donc événement non confirmé) ; logs et alertes sur échecs de webhooks.

Exemple `transfer.success` (avec `event_id` et `transaction_id`) :

```json
{
  "data": {
    "address": "6AtXPbFNrvg6ZiG4g1j3p8Z7mkpqjtdT2jC5siQC5dqM",
    "amount": "1100000",
    "chain": "solana",
    "currency": "USDC",
    "fee": "1000000",
    "hash": "3TfBAvqrGBHvHMVzrGMfNbyPZ3Lb1oWYfKtYgzq2qvBDa1DzskqY9V7YgtyUeyb5aA9F4hgPBm3Hp1VpLJMgchYx",
    "reference": "SND_USDC_5c2d2dfd2fe2",
    "timestamp": "2026-05-15T12:03:08Z",
    "transaction_id": "3ac20197-f0c7-4553-ac32-9ead17c7f0a9"
  },
  "event": "transfer.success",
  "event_id": "944a4089-6065-49ca-8f43-fb10f15c59e6"
}
```

Exemple `transfer.failed` : `event_id` présent, `data` identique à celui de §5.1 (`hash: ""`, `fee: "0"`).

---

## 6) Stablecoins — erreurs, sécurité, réconciliation, opérations, UX

### 6.1 Error Handling and Failure Scenarios

Source : https://bitnob.dev/docs/stablecoins/error-handling-and-failure-scenarios

| Étape | Cause courante | Stratégie |
| --- | --- | --- |
| Pré-validation | Adresse invalide, chaîne/token non supporté | Erreur 400 synchrone avec message descriptif |
| Erreur de diffusion | Nœud RPC, congestion | Retry/requeue |
| Échec on-chain | Out-of-gas, revert contrat, token gelé | Webhook `transfer.failed` et déblocage du solde |
| Livraison webhook | Timeout, non-2xx | Retry avec backoff exponentiel |

Exemple d'erreur de validation (3e format d'erreur du lot, cf. §8) :

```json
{ "status": false, "message": "Unsupported blockchain network for asset type", "errorCode": "CHAIN_ASSET_MISMATCH" }
```

- `transfer.failed` : « les fonds retenus sont rendus au solde disponible quand le retrait atteint l'état terminal `failed` ».
- **Idempotence** : `reference` unique par transfert (présenté ici comme **champ requis**). Même `reference` deux fois : si le premier a réussi, le second renvoie la même réponse ; si le premier a échoué, le second peut réessayer ou renvoyer une erreur selon la cause. Ne pas réessayer à l'aveugle sans consulter les webhooks. (La référence API documente aussi un `409 DUPLICATE_REFERENCE`, cf. §8.)
- Retries réseau : backoff exponentiel, éviter les tempêtes de retries. Webhooks : retries automatiques, suivi des non-livrés dans le Dashboard, journaux avec horodatage/erreur/nombre de tentatives.
- Outils ops : visibilité Dashboard, recherche par reference/statut/chaîne/token (équivalent des query params de `GET /api/transactions`), retry manuel (option UI), export CSV.

### 6.2 Security and Reliability Best Practices

Source : https://bitnob.dev/docs/stablecoins/security-and-reliability-best-practices

- **Clés API** : auth HMAC avec secrets ; clés séparées prod/staging/dev, rotation via Dashboard, jamais dans le frontend/GitHub/clients. Les clés sont liées à un compte entreprise.
- **Scopes** (principe du moindre privilège) :

| Scope | Capacité | Rayon d'impact en cas de fuite |
| --- | --- | --- |
| `wallet:read` | Voir soldes et métadonnées | Faible |
| `wallet:write` | Créer des adresses de dépôt | Moyen |
| `transfer:create` | Envoyer des stablecoins | Élevé (seul scope qui déplace de l'argent) |
| `webhook:read` | Voir les webhooks configurés | Faible ; **recevoir des webhooks ne demande aucun scope** |

- **Sécurité des webhooks** : « Bitnob signe tous les webhooks avec un secret partagé **HMAC SHA-512** » ; étapes : lire `X-Bitnob-Signature`, hacher le corps brut avec le secret webhook, comparer avec **comparaison à temps constant**. Protège contre usurpation et rejeu. Liste d'IP = seconde couche seulement ; la signature reste le contrôle faisant foi.
- **Intégrité des transferts** : `reference` unique ; ne lancer un second transfert qu'après avoir confirmé l'échec ou l'achèvement du premier ; écouter `transfer.failed` / `transfer.success` ; verrou interne si retraits concurrents.
- Contrôle d'accès : 2FA admin, isoler `transfer:create` dans un service séparé, journaliser les actions internes, multi-tenant : un tenant ne doit pas déclencher de transfert hors de son périmètre.
- Fiabilité : file d'attente + retry avec backoff si API indisponible ; replays de webhooks possibles depuis le Dashboard ; alerte sur confirmations retardées ; ne relancer un transfert qu'après validation.
- Monitoring : taux succès/échec par chaîne, latence/erreurs des webhooks, santé des soldes, usage des clés.
- Anti-fraude : valider toute adresse utilisateur via `POST /api/addresses/validate` avant l'envoi, 2FA/passkeys sur transferts élevés, seuils quotidiens, détection des adresses nouvelles/non vérifiées.
- **Validate Address** : `POST /api/addresses/validate` (`address`, `chain`) → `valid` booléen, adresse et chaîne en écho, `error` si invalide. **Contrôle de format uniquement** : ne prouve pas que le destinataire contrôle l'adresse (n'arrête pas l'ingénierie sociale).

### 6.3 Advanced Topics & Best Practices for Stablecoins

Source : https://bitnob.dev/docs/stablecoins/advanced-topics-and-best-practices-for-stablecoins

- **Soldes** (`GET /api/balances`) : champs à surveiller : `ledger_balance` (total incluant le pending, plus petite unité, ex. `'6281647'` = 6.281647 USDT), `available_balance`, `currency` (USDT, USDC, BTC), `ledger_balance_formatted`, `available_balance_formatted`, `company_id`. `GET /api/balances/:currency` pour un seul actif. Exemple JSON absent de la source (placeholder `$21`).
- **Réconciliation** : relier avec `reference` ; cron ~15 min pour sommer par chaîne, comparer à Bitnob, signaler les écarts.
- **Dépôts, cas limites** : doublons → identifiant unique `address + token + chain + txHash` ; reorgs (surtout EVM) : Bitnob « ajustera le statut du webhook si nécessaire », suivre les confirmations pour les gros montants ; **dépôts sur la mauvaise chaîne : Bitnob ne peut pas les récupérer** (avertir l'utilisateur, QR codes avec métadonnées de chaîne).
- **Frais** : $1 forfaitaire par envoi, identique partout, lisible via `fee` de `GET /api/transactions/{id or reference}` ; frais les plus bas conseillés : tron, bsc, polygon ; éviter ethereum pour les micro-paiements. Suggestion UI de la page : « Sending $1.00 / Network Fee $0.01 / You'll receive $0.99 » — **incohérente avec le forfait $1 prélevé en plus** (cf. §8).
- **Débit** : 60 req/min par clé ; `Retry-After` sur 429 ; file d'attente + backoff exponentiel ; un transfert par requête (pas de batch natif).
- **Checklist prod** : clés scopées/rotation, testnet vérifié, vérif des webhooks, `reference` unique, retry 429/5xx, monitoring des échecs, script de réconciliation, plan d'escalade support.

### 6.4 Stablecoin Reconciliation & Ledger Integrity Guide

Source : https://bitnob.dev/docs/stablecoins/stablecoin-reconciliation-and-ledger-integrity-guide

- Trois vérités à rapprocher : votre ledger interne, les soldes Bitnob (`GET /api/balances`, `/api/balances/:currency`), l'état on-chain.
- **Règles de ledger** : enregistrer chaque dépôt/retrait avec `reference`, `txHash`, chaîne, token, `wallet_id`, timestamp, source ; **créditer un dépôt seulement à réception de `deposit.success`** ; **débiter un retrait seulement quand Bitnob renvoie 200 OK ET émet `transfer.success`** ; table `webhook_event_log` dédiée.
- Exemple de diff : `{"wallet_id":"abc","token":"USDT","chain":"tron","bitnob_balance":50000,"internal_ledger":49000,"discrepancy":+1000}` (le `+1000` n'est pas du JSON valide dans la source).
- Job quotidien : comparer soldes, dépôts manquants, transferts marqués réussis mais échoués, transferts non confirmés, tx orphelines on-chain. Buckets « Pending Investigation / Resolved / False Positive ».
- Alertes : écart ≥ 1 $ ou 0,5 % ; transfert `pending` > 30 min ; webhook non traité après 3 retries.
- **Livraison au moins une fois** : « Bitnob guarantees at-least-once delivery » → dédoublonner sur `event` + `txHash`, journaliser, prévoir un retry pour `deposit.success`, `transfer.success`, `transfer.failed`. Rattrapage : balayer `GET /api/transactions` avec ses query params.
- Confirmations minimales (ce guide) : Ethereum 15, BSC 15, **Polygon 15**, Tron 19, Solana 1, TON 3+ (selon chaîne). Alternative acceptée : crédit si `deposit.success` reçu **ou** si un `txHash` interrogé montre ≥ confirmations requises.
- Règles d'or : piloté par webhooks (polling = failsafe), le ledger est la vérité, un événement Bitnob = une seule action de ledger, échouer bruyamment.

### 6.5 Stablecoin Operations Guide

Source : https://bitnob.dev/docs/stablecoins/stablecoin-operations-guide

Guide pour équipes ops/support (Finance/Trésorerie, Support, Risque/Conformité). Outils de monitoring : journaux de webhooks, suivi des transferts en `pending`, tableau de bord de soldes, journal d'audit, rapports de réconciliation. SOPs :

1. Dépôt qui n'apparaît pas : vérifier chaîne/token/adresse → retrouver l'enregistrement Bitnob puis l'explorateur via `txHash` → chercher `deposit.success` dans le journal webhook → escalade ingénierie avec `txHash` + adresse.
2. Transfert `pending` trop longtemps : retrouver par `reference` (`GET /api/transactions/{id or reference}`), vérifier congestion/gas, replacer avec priorité supérieure si gas trop bas, escalader si > 30 min.
3. Échec de livraison webhook : retry via Dashboard/CLI support ; vérifier l'endpoint, la vérification de signature et l'allowlist IP.
4. Dépôt sur mauvaise chaîne : « la plupart irrécupérables » ; récupération manuelle au cas par cas seulement si envoyé à un contrat contrôlé par Bitnob.

Réconciliation quotidienne/horaire : signaler les écarts > 0,5 %. Routes d'escalade (tableau) : API down → Ingénierie + Infra ; gros transfert bloqué → Ingénierie + Trésorerie ; mauvais token/chaîne → Support → Ops → Ingénierie ; panne webhooks → SRE → Ingénierie ; solde inattendu → Ingénierie + Finance.

### 6.6 Blockchain Explorer Guide

Source : https://bitnob.dev/docs/stablecoins/blockchain-explorer-guide

Méthode : demander le `txHash` au client, l'ouvrir dans le bon explorateur, comparer statut, confirmations, adresse destinataire, token (vrai contrat), montant avec le webhook/`GET /api/transactions/...`.

| Chaîne | Explorateur | Format d'adresse | Format de hash | Onglet token |
| --- | --- | --- | --- | --- |
| Ethereum | https://etherscan.io | `0x...` | `0x...` | ERC-20 Token Txns |
| BSC | https://bscscan.com | `0x...` | `0x...` | BEP-20 Token Txns |
| Polygon | https://polygonscan.com | `0x...` | `0x...` | ERC-20 Token Txns |
| Tron | https://tronscan.org | `T...` | `TX...` | TRC-20 Transfers |
| Solana | https://solscan.io | base58 | base58 | Token Transfers |
| TON | https://tonscan.org | `EQ...`, hex | base64 ou hex | Jetton Activity |
| Arbitrum | https://arbiscan.io | — | — | — |
| Base | https://basescan.org | — | — | — |
| Optimism | https://optimistic.etherscan.io | — | — | — |
| Avalanche | https://avascan.info/ | — | — | — |
| Plasma | https://plasmascan.to/ | — | — | — |

(Colonnes « — » : non précisé dans la doc.) Confirmations à voir : 15 (ETH, BSC), 19 (Tron), 1 (Solana). Contrat USDT sur BSC cité : `0x55d398326f99059ff775485246999027b3197955`. Pièges : token envoyé en TRX au lieu d'USDT sur Tron, memo oubliée pour un exchange, mauvaise chaîne (hash `0x...` alors que l'adresse était Tron : fonds probablement perdus). Payout bloqué 20+ min : vérifier si en attente (congestion), échoué (gas/revert) ou jamais diffusé (ingénierie), puis réessayer/escalader avec `reference` + chaîne. Astuce ops : bouton « View on Explorer » construit depuis le hash de `GET /api/transactions`.

### 6.7 Stablecoins UX Best Practices

Source : https://bitnob.dev/docs/stablecoins/stablecoins-ux-best-practices

- Chaîne par défaut recommandée (Tron ou BSC), sélecteur alimenté par `supported-chains` (nom de réseau, type de token, frais, temps moyen de confirmation).
- Statuts : « Pending » avec progression (« 6/15 confirmations »), mise à jour automatique via webhook, sur échec (`transfer.failed`) : résumé + référence + retry/support.
- **Frais** : $1 forfaitaire **ajouté au-dessus** du montant : « You're sending $100 / Network Fee $1.00 / You will be charged $101.00 » ; pas de devis nécessaire ; lire `fee` / `fee_formatted` dans `GET /api/transactions/{id or reference}` (absents de la réponse de création).
- Réutiliser `reference` dans reçus, webhooks, logs, tickets. Afficher chaîne, format de token (ERC-20…), format d'adresse (`0x...`, `T...`, `3...`) ; avertir sur l'envoi dans le mauvais format.
- QR code pour dépôts : adresse (+ métadonnées éventuelles), libellé du type « Scan to send USDT on Tron (TRC-20) ».
- Mobile : action sheets, boutons copier, historique coloré (reçu = vert, envoyé = rouge, en attente = jaune). Cas limites : ne pas promettre de récupération, vue « Unverified Deposit », contact support (`txHash`, adresse, chaîne, token). Alertes en temps réel : toasts, notifications in-app, email/SMS pour montants élevés.

---

## 7) Virtual Accounts (NGN)

### 7.1 Overview (`/docs/virtual-accounts` et `/docs/virtual-accounts/overview`)

Source : https://bitnob.dev/docs/virtual-accounts — https://bitnob.dev/docs/virtual-accounts/overview (contenu identique).

Un virtual account est un **numéro de compte bancaire nigérian dédié** à un client, pour recevoir des NGN depuis un compte bancaire ou autre canal. Les fonds sont identifiés et crédités sur le **solde NGN** (`GET /api/balances`). Chaque compte est lié de façon unique à un client. Cas d'usage : recevoir des NGN, créditer automatiquement le solde, fournir un compte dédié pour paiements récurrents ou ponctuels. (Le crédit va sur le solde NGN **de votre entreprise**, pas un solde par client — précisé dans la référence API webhooks.)

### 7.2 Getting Started

Source : https://bitnob.dev/docs/virtual-accounts/getting-started

**Création** : `POST /api/virtual-accounts`

```json
{
  "reference": "your-unique-reference",
  "currency": "NGN",
  "customer_id": "",
  "account_alias": "Optional display name"
}
```

- `reference` unique chez vous, sert de **clé d'idempotence** ; **NGN est la seule devise supportée**.
- **Cause n°1 d'échec : fiche client incomplète.** KYC obligatoire pour chaque compte naira. La fiche *client* doit porter : `first_name`, `last_name`, `email`, `phone_number`, `date_of_birth` (18 ans ou plus), `id_type` (doit valoir `"bvn"`), `id_number` (BVN à 11 chiffres). (La référence API ajoute `customer_type` requis.) Le BVN se pose sur le client (création ou patch), pas sur la requête du compte.
- Le BVN est vérifié auprès du registre national à la création du compte ; un BVN qui ne correspond pas aux données du client est rejeté. **Nom et date de naissance doivent être ceux enregistrés sous le BVN**, sinon échec même si le BVN est valide.
- Erreur si champs manquants : un seul message nomme tous les champs manquants :

```text
customer  is missing bvn, date_of_birth;
update the customer record and retry
```

  L'erreur concerne la fiche client, pas le payload du compte.
- **Clients entreprise** : `customer_type: "business"` + `company_name` + `registration_number` (ex. `RC1487263`) ; les champs personnels doivent décrire un représentant (dirigeant), mêmes règles.
- Exemples complets de fiche client individuelle/entreprise dans la source (country `NGA`, `dial_code` `+234`, etc.).

Autres routes :

| Méthode | Chemin | Rôle |
| --- | --- | --- |
| GET | `/api/virtual-accounts` | Lister vos comptes |
| GET | `/api/virtual-accounts/:id` | Récupérer un compte |
| GET | `/api/virtual-accounts/:id/transactions` | Dépôts sur ce compte |
| PATCH | `/api/virtual-accounts/:id/alias` | Changer le nom d'affichage |
| GET | `/api/virtual-accounts/supported-currencies` | Renvoie actuellement NGN |

**Simulation de dépôt (sandbox)** : `POST /api/virtual-accounts/:id/simulate-deposit` simule un virement entrant ; **rejeté en production**. (Détails : chaque appel ajoute 100000 kobo = ₦1 000,00, cf. `api-reference-core.md`.)

### 7.3 Errors

Source : https://bitnob.dev/docs/virtual-accounts/errors

| Situation | Ce que vous obtenez |
| --- | --- |
| NGN non activé pour vous | `feature-not-enabled` |
| Client sans BVN ou autres champs requis | Erreur de validation nommant chaque champ manquant |
| BVN ne correspond pas aux données client | Échec de vérification |
| Montant sous ₦500 ou au-dessus de ₦10 000 000 | Erreur de validation |
| Solde insuffisant | `failed precondition` |

Non précisé dans la doc : à quelle opération s'appliquent les bornes ₦500 / ₦10 000 000 et le « solde insuffisant » (aucun endpoint de retrait NGN n'est documenté dans ce lot) ; codes HTTP et forme JSON exacts de ces erreurs.

---

## 8) Contradictions et obsolescences relevées

| # | Sujet | Constat |
| --- | --- | --- |
| 1 | Signature de requête (JS de « Sending ») | JS : `Date.now()` (ms), concaténation `clientId+method+path+timestamp+body`, **base64**. Auth officielle : secondes, `CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD`, **hex**. À ignorer. |
| 2 | `reference` du retrait | Docs stablecoins : **requis**. Référence API : **Optional** (mais recommandé). |
| 3 | Doublon de `reference` | Docs : « même réponse » ou « peut réessayer ». Référence API : `409 DUPLICATE_REFERENCE`, avec le retrait existant dans `data`. |
| 4 | `Idempotency-Key` (en-tête) | Documenté dans Getting Started et Key Concepts (fenêtre 24 h) ; absent de la référence API (seul `reference` en body). |
| 5 | Frais | Forfait $1 en plus du montant (Sending, UX) vs suggestion d'UI « Network Fee $0.01, you'll receive $0.99 » (Advanced). Webhook `transfer.failed` : `fee: "0"`. |
| 6 | Confirmations Polygon | Key Concepts : **128** ; guide de réconciliation : **15**. |
| 7 | Chaînes d'envoi | Sending liste 13 entrées (dont TON/Plasma « coming soon ») ; référence withdrawal : `ethereum, bsc, polygon, solana, tron, stellar, bitcoin` seulement. Génération d'adresse (référence addresses) : `avalanche, base, bitcoin, ethereum, optimism, polygon, solana, stellar` (sans tron/bsc/arbitrum, alors que la page « Issuing » cite tron, bsc, arbitrum). Prod : « 13 chaînes » (référence) vs 12 lignes dans la table de la page dépôts. |
| 8 | Payloads de webhook | `event_id`, `from_address`, `transaction_id` présents sur certains exemples, absents sur d'autres pour la même page/événement. `confirmations` annoncé mais jamais présent. |
| 9 | Retries webhook | « jusqu'à acquittement » (Getting Started) vs « 3 fois après le 1er échec » (Webhooks) / « up to 3 times with exponential backoff » (référence). Délai : « 2xx sous 5 s » (Handling) vs « 200 » partout ailleurs. |
| 10 | `transfer.initiated` | Cité dans « Handling webhooks » comme à ne pas utiliser pour créditer ; aucun payload ni définition ailleurs. |
| 11 | Page `_internal-wallet-to-wallet-transfers` | Endpoint `/api/wallets/transfers` absent de la référence API ; page probablement brouillon/obsolète. |
| 12 | Formats d'erreur | 3 formes : `{status:false, message, errorCode}` (docs), `{success:false, message, error:{code,details}}` (withdrawal), RFC 7807-like `{type,title,status,detail,code,correlation_id}` (wallets). |
| 13 | Webhook VA | Enveloppe camelCase (`eventType`, `eventId`, `payload`) différente de l'enveloppe stablecoin (`event`, `event_id`, `data`). |
| 14 | Montant webhook VA | La référence dit « in naira as a string. `'5000000'` is ₦50,000.00 » alors que toutes les autres surfaces VA parlent de **kobo** (5 000 000 kobo = ₦50 000,00) : le mot « naira » est trompeur. |
| 15 | `customer_type` VA | Requis dans la référence (« Customer type is required »), absent du tableau de Getting Started. |

---

## 9) À retenir pour DioteKo

- **Environnement** : une seule URL `https://api.bitnob.com`; sandbox/live déterminé par les clés (`GET /api/whoami` → `data.environment`). Ne pas coder deux URL.
- **Auth des requêtes** : `X-Auth-Client`, `X-Auth-Timestamp` (**secondes**), `X-Auth-Nonce`, `X-Auth-Signature` = HMAC-SHA256 **hex** de `CLIENT_ID:TIMESTAMP:NONCE:PAYLOAD`. Ignorer l'exemple JS base64/ms de la page « Sending ».
- **Webhooks stablecoins** : événements `deposit.success`, `transfer.success`, `transfer.failed` ; vérifier `x-bitnob-signature` = HMAC **SHA-512** hex du **corps brut** avec le secret webhook ; comparer en temps constant ; répondre vite en 200 ; dédoublonner (`event_id` si présent + `reference`/`hash`) ; livraison au moins une fois ; IP sources `18.171.51.218` et `13.134.154.133` (couche secondaire). Payloads : voir §5.1/§5.2.
- **Unités** : USDT/USDC en unités de base à 6 décimales, en **string** (`"1000000"` = 1 USDT). Dépôt et envoi minimum **$1**. Frais d'envoi **$1 forfaitaire en plus**.
- **Lightning (hors de ce fichier)** : les docs stablecoins ne couvrent pas le pay-in Lightning ; la page webhooks cite seulement l'événement `btc.lightning.received.success` sans payload. Contrat Lightning complet dans `api-reference-core.md`.
- **Scopes** : prévoir une clé avec `wallet:read`/`wallet:write`/`transfer:create` selon besoin ; vérifier `data.permissions` (`null` = accès complet, à éviter en prod). Le scope nécessaire pour les routes Lightning n'est pas précisé dans la doc.
- **Limite de débit** : 60 req/min/clé ; 429 avec `Retry-After` ; backoff exponentiel.
- **Sandbox** : faucet Circle pour USDC/USDT de test; chaînes testnet limitées (voir §4.2). Pour les virtual accounts : `simulate-deposit` (sandbox uniquement).
- **KYC / limites virtual accounts** : BVN (11 chiffres), nom + date de naissance identiques au registre, 18 ans minimum, NGN uniquement, `feature-not-enabled` si NGN non activé ; bornes ₦500 à ₦10 000 000 citées sans opération associée. Montants VA en kobo (÷100 pour afficher des naira).
- **Réconciliation** : ne créditer qu'à la réception de l'événement de succès ; garder un `webhook_event_log` ; job de rattrapage via `GET /api/transactions` (curseur, `limit` max 100).

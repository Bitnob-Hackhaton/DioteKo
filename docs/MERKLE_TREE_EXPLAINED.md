# L'arbre de Merkle expliqué avec un exemple complet (4 événements, 3 certificats)

> Complète [`CERTIFICATE_EVENT_CHAIN.md`](CERTIFICATE_EVENT_CHAIN.md) (§8). Ce document
> suit **un exemple concret** de bout en bout : les tables, les lignes qu'elles contiennent,
> les hashs, l'arbre, la preuve et la triche détectée.
>
> **Légende :** 🎯 = cible, **pas encore dans le code**. Aujourd'hui `CertificateAnchorService`
> **simule** l'ancrage (faux `txId` aléatoire) et il n'existe ni table d'événements ni arbre de Merkle.
> Les hashs de ce document sont **réels** : ils ont été calculés avec SHA-256 sur les JSON montrés
> (affichés en version courte, 6 caractères, suivie de `…`).

---

## 1. L'idée en une minute

Chaque événement d'un certificat (émission, révocation…) a un **hash** : une empreinte de 64
caractères. On veut prouver sur Bitcoin que ces événements existaient à une certaine date, **sans
payer une transaction Bitcoin par événement**.

L'arbre de Merkle règle ça : on **colle les hashs deux par deux**, on re-hache, et on recommence
jusqu'à ne plus avoir qu'**un seul hash : la racine**. Une seule transaction Bitcoin contient cette
racine, et elle « scelle » **tous** les événements du lot.

```mermaid
flowchart LR
    A["4 événements<br/>4 hashs"] --> B["On colle 2 par 2<br/>et on re-hache<br/>2 hashs"]
    B --> C["On colle encore<br/>1 hash : la racine"]
    C --> D["1 seule transaction Bitcoin<br/>contient la racine"]

    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000

    class A,B,C process
    class D success
```

Si **un seul caractère** d'un seul événement change, son hash change, donc tous les hashs
au-dessus changent, donc la racine change, et elle ne correspond plus à celle écrite dans Bitcoin.

---

## 2. Le modèle conceptuel de données (MCD) 🎯

Trois tables nouvelles autour de ce qui existe déjà (la demande et le paiement). Les relations se lisent
ainsi : un certificat a **plusieurs** événements ; chaque événement appartient à **au plus un** lot
d'ancrage ; un lot regroupe **plusieurs** événements et correspond à **une** transaction Bitcoin.

```mermaid
erDiagram
    PAYMENT ||--o| CERTIFICATE_REQUEST : "règle"
    CERTIFICATE_REQUEST ||--o| CERTIFICATE : "aboutit à"
    CERTIFICATE ||--|{ CERTIFICATE_EVENT : "possède"
    ANCHOR_BATCH |o--o{ CERTIFICATE_EVENT : "regroupe"

    PAYMENT {
        uuid id PK
        string status
    }
    CERTIFICATE_REQUEST {
        uuid id PK
        uuid payment_id FK
        string status
    }
    CERTIFICATE {
        uuid id PK
        uuid request_id FK
        string certificate_type
        string status_cached
    }
    CERTIFICATE_EVENT {
        uuid id PK
        uuid certificate_id FK
        int seq
        string event_type
        string previous_hash
        string content_hash
        string event_hash
        datetime occurred_at
        uuid anchor_batch_id FK
        int leaf_index
        json merkle_proof
    }
    ANCHOR_BATCH {
        uuid id PK
        string merkle_root
        int leaf_countv
        string bitcoin_tx_id
        string status
        datetime anchored_at
    }
```

| Table | Rôle | Existe aujourd'hui ? |
|---|---|---|
| `payments` | Le paiement du citoyen (un par demande) | ✅ oui |
| `admin_certificate_requests` | La demande (porte `payment_id`) | ✅ oui |
| `certificates` | Le certificat émis (aujourd'hui : `admin_certificates_refs` + `verifiable_credentials`) | 🟡 en partie |
| `certificate_events` | Le journal : 1 ligne par événement, jamais modifiée, jamais supprimée | 🎯 non |
| `anchor_batches` | 1 ligne par lot ancré : racine de Merkle + transaction Bitcoin | 🎯 non |

> **Le paiement.** Chaque nouveau certificat vient d'une demande **payée**. Seul un certificat
> **réellement émis** produit un événement `ISSUED`. Le paiement ne fait donc pas partie de l'arbre :
> il déclenche l'émission, l'émission crée l'événement, et c'est l'**événement** qui entre dans l'arbre.
> Le coût d'une transaction Bitcoin est partagé entre tous les certificats du lot.

```mermaid
flowchart LR
    P["Paiement du citoyen<br/>Lightning via Bitnob"] --> I["Certificat émis"]
    I --> E["Événement ISSUED<br/>écrit dans certificate_events"]
    E --> Q["En attente<br/>du prochain lot"]
    Q --> B["Lot d'ancrage<br/>arbre de Merkle"]
    B --> T["Transaction Bitcoin<br/>avec la racine"]

    classDef finance fill:#ff922b,stroke:#d9480f,color:#fff
    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef pending fill:#ffd43b,stroke:#f08c00,color:#000
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000

    class P finance
    class I,E,B process
    class Q pending
    class T success
```

---

## 3. Le scénario de l'exemple

Entre 09h00 et 09h12, le 20 octobre 2026, il se passe **4 choses** sur **3 certificats** :

| Événement | Heure | Certificat | Type | `seq` |
|---|---|---|---|---|
| E1 | 09:00 | C-001 | `ISSUED` | 1 |
| E2 | 09:04 | C-002 | `ISSUED` | 1 |
| E3 | 09:10 | C-001 | `REVOKED` | 2 |
| E4 | 09:12 | C-003 | `ISSUED` | 1 |

Deux idées qui ne se mélangent pas :

- **La chaîne `previousHash`** relie les événements **d'un même certificat** (C-001 : E3 pointe vers E1).
- **L'arbre de Merkle** regroupe les événements **de tous les certificats** qui arrivent pendant la même fenêtre.

```mermaid
flowchart LR
    subgraph C1["Certificat C-001"]
        E1["E1 ISSUED<br/>seq 1<br/>previousHash = null"] --> E3["E3 REVOKED<br/>seq 2<br/>previousHash = hash de E1"]
    end
    subgraph C2["Certificat C-002"]
        E2["E2 ISSUED<br/>seq 1<br/>previousHash = null"]
    end
    subgraph C3["Certificat C-003"]
        E4["E4 ISSUED<br/>seq 1<br/>previousHash = null"]
    end

    classDef success fill:#51cf66,stroke:#2f9e44,color:#000
    classDef error fill:#ff6b6b,stroke:#c92a2a,color:#fff

    class E1,E2,E4 success
    class E3 error
```

---

## 4. Étape 1 : chaque événement devient une feuille (son hash)

Un événement est écrit sous une forme **canonique** (clés triées, aucun espace superflu) puis passé
dans SHA-256. Exemple réel pour **E1** :

```json
{"certificateId":"C-001","contentHash":"sha256:aa11","occurredAt":"2026-10-20T09:00:00Z","previousHash":null,"seq":1,"type":"ISSUED"}
```

SHA-256 de ce texte = `47771d32b14a2bc9b2e7854f84497fe85ae1b824ff8b11072298351fdb54367f`, soit **H1 = `47771d…`**.

Pour **E3**, le champ `previousHash` contient le hash complet de E1. C'est ce qui fait la **chaîne** :

```json
{"certificateId":"C-001","contentHash":"sha256:cc33","occurredAt":"2026-10-20T09:10:00Z","previousHash":"47771d32b14a2bc9b2e7854f84497fe85ae1b824ff8b11072298351fdb54367f","seq":2,"type":"REVOKED"}
```

| Feuille | Événement | Hash (version courte) |
|---|---|---|
| **H1** | E1 : C-001 `ISSUED` | `47771d…` |
| **H2** | E2 : C-002 `ISSUED` | `72d45f…` |
| **H3** | E3 : C-001 `REVOKED` | `f7c7ab…` |
| **H4** | E4 : C-003 `ISSUED` | `f26144…` |

> **Aucune donnée personnelle** dans l'événement : seulement un `contentHash` (empreinte du contenu du
> certificat, avec un sel aléatoire côté serveur). Même la racine publiée sur Bitcoin ne révèle rien.

### Dans la base, avant l'ancrage 🎯

Les événements sont écrits **tout de suite**, mais ne sont pas encore dans un lot.

**`certificates`**

| id | certificate_type | status_cached |
|---|---|---|
| C-001 | résidence | REVOKED |
| C-002 | naissance | ISSUED |
| C-003 | nationalité | ISSUED |

**`certificate_events`**

| id | certificate_id | seq | event_type | previous_hash | event_hash | anchor_batch_id | leaf_index |
|---|---|---|---|---|---|---|---|
| E1 | C-001 | 1 | ISSUED | null | `47771d…` | *vide* | *vide* |
| E2 | C-002 | 1 | ISSUED | null | `72d45f…` | *vide* | *vide* |
| E3 | C-001 | 2 | REVOKED | `47771d…` | `f7c7ab…` | *vide* | *vide* |
| E4 | C-003 | 1 | ISSUED | null | `f26144…` | *vide* | *vide* |

> `status_cached` n'est qu'un **cache** pour répondre vite. La vérité, c'est la suite des événements.

---

## 5. Étape 2 : construire l'arbre

Règle unique : **le parent = SHA-256 des deux enfants collés, gauche puis droite.**

| Calcul | Résultat |
|---|---|
| H12 = SHA-256(H1 puis H2) | `57a8ee…` |
| H34 = SHA-256(H3 puis H4) | `c5a465…` |
| **Racine R = SHA-256(H12 puis H34)** | **`390ffa…`** |

```mermaid
flowchart TD
    E1["E1 · C-001 ISSUED<br/>H1 = 47771d…"] --> N12["H12 = 57a8ee…<br/>hash de H1 puis H2"]
    E2["E2 · C-002 ISSUED<br/>H2 = 72d45f…"] --> N12
    E3["E3 · C-001 REVOKED<br/>H3 = f7c7ab…"] --> N34["H34 = c5a465…<br/>hash de H3 puis H4"]
    E4["E4 · C-003 ISSUED<br/>H4 = f26144…"] --> N34
    N12 --> R["Racine R = 390ffa…<br/>hash de H12 puis H34"]
    N34 --> R

    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000

    class E1,E2,E3,E4,N12,N34 process
    class R success
```

Remarque : l'arbre mélange **plusieurs certificats** (C-001, C-002, C-003). C'est voulu : un seul
point d'ancrage pour tout le monde.

---

## 6. Étape 3 : ancrer la racine sur Bitcoin

On écrit **uniquement la racine** (32 octets) dans une transaction Bitcoin (champ `OP_RETURN`) 🎯.
Une fois la transaction confirmée, on remplit la base.

**`anchor_batches`** (une seule ligne pour tout le lot)

| id | merkle_root | leaf_count | bitcoin_tx_id | status | anchored_at |
|---|---|---|---|---|---|
| B-001 | `390ffa91cdaf48c5…` | 4 | *l'identifiant de la transaction* | CONFIRMED | 2026-10-20 09:30 |

**`certificate_events`** après l'ancrage : on ajoute le lot, la position de la feuille et la **preuve**.

| id | certificate_id | event_hash | anchor_batch_id | leaf_index | merkle_proof |
|---|---|---|---|---|---|
| E1 | C-001 | `47771d…` | B-001 | 0 | `[H2, H34]` |
| E2 | C-002 | `72d45f…` | B-001 | 1 | `[H1, H34]` |
| E3 | C-001 | `f7c7ab…` | B-001 | 2 | `[H4, H12]` |
| E4 | C-003 | `f26144…` | B-001 | 3 | `[H3, H12]` |

Chaque événement garde **2 hashs** : ses « voisins » sur le chemin jusqu'à la racine. C'est sa preuve.

```mermaid
flowchart LR
    ROOT["Racine 390ffa…"] --> TX["Transaction Bitcoin<br/>(1 seule)"]
    TX --> BATCH["anchor_batches<br/>B-001"]
    BATCH --> L1["E1"]
    BATCH --> L2["E2"]
    BATCH --> L3["E3"]
    BATCH --> L4["E4"]

    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000

    class ROOT,BATCH,L1,L2,L3,L4 process
    class TX success
```

---

## 7. La preuve de Merkle : vérifier E3 sans connaître E1 ni E2

Un vérificateur veut savoir : « La révocation E3 était-elle bien dans le lot ancré sur Bitcoin ? »

Il reçoit : **E3** (son contenu), la **preuve** `[H4 à droite, H12 à gauche]`, et il lit la **racine
dans Bitcoin**. Il refait les calculs :

| # | Calcul du vérificateur | Résultat |
|---|---|---|
| 1 | H3 = SHA-256(JSON canonique de E3) | `f7c7ab…` |
| 2 | H34 = SHA-256(H3 puis **H4** à droite) | `c5a465…` |
| 3 | R = SHA-256(**H12** à gauche puis H34) | `390ffa…` |
| 4 | Comparer avec la racine lue dans Bitcoin | **identique** : E3 faisait bien partie du lot |

```mermaid
flowchart TD
    E3["E3 : l'événement à vérifier<br/>H3 = f7c7ab…"] --> N34["H34 calculé = c5a465…"]
    H4["H4 = f26144…<br/>fourni dans la preuve"] --> N34
    H12["H12 = 57a8ee…<br/>fourni dans la preuve"] --> R["R calculé = 390ffa…"]
    N34 --> R
    R --> CMP{"Même valeur que<br/>la racine dans Bitcoin ?"}
    CMP -- oui --> OK["E3 est prouvé<br/>et ancré à cette date"]
    CMP -- non --> KO["Preuve invalide"]

    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef pending fill:#ffd43b,stroke:#f08c00,color:#000
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000
    classDef error fill:#ff6b6b,stroke:#c92a2a,color:#fff

    class E3,N34,R process
    class H4,H12 pending
    class OK success
    class KO error
```

*Jaune = hashs fournis par la preuve. Bleu = calculés par le vérificateur. Les événements E1 et E2 ne sont
jamais montrés : on ne voit que `H12`, une empreinte.*

```mermaid
sequenceDiagram
    participant V as Vérificateur
    participant A as API DioteKo
    participant B as Bitcoin

    V->>A: Demander l'événement E3 et sa preuve
    A-->>V: E3, preuve H4 à droite et H12 à gauche, identifiant du lot
    V->>V: Recalculer H3, puis H34, puis la racine
    V->>B: Lire la racine contenue dans la transaction du lot
    B-->>V: Racine 390ffa…
    V->>V: Comparer les deux racines
    Note over V: Identiques : E3 est authentique et ancré
```

### Pourquoi c'est efficace

La taille de la preuve grandit **très lentement** avec le nombre d'événements :

| Événements dans le lot | Hashs dans la preuve | Taille de la preuve |
|---|---|---|
| 4 | 2 | 64 octets |
| 1 000 | 10 | 320 octets |
| 1 000 000 | 20 | 640 octets |

Un lot d'un million d'événements se vérifie avec **20 hashs** et **une** transaction Bitcoin.

---

## 8. Que se passe-t-il si quelqu'un triche ?

Imaginons que l'on transforme, après coup, la révocation E3 en émission (`REVOKED` devient `ISSUED`)
pour faire passer un certificat révoqué pour valide.

```mermaid
flowchart TD
    T["E3 falsifié<br/>REVOKED devient ISSUED"] --> H3["H3 devient a61b06…<br/>au lieu de f7c7ab…"]
    H3 --> H34["H34 devient fbad00…<br/>au lieu de c5a465…"]
    H34 --> R["Racine devient 6b19ec…<br/>au lieu de 390ffa…"]
    R --> CMP{"Racine dans Bitcoin<br/>= 390ffa… ?"}
    CMP -- différente --> FRAUD["Fraude détectée"]
    BTC["Bitcoin garde 390ffa…<br/>et personne ne peut la modifier"] --> CMP

    classDef error fill:#ff6b6b,stroke:#c92a2a,color:#fff
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000
    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff

    class T,H3,H34,R,FRAUD error
    class BTC success
    class CMP process
```

Le tricheur ne peut pas « réparer » la racine : il devrait **réécrire Bitcoin**. Il ne peut pas non plus
recalculer la chaîne `previousHash` pour tout masquer, car la racine ancrée ne correspondra plus.

Ce que Merkle **ne** fait **pas** : il ne protège pas les événements **pas encore ancrés** (voir
[`CERTIFICATE_EVENT_CHAIN.md`](CERTIFICATE_EVENT_CHAIN.md) §10 : fenêtre de risque). D'où l'intérêt d'ancrer
régulièrement.

---

## 9. Quand le nombre d'événements est impair

Un lot n'a pas une taille fixe de 4 : il peut contenir 1, 5 ou 1 000 événements, selon ce qui est
arrivé **avant sa fermeture** (voir §10). Si, au moment de fermer le lot, le nombre d'événements est
impair, le dernier n'a pas de voisin. Exemple avec 5 événements : on **recopie le dernier hash** pour
l'apparier avec lui-même (méthode utilisée par Bitcoin pour ses propres blocs). Cette recopie ne concerne
que l'instant où l'on construit l'arbre, jamais des événements qui arriveraient plus tard.

```mermaid
flowchart TD
    H1["H1"] --> H12["H12"]
    H2["H2"] --> H12
    H3["H3"] --> H34["H34"]
    H4["H4"] --> H34
    H12 --> H1234["H1234 = 390ffa…"]
    H34 --> H1234
    H5["H5 = 559a16…"] --> H55["H55 = 1e2041…<br/>H5 collé avec lui-même"]
    H5 --> H55
    H55 --> H5555["H5555<br/>H55 collé avec lui-même"]
    H55 --> H5555
    H1234 --> RAC["Racine = 853e95…"]
    H5555 --> RAC

    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef pending fill:#ffd43b,stroke:#f08c00,color:#000
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000

    class H1,H2,H3,H4,H12,H34,H1234,H5555 process
    class H5,H55 pending
    class RAC success
```

*Jaune = hash recopié pour combler le manque.*

> **Note de sécurité pour l'implémentation 🎯.** Dans une version de production, on préfixe les
> feuilles et les nœuds d'un octet différent avant de hacher (par exemple `0x00` pour une feuille, `0x01`
> pour un nœud) afin d'empêcher de faire passer un nœud pour une feuille. L'exemple ci-dessus reste
> volontairement simple.

---

## 10. Plusieurs lots : les événements qui arrivent après, et un certificat réparti sur plusieurs lots

### 10.1 Un lot fermé ne change plus : les nouveaux événements vont dans un nouveau lot

Un arbre se construit des feuilles vers la racine, **une seule fois**, au moment où le lot est fermé
(par exemple toutes les 30 minutes, ou dès qu'il y a 100 événements : à choisir 🎯). Une fois la racine
écrite dans Bitcoin, on n'y ajoute plus rien : ajouter une feuille changerait la racine, qui ne
correspondrait plus à celle de la transaction.

Les événements suivants attendent donc dans un **nouveau lot**, avec un **nouvel arbre**, une **nouvelle
racine** et une **nouvelle transaction**. Les anciens lots ne sont jamais recalculés et leurs preuves
restent valables. **Un lot = un ancrage.**

```mermaid
flowchart LR
    subgraph B1["Lot B-001 : fermé et ancré"]
        E1["E1"] --> R1["Racine 390ffa…"]
        E2["E2"] --> R1
        E3["E3"] --> R1
        E4["E4"] --> R1
        R1 --> T1["Transaction Bitcoin n°1"]
    end
    subgraph B2["Lot B-002 : fermé et ancré plus tard"]
        E5["E5"] --> R2["Nouvelle racine"]
        E6["E6"] --> R2
        R2 --> T2["Transaction Bitcoin n°2"]
    end
    subgraph B3["Lot B-003 : ouvert"]
        E7["E7 en attente<br/>d'autres événements"]
    end

    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000
    classDef pending fill:#ffd43b,stroke:#f08c00,color:#000

    class E1,E2,E3,E4,E5,E6,R1,R2 process
    class T1,T2 success
    class E7 pending
```

Cycle de vie d'un lot (colonne `status` de `anchor_batches`) :

```mermaid
stateDiagram-v2
    [*] --> OPEN
    OPEN --> CLOSED: fermeture par délai ou par taille
    CLOSED --> BROADCAST: racine calculée et transaction diffusée
    BROADCAST --> CONFIRMED: transaction confirmée
    CONFIRMED --> [*]

    classDef pending fill:#ffd43b,stroke:#f08c00,color:#000
    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000

    class OPEN pending
    class CLOSED,BROADCAST process
    class CONFIRMED success
```

### 10.2 Un même certificat dont les événements sont dans plusieurs lots

Cas : le certificat **C-005** est émis, révoqué, réémis, révoqué, réémis. Cela fait 5 événements, répartis
sur 3 lots.

| Événement | `seq` | Type | `previous_hash` | Lot | Feuille |
|---|---|---|---|---|---|
| F1 | 1 | `ISSUED` | null | B-001 | 0 |
| F2 | 2 | `REVOKED` | hash de F1 | B-001 | 1 |
| F3 | 3 | `REISSUED` | hash de F2 | B-002 | 0 |
| F4 | 4 | `REVOKED` | hash de F3 | B-002 | 1 |
| F5 | 5 | `REISSUED` | hash de F4 | B-003 (ouvert) | 0 |

Il y a **deux liens indépendants** :

| Lien | Qui pointe vers quoi | Ce qu'il garantit |
|---|---|---|
| **Chaîne** | `previous_hash` de F(n) est le hash de F(n-1) | L'ordre et la continuité de l'historique. Elle ne dépend pas des lots. |
| **Ancrage** | `anchor_batch_id` et `merkle_proof` de chaque événement | Cet événement existait dans le lot X, donc avant la date de la transaction de X. |

Le **certificat** ne pointe vers aucun lot : ce sont ses **événements** qui le font.

```mermaid
flowchart LR
    subgraph B1["Lot B-001 : ancré"]
        F1["F1 ISSUED<br/>seq 1"]
        F2["F2 REVOKED<br/>seq 2"]
    end
    subgraph B2["Lot B-002 : ancré"]
        F3["F3 REISSUED<br/>seq 3"]
        F4["F4 REVOKED<br/>seq 4"]
    end
    subgraph B3["Lot B-003 : ouvert, pas encore ancré"]
        F5["F5 REISSUED<br/>seq 5"]
    end

    F2 -->|"previous_hash"| F1
    F3 -->|"previous_hash"| F2
    F4 -->|"previous_hash"| F3
    F5 -->|"previous_hash"| F4

    classDef success fill:#51cf66,stroke:#2f9e44,color:#000
    classDef error fill:#ff6b6b,stroke:#c92a2a,color:#fff
    classDef pending fill:#ffd43b,stroke:#f08c00,color:#000

    class F1,F3 success
    class F2,F4 error
    class F5 pending
```

*Les flèches de chaîne traversent les lots sans problème : elles ne regardent que les hashs. Vert =
certificat valide, rouge = révoqué, jaune = pas encore ancré.*

**Vérification du certificat :** on prend les événements triés par `seq`, et pour **chacun** on contrôle :

1. son hash recalculé est identique à celui stocké ;
2. son `previous_hash` est le hash de l'événement précédent ;
3. sa preuve de Merkle remonte à la racine de **son** lot (F1 et F2 dans B-001, F3 et F4 dans B-002) ;
4. cette racine est bien dans la transaction Bitcoin de ce lot.

Le statut courant est le type du **dernier** événement (ici `REISSUED`), valide si `validUntil` n'est pas
dépassé. Comme F5 est dans un lot ouvert, l'API peut répondre « valide, mais le dernier événement n'est
pas encore ancré » (fenêtre de risque, `CERTIFICATE_EVENT_CHAIN.md` §10).

Deux conséquences utiles :

- **Le dernier ancrage couvre tout le passé.** Le hash de F5 dépend de celui de F4, qui dépend de F3, etc.
  Dès que F5 est ancré, on prouve que toute la chaîne F1 à F4 existait au plus tard à cette date. Les
  ancrages précédents servent à dater chaque événement plus précisément.
- **Règle d'implémentation 🎯 :** les événements d'un même certificat entrent dans les lots dans l'ordre
  de `seq`. Ainsi la date d'ancrage de F(n+1) n'est jamais antérieure à celle de F(n), et le vérificateur
  peut contrôler cette cohérence.

---

## 11. Qui paie l'ancrage ? 🎯 décision ouverte

Un lien `previous_hash` ne coûte rien (c'est une colonne de la base). L'**ancrage**, lui, est une
transaction Bitcoin : il a des **frais**. Une transaction coûte à peu près la même chose pour 4 ou pour
1 000 événements (les montants dépendent du réseau), donc **plus le lot est gros, moins chaque événement
coûte**. C'est la raison d'être de l'arbre de Merkle.

| Événement | Qui le déclenche | Paiement du citoyen ? | Qui porte l'ancrage |
|---|---|---|---|
| `ISSUED` | Le citoyen (demande payée) | Oui | L'administration, sur ce qu'elle gagne à l'émission |
| `REISSUED` | Le citoyen (renouvellement) | Oui | L'administration |
| `REVOKED` | L'administration | **Non** | L'administration, forcément |

Une révocation n'a pas de paiement à côté : elle ne doit **jamais être bloquée** faute de frais.

**Piège à éviter :** « profiter du paiement pour ancrer » ne veut pas dire une transaction Bitcoin par
paiement, ce qui annulerait l'intérêt de Merkle. Le paiement **alimente un budget d'ancrage** (un crédit par
administration), et l'ancrage se fait ensuite **par lot**, avec ce budget.

```mermaid
flowchart LR
    PAY["Paiement du citoyen<br/>ISSUED ou REISSUED"] --> ADM["Part de l'administration"]
    ADM --> BUD["Budget d'ancrage<br/>de l'administration"]
    REV["Révocation<br/>décidée par l'administration<br/>sans paiement"] --> BUD
    BUD --> LOT["Fermeture du lot"]
    LOT --> TX["1 transaction Bitcoin<br/>frais payés par le budget"]

    classDef finance fill:#ff922b,stroke:#d9480f,color:#fff
    classDef authority fill:#9c36b5,stroke:#6f00b6,color:#fff
    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000

    class PAY,BUD finance
    class ADM,REV authority
    class LOT process
    class TX success
```

**Portée d'un lot : trois options.**

| Option | Avantage | Inconvénient |
|---|---|---|
| **Un lot global** (toutes les administrations) | Un seul portefeuille, coût par événement minimal | Il faut répartir les frais entre administrations |
| **Un lot par administration** | Chacune paie et signe son propre ancrage ; colle à `organization_id` | Une petite administration remplit son lot lentement : délai plus long ou coût par événement plus élevé |
| **Un lot global, frais répartis au prorata** | Un seul ancrage, frais équitables | Il faut une comptabilité par administration |

**Orientation actuelle (non figée) :** pour le hackathon, **un lot global géré par DioteKo sur le testnet**
(pas de vrais frais, un seul portefeuille, démonstration simple). En production, l'administration finance
l'ancrage avec son budget d'ancrage, et le lot par administration est l'évolution possible. Aujourd'hui l'argent
du citoyen arrive déjà à l'administration par le payout Bitnob, ce qui en fait le point naturel pour prélever la
part d'ancrage (non vérifié dans le code). Détail et points ouverts (règle de fermeture du lot, choix du vrai
ancrage) : [`DECISIONS.md`](DECISIONS.md).

---

## 12. Qui fait quoi : la chaîne et l'arbre se complètent

| | Chaîne `previousHash` | Arbre de Merkle |
|---|---|---|
| **Relie** | Les événements **d'un même certificat** | Les événements **de tous les certificats** d'un lot |
| **Sert à** | Rendre l'**historique** inviolable : on ne peut ni insérer ni retirer un événement au milieu | Prouver que des événements **existaient** à telle date avec **une seule** transaction |
| **Prouve** | L'ordre et la continuité | L'appartenance à un lot ancré |
| **Seul, il ne suffit pas car** | Celui qui contrôle la base peut tout recalculer | Il ne dit rien de l'ordre dans un certificat |
| **Dans la base** | `previous_hash`, `seq` | `anchor_batch_id`, `leaf_index`, `merkle_proof` |

```mermaid
flowchart LR
    CH["Chaîne previousHash<br/>par certificat<br/>historique cohérent"] --> ME["Arbre de Merkle<br/>par lot<br/>une racine"]
    ME --> BT["Transaction Bitcoin<br/>date et immuabilité"]

    classDef process fill:#4c6ef5,stroke:#1971c2,color:#fff
    classDef success fill:#51cf66,stroke:#2f9e44,color:#000

    class CH,ME process
    class BT success
```

---

## 13. Ce qui existe aujourd'hui et ce qui reste à faire

| Élément | État | Détail |
|---|---|---|
| Hash d'un document | ✅ | `createDocumentHash` (SHA-256 d'un JSON) dans `certificate-anchor.service.ts` |
| Ancrage Bitcoin | 🔴 simulé | `anchorDocumentHash` renvoie un `txId` aléatoire, rien n'est diffusé |
| Vérification d'ancrage | 🔴 simulée | `verifyDocumentHash` répond toujours `verified: true` |
| Table `certificate_events` | 🎯 à créer | journal en ajout seul |
| Table `anchor_batches` | 🎯 à créer | une ligne par lot |
| Calcul de l'arbre et des preuves | 🎯 à écrire | un petit service (quelques dizaines de lignes) |
| Vrai ancrage | 🎯 à choisir | transaction `OP_RETURN` maison, ou un service d'ancrage groupé existant (OpenTimestamps) : **à vérifier avant adoption** |

Ordre conseillé pour le hackathon : (1) table `certificate_events` avec `previous_hash`, (2) calcul de
l'arbre et des preuves **en local** avec un vrai SHA-256 (déjà démontrable, sans Bitcoin), (3) brancher
le vrai ancrage de la racine.

---

## 14. Mini-glossaire

| Mot | Sens simple |
|---|---|
| **Hash** | Empreinte de 64 caractères. Même texte donne toujours le même hash. Un caractère changé change tout le hash. |
| **Feuille** | Le hash d'un événement, tout en bas de l'arbre. |
| **Nœud** | Le hash obtenu en collant deux hashs enfants. |
| **Racine (Merkle root)** | Le hash tout en haut. Il résume **tout** le lot. C'est lui qu'on écrit dans Bitcoin. |
| **Preuve de Merkle** | Les hashs voisins nécessaires pour remonter d'une feuille jusqu'à la racine. |
| **Lot (batch)** | Ensemble d'événements ancrés ensemble avec une seule transaction. |
| **Ancrage** | Écrire la racine dans une transaction Bitcoin pour la dater de façon immuable. |

---

## 15. Phrase pour le jury

> « Chaque événement d'un certificat est haché, enchaîné au précédent, puis tous les événements d'un
> lot sont regroupés dans un arbre de Merkle dont **une seule racine** est inscrite sur Bitcoin. N'importe
> qui peut vérifier un événement avec une preuve de quelques hashs, sans nous faire confiance et sans
> que l'on révèle les autres certificats. »

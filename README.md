# DioteKo

Languages: [English](#english) | [Français](#français)

## English

DioteKo issues administrative certificates to citizens. A citizen signs in with Google (through Appwrite), requests a certificate in the mobile wallet, pays a Lightning invoice created by Bitnob, and receives a signed Verifiable Credential and a PDF with a QR code. Anyone can verify a certificate publicly.

**Status:** development prototype (Africa DID Hackathon 2026). Not production-ready. Simulated parts and known gaps are listed in [ARCHITECTURE.md](ARCHITECTURE.md).

### Components

| Folder | What it is | State |
|---|---|---|
| `backend-nest/` | NestJS 11 + TypeORM + PostgreSQL API, port 3001, prefix `/api` | Active |
| `frontmobile/` | Expo Router + React Native citizen wallet | Active (`app/admin/*` are mockups) |
| `frontweb/` | TanStack Start + Vite console for organisation staff | Active (real mode: list, detail, accept, reject, request-info) |

### Quick start

```bash
npm run dev:up        # repo root: Postgres, backend-nest and Appwrite in Docker
# fill backend-nest/.env (JWT_SECRET, VC_SIGNING_SECRET), see QUICKSTART.md
npm run db:setup      # repo root: migrations and seed
curl http://localhost:3001/api/healthz
cd frontmobile && npm install && npm start
```

Details: [QUICKSTART.md](QUICKSTART.md), [SETUP.md](SETUP.md), [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md).

### Documentation

- Onboarding: [QUICKSTART.md](QUICKSTART.md) · [SETUP.md](SETUP.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
- Overview: [ARCHITECTURE.md](ARCHITECTURE.md) · [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- Canonical details: [docs/ARCHITECTURE_AS_BUILT.md](docs/ARCHITECTURE_AS_BUILT.md) · [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md) · [docs/DATABASE_MODEL.md](docs/DATABASE_MODEL.md) · [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) · [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)

### License

ISC. See [LICENSE](LICENSE).

### Authors

**Salif Diallo**
- GitHub: [@MrSalifDiallo](https://github.com/MrSalifDiallo)
- LinkedIn: [Salif Diallo](https://www.linkedin.com/in/salif-diallo-152650313/)
- Email: [salifdiallo@esp.sn](mailto:salifdiallo@esp.sn)

**Aicha Ndiaye**
- GitHub: [@smiley100](https://github.com/smiley100)
- LinkedIn: [Aicha Ndiaye](https://www.linkedin.com/in/ndiaye-a%C3%AFcha-72ba87331)
- Email: [ndiayeaicha0928@gmail.com](mailto:ndiayeaicha0928@gmail.com)

---

## Français

DioteKo délivre des certificats administratifs aux citoyens. Le citoyen se connecte avec Google (via Appwrite), demande un certificat dans le wallet mobile, paie une facture Lightning créée par Bitnob, et reçoit une Verifiable Credential signée ainsi qu'un PDF avec QR code. N'importe qui peut vérifier un certificat publiquement.

**Statut :** prototype de développement (Africa DID Hackathon 2026). Pas prêt pour la production. Les parties simulées et les écarts connus sont listés dans [ARCHITECTURE.md](ARCHITECTURE.md).

### Composants

| Dossier | Rôle | État |
|---|---|---|
| `backend-nest/` | API NestJS 11 + TypeORM + PostgreSQL, port 3001, préfixe `/api` | Actif |
| `frontmobile/` | Wallet citoyen Expo Router + React Native | Actif (`app/admin/*` sont des maquettes) |
| `frontweb/` | Console TanStack Start + Vite pour le personnel des organisations | Actif (mode réel : liste, détail, accepter, rejeter, demander un complément) |

### Démarrage rapide

```bash
npm run dev:up        # racine du repo : Postgres, backend-nest et Appwrite en Docker
# renseigner backend-nest/.env (JWT_SECRET, VC_SIGNING_SECRET), voir QUICKSTART.md
npm run db:setup      # racine du repo : migrations et seed
curl http://localhost:3001/api/healthz
cd frontmobile && npm install && npm start
```

Détails : [QUICKSTART.md](QUICKSTART.md), [SETUP.md](SETUP.md), [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md).

### Documentation

- Prise en main : [QUICKSTART.md](QUICKSTART.md) · [SETUP.md](SETUP.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [CONTRIBUTING.md](CONTRIBUTING.md)
- Vue d'ensemble : [ARCHITECTURE.md](ARCHITECTURE.md) · [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- Détails de référence : [docs/ARCHITECTURE_AS_BUILT.md](docs/ARCHITECTURE_AS_BUILT.md) · [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md) · [docs/DATABASE_MODEL.md](docs/DATABASE_MODEL.md) · [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) · [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)

### Licence

ISC. Voir [LICENSE](LICENSE).

### Auteurs

**Salif Diallo**
- GitHub : [@MrSalifDiallo](https://github.com/MrSalifDiallo)
- LinkedIn : [Salif Diallo](https://www.linkedin.com/in/salif-diallo-152650313/)
- Email : [salifdiallo@esp.sn](mailto:salifdiallo@esp.sn)

**Aicha Ndiaye**
- GitHub : [@smiley100](https://github.com/smiley100)
- LinkedIn : [Aicha Ndiaye](https://www.linkedin.com/in/ndiaye-a%C3%AFcha-72ba87331)
- Email : [ndiayeaicha0928@gmail.com](mailto:ndiayeaicha0928@gmail.com)

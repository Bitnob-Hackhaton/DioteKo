# Project Summary

DioteKo issues administrative certificates to citizens. A certificate is requested in a mobile wallet, paid with a Bitcoin Lightning invoice, issued as a signed Verifiable Credential with a PDF and a QR code, and can be verified publicly. Built for the Africa DID Hackathon 2026. Status: prototype, not production-ready.

## Users

- **Citizen (holder):** signs in with Google, requests a certificate, pays the invoice, downloads the PDF, verifies a certificate.
- **Organisation staff (issuer, admin):** reviews requests in the web console (accept, reject, ask for more information), issues certificates, and settles payments to the organisation.
- **Anyone:** verifies a certificate from its identifier.

## Working end to end (sandbox)

- Google sign-in through Appwrite, then DioteKo tokens issued by `backend-nest`.
- Certificate request, agent review for types that need it, Lightning invoice creation at Bitnob, reading the payment status, automatic or manual issuance, PDF with QR code, 5-minute signed download link, public verification.
- Organisation console in real mode: list, detail, accept, reject, request more information.
- Bitnob payouts for a certificate (sandbox).
- Automated tests on the backend (Jest unit tests and an E2E suite).

## Not production-ready

- **Bitcoin anchoring is simulated.** The transaction ID is random and nothing is broadcast.
- **A real Lightning payment has not been observed.** The sandbox cannot settle invoices through the API.
- **Verifiable Credentials are checkable only by this backend**, because they use a shared HS256 secret.
- **Certificate PDFs live on the container filesystem** with no volume.
- **The citizen's name is declared,** from the Google profile or typed in the form. No verified identity source is connected.
- **Revocation is not scoped to the organisation.** Any issuer or admin can revoke any credential.
- **The mobile `app/admin/*` screens are mockups.** The mobile app has no automated tests, and the verification flow has not been tested on a phone.

Details and the full gap list: [ARCHITECTURE.md](ARCHITECTURE.md) and [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).

## Components

| Folder | Role |
|---|---|
| `backend-nest/` | NestJS 11 API with TypeORM and PostgreSQL |
| `frontmobile/` | Expo Router and React Native citizen wallet |
| `frontweb/` | TanStack Start and Vite console for organisation staff |

## Documentation map

- Onboarding: [README.md](README.md), [QUICKSTART.md](QUICKSTART.md), [SETUP.md](SETUP.md), [DEPLOYMENT.md](DEPLOYMENT.md), [CONTRIBUTING.md](CONTRIBUTING.md)
- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md), [docs/ARCHITECTURE_AS_BUILT.md](docs/ARCHITECTURE_AS_BUILT.md)
- Business and domain: [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md), [docs/DOMAIN_NOTES.md](docs/DOMAIN_NOTES.md)
- Operations: [docs/DEV_WORKFLOW.md](docs/DEV_WORKFLOW.md), [docs/TESTING.md](docs/TESTING.md), [docs/BITNOB.md](docs/BITNOB.md)
- Decisions and issues: [docs/DECISIONS.md](docs/DECISIONS.md), [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md), [docs/ROADMAP_NEXT_STEPS.md](docs/ROADMAP_NEXT_STEPS.md)

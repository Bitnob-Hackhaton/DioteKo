---
name: schema-rationale-docs
description: Where backend-nest schema / FK / migration rationale is documented (DECISIONS, KNOWN_ISSUES, SCHEMA)
metadata:
  type: reference
---

For `backend-nest/` schema, FK, and migration rationale — check these before assuming intent:

- `docs/DECISIONS.md` — architecture decisions (fresh DB / no data migration, simulated Bitcoin anchoring, HS256 VC signing, port 3001, one deep domain vs eight stubs). The Postgres host port is 5435 (`DIOTEKO_PG_HOST_PORT`).
- `docs/KNOWN_ISSUES.md` — deliberate gaps, e.g. `payments.bitnob_payout_id` / `bitnob_trade_id` have NO FK constraint by design (module-boundary choice); Bitnob DTO field names are best-guess (no live API docs); VC revoke has no org-scoping.
- `docs/SCHEMA.md` — column-level schema reference with nullability / FK notes.

Related: [[backend-nest-migration-stack]].

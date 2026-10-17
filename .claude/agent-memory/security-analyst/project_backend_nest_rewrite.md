---
name: backend-nest-rewrite
description: backend-nest/ is the running NestJS backend with working RBAC (global guards, @Roles, boot-time secret validation)
metadata:
  type: project
---

`backend-nest/` is the NestJS + TypeORM + PostgreSQL backend (port 3001, prefix `/api`). It is
the "NestJS + DID + Verifiable Credentials" target from CLAUDE.md.

**Why this matters for security review:** `backend-nest/` enforces access control server-side:
- Global guards in `backend-nest/src/app.module.ts`: `JwtAuthGuard` then `RolesGuard` via `APP_GUARD`.
- `@Roles(RoleCode.ISSUER, RoleCode.ADMIN)` decorator + `RoleCode` enum (`modules/identity/entities/role.entity.ts`).
- `RolesGuard` compares `@Roles` metadata against `req.user.roles` from the JWT.
- `env.validation.ts` fails boot on missing `JWT_SECRET` / `VC_SIGNING_SECRET`; Bitnob/Appwrite creds are warn-only.

**How to apply:** review `backend-nest/` routes against this threat model. Don't assume
"no server-side role enforcement" there. Related: [[bitnob-hmac-signing]].

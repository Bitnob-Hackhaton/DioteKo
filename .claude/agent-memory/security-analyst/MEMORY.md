# Security Analyst Memory

## Project

- [backend-nest rewrite](project_backend_nest_rewrite.md) — backend-nest is the running NestJS backend WITH working RBAC (global guards, @Roles, boot-time secret validation)
- [Bitnob HMAC signing](project_bitnob_hmac_signing.md) — outbound request signing scheme, the sign-what-you-send invariant, and what any change must preserve
- [Bitnob payout money-safety](project_bitnob_payout_money_safety.md) — money-out review checklist + authz model (org scope read from DB, beneficiary resolved server-side)
- [Bitnob withdrawals + bulk money-safety](project_bitnob_withdrawals_bulk_money_safety.md) — Increment 4 deltas vs the payout pattern + the conditions on-chain withdrawal/bulk-transfer must ship with
- [Bitnob webhook verification](project_bitnob_webhook_verification.md) — Increment 5 HMAC-SHA512 signature guard + transfer.* -> withdrawal/bulk status: guard-composition, replay reasoning, MUST-FIX conditions
- [backend-nest env separation](project_backend_nest_env_separation.md) — dev/test/prod .env-file split (env-files.ts + NODE_ENV): fail-closed analysis + .dockerignore leak / seed prod-guard blockers
- [admin-certificates org scoping](project_admin_certs_org_scoping.md) — staff-per-org rule; 1-sat invoice hole FIXED; public PDF FIXED (signed 5-min links, PR #7); residual: QR = certificateId only, file-link holder-only

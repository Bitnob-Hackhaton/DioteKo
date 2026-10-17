---
name: review-gate-convention
description: On backend-nest increments, @security-analyst and @migration-reviewer run before @code-reviewer; their numbered conditions (M1-M6, A1-A5) are referenced in code comments
metadata:
  type: project
---

For non-trivial `backend-nest/` increments the team runs a multi-agent review pipeline
(CLAUDE.md §3 Phase 4): `@security-analyst` and `@migration-reviewer` first, then
`@code-reviewer`.

**Why:** money-movement / auth / migration changes need specialist review before the
generalist pass; keeps each agent's scope narrow (CLAUDE.md §10).

**How to apply:**
- Security-analyst conditions are labelled `M1`, `M2`, ... and migration-reviewer
  conditions `A1`, `A2`, ...  These IDs get written into code comments (e.g.
  `// M4 — local writes are transactional`, `// A3 runtime guard`).
- As code-reviewer: confirm the M#/A# conditions are ACTUALLY met in the code (don't
  trust the comment), and focus new findings on what the earlier passes' scope missed
  (cross-feature interactions, error/edge paths, tests, ledger completeness).
- Deliverable format expected: BLOCKING vs NON-BLOCKING with file:line + fix, explicit
  yes/no on each security condition, and a SHIP / FIX-THEN-SHIP / REWORK verdict.
- See [[backend-nest-migration]].

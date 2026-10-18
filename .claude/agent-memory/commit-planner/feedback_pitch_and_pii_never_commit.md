---
name: pitch-and-pii-never-commit
description: pitch/ must never be committed; KYC console/mobile screenshots and identity-looking mock values block commits until de-identified
metadata:
  type: feedback
---

`pitch/` (untracked on purpose, history rewritten to remove it) is never staged: no `git add pitch/`, and no catch-all that could include it. It is listed as "excluded on purpose" in every plan. Do not edit `.gitignore` to hide it.

`frontweb/Screen/` and `frontmobile/Screen/KYC/` hold readable identity data (names, birth dates, ID numbers, passport photo). They stay out of every commit until blurred or replaced. The README embeds them, so the `docs(readme)` commit ships broken images until the user decides.

`frontweb/src/lib/mocks-kyc.ts` (added KYC mocks) carries identity-looking values (full names, date of birth, ID number, nationality). Treat them as real data until the user says they are invented.

**Why:** user hard rule after a history rewrite removed `pitch/`; the KYC screenshots and mocks show real-looking holder data, and the README rule forbids personal data.

**How to apply:** before planning any `frontweb/src/` or README commit, grep for those values and for `Screen/KYC`. Never use `git add docs/` (it would pull `docs/pr/`) or `git add frontmobile/` (it would pull Expo template files and `Screen/`). Use explicit paths or the narrow `:!` exclusions.

Related: [[readme-screenshots-pii]] (readme-writer memory).

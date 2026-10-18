---
name: readme-screenshots-pii
description: Screenshots in frontweb/Screen/KYC and frontmobile/Screen/KYC can show real identity data; check each image for readable names, birth dates and ID numbers before captioning and flag it
metadata:
  type: feedback
---

Read every screenshot before captioning, and look for readable personal data (name, birth date, ID or passport number), not just the screen content.

**Why:** the console KYC screenshots (`frontweb/Screen/KYC/Illisible_MRZ.png`, `Not_conclued_KYC.png`) showed a real holder name, birth date and ID number in the OCR table, while the hard rule says no personal data in the README. Mobile KYC shots were hand-redacted with black scribbles.

**How to apply:** captions never repeat readable values. Flag the offending files to the caller in the final report so the author blurs them before committing. README layout: mobile thumbnails width 170, wide console shots width 330 in 2-column tables, one table per row pair.

Related repo facts: `docs/KYC.md` sections 16 and 17 are the source of truth for KYC; section 5 and `pitch/09` are stale on the "refusal ends in rejected" rule.

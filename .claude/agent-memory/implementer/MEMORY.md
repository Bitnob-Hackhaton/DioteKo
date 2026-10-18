# Implementer Memory Index

- [Bitnob API facts (live sandbox)](project_bitnob_api_facts.md) — verified envelope/error shapes + quirks; RFC 7807 errors; payout 3-step flow probed live
- [Bitnob module layout after Increment 3](project_bitnob_module_layout.md) — payout rework: BitnobPayoutsService (repo-free), BitnobMoneyController, cert-path in AdminCertificatesService, security conditions
- [Bitnob sandbox limits](project_bitnob_sandbox_limits.md) — DioteKo sandbox: bulk writes 403 "Feature Not Enabled", no stablecoin balance, address-validate field is `valid`; shaped Increment 4 decisions
- [Bitnob money-safety model](project_bitnob_money_safety_model.md) — recurring pattern for Bitnob money code: service-first prod gate, CAS, revert vs no-revert, PII-safe errors
- [KYC assessment vault](project_kyc_assessment.md) — agent sees Idswyft OCR/scores via encrypted kyc_documents kind=assessment; no migration; shapes unverified
- [Bitnob webhook guard (Increment 5)](project_bitnob_webhook_guard.md) — HMAC-SHA512 rawBody guard, catch-all route, transfer.* -> withdrawal status; the Buffer.from-hex-doesn't-throw gotcha

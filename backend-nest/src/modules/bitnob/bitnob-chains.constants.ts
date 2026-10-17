/**
 * Validation vocabularies + amount limits for the Increment 4 Bitnob
 * money-movement surface (on-chain withdrawals + bulk transfers).
 *
 * `GET /api/stablecoins/supported-chains` is the per-environment source of
 * truth for the chain list; this constant is the conservative allow-list the
 * DTOs enforce so an unknown value is a clean 400 rather than a Bitnob
 * round-trip. Keep it a subset of what that endpoint returns. The DTOs
 * lower-case the incoming `chain` before matching (via `@Transform`), so
 * `"Ethereum"` is accepted and normalised to `"ethereum"`.
 */
export const BITNOB_CHAINS = [
  'ethereum',
  'bsc',
  'polygon',
  'solana',
  'tron',
  'stellar',
  'bitcoin',
] as const;

export type BitnobChain = (typeof BITNOB_CHAINS)[number];

/**
 * Withdrawal / bulk currencies for THIS increment: USDT + USDC only.
 *
 * Both are 6-decimal stablecoins on every chain Bitnob supports, and both
 * track USD ~1:1 — so the "$10 USD minimum" Bitnob enforces becomes a fixed
 * base-unit threshold (`WITHDRAWAL_MIN_BASE_UNITS`) with NO FX lookup.
 * BTC / native-asset withdrawals are deferred to a later increment: they
 * would need a live FX conversion to evaluate the USD minimum.
 */
export const BITNOB_WITHDRAWAL_CURRENCIES = ['USDT', 'USDC'] as const;

export type BitnobWithdrawalCurrency = (typeof BITNOB_WITHDRAWAL_CURRENCIES)[number];

/**
 * Positive base-unit integer string: no leading zero, 1..18 digits. Shared by
 * the withdrawal `amount` and each bulk item `amount`.
 *
 * Bulk-amount-unit note: the Phase 1 sandbox probe could NOT confirm whether
 * Bitnob echoes bulk item `amount` back in base units or a decimal string —
 * bulk transfers are "Feature Not Enabled" on the DioteKo sandbox account
 * (`POST /api/bulk-transfers` -> 403 FORBIDDEN). We therefore treat bulk
 * `amount` as base units, identical to the (verified) withdrawal contract,
 * because the integration-analyst contract has each bulk item resolve to its
 * own `withdrawal_id` — i.e. a bulk item IS a withdrawal.
 */
export const BASE_UNIT_AMOUNT_PATTERN = /^[1-9]\d{0,17}$/;

/**
 * $10 USD floor for a single withdrawal / bulk item, expressed in 6-decimal
 * stablecoin base units (10 * 1e6). Enforced client-side so a below-minimum
 * request never reaches Bitnob.
 */
export const WITHDRAWAL_MIN_BASE_UNITS = 10_000_000n;

/**
 * Absolute per-withdrawal / per-bulk-item ceiling — 1,000,000 USDT
 * (1e6 * 1e6 base units). Defence-in-depth: a fat-fingered amount can't move
 * more than this in one call, independent of the wallet balance.
 */
export const WITHDRAWAL_MAX_BASE_UNITS = 1_000_000_000_000n;

/**
 * Ceiling for a bulk batch total (sum of all item amounts), re-checked at
 * confirm time. 10,000,000 USDT.
 */
export const BULK_BATCH_MAX_TOTAL_BASE_UNITS = 10_000_000_000_000n;

/** Bulk batch item-count bounds. */
export const BULK_MIN_ITEMS = 1;
export const BULK_MAX_ITEMS = 50;

/**
 * Single source of truth for the free-text `description` length cap on the
 * Increment 4 DTOs. Deliberately a separate constant from the payout flow's
 * `PAYMENT_REASON_MAX_LENGTH` (140) — `description` here is off-chain internal
 * metadata (see below), not a corridor `payment_reason`, and 200 chars is a
 * comfortable label length. All three Inc-4 DTOs
 * (`CreateWithdrawalDto`, `CreateBulkTransferDto`, `BulkTransferItemDto`)
 * reference these.
 */
export const WITHDRAWAL_DESCRIPTION_MAX_LENGTH = 200;
export const BULK_DESCRIPTION_MAX_LENGTH = 200;

/**
 * Conservative address sanity check — rejects obvious garbage / injection
 * before a money call, without trying to be a per-chain validator (that is
 * `POST /api/addresses/validate`'s job, exposed as
 * `POST /api/bitnob/withdrawals/validate-address`). EVM `0x…40hex`, tron
 * `T…`, solana base58, stellar `G…56`, and bech32/base58 bitcoin all fit
 * `[A-Za-z0-9]{16,120}`.
 */
export const BITNOB_ADDRESS_PATTERN = /^[A-Za-z0-9]{16,120}$/;

/**
 * Validation vocabularies shared by the Bitnob payout DTOs. Kept small and
 * corridor-scoped to what DioteKo actually supports today (NG/KE/GH). The
 * raw admin path uses looser format matchers instead (see
 * `CreatePayoutQuoteDto`), on the basis that Bitnob is the source of truth
 * there and the endpoint is `admin`-only.
 */
export const PAYOUT_SUPPORTED_COUNTRIES = ['NG', 'KE', 'GH'] as const;

export const PAYOUT_SETTLEMENT_CURRENCIES = ['NGN', 'KES', 'GHS', 'USD'] as const;

export const PAYOUT_FROM_ASSETS = ['BTC', 'USDT'] as const;

/** Default crypto leg for a certificate payout — a stablecoin, to keep the
 * quoted rate predictable between quote and finalize. */
export const PAYOUT_DEFAULT_FROM_ASSET = 'USDT';

/** Free-text `payment_reason` guard: single line, bounded length. */
export const PAYMENT_REASON_MAX_LENGTH = 140;
export const PAYMENT_REASON_SINGLE_LINE = /^[^\n\r]*$/;

/** Bitnob `settlement_amount` in display units: up to 12 integer digits, up
 * to 2 decimals. */
export const SETTLEMENT_AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

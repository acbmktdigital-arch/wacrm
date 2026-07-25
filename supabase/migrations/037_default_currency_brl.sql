-- ============================================================
-- 037_default_currency_brl
--
-- Change the per-account default currency from USD to BRL.
--
-- Migration 021 introduced `accounts.default_currency` with a
-- DEFAULT of 'USD', which suits the upstream template but not this
-- fork: this deployment serves Brazilian customers, so every new
-- account should start in Reais rather than forcing an operator to
-- change it by hand after signup.
--
-- Only the column DEFAULT changes. Existing rows keep whatever
-- currency they already have — accounts that deliberately set a
-- different currency are not rewritten.
--
-- The ISO-4217 format CHECK from 021 still applies; 'BRL' satisfies
-- it. RLS is unchanged.
-- ============================================================

ALTER TABLE accounts
  ALTER COLUMN default_currency SET DEFAULT 'BRL';

-- ============================================================
-- 040_contact_address.sql
--
-- Promote "address" to a first-class contact field. The CRM's native
-- contact was name / phone / email / company; address lived only as a
-- per-account custom field. For businesses that serve individuals
-- (B2C), address is core, so it becomes a standard column available to
-- every account.
--
-- Data note: migrating existing custom-field "Endereço" values into
-- this column (and removing the redundant custom field) is done
-- per-account by a separate one-off script — this migration only adds
-- the column so it's safe for every fork/account.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS address TEXT;

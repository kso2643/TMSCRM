-- ════════════════════════════════════════════════════════════════════════
-- Migration: Quotation company/brand (APJ / TMS)
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE.
-- This file only ADDS a column — it never drops or rewrites anything, so
-- your existing Quotations are untouched. Every existing row is backfilled
-- to 'TMS' (the only brand that existed before this migration), which
-- matches how they were already being numbered/printed. This is NOT the
-- same as schema.sql (which DROPs and recreates every table) — do not run
-- schema.sql again on a live DB.
--
-- Run once:
--   mysql -u <user> -p <database> < database/migration_quotation_company.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── 1. Brand flag on the existing Quotation table ─────────────────────────
ALTER TABLE `Quotation`
  ADD COLUMN `company` VARCHAR(10) NOT NULL DEFAULT 'TMS' AFTER `id`;

ALTER TABLE `Quotation`
  ADD KEY `Quotation_company_idx` (`company`);

-- ── 2. Backfill existing rows explicitly (defensive; DEFAULT already
--       covers this for the ALTER itself, but this makes the intent explicit
--       and is a no-op if everything is already 'TMS') ────────────────────
UPDATE `Quotation` SET `company` = 'TMS' WHERE `company` IS NULL OR `company` = '';

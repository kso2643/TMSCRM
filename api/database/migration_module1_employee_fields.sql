-- ════════════════════════════════════════════════════════════════════════
-- Migration: Module 1 — Employee Management Enhancement
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE.
-- Only ADDS columns/tables — never drops or rewrites anything. Run this
-- AFTER migration_payroll_hr.sql (it extends the same `User` table).
--
-- Run once:
--   mysql -u <user> -p <database> < database/migration_module1_employee_fields.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── 1. Remaining Basic Information field ──────────────────────────────────
-- (name, mobile/phone, email, DOB, DOJ, gender, blood group, marital status
--  already exist on `User` — see schema.sql / migration_payroll_hr.sql.
--  Father's Name is the one field from Module 1's "Basic Information" list
--  that isn't there yet.)
ALTER TABLE `User`
  ADD COLUMN `fatherName` VARCHAR(150) NULL AFTER `employmentType`;

-- ── 2. Address Information — Permanent + Present, each with its own
--       Address / City / District / State / Pincode ──────────────────────
-- (`currentAddress` already exists as a single free-text field from the
--  earlier payroll migration and is left untouched — these are new,
--  separate columns matching the spec's structured Permanent/Present split.)
ALTER TABLE `User`
  ADD COLUMN `permanentAddress`  TEXT        NULL AFTER `fatherName`,
  ADD COLUMN `permanentCity`     VARCHAR(100) NULL AFTER `permanentAddress`,
  ADD COLUMN `permanentDistrict` VARCHAR(100) NULL AFTER `permanentCity`,
  ADD COLUMN `permanentState`    VARCHAR(100) NULL AFTER `permanentDistrict`,
  ADD COLUMN `permanentPincode`  VARCHAR(12)  NULL AFTER `permanentState`,

  ADD COLUMN `presentAddress`    TEXT         NULL AFTER `permanentPincode`,
  ADD COLUMN `presentCity`       VARCHAR(100) NULL AFTER `presentAddress`,
  ADD COLUMN `presentDistrict`   VARCHAR(100) NULL AFTER `presentCity`,
  ADD COLUMN `presentState`      VARCHAR(100) NULL AFTER `presentDistrict`,
  ADD COLUMN `presentPincode`    VARCHAR(12)  NULL AFTER `presentState`,

  -- Remembers the "Present Address Same as Permanent Address" checkbox
  -- state, so re-opening the edit form shows it checked correctly instead
  -- of having to compare every field to guess.
  ADD COLUMN `presentAddressSameAsPermanent` TINYINT(1) NOT NULL DEFAULT 0 AFTER `presentPincode`;

-- ── 3. Remaining Bank Details fields ───────────────────────────────────────
-- (Bank Name, Account Holder Name, Account Number, IFSC already exist —
--  Branch Name and UPI ID are the two missing from the spec's list.)
ALTER TABLE `User`
  ADD COLUMN `bankBranchName` VARCHAR(150) NULL AFTER `bankName`,
  ADD COLUMN `upiId`          VARCHAR(100) NULL AFTER `bankBranchName`;

-- ── 4. Employee document uploads (Address Proof, Bank Passbook, Aadhaar,
--       PAN, Photo) ─────────────────────────────────────────────────────
-- One row per (employee, document type) — uploading again for the same
-- type replaces the existing row (see EmployeeDocumentController::upload).
-- Files themselves are stored OUTSIDE the web-servable directory (see the
-- controller) — this table only holds metadata + the on-disk filename.
CREATE TABLE IF NOT EXISTS `EmployeeDocument` (
  `id`               VARCHAR(30)  NOT NULL,
  `userId`           VARCHAR(30)  NOT NULL,
  `documentType`     VARCHAR(30)  NOT NULL, -- ADDRESS_PROOF | BANK_PASSBOOK | AADHAAR_CARD | PAN_CARD | PHOTO
  `originalFilename` VARCHAR(255) NOT NULL,
  `storedFilename`   VARCHAR(255) NOT NULL, -- random on-disk name, never derived from user input
  `mimeType`         VARCHAR(100) NOT NULL,
  `fileSize`         INT          NOT NULL, -- bytes
  `uploadedById`     VARCHAR(30)  NOT NULL,
  `createdAt`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `EmployeeDocument_userId_documentType_key` (`userId`, `documentType`),
  KEY `EmployeeDocument_uploadedById_idx` (`uploadedById`),
  CONSTRAINT `EmployeeDocument_userId_fkey`
    FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `EmployeeDocument_uploadedById_fkey`
    FOREIGN KEY (`uploadedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

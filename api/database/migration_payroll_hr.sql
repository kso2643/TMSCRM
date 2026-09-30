-- ════════════════════════════════════════════════════════════════════════
-- Migration: Payroll & HR module
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE.
-- This file only ADDS columns/tables — it never drops or rewrites
-- anything, so your existing Users, Customers, Quotations, etc. are
-- untouched. This is NOT the same as schema.sql (which DROPs and
-- recreates every table) — do not run schema.sql again on a live DB.
--
-- Run once:
--   mysql -u <user> -p <database> < database/migration_payroll_hr.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── 1. HR master-data fields on the existing User table ──────────────────
ALTER TABLE `User`
  ADD COLUMN `employeeCode`          VARCHAR(50)  NULL AFTER `sessionTimeout`,
  ADD COLUMN `designation`           VARCHAR(150) NULL AFTER `employeeCode`,
  ADD COLUMN `dateOfBirth`           DATE         NULL AFTER `designation`,
  ADD COLUMN `dateOfJoining`         DATE         NULL AFTER `dateOfBirth`,
  ADD COLUMN `dateOfLeaving`         DATE         NULL AFTER `dateOfJoining`,
  ADD COLUMN `gender`                VARCHAR(20)  NULL AFTER `dateOfLeaving`,
  ADD COLUMN `maritalStatus`         VARCHAR(20)  NULL AFTER `gender`,
  ADD COLUMN `bloodGroup`            VARCHAR(10)  NULL AFTER `maritalStatus`,
  ADD COLUMN `personalEmail`         VARCHAR(255) NULL AFTER `bloodGroup`,
  ADD COLUMN `currentAddress`        TEXT         NULL AFTER `personalEmail`,
  ADD COLUMN `emergencyContactName`  VARCHAR(150) NULL AFTER `currentAddress`,
  ADD COLUMN `emergencyContactPhone` VARCHAR(30)  NULL AFTER `emergencyContactName`,
  ADD COLUMN `panNumber`             VARCHAR(20)  NULL AFTER `emergencyContactPhone`,
  ADD COLUMN `aadharNumber`          VARCHAR(20)  NULL AFTER `panNumber`,
  ADD COLUMN `bankAccountName`       VARCHAR(150) NULL AFTER `aadharNumber`,
  ADD COLUMN `bankAccountNumber`     VARCHAR(40)  NULL AFTER `bankAccountName`,
  ADD COLUMN `bankIFSC`              VARCHAR(20)  NULL AFTER `bankAccountNumber`,
  ADD COLUMN `bankName`              VARCHAR(150) NULL AFTER `bankIFSC`,
  ADD COLUMN `uanNumber`             VARCHAR(30)  NULL AFTER `bankName`,
  ADD COLUMN `pfNumber`              VARCHAR(40)  NULL AFTER `uanNumber`,
  ADD COLUMN `esiNumber`             VARCHAR(40)  NULL AFTER `pfNumber`,
  ADD COLUMN `employmentType`        VARCHAR(30)  NOT NULL DEFAULT 'FULL_TIME' AFTER `esiNumber`;

ALTER TABLE `User`
  ADD UNIQUE KEY `User_employeeCode_key` (`employeeCode`);

-- ── 2. New Payroll table (one row per employee per pay period) ───────────
CREATE TABLE IF NOT EXISTS `Payroll` (
  `id`                  VARCHAR(30)   NOT NULL,
  `userId`              VARCHAR(30)   NOT NULL,
  `month`               INT           NOT NULL,
  `year`                INT           NOT NULL,
  `basicSalary`         DECIMAL(14,2) NOT NULL DEFAULT 0,
  `hra`                 DECIMAL(14,2) NOT NULL DEFAULT 0,
  `conveyanceAllowance` DECIMAL(14,2) NOT NULL DEFAULT 0,
  `medicalAllowance`    DECIMAL(14,2) NOT NULL DEFAULT 0,
  `specialAllowance`    DECIMAL(14,2) NOT NULL DEFAULT 0,
  `otherAllowance`      DECIMAL(14,2) NOT NULL DEFAULT 0,
  `grossSalary`         DECIMAL(14,2) NOT NULL DEFAULT 0,
  `pfDeduction`         DECIMAL(14,2) NOT NULL DEFAULT 0,
  `esiDeduction`        DECIMAL(14,2) NOT NULL DEFAULT 0,
  `professionalTax`     DECIMAL(14,2) NOT NULL DEFAULT 0,
  `tds`                 DECIMAL(14,2) NOT NULL DEFAULT 0,
  `otherDeductions`     DECIMAL(14,2) NOT NULL DEFAULT 0,
  `totalDeductions`     DECIMAL(14,2) NOT NULL DEFAULT 0,
  `netSalary`           DECIMAL(14,2) NOT NULL DEFAULT 0,
  `workingDays`         INT               NULL,
  `presentDays`         DECIMAL(6,2)      NULL,
  `lopDays`             DECIMAL(6,2)  NOT NULL DEFAULT 0,
  `status`              VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
  `paidOn`              DATETIME          NULL,
  `remarks`             TEXT              NULL,
  `generatedById`       VARCHAR(30)       NULL,
  `createdAt`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Payroll_userId_month_year_key` (`userId`,`month`,`year`),
  KEY `Payroll_userId_idx` (`userId`),
  KEY `Payroll_year_month_idx` (`year`,`month`),
  CONSTRAINT `Payroll_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

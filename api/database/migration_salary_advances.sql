-- ════════════════════════════════════════════════════════════════════════
-- Migration: Salary Advances + Recovery (extends the Payroll & HR module)
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE.
-- This file only ADDS two new tables — it never touches User, Payroll,
-- or anything else. Run AFTER migration_payroll_hr.sql (needs the
-- `User` table to exist for the foreign key).
--
-- Run once:
--   mysql -u <user> -p <database> < database/migration_salary_advances.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── 1. One row per salary advance given to an employee ───────────────────
CREATE TABLE IF NOT EXISTS `SalaryAdvance` (
  `id`                    VARCHAR(30)   NOT NULL,
  `userId`                VARCHAR(30)   NOT NULL,
  `advanceDate`           DATE          NOT NULL,
  `advanceAmount`         DECIMAL(14,2) NOT NULL,
  `reason`                TEXT              NULL,
  -- MONTHLY_FIXED: recovered automatically at `monthlyRecoveryAmount`/month.
  -- MANUAL: admin decides the amount to recover each month on the Recovery screen.
  `recoveryType`          VARCHAR(20)   NOT NULL DEFAULT 'MONTHLY_FIXED',
  `monthlyRecoveryAmount` DECIMAL(14,2)     NULL,
  `recoveryStartMonth`    INT           NOT NULL,
  `recoveryStartYear`     INT           NOT NULL,
  -- Kept in sync on every recovery insert/update: advanceAmount - SUM(paid recoveries).
  `remainingAmount`       DECIMAL(14,2) NOT NULL DEFAULT 0,
  `status`                VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | COMPLETED | CANCELLED
  `cancelledAt`           DATETIME          NULL,
  `createdById`           VARCHAR(30)       NULL,
  `createdAt`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `SalaryAdvance_userId_idx` (`userId`),
  KEY `SalaryAdvance_status_idx` (`status`),
  CONSTRAINT `SalaryAdvance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SalaryAdvance_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. One row per advance per month a recovery was recorded ─────────────
CREATE TABLE IF NOT EXISTS `SalaryAdvanceRecovery` (
  `id`               VARCHAR(30)   NOT NULL,
  `advanceId`        VARCHAR(30)   NOT NULL,
  `month`            INT           NOT NULL,
  `year`             INT           NOT NULL,
  `amountRecovered`  DECIMAL(14,2) NOT NULL DEFAULT 0,
  `status`           VARCHAR(20)   NOT NULL DEFAULT 'PAID', -- PAID | UNPAID
  `recoveryMode`     VARCHAR(20)   NOT NULL DEFAULT 'AUTOMATIC', -- AUTOMATIC | MANUAL (mirrors the parent advance's recoveryType)
  `remarks`          TEXT              NULL, -- required by the UI when status=UNPAID
  `recordedById`     VARCHAR(30)       NULL,
  `createdAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `SalaryAdvanceRecovery_advance_month_year_key` (`advanceId`,`month`,`year`),
  KEY `SalaryAdvanceRecovery_advanceId_idx` (`advanceId`),
  KEY `SalaryAdvanceRecovery_year_month_idx` (`year`,`month`),
  CONSTRAINT `SalaryAdvanceRecovery_advanceId_fkey` FOREIGN KEY (`advanceId`) REFERENCES `SalaryAdvance` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `SalaryAdvanceRecovery_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

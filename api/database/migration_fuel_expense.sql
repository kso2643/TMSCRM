-- ════════════════════════════════════════════════════════════════════════
-- Migration: Fuel Expense (meter-reading log tied to Attendance punch in/out)
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE.
-- This file only ADDS columns/tables — it never drops or rewrites
-- anything, so your existing Users, Attendance, etc. are untouched.
-- This is NOT the same as schema.sql (which DROPs and recreates every
-- table) — do not run schema.sql again on a live DB.
--
-- Run once:
--   mysql -u <user> -p <database> < database/migration_fuel_expense.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── 1. Vehicle profile fields on the existing User table ─────────────────
-- One vehicle per employee, so this lives directly on User (same pattern
-- as the HR fields added in migration_payroll_hr.sql) rather than a
-- separate one-row-per-user table.
-- No AFTER-column placement here on purpose — this migration shouldn't
-- depend on exactly which of the other migration_*.sql files have already
-- been applied to your live DB. Columns just land at the end of the table.
ALTER TABLE `User`
  ADD COLUMN `vehicleType`      VARCHAR(50)  NULL,
  ADD COLUMN `vehicleDetails`   VARCHAR(150) NULL,
  ADD COLUMN `vehicleMileage`   DECIMAL(6,2) NULL,
  ADD COLUMN `vehicleFuelPrice` DECIMAL(8,2) NULL;

-- ── 2. FuelExpense — one row per Attendance day ───────────────────────────
-- Opened by the "starting meter reading" prompt right after punch in,
-- closed by the "closing meter reading" prompt right after punch out.
-- mileageUsed/fuelPriceUsed are a snapshot of the employee's vehicle
-- profile at the time the day was opened, so a later profile edit never
-- retroactively changes an already-computed day's fuel cost.
CREATE TABLE IF NOT EXISTS `FuelExpense` (
  `id`               VARCHAR(30)   NOT NULL,
  `attendanceId`     VARCHAR(30)   NOT NULL,
  `userId`           VARCHAR(30)   NOT NULL,
  `date`             DATETIME      NOT NULL,
  `vehicleType`      VARCHAR(50)       NULL,
  `vehicleDetails`   VARCHAR(150)      NULL,
  `mileageUsed`      DECIMAL(6,2)      NULL,
  `fuelPriceUsed`    DECIMAL(8,2)      NULL,
  `openingMeter`     DECIMAL(10,1)     NULL,
  `closingMeter`     DECIMAL(10,1)     NULL,
  `personalKm`       DECIMAL(8,1)  NOT NULL DEFAULT 0,
  `officialKm`       DECIMAL(8,1)      NULL,
  `fuelCost`         DECIMAL(10,2)     NULL,
  `customersVisited` TEXT              NULL,
  `miscDesc`         VARCHAR(255)      NULL,
  `miscAmount`       DECIMAL(10,2) NOT NULL DEFAULT 0,
  `totalAmount`      DECIMAL(10,2)     NULL,
  `status`           VARCHAR(20)   NOT NULL DEFAULT 'OPEN',
  `createdAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `FuelExpense_attendanceId_key` (`attendanceId`),
  KEY `FuelExpense_userId_date_idx` (`userId`,`date`),
  CONSTRAINT `FuelExpense_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `Attendance` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `FuelExpense_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

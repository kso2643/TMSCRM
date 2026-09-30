-- ════════════════════════════════════════════════════════════════════════
-- Migration: Modules 2 (gap fix), 3–6 (Salary Advance system), 10 (Notifications)
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE. Only ADDS columns/tables.
-- Run AFTER migration_payroll_hr.sql and migration_module1_employee_fields.sql.
--
--   mysql -u <user> -p <database> < migration_module2to10_advance_system.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── Module 2 gap — spec lists Basic/HRA/DA/Special/Conveyance/Medical/Other
--    as the 7 allowances; `Payroll` had everything except DA. Spec's
--    Deductions list also names "Loan Recovery" and "Advance Recovery" as
--    their own line items (distinct from "Other Deductions") — those were
--    missing too. Advance Recovery is auto-filled by the trigger described
--    in Module 4 (see PayrollController::create()); Loan Recovery is a
--    plain manual figure, same as the other deduction fields. ───────────
ALTER TABLE `Payroll`
  ADD COLUMN `daAllowance`              DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `hra`,
  ADD COLUMN `loanRecoveryDeduction`    DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `tds`,
  ADD COLUMN `advanceRecoveryDeduction` DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER `loanRecoveryDeduction`;

-- ── Modules 3 & 6 — the advance itself. One row per advance given to an
--    employee. `recoveredAmount` is a cached running total kept in sync by
--    AdvanceRecovery rows (see apply_advance_recovery() in
--    includes/AdvanceRecoveryCalc.php) — remaining balance, months
--    remaining, and expected closing date are all derived from this at
--    read time rather than stored, so they can never drift out of sync. ──
CREATE TABLE IF NOT EXISTS `SalaryAdvance` (
  `id`                  VARCHAR(30)   NOT NULL,
  `userId`              VARCHAR(30)   NOT NULL,
  `advanceDate`         DATE          NOT NULL,
  `advanceAmount`       DECIMAL(14,2) NOT NULL,
  `reason`              TEXT              NULL,
  `approvedById`        VARCHAR(30)       NULL,
  -- Spec names only "Recovery Start Month" — a month number alone is
  -- ambiguous across years, so a year field is added alongside it.
  `recoveryStartMonth`  INT           NOT NULL,
  `recoveryStartYear`   INT           NOT NULL,
  `recoveryType`        VARCHAR(20)   NOT NULL DEFAULT 'MONTHLY_FIXED', -- MONTHLY_FIXED | MANUAL
  `monthlyRecoveryAmount` DECIMAL(14,2)   NULL, -- required when recoveryType = MONTHLY_FIXED
  `status`              VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE',        -- ACTIVE | COMPLETED | CANCELLED
  `recoveredAmount`     DECIMAL(14,2) NOT NULL DEFAULT 0,               -- cached; see note above
  `createdById`         VARCHAR(30)   NOT NULL,
  `createdAt`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `SalaryAdvance_userId_idx` (`userId`),
  KEY `SalaryAdvance_status_idx` (`status`),
  CONSTRAINT `SalaryAdvance_userId_fkey`       FOREIGN KEY (`userId`)       REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `SalaryAdvance_approvedById_fkey` FOREIGN KEY (`approvedById`) REFERENCES `User` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `SalaryAdvance_createdById_fkey`  FOREIGN KEY (`createdById`)  REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Modules 4, 5 & 6 — one row per (advance, month, year): the per-month
--    recovery ledger. Created automatically when payroll is processed for
--    that employee (mode=AUTO), or entered by hand (mode=MANUAL) from the
--    Advance Recovery screen. `status`=UNPAID + `remarks` is Module 6's
--    "recovery skipped" handling. ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS `AdvanceRecovery` (
  `id`               VARCHAR(30)   NOT NULL,
  `advanceId`        VARCHAR(30)   NOT NULL,
  `userId`           VARCHAR(30)   NOT NULL, -- denormalized for filtering without a join, same pattern as ActivityLog
  `month`            INT           NOT NULL,
  `year`             INT           NOT NULL,
  `amountRecovered`  DECIMAL(14,2) NOT NULL DEFAULT 0,
  `recoveryMode`     VARCHAR(10)   NOT NULL DEFAULT 'AUTO', -- AUTO | MANUAL
  `status`           VARCHAR(10)   NOT NULL DEFAULT 'PAID', -- PAID | UNPAID
  `remarks`          TEXT              NULL, -- mandatory when status=UNPAID (enforced in controller)
  `payrollId`        VARCHAR(30)       NULL, -- the Payroll row that triggered this, when mode=AUTO
  `recordedById`     VARCHAR(30)   NOT NULL,
  `createdAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `AdvanceRecovery_advance_month_year_key` (`advanceId`,`month`,`year`),
  KEY `AdvanceRecovery_userId_idx` (`userId`),
  KEY `AdvanceRecovery_month_year_idx` (`year`,`month`),
  CONSTRAINT `AdvanceRecovery_advanceId_fkey` FOREIGN KEY (`advanceId`) REFERENCES `SalaryAdvance` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `AdvanceRecovery_userId_fkey`    FOREIGN KEY (`userId`)    REFERENCES `User` (`id`)          ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AdvanceRecovery_payrollId_fkey` FOREIGN KEY (`payrollId`) REFERENCES `Payroll` (`id`)       ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `AdvanceRecovery_recordedById_fkey` FOREIGN KEY (`recordedById`) REFERENCES `User` (`id`)    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Module 10 — computed reminders (salary processing due, recovery
--    pending, advance completed/overdue, birthday, probation completion).
--    Rows are generated on read (see NotificationController::index()) —
--    there's no cron in this codebase, so "due" conditions are recomputed
--    each time the endpoint is called, with a dedup check so the same
--    condition doesn't create duplicate rows. This table only covers the
--    in-app / dashboard notification bell — see NotificationController.php's
--    header comment for why email/browser-push delivery isn't included. ──
CREATE TABLE IF NOT EXISTS `Notification` (
  `id`           VARCHAR(30)  NOT NULL,
  `userId`       VARCHAR(30)  NOT NULL, -- recipient (typically an admin/HR user)
  `type`         VARCHAR(40)  NOT NULL, -- SALARY_PROCESSING_DUE | RECOVERY_PENDING | ADVANCE_COMPLETED | ADVANCE_OVERDUE | EMPLOYEE_BIRTHDAY | PROBATION_COMPLETION
  `title`        VARCHAR(200) NOT NULL,
  `message`      VARCHAR(500) NOT NULL,
  `relatedType`  VARCHAR(30)      NULL, -- 'User' | 'SalaryAdvance' | 'Payroll' — what relatedId points to
  `relatedId`    VARCHAR(30)      NULL,
  `dedupeKey`    VARCHAR(150) NOT NULL, -- e.g. "RECOVERY_PENDING:advId:2026:7" — prevents re-creating the same reminder
  `isRead`       TINYINT(1)   NOT NULL DEFAULT 0,
  `createdAt`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Notification_dedupeKey_key` (`dedupeKey`),
  KEY `Notification_userId_isRead_idx` (`userId`,`isRead`),
  CONSTRAINT `Notification_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

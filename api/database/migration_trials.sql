-- ════════════════════════════════════════════════════════════════════════
-- Migration: Tool trials (request with existing data → approval with
-- recommendation → cost savings report)
--
-- You normally do NOT need to run this: the API creates the table on first
-- use (includes/SchemaGuard.php), matching your database collation.
-- Run it by hand only if the API user lacks CREATE permission. If your
-- tables use utf8mb4_general_ci, replace utf8mb4_unicode_ci below first.
--   mysql -u <user> -p <database> < database/migration_trials.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `Trial` (
  `id`               VARCHAR(30)   NOT NULL,
  `trialNo`          VARCHAR(30)   NOT NULL,
  `customerId`       VARCHAR(30)       NULL,
  `customerName`     VARCHAR(255)      NULL,
  `component`        VARCHAR(255)      NULL,
  `requestedById`    VARCHAR(30)   NOT NULL,
  `status`           VARCHAR(20)   NOT NULL DEFAULT 'PENDING_APPROVAL',
  `existingData`     LONGTEXT          NULL,
  `recommendations`  TEXT              NULL,
  `approvalNote`     TEXT              NULL,
  `decidedById`      VARCHAR(30)       NULL,
  `decidedAt`        DATETIME          NULL,
  `savingsData`      LONGTEXT          NULL,
  `savingsPerYear`   DECIMAL(16,2)     NULL,
  `savingsPct`       DECIMAL(7,2)      NULL,
  `bestTool`         VARCHAR(255)      NULL,
  `completedAt`      DATETIME          NULL,
  `createdAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Trial_trialNo_key` (`trialNo`),
  KEY `Trial_requestedById_idx` (`requestedById`),
  KEY `Trial_status_idx` (`status`),
  CONSTRAINT `Trial_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

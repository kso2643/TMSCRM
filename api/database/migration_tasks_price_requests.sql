-- ════════════════════════════════════════════════════════════════════════
-- Migration: Tasks (admin-assigned queue with timer) + Price requests
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE, and safe to run more than
-- once. Additive only — it never drops or rewrites anything.
--
-- You normally don't need to run this by hand: the API creates any
-- missing table/column on first use (includes/SchemaGuard.php). Run it
-- manually only if the API's DB user lacks CREATE/ALTER permission:
--   mysql -u <user> -p <database> < database/migration_tasks_price_requests.sql
--
-- (ADD COLUMN IF NOT EXISTS needs MariaDB 10.0.2+, which Hostinger uses.)
--
-- COLLATION: these tables must use the same collation as your existing
-- `User`/`Customer` tables. If yours are utf8mb4_general_ci, replace
-- utf8mb4_unicode_ci below before running (the API does this automatically).
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── AdminTask ──
CREATE TABLE IF NOT EXISTS `AdminTask` (
  `id`             VARCHAR(30)   NOT NULL,
  `title`          VARCHAR(255)  NOT NULL,
  `description`    TEXT              NULL,
  `assignedToId`   VARCHAR(30)   NOT NULL,
  `assignedById`   VARCHAR(30)   NOT NULL,
  `customerId`     VARCHAR(30)       NULL,
  `priority`       VARCHAR(10)   NOT NULL DEFAULT 'NORMAL',
  `status`         VARCHAR(20)   NOT NULL DEFAULT 'QUEUED',
  `queuePosition`  INT           NOT NULL DEFAULT 0,
  `dueDate`        DATE              NULL,
  `startedAt`      DATETIME          NULL,
  `lastResumedAt`  DATETIME          NULL,
  `workedSeconds`  INT           NOT NULL DEFAULT 0,
  `completedAt`    DATETIME          NULL,
  `completionNote` TEXT              NULL,
  `createdAt`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `AdminTask_assignedToId_status_idx` (`assignedToId`, `status`),
  KEY `AdminTask_queuePosition_idx` (`queuePosition`),
  CONSTRAINT `AdminTask_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AdminTask_assignedById_fkey` FOREIGN KEY (`assignedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── PriceRequest ──
CREATE TABLE IF NOT EXISTS `PriceRequest` (
  `id`             VARCHAR(30)   NOT NULL,
  `requestedById`  VARCHAR(30)   NOT NULL,
  `customerId`     VARCHAR(30)       NULL,
  `productId`      VARCHAR(30)       NULL,
  `itemCode`       VARCHAR(100)      NULL,
  `productName`    VARCHAR(255)  NOT NULL,
  `quantity`       DECIMAL(14,2)     NULL,
  `listPrice`      DECIMAL(14,2)     NULL,
  `requestedPrice` DECIMAL(14,2)     NULL,
  `notes`          TEXT              NULL,
  `status`         VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  `approvedPrice`  DECIMAL(14,2)     NULL,
  `responseNote`   TEXT              NULL,
  `respondedById`  VARCHAR(30)       NULL,
  `respondedAt`    DATETIME          NULL,
  `createdAt`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `PriceRequest_requestedById_idx` (`requestedById`),
  KEY `PriceRequest_status_idx` (`status`),
  CONSTRAINT `PriceRequest_requestedById_fkey` FOREIGN KEY (`requestedById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


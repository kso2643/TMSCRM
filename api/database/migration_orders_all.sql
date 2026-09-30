-- ════════════════════════════════════════════════════════════════════════
-- Migration: Orders — everything in one file (tables + procurement + proforma + per-item supply)
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE, and safe to run more than
-- once. Additive only — it never drops or rewrites anything.
-- Replaces running migration_orders.sql + migration_orders_procurement.sql
-- separately; fine to run even if those already ran.
--
-- You normally don't need to run this by hand: the API creates any
-- missing table/column on first use (includes/SchemaGuard.php). Run it
-- manually only if the API's DB user lacks CREATE/ALTER permission:
--   mysql -u <user> -p <database> < database/migration_orders_all.sql
--
-- (ADD COLUMN IF NOT EXISTS needs MariaDB 10.0.2+, which Hostinger uses.)
--
-- COLLATION: these tables must use the same collation as your existing
-- `User`/`Customer` tables. If yours are utf8mb4_general_ci, replace
-- utf8mb4_unicode_ci below before running (the API does this automatically).
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── CustomerOrder ──
CREATE TABLE IF NOT EXISTS `CustomerOrder` (
  `id`                     VARCHAR(30)   NOT NULL,
  `customerId`             VARCHAR(30)   NOT NULL,
  `engineerId`             VARCHAR(30)   NOT NULL,
  `orderType`              VARCHAR(10)   NOT NULL DEFAULT 'VERBAL',
  `poDocumentOriginalName` VARCHAR(255)      NULL,
  `poDocumentStoredName`   VARCHAR(255)      NULL,
  `poDocumentMime`         VARCHAR(100)      NULL,
  `poDocumentSize`         INT               NULL,
  `verbalDetails`          TEXT              NULL,
  `orderDate`              DATE          NOT NULL,
  `deliveryStatus`         VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  `notDeliveredReason`     TEXT              NULL,
  `deliveredDate`          DATE              NULL,
  `notes`                  TEXT              NULL,
  `expectedDeliveryDate`   DATE              NULL,
  `procurementStatus`      VARCHAR(20)   NOT NULL DEFAULT 'NOT_ORDERED',
  `proformaStatus`         VARCHAR(20)   NOT NULL DEFAULT 'NOT_CONFIRMED',
  `createdAt`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`              DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `CustomerOrder_customerId_idx` (`customerId`),
  KEY `CustomerOrder_engineerId_idx` (`engineerId`),
  KEY `CustomerOrder_orderDate_idx` (`orderDate`),
  KEY `CustomerOrder_deliveryStatus_idx` (`deliveryStatus`),
  CONSTRAINT `CustomerOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `CustomerOrder_engineerId_fkey` FOREIGN KEY (`engineerId`) REFERENCES `User` (`id`)     ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `CustomerOrder` ADD COLUMN IF NOT EXISTS `expectedDeliveryDate` DATE NULL;
ALTER TABLE `CustomerOrder` ADD COLUMN IF NOT EXISTS `procurementStatus` VARCHAR(20) NOT NULL DEFAULT 'NOT_ORDERED';
ALTER TABLE `CustomerOrder` ADD COLUMN IF NOT EXISTS `proformaStatus` VARCHAR(20) NOT NULL DEFAULT 'NOT_CONFIRMED';

-- ── CustomerOrderItem ──
CREATE TABLE IF NOT EXISTS `CustomerOrderItem` (
  `id`          VARCHAR(30)   NOT NULL,
  `orderId`     VARCHAR(30)   NOT NULL,
  `productId`   VARCHAR(30)       NULL,
  `itemCode`    VARCHAR(100)  NOT NULL,
  `productName` VARCHAR(255)  NOT NULL,
  `unit`        VARCHAR(20)       NULL,
  `quantity`    DECIMAL(14,2) NOT NULL,
  `supplied`    TINYINT(1)    NOT NULL DEFAULT 0,
  `suppliedAt`  DATETIME          NULL,
  `createdAt`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `CustomerOrderItem_orderId_idx` (`orderId`),
  KEY `CustomerOrderItem_productId_idx` (`productId`),
  CONSTRAINT `CustomerOrderItem_orderId_fkey`   FOREIGN KEY (`orderId`)   REFERENCES `CustomerOrder` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `CustomerOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`)       ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `CustomerOrderItem` ADD COLUMN IF NOT EXISTS `supplied` TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE `CustomerOrderItem` ADD COLUMN IF NOT EXISTS `suppliedAt` DATETIME NULL;


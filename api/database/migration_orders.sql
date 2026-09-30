-- ════════════════════════════════════════════════════════════════════════
-- Migration: Customer Orders (Verbal & Purchase Order tracking)
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE.
-- This file only ADDS tables — it never drops or rewrites anything.
--
-- Run once:
--   mysql -u <user> -p <database> < database/migration_orders.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── CustomerOrder — one row per verbal commitment or purchase order ──────
-- orderType='PO'     → poDocument* columns hold the attached file
-- orderType='VERBAL' → verbalDetails holds what was agreed
-- Both are supported on the same row (not two tables) since an order can
-- start verbal and later get a PO attached without changing identity.
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

-- ── CustomerOrderItem — the product lines on an order ─────────────────────
-- Mirrors QuotationItem's shape: product identity is snapshotted onto the
-- row (itemCode/productName/unit) so the order stays readable even if the
-- Product catalog entry is later renamed or deleted.
CREATE TABLE IF NOT EXISTS `CustomerOrderItem` (
  `id`          VARCHAR(30)   NOT NULL,
  `orderId`     VARCHAR(30)   NOT NULL,
  `productId`   VARCHAR(30)       NULL,
  `itemCode`    VARCHAR(100)  NOT NULL,
  `productName` VARCHAR(255)  NOT NULL,
  `unit`        VARCHAR(20)       NULL,
  `quantity`    DECIMAL(14,2) NOT NULL,
  `createdAt`   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `CustomerOrderItem_orderId_idx` (`orderId`),
  KEY `CustomerOrderItem_productId_idx` (`productId`),
  CONSTRAINT `CustomerOrderItem_orderId_fkey`   FOREIGN KEY (`orderId`)   REFERENCES `CustomerOrder` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `CustomerOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`)       ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

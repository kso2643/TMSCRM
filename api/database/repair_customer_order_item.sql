-- ════════════════════════════════════════════════════════════════════════
-- Repair: rebuild CustomerOrderItem with its correct, complete structure.
--
-- Your live copy of this table is missing the `productName` column (and
-- very likely `itemCode`/`unit` too — they're added by the same original
-- CREATE TABLE statement, most likely truncated when migration_orders.sql
-- was pasted into phpMyAdmin).
--
-- Safe to run: every order-item insert requires `productName`, so no
-- order item could have ever been successfully saved into this table
-- while it was missing that column — there is nothing real to lose here.
-- This does NOT touch CustomerOrder (your actual order headers) at all.
--
-- Run once:
--   mysql -u <user> -p <database> < database/repair_customer_order_item.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

DROP TABLE IF EXISTS `CustomerOrderItem`;

CREATE TABLE `CustomerOrderItem` (
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

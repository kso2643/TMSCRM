-- ════════════════════════════════════════════════════════════════════════
-- Migration: Procurement tracking on Orders (expected arrival + ordered-or-not)
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE. Additive only.
-- Needs migration_orders.sql to have already been run (this adds columns
-- to the CustomerOrder table it creates).
--
-- Run once:
--   mysql -u <user> -p <database> < database/migration_orders_procurement.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- expectedDeliveryDate: set by an admin once they know when a supplier/PO
-- will actually arrive — separate from deliveredDate, which is only set
-- once it truly has arrived.
--
-- procurementStatus: a different step from deliveryStatus. deliveryStatus
-- is about handing the item to the customer; procurementStatus is about
-- whether the company has placed its own order with ITS supplier yet
-- (NOT_ORDERED/ORDERED). Both are admin-set; engineers see them but don't
-- set them.
ALTER TABLE `CustomerOrder`
  ADD COLUMN `expectedDeliveryDate` DATE NULL,
  ADD COLUMN `procurementStatus` VARCHAR(20) NOT NULL DEFAULT 'NOT_ORDERED';

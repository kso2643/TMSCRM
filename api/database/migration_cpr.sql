-- Migration: CPR opportunity register + Saturday weekly review.
-- You normally do NOT need to run this: the API creates these tables on first use
-- (includes/SchemaGuard.php), matching your database collation.
--   mysql -u <user> -p <database> < database/migration_cpr.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `CprOpportunity` (
  `id` VARCHAR(30) NOT NULL, `slNo` INT NOT NULL AUTO_INCREMENT,
  `region` VARCHAR(120) NULL, `seId` VARCHAR(30) NULL, `seName` VARCHAR(120) NULL,
  `channel` VARCHAR(20) NULL, `distributor` VARCHAR(150) NULL,
  `customerId` VARCHAR(30) NULL, `customerName` VARCHAR(255) NOT NULL,
  `materialGroup` VARCHAR(80) NULL, `materialSubGroup` VARCHAR(150) NULL, `capturedDate` DATE NULL,
  `component` VARCHAR(200) NULL, `opportunity` TEXT NULL, `edp` VARCHAR(100) NULL,
  `productGroup` VARCHAR(80) NULL, `focusGroup` VARCHAR(80) NULL, `cpr` VARCHAR(1) NULL,
  `annualPotential` DECIMAL(14,4) NULL, `objective` TEXT NULL, `competition` VARCHAR(200) NULL,
  `personResponsible` VARCHAR(120) NULL, `timeline` DATE NULL,
  `expectedSale` DECIMAL(14,4) NULL, `orderValue` DECIMAL(14,4) NULL,
  `status` VARCHAR(40) NOT NULL DEFAULT 'Trial planned', `rag` VARCHAR(10) NULL,
  `latestRemark` TEXT NULL, `lastReviewDate` DATE NULL, `importKey` VARCHAR(64) NULL,
  `isActive` TINYINT(1) NOT NULL DEFAULT 1,
  `createdById` VARCHAR(30) NULL, `updatedById` VARCHAR(30) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `CprOpportunity_slNo_key` (`slNo`), UNIQUE KEY `CprOpportunity_importKey_key` (`importKey`),
  KEY `CprOpportunity_seId_idx` (`seId`), KEY `CprOpportunity_status_idx` (`status`), KEY `CprOpportunity_customerId_idx` (`customerId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `CprReview` (
  `id` VARCHAR(30) NOT NULL, `opportunityId` VARCHAR(30) NOT NULL, `reviewDate` DATE NOT NULL,
  `remark` TEXT NULL, `status` VARCHAR(40) NULL, `prevStatus` VARCHAR(40) NULL, `rag` VARCHAR(10) NULL,
  `expectedSale` DECIMAL(14,4) NULL, `orderValue` DECIMAL(14,4) NULL, `timeline` DATE NULL,
  `reviewedById` VARCHAR(30) NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updatedAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), UNIQUE KEY `CprReview_opp_date_key` (`opportunityId`, `reviewDate`),
  KEY `CprReview_date_idx` (`reviewDate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


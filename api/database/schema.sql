-- ════════════════════════════════════════════════════════════════════════
-- Industrial CRM — MySQL Schema
-- Converted 1:1 from backend/prisma/schema.prisma (PostgreSQL → MySQL)
--
-- Notes on the conversion:
--   • Prisma's String @id @default(cuid()) primary keys are generated in
--     application code (PHP, see includes/Helpers.php gen_id()) exactly as
--     Prisma's client used to generate them in Node — so these stay
--     VARCHAR(30) rather than becoming MySQL AUTO_INCREMENT integers.
--     This keeps the data shape identical to what the React frontend has
--     always received (opaque string IDs), so nothing on the frontend
--     needs to change.
--   • Float → DOUBLE for GPS coordinates (lat/lng/accuracy/distance), and
--     DECIMAL(14,2) for money/quantity fields, matching how the original
--     code already rounds those values to 2 decimal places before saving.
--   • Foreign keys mirror the Prisma relations exactly, including the two
--     explicit `onDelete: Cascade` relations (QuotationItem→Quotation,
--     LocationPing→Attendance). Fields that are plain strings in Prisma
--     (e.g. approvedById, productRef) — i.e. NOT declared as a Prisma
--     relation — are kept as plain VARCHAR columns with no FK constraint,
--     exactly matching the original schema.
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─────────────────────────────────────────────────────────────────────────
-- USER  — roles: SUPER_ADMIN | ADMIN | MANAGER | SALES_ENGINEER | SALES
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS `User`;
CREATE TABLE `User` (
  `id`               VARCHAR(30)  NOT NULL,
  `name`             VARCHAR(255) NOT NULL,
  `email`            VARCHAR(255) NOT NULL,
  `password`         VARCHAR(255) NOT NULL,
  `role`             VARCHAR(30)  NOT NULL DEFAULT 'SALES',
  `isActive`         TINYINT(1)   NOT NULL DEFAULT 1,
  `isLocked`         TINYINT(1)   NOT NULL DEFAULT 0,
  `phone`            VARCHAR(30)      NULL,
  `avatar`           VARCHAR(500)     NULL,
  `department`       VARCHAR(100)     NULL,
  `lastLoginAt`      DATETIME         NULL,
  `failedLoginCount` INT          NOT NULL DEFAULT 0,
  `twoFactorEnabled` TINYINT(1)   NOT NULL DEFAULT 0,
  `sessionTimeout`   INT          NOT NULL DEFAULT 480,
  `createdAt`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `User_email_key` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────
-- CUSTOMER — with GPS location for geo-fence check-in
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS `Customer`;
CREATE TABLE `Customer` (
  `id`             VARCHAR(30)  NOT NULL,
  `companyName`    VARCHAR(255) NOT NULL,
  `contactPerson`  VARCHAR(255) NOT NULL,
  `contactNumber`  VARCHAR(30)  NOT NULL,
  `designation`    VARCHAR(150)     NULL,
  `email`          VARCHAR(255)     NULL,
  `location`       VARCHAR(255)     NULL,
  `address`        TEXT             NULL,
  `lat`            DOUBLE           NULL,
  `lng`            DOUBLE           NULL,
  `geoFenceRadius` INT          NOT NULL DEFAULT 200,
  `mapsLink`       VARCHAR(500)     NULL,
  `category`       VARCHAR(100)     NULL,
  `industryType`   VARCHAR(100)     NULL,
  `machineDetails` TEXT             NULL,
  `status`         VARCHAR(30)  NOT NULL DEFAULT 'ACTIVE',
  `remarks`        TEXT             NULL,
  `isActive`       TINYINT(1)   NOT NULL DEFAULT 1,
  `createdById`    VARCHAR(30)  NOT NULL,
  `createdAt`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `Customer_createdById_idx` (`createdById`),
  CONSTRAINT `Customer_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────
-- MEETING — geo-fence check-in, timer, rich notes, follow-up pipeline
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS `Meeting`;
CREATE TABLE `Meeting` (
  `id`                    VARCHAR(30)  NOT NULL,
  `customerId`            VARCHAR(30)  NOT NULL,
  `userId`                VARCHAR(30)  NOT NULL,
  `assignedToId`          VARCHAR(30)      NULL,
  `meetingDate`           DATETIME     NOT NULL,
  `meetingType`           VARCHAR(40)  NOT NULL,
  `status`                VARCHAR(40)  NOT NULL DEFAULT 'NEW_LEAD',
  `checkInLat`            DOUBLE           NULL,
  `checkInLng`            DOUBLE           NULL,
  `checkInDistance`       DOUBLE           NULL,
  `checkedInAt`           DATETIME         NULL,
  `isGeoVerified`         TINYINT(1)   NOT NULL DEFAULT 0,
  `timerStartedAt`        DATETIME         NULL,
  `timerEndedAt`          DATETIME         NULL,
  `timerPausedSeconds`    INT          NOT NULL DEFAULT 0,
  `visitDurationMinutes`  INT              NULL,
  `notes`                 TEXT             NULL,
  `summary`               TEXT             NULL,
  `actionItems`           TEXT             NULL,
  `customerRequirements`  TEXT             NULL,
  `competitorInfo`        TEXT             NULL,
  `opportunities`         TEXT             NULL,
  `attachments`           TEXT             NULL,
  `nextFollowUp`          DATETIME         NULL,
  `followUpTime`          VARCHAR(10)      NULL,
  `followUpPriority`      VARCHAR(20)  NOT NULL DEFAULT 'MEDIUM',
  `trialDate`             DATETIME         NULL,
  `trialStatus`           VARCHAR(40)      NULL,
  `trialFeedback`         TEXT             NULL,
  `quotationDate`         DATETIME         NULL,
  `quotationStatus`       VARCHAR(40)      NULL,
  `reminderSent`          TINYINT(1)   NOT NULL DEFAULT 0,
  `createdAt`             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `Meeting_customerId_idx` (`customerId`),
  KEY `Meeting_userId_idx` (`userId`),
  KEY `Meeting_assignedToId_idx` (`assignedToId`),
  KEY `Meeting_nextFollowUp_idx` (`nextFollowUp`),
  CONSTRAINT `Meeting_customerId_fkey`   FOREIGN KEY (`customerId`)   REFERENCES `Customer` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Meeting_userId_fkey`       FOREIGN KEY (`userId`)       REFERENCES `User` (`id`)     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Meeting_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User` (`id`)     ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────
-- FOLLOW-UP ALERT
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS `FollowUpAlert`;
CREATE TABLE `FollowUpAlert` (
  `id`        VARCHAR(30) NOT NULL,
  `meetingId` VARCHAR(30) NOT NULL,
  `userId`    VARCHAR(30) NOT NULL,
  `alertType` VARCHAR(40) NOT NULL,
  `isRead`    TINYINT(1)  NOT NULL DEFAULT 0,
  `sentAt`    DATETIME        NULL,
  `createdAt` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `FollowUpAlert_userId_isRead_idx` (`userId`, `isRead`),
  KEY `FollowUpAlert_meetingId_idx` (`meetingId`),
  CONSTRAINT `FollowUpAlert_meetingId_fkey` FOREIGN KEY (`meetingId`) REFERENCES `Meeting` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `FollowUpAlert_userId_fkey`    FOREIGN KEY (`userId`)    REFERENCES `User` (`id`)    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────
-- CATEGORY / ITEM-GROUP MAPPING / PRODUCT / STOCK / QUOTATION
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS `Category`;
CREATE TABLE `Category` (
  `id`        VARCHAR(30)  NOT NULL,
  `name`      VARCHAR(150) NOT NULL,
  `color`     VARCHAR(20)  NOT NULL DEFAULT '#64748b',
  `sortOrder` INT          NOT NULL DEFAULT 0,
  `createdAt` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Category_name_key` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `ItemGroupMapping`;
CREATE TABLE `ItemGroupMapping` (
  `id`         VARCHAR(30)  NOT NULL,
  `itemGroup`  VARCHAR(150) NOT NULL,
  `categoryId` VARCHAR(30)      NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ItemGroupMapping_itemGroup_key` (`itemGroup`),
  KEY `ItemGroupMapping_categoryId_idx` (`categoryId`),
  CONSTRAINT `ItemGroupMapping_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `Product`;
CREATE TABLE `Product` (
  `id`             VARCHAR(30)    NOT NULL,
  `itemCode`       VARCHAR(100)   NOT NULL,
  `productName`    VARCHAR(255)   NOT NULL,
  `description`    TEXT               NULL,
  `unit`           VARCHAR(20)        NULL,
  `standardPrice`  DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `category`       VARCHAR(100)       NULL,
  `categoryId`     VARCHAR(30)        NULL,
  `productRef`     VARCHAR(100)       NULL,
  `isCustom`       TINYINT(1)     NOT NULL DEFAULT 0,
  `drawingNumber`  VARCHAR(100)       NULL,
  `revisionNumber` VARCHAR(50)        NULL,
  `hsnCode`        VARCHAR(30)        NULL,
  `isActive`       TINYINT(1)     NOT NULL DEFAULT 1,
  `createdAt`      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Product_itemCode_key` (`itemCode`),
  KEY `Product_categoryId_idx` (`categoryId`),
  CONSTRAINT `Product_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `Stock`;
CREATE TABLE `Stock` (
  `id`               VARCHAR(30)    NOT NULL,
  `itemCode`         VARCHAR(100)   NOT NULL,
  `itemName`         VARCHAR(255)   NOT NULL,
  `itemType`         VARCHAR(50)    NOT NULL DEFAULT 'Regular',
  `productMaster`    VARCHAR(150)       NULL,
  `productFamily`    VARCHAR(150)       NULL,
  `productSubfamily` VARCHAR(150)       NULL,
  `itemGroup`        VARCHAR(150)       NULL,
  `categoryCode`     VARCHAR(50)        NULL,
  `categoryId`       VARCHAR(30)        NULL,
  `productId`        VARCHAR(30)        NULL,
  `availableStock`   DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `reservedStock`    DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `minimumStock`     DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `netPrice`         DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `xceedLp`          DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `edd`              VARCHAR(100)       NULL,
  `rad`              VARCHAR(100)       NULL,
  `location`         VARCHAR(150)       NULL,
  `isActive`         TINYINT(1)     NOT NULL DEFAULT 1,
  `lastUpdated`      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Stock_itemCode_key` (`itemCode`),
  UNIQUE KEY `Stock_productId_key` (`productId`),
  KEY `Stock_categoryId_idx` (`categoryId`),
  CONSTRAINT `Stock_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `Stock_productId_fkey`  FOREIGN KEY (`productId`)  REFERENCES `Product` (`id`)  ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `Quotation`;
CREATE TABLE `Quotation` (
  `id`              VARCHAR(30)    NOT NULL,
  `company`         VARCHAR(10)    NOT NULL DEFAULT 'TMS',
  `quotationNumber` VARCHAR(60)    NOT NULL,
  `customerId`      VARCHAR(30)    NOT NULL,
  `userId`          VARCHAR(30)    NOT NULL,
  `status`          VARCHAR(40)    NOT NULL DEFAULT 'DRAFT',
  `version`         INT            NOT NULL DEFAULT 1,
  `totalAmount`     DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `notes`           TEXT               NULL,
  `validUntil`      DATETIME           NULL,
  `approvalStatus`  VARCHAR(20)    NOT NULL DEFAULT 'PENDING',
  `approvedById`    VARCHAR(30)        NULL,
  `approvedAt`      DATETIME           NULL,
  `quotationDate`   DATETIME           NULL,
  `enquiryDate`     DATETIME           NULL,
  `toName`          VARCHAR(255)       NULL,
  `toAddr1`         VARCHAR(255)       NULL,
  `toAddr2`         VARCHAR(255)       NULL,
  `toState`         VARCHAR(100)       NULL,
  `kindAttn`        VARCHAR(255)       NULL,
  `toDesignation`   VARCHAR(150)       NULL,
  `enquiryRef`      VARCHAR(150)       NULL,
  `subject`         VARCHAR(255)       NULL,
  `salesTax`        VARCHAR(100)   DEFAULT '18% GST Extra',
  `paymentTerms`    VARCHAR(255)       NULL,
  `validity`        VARCHAR(100)   DEFAULT '15 Days',
  `deliveryCharges` VARCHAR(150)       NULL,
  `signCompany`     VARCHAR(255)       NULL,
  `signName`        VARCHAR(150)       NULL,
  `signDesignation` VARCHAR(150)       NULL,
  `createdAt`       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `Quotation_quotationNumber_key` (`quotationNumber`),
  KEY `Quotation_company_idx` (`company`),
  KEY `Quotation_customerId_idx` (`customerId`),
  KEY `Quotation_userId_idx` (`userId`),
  CONSTRAINT `Quotation_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Quotation_userId_fkey`     FOREIGN KEY (`userId`)     REFERENCES `User` (`id`)     ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `QuotationItem`;
CREATE TABLE `QuotationItem` (
  `id`          VARCHAR(30)    NOT NULL,
  `quotationId` VARCHAR(30)    NOT NULL,
  `productId`   VARCHAR(30)        NULL,
  `itemCode`    VARCHAR(100)   NOT NULL,
  `productName` VARCHAR(255)   NOT NULL,
  `description` TEXT               NULL,
  `category`    VARCHAR(100)       NULL,
  `unit`        VARCHAR(20)        NULL,
  `quantity`    DECIMAL(14,2)  NOT NULL,
  `unitPrice`   DECIMAL(14,2)  NOT NULL,
  `discount`    DECIMAL(6,2)   NOT NULL DEFAULT 0,
  `netPrice`    DECIMAL(14,2)  NOT NULL DEFAULT 0,
  `totalPrice`  DECIMAL(14,2)  NOT NULL,
  `delivery`    VARCHAR(100)       NULL,
  `hsnCode`     VARCHAR(30)        NULL,
  `createdAt`   DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `QuotationItem_quotationId_idx` (`quotationId`),
  KEY `QuotationItem_productId_idx` (`productId`),
  CONSTRAINT `QuotationItem_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `Quotation` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `QuotationItem_productId_fkey`   FOREIGN KEY (`productId`)   REFERENCES `Product` (`id`)   ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ─────────────────────────────────────────────────────────────────────────
-- ATTENDANCE / LOCATION PING / LEAVE / APPROVAL / ACTIVITY LOG
-- ─────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS `Attendance`;
CREATE TABLE `Attendance` (
  `id`           VARCHAR(30)   NOT NULL,
  `userId`       VARCHAR(30)   NOT NULL,
  `date`         DATETIME      NOT NULL,
  `checkIn`      DATETIME          NULL,
  `checkOut`     DATETIME          NULL,
  `checkInLat`   DOUBLE            NULL,
  `checkInLng`   DOUBLE            NULL,
  `checkOutLat`  DOUBLE            NULL,
  `checkOutLng`  DOUBLE            NULL,
  `workingHours` DECIMAL(6,2)      NULL,
  `status`       VARCHAR(30)   NOT NULL DEFAULT 'PENDING',
  `adminNote`    TEXT              NULL,
  `approvedById` VARCHAR(30)       NULL,
  `approvedAt`   DATETIME          NULL,
  `createdAt`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `Attendance_userId_date_idx` (`userId`, `date`),
  CONSTRAINT `Attendance_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `LocationPing`;
CREATE TABLE `LocationPing` (
  `id`           VARCHAR(30) NOT NULL,
  `attendanceId` VARCHAR(30) NOT NULL,
  `lat`          DOUBLE      NOT NULL,
  `lng`          DOUBLE      NOT NULL,
  `accuracy`     DOUBLE          NULL,
  `capturedAt`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `LocationPing_attendanceId_capturedAt_idx` (`attendanceId`, `capturedAt`),
  CONSTRAINT `LocationPing_attendanceId_fkey` FOREIGN KEY (`attendanceId`) REFERENCES `Attendance` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `Leave`;
CREATE TABLE `Leave` (
  `id`           VARCHAR(30)   NOT NULL,
  `userId`       VARCHAR(30)   NOT NULL,
  `leaveType`    VARCHAR(30)   NOT NULL,
  `fromDate`     DATETIME      NOT NULL,
  `toDate`       DATETIME      NOT NULL,
  `totalDays`    DECIMAL(6,2)  NOT NULL,
  `reason`       TEXT              NULL,
  `status`       VARCHAR(20)   NOT NULL DEFAULT 'PENDING',
  `adminNote`    TEXT              NULL,
  `approvedById` VARCHAR(30)       NULL,
  `approvedAt`   DATETIME          NULL,
  `createdAt`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `Leave_userId_idx` (`userId`),
  CONSTRAINT `Leave_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `Approval`;
CREATE TABLE `Approval` (
  `id`          VARCHAR(30) NOT NULL,
  `type`        VARCHAR(30) NOT NULL,
  `entityId`    VARCHAR(30) NOT NULL,
  `requestById` VARCHAR(30) NOT NULL,
  `status`      VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `note`        TEXT            NULL,
  `quotationId` VARCHAR(30)     NULL,
  `createdAt`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `Approval_requestById_idx` (`requestById`),
  KEY `Approval_quotationId_idx` (`quotationId`),
  CONSTRAINT `Approval_requestById_fkey` FOREIGN KEY (`requestById`) REFERENCES `User` (`id`)      ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Approval_quotationId_fkey` FOREIGN KEY (`quotationId`) REFERENCES `Quotation` (`id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TABLE IF EXISTS `ActivityLog`;
CREATE TABLE `ActivityLog` (
  `id`         VARCHAR(30) NOT NULL,
  `userId`     VARCHAR(30) NOT NULL,
  `action`     VARCHAR(60) NOT NULL,
  `entityType` VARCHAR(60)     NULL,
  `entityId`   VARCHAR(30)     NULL,
  `details`    TEXT            NULL,
  `ipAddress`  VARCHAR(45)     NULL,
  `userAgent`  VARCHAR(500)    NULL,
  `createdAt`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ActivityLog_userId_idx` (`userId`),
  KEY `ActivityLog_createdAt_idx` (`createdAt`),
  CONSTRAINT `ActivityLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

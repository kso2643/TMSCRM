-- Migration: breaks (tea / lunch) and stationary / location-off events.
-- You normally do NOT need to run this: the API creates these tables on first use
-- (includes/SchemaGuard.php), matching your database collation.
--   mysql -u <user> -p <database> < database/migration_breaks.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `AttendanceBreak` (
  `id`              VARCHAR(30)  NOT NULL,
  `userId`          VARCHAR(30)  NOT NULL,
  `attendanceId`    VARCHAR(30)      NULL,
  `breakType`       VARCHAR(10)  NOT NULL,
  `triggerType`     VARCHAR(10)  NOT NULL DEFAULT 'MANUAL',
  `startedAt`       DATETIME     NOT NULL,
  `endedAt`         DATETIME         NULL,
  `durationSeconds` INT              NULL,
  `lat`             DOUBLE           NULL,
  `lng`             DOUBLE           NULL,
  `createdAt`       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `AttendanceBreak_user_started_idx` (`userId`, `startedAt`),
  KEY `AttendanceBreak_attendanceId_idx` (`attendanceId`),
  CONSTRAINT `AttendanceBreak_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `StationaryLog` (
  `id`           VARCHAR(30)  NOT NULL,
  `userId`       VARCHAR(30)  NOT NULL,
  `attendanceId` VARCHAR(30)      NULL,
  `eventType`    VARCHAR(30)  NOT NULL,
  `sinceAt`      DATETIME         NULL,
  `detectedAt`   DATETIME     NOT NULL,
  `minutes`      INT              NULL,
  `lat`          DOUBLE           NULL,
  `lng`          DOUBLE           NULL,
  `createdAt`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `StationaryLog_user_detected_idx` (`userId`, `detectedAt`),
  CONSTRAINT `StationaryLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


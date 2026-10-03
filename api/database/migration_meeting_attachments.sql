-- Migration: photos, files and voice notes on meetings.
-- You normally do NOT need to run this: the API creates the table on first use
-- (includes/SchemaGuard.php), matching your database collation.
--   mysql -u <user> -p <database> < database/migration_meeting_attachments.sql

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `MeetingAttachment` (
  `id` VARCHAR(30) NOT NULL, `meetingId` VARCHAR(30) NOT NULL,
  `kind` VARCHAR(10) NOT NULL, `originalName` VARCHAR(255) NOT NULL, `storedName` VARCHAR(80) NOT NULL,
  `mime` VARCHAR(100) NOT NULL, `sizeBytes` INT NOT NULL, `durationSec` INT NULL,
  `uploadedById` VARCHAR(30) NOT NULL, `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `MeetingAttachment_meeting_idx` (`meetingId`, `createdAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

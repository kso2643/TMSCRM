-- ════════════════════════════════════════════════════════════════════════
-- Migration: Appointments (engineer scheduling — monthly/day calendar,
--            customer + engineer assignment, evening-before reminders)
--
-- SAFE TO RUN ON YOUR EXISTING LIVE DATABASE.
-- This file only ADDS tables — it never drops or rewrites anything, so
-- your existing Users, Customers, Meetings, etc. are untouched.
-- This is NOT the same as schema.sql (which DROPs and recreates every
-- table) — do not run schema.sql again on a live DB.
--
-- Run once:
--   mysql -u <user> -p <database> < database/migration_appointments.sql
-- ════════════════════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── 1. Appointment — one row per scheduled customer visit ────────────────
-- Deliberately separate from `Meeting` (which is the sales pipeline:
-- leads, quotations, trials). An Appointment is simpler on purpose — a
-- customer, a day (+ optional time), and the engineer assigned to go —
-- so the calendar stays fast and the create form stays short. `userId` is
-- whoever booked it, `assignedToId` is the engineer doing the visit; the
-- two are the same row when someone self-assigns.
CREATE TABLE IF NOT EXISTS `Appointment` (
  `id`               VARCHAR(30)  NOT NULL,
  `customerId`       VARCHAR(30)  NOT NULL,
  `userId`           VARCHAR(30)  NOT NULL,
  `assignedToId`     VARCHAR(30)  NOT NULL,
  `title`            VARCHAR(255) NOT NULL,
  `appointmentDate`  DATE         NOT NULL,
  `appointmentTime`  VARCHAR(10)      NULL,
  `status`           VARCHAR(20)  NOT NULL DEFAULT 'SCHEDULED',
  `notes`            TEXT             NULL,
  `createdAt`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `Appointment_customerId_idx` (`customerId`),
  KEY `Appointment_userId_idx` (`userId`),
  KEY `Appointment_assignedToId_idx` (`assignedToId`),
  KEY `Appointment_appointmentDate_idx` (`appointmentDate`),
  CONSTRAINT `Appointment_customerId_fkey`   FOREIGN KEY (`customerId`)   REFERENCES `Customer` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Appointment_userId_fkey`       FOREIGN KEY (`userId`)       REFERENCES `User` (`id`)     ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `Appointment_assignedToId_fkey` FOREIGN KEY (`assignedToId`) REFERENCES `User` (`id`)     ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. AppointmentAlert — assignment pings + evening-before reminders ────
-- Same generated-on-read idea as `FollowUpAlert` / `Notification` — there
-- is no cron in this codebase, so rows are inserted the moment someone
-- calls GET /api/appointments/reminders (see AppointmentController::
-- reminders()), which the CRM polls every few minutes while it's open.
-- The unique key is what makes that safe to call repeatedly: the same
-- appointment/user/type combination can only ever insert once, so calling
-- it every few minutes just no-ops after the first hit instead of
-- spamming the alert.
CREATE TABLE IF NOT EXISTS `AppointmentAlert` (
  `id`            VARCHAR(30) NOT NULL,
  `appointmentId` VARCHAR(30) NOT NULL,
  `userId`        VARCHAR(30) NOT NULL,
  `alertType`     VARCHAR(40) NOT NULL,   -- TASK_ASSIGNED | REMINDER_EVENING_BEFORE
  `isRead`        TINYINT(1)  NOT NULL DEFAULT 0,
  `createdAt`     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `AppointmentAlert_appt_user_type_key` (`appointmentId`,`userId`,`alertType`),
  KEY `AppointmentAlert_userId_isRead_idx` (`userId`,`isRead`),
  CONSTRAINT `AppointmentAlert_appointmentId_fkey` FOREIGN KEY (`appointmentId`) REFERENCES `Appointment` (`id`) ON DELETE CASCADE  ON UPDATE CASCADE,
  CONSTRAINT `AppointmentAlert_userId_fkey`        FOREIGN KEY (`userId`)        REFERENCES `User` (`id`)        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

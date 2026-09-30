<?php
/**
 * Mirrors the inline `prisma.activityLog.create({...})` calls scattered
 * across the JS controllers. (Note: the JS project also had an unused
 * `logActivity` Express middleware in middleware/activity.js that was
 * never actually wired into any route — confirmed by grepping the
 * original source — so it's intentionally not ported.)
 */
function log_activity(string $userId, string $action, ?string $entityType = null, ?string $entityId = null, $details = null): void
{
    try {
        $stmt = db()->prepare(
            'INSERT INTO `ActivityLog` (id, userId, action, entityType, entityId, details, ipAddress, userAgent, createdAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            gen_id(),
            $userId,
            $action,
            $entityType,
            $entityId,
            $details !== null ? (is_string($details) ? $details : json_str($details)) : null,
            client_ip(),
            user_agent(),
            now_sql(),
        ]);
    } catch (\Throwable $e) {
        // Never break the main response because logging failed.
        error_log('log_activity failed: ' . $e->getMessage());
    }
}

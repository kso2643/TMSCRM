<?php
/**
 * Live alert feed for crm/crm-global.js (the site-wide script that shows a
 * toast + plays a sound on every page).
 *
 * GET /api/alerts-feed?since=Y-m-d H:i:s
 *   → { now, events: [{ id, type, title, body, link, at }] }
 *
 * Events are derived from existing rows (no new table): anything that
 * happened after `since` and concerns the caller —
 *   TASK_ASSIGNED          a task was assigned to you
 *   TASK_COMPLETED         a task you assigned was completed (Super Admin: any task)
 *   PRICE_REQUEST_NEW      a new price request (Super Admin / Admin)
 *   PRICE_REQUEST_ANSWERED your price request was approved / rejected
 *   TRIAL_REQUESTED        a new trial request (Super Admin / Admin)
 *   TRIAL_DECIDED          your trial request was approved / rejected
 *   TRIAL_COMPLETED        a trial's savings report was submitted (Super Admin / Admin)
 *
 * The client passes back `now` from the previous call as the next `since`,
 * so clock differences between browser and server don't matter. Each
 * source is queried independently and skipped if its table doesn't exist
 * yet (a module nobody has opened), so one missing table never breaks the feed.
 */
class AlertFeedController
{
    private const MAX_EVENTS = 30;

    private static function fmtDuration(int $sec): string
    {
        $h = intdiv($sec, 3600); $m = intdiv($sec % 3600, 60);
        return $h ? "{$h}h {$m}m" : ($m ? "{$m}m" : "{$sec}s");
    }

    /** Runs one source query, returning [] if its table doesn't exist (or any DB error). */
    private static function rows(string $sql, array $params): array
    {
        try {
            $s = db()->prepare($sql);
            $s->execute($params);
            return $s->fetchAll();
        } catch (PDOException $e) {
            return [];
        }
    }

    public function feed(): void
    {
        $auth = authenticate();
        $me = $auth['id'];
        $isManager = (ROLE_LEVELS[$auth['role']] ?? 0) >= ROLE_LEVELS['ADMIN'];
        $isSuper = $auth['role'] === 'SUPER_ADMIN';
        $now = now_sql();

        // First call from a browser: look back 12h so alerts raised while
        // you were away still show once. Never look back more than 7 days.
        $since = to_dt(qp('since')) ?? (new DateTime('-12 hours'))->format('Y-m-d H:i:s');
        $floor = (new DateTime('-7 days'))->format('Y-m-d H:i:s');
        if ($since < $floor) $since = $floor;

        $ev = [];
        $add = function (string $id, string $type, string $title, string $body, string $link, string $at) use (&$ev) {
            $ev[] = ['id' => $id, 'type' => $type, 'title' => $title, 'body' => $body, 'link' => $link, 'at' => $at];
        };

        // Tasks assigned to me (by someone else)
        foreach (self::rows(
            "SELECT t.id, t.title, t.priority, t.createdAt, b.name AS byName FROM `AdminTask` t
             LEFT JOIN `User` b ON b.id = t.assignedById
             WHERE t.assignedToId=? AND t.assignedById<>? AND t.createdAt>? ORDER BY t.createdAt DESC LIMIT 20",
            [$me, $me, $since]) as $r) {
            $add('task-assigned-' . $r['id'], 'TASK_ASSIGNED', 'New task assigned',
                '“' . $r['title'] . '” from ' . ($r['byName'] ?: 'admin') . ($r['priority'] === 'URGENT' || $r['priority'] === 'HIGH' ? ' · ' . strtolower($r['priority']) . ' priority' : ''),
                '/tasks/', $r['createdAt']);
        }

        // Tasks completed — ones I assigned (Super Admin: all)
        if ($isManager) {
            foreach (self::rows(
                "SELECT t.id, t.title, t.workedSeconds, t.completedAt, t.completionNote, a.name AS whoName FROM `AdminTask` t
                 LEFT JOIN `User` a ON a.id = t.assignedToId
                 WHERE t.status='COMPLETED' AND t.completedAt>? AND t.assignedToId<>? " . ($isSuper ? '' : 'AND t.assignedById=? ') .
                "ORDER BY t.completedAt DESC LIMIT 20",
                $isSuper ? [$since, $me] : [$since, $me, $me]) as $r) {
                $add('task-done-' . $r['id'], 'TASK_COMPLETED', 'Task completed',
                    ($r['whoName'] ?: 'Someone') . ' completed “' . $r['title'] . '” in ' . self::fmtDuration((int) $r['workedSeconds']) .
                    ($r['completionNote'] ? ' — ' . mb_substr($r['completionNote'], 0, 80) : ''),
                    '/tasks/#completed', $r['completedAt']);
            }
        }

        // Price requests
        if ($isManager) {
            foreach (self::rows(
                "SELECT r.id, r.productName, r.createdAt, u.name AS byName FROM `PriceRequest` r
                 LEFT JOIN `User` u ON u.id = r.requestedById
                 WHERE r.status='PENDING' AND r.createdAt>? AND r.requestedById<>? ORDER BY r.createdAt DESC LIMIT 20",
                [$since, $me]) as $r) {
                $add('price-new-' . $r['id'], 'PRICE_REQUEST_NEW', 'New price request',
                    ($r['byName'] ?: 'An engineer') . ' asks for a price on ' . $r['productName'], '/tasks/#prices', $r['createdAt']);
            }
        }
        foreach (self::rows(
            "SELECT r.id, r.productName, r.status, r.approvedPrice, r.respondedAt FROM `PriceRequest` r
             WHERE r.requestedById=? AND r.respondedAt>? AND r.respondedById<>? ORDER BY r.respondedAt DESC LIMIT 20",
            [$me, $since, $me]) as $r) {
            $ok = $r['status'] === 'APPROVED';
            $add('price-answer-' . $r['id'] . '-' . $r['respondedAt'], 'PRICE_REQUEST_ANSWERED', $ok ? 'Price request approved' : 'Price request rejected',
                $r['productName'] . ($ok ? ' — approved at ₹' . number_format((float) $r['approvedPrice'], 2) : ''), '/tasks/#prices', $r['respondedAt']);
        }

        // Trials
        if ($isManager) {
            foreach (self::rows(
                "SELECT t.id, t.trialNo, t.customerName, t.component, t.createdAt, u.name AS byName FROM `Trial` t
                 LEFT JOIN `User` u ON u.id = t.requestedById
                 WHERE t.status='PENDING_APPROVAL' AND t.createdAt>? AND t.requestedById<>? ORDER BY t.createdAt DESC LIMIT 20",
                [$since, $me]) as $r) {
                $add('trial-new-' . $r['id'], 'TRIAL_REQUESTED', 'New trial request',
                    $r['trialNo'] . ' · ' . trim(($r['customerName'] ?: '') . ' ' . ($r['component'] ? '— ' . $r['component'] : '')) . ' (by ' . ($r['byName'] ?: '—') . ')',
                    '/trials/#/t/' . rawurlencode($r['id']), $r['createdAt']);
            }
            foreach (self::rows(
                "SELECT t.id, t.trialNo, t.customerName, t.savingsPerYear, t.completedAt FROM `Trial` t
                 WHERE t.status='COMPLETED' AND t.completedAt>? AND t.requestedById<>? ORDER BY t.completedAt DESC LIMIT 20",
                [$since, $me]) as $r) {
                $add('trial-done-' . $r['id'], 'TRIAL_COMPLETED', 'Trial completed',
                    $r['trialNo'] . ' · ' . ($r['customerName'] ?: '') . ($r['savingsPerYear'] !== null ? ' — saving ₹' . number_format((float) $r['savingsPerYear']) . ' / year' : ''),
                    '/trials/#/t/' . rawurlencode($r['id']), $r['completedAt']);
            }
        }
        foreach (self::rows(
            "SELECT t.id, t.trialNo, t.status, t.decidedAt, t.approvalNote FROM `Trial` t
             WHERE t.requestedById=? AND t.decidedAt>? AND t.decidedById<>? AND t.status IN ('APPROVED','REJECTED','COMPLETED')
             ORDER BY t.decidedAt DESC LIMIT 20",
            [$me, $since, $me]) as $r) {
            $rej = $r['status'] === 'REJECTED';
            $add('trial-decided-' . $r['id'] . '-' . $r['decidedAt'], 'TRIAL_DECIDED', $rej ? 'Trial request rejected' : 'Trial request approved',
                $r['trialNo'] . ($rej && $r['approvalNote'] ? ' — ' . mb_substr($r['approvalNote'], 0, 80) : ($rej ? '' : ' — you can run the trial now')),
                '/trials/#/t/' . rawurlencode($r['id']), $r['decidedAt']);
        }

        usort($ev, fn($a, $b) => strcmp($b['at'], $a['at']));
        sendSuccess(['now' => $now, 'events' => array_slice($ev, 0, self::MAX_EVENTS)]);
    }
}

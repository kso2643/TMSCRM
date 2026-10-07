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
 *   LEAVE_REQUESTED        someone applied for leave (Super Admin / Admin)
 *   LEAVE_DECIDED          your leave was approved / rejected
 *   BREAK_STARTED          someone started a tea / lunch break (Super Admin)
 *   STATIONARY             someone stayed 30+ min in one place and said it wasn't a break,
 *                          or didn't answer the prompt (Super Admin)
 *   LOCATION_OFF           someone punched in has location turned off (Super Admin)
 *
 * GET /api/alerts-feed/history?days=30 returns the same events over the
 * last N days (max 60) for the Alerts & reminders page.
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
        // First call from a browser: look back 12h so alerts raised while
        // you were away still show once. Never look back more than 7 days.
        $since = to_dt(qp('since')) ?? (new DateTime('-12 hours'))->format('Y-m-d H:i:s');
        $floor = (new DateTime('-7 days'))->format('Y-m-d H:i:s');
        if ($since < $floor) $since = $floor;
        $now = now_sql();
        sendSuccess(['now' => $now, 'events' => array_slice($this->collect($auth, $since, 20), 0, self::MAX_EVENTS)]);
    }

    // GET /api/alerts-feed/history?days=30
    public function history(): void
    {
        $auth = authenticate();
        $days = max(1, min(60, (int) qp('days', 30)));
        $since = (new DateTime("-{$days} days"))->format('Y-m-d H:i:s');
        sendSuccess(['now' => now_sql(), 'days' => $days, 'events' => $this->collect($auth, $since, 200)]);
    }

    /** Every event since $since that concerns $auth, newest first. */
    private function collect(array $auth, string $since, int $per): array
    {
        $me = $auth['id'];
        $isManager = (ROLE_LEVELS[$auth['role']] ?? 0) >= ROLE_LEVELS['ADMIN'];
        $isSuper = $auth['role'] === 'SUPER_ADMIN';

        $ev = [];
        $add = function (string $id, string $type, string $title, string $body, string $link, string $at) use (&$ev) {
            $ev[] = ['id' => $id, 'type' => $type, 'title' => $title, 'body' => $body, 'link' => $link, 'at' => $at];
        };

        // Tasks assigned to me (by someone else)
        foreach (self::rows(
            "SELECT t.id, t.title, t.priority, t.createdAt, b.name AS byName FROM `AdminTask` t
             LEFT JOIN `User` b ON b.id = t.assignedById
             WHERE t.assignedToId=? AND t.assignedById<>? AND t.createdAt>? ORDER BY t.createdAt DESC LIMIT $per",
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
                "ORDER BY t.completedAt DESC LIMIT $per",
                $isSuper ? [$since, $me] : [$since, $me, $me]) as $r) {
                $add('task-done-' . $r['id'], 'TASK_COMPLETED', 'Task completed',
                    ($r['whoName'] ?: 'Someone') . ' completed “' . $r['title'] . '” in ' . self::fmtDuration((int) $r['workedSeconds']) .
                    ($r['completionNote'] ? ' — ' . mb_substr($r['completionNote'], 0, 80) : ''),
                    '/tasks/#completed', $r['completedAt']);
            }
        }

        // Price requests (make sure the multi-item columns/table exist before querying them)
        try { ensure_schema(PriceRequestController::schema(), 'migration_tasks_price_requests.sql'); } catch (Throwable $e) {}
        if ($isManager) {
            // One alert per request (a multi-item request is one alert, not one per item).
            foreach (self::rows(
                "SELECT COALESCE(r.batchId, r.id) AS gid, MIN(r.productName) AS productName, COUNT(*) AS n, MAX(r.createdAt) AS createdAt,
                        MAX(u.name) AS byName, MAX(c.companyName) AS companyName, MAX(b.requestNo) AS requestNo, MAX(r.revisionCount) AS rev
                 FROM `PriceRequest` r
                 LEFT JOIN `User` u ON u.id = r.requestedById
                 LEFT JOIN `Customer` c ON c.id = r.customerId
                 LEFT JOIN `PriceRequestBatch` b ON b.id = r.batchId
                 WHERE r.status='PENDING' AND r.createdAt>? AND r.requestedById<>?
                 GROUP BY COALESCE(r.batchId, r.id) ORDER BY MAX(r.createdAt) DESC LIMIT $per",
                [$since, $me]) as $r) {
                $what = (int) $r['n'] > 1 ? $r['n'] . ' items' : $r['productName'];
                $add('price-new-' . $r['gid'] . '-' . $r['createdAt'], 'PRICE_REQUEST_NEW', ((int) $r['rev'] ? 'Revised price request' : 'New price request') . ($r['requestNo'] ? ' ' . $r['requestNo'] : ''),
                    ($r['byName'] ?: 'An engineer') . ' asks for a price on ' . $what . ($r['companyName'] ? ' for ' . $r['companyName'] : ''),
                    '/price-requests/', $r['createdAt']);
            }
            // Engineer pressed "Remind admin"
            foreach (self::rows(
                "SELECT b.id, b.requestNo, b.lastRemindedAt, b.remindCount, u.name AS byName, c.companyName,
                        (SELECT COUNT(*) FROM `PriceRequest` r WHERE r.batchId=b.id AND r.status='PENDING') AS pending
                 FROM `PriceRequestBatch` b LEFT JOIN `User` u ON u.id=b.requestedById LEFT JOIN `Customer` c ON c.id=b.customerId
                 WHERE b.lastRemindedAt>? AND b.requestedById<>? ORDER BY b.lastRemindedAt DESC LIMIT $per",
                [$since, $me]) as $r) {
                if (!(int) $r['pending']) continue;
                $add('price-remind-' . $r['id'] . '-' . $r['lastRemindedAt'], 'PRICE_REQUEST_REMINDER', 'Reminder: price request ' . $r['requestNo'],
                    ($r['byName'] ?: 'An engineer') . ' is waiting for ' . $r['pending'] . ' price' . ((int) $r['pending'] === 1 ? '' : 's') . ($r['companyName'] ? ' for ' . $r['companyName'] : '') . ((int) $r['remindCount'] > 1 ? ' (reminder ' . $r['remindCount'] . ')' : ''),
                    '/price-requests/#' . $r['id'], $r['lastRemindedAt']);
            }
        }
        foreach (self::rows(
            "SELECT COALESCE(r.batchId, r.id) AS gid, MIN(r.productName) AS productName, COUNT(*) AS n, MAX(r.respondedAt) AS respondedAt,
                    SUM(r.status='APPROVED') AS ok, SUM(r.status='REJECTED') AS bad, MAX(r.approvedPrice) AS approvedPrice, MAX(b.requestNo) AS requestNo
             FROM `PriceRequest` r LEFT JOIN `PriceRequestBatch` b ON b.id = r.batchId
             WHERE r.requestedById=? AND r.respondedAt>? AND r.respondedById<>?
             GROUP BY COALESCE(r.batchId, r.id), r.respondedAt ORDER BY MAX(r.respondedAt) DESC LIMIT $per",
            [$me, $since, $me]) as $r) {
            // Answers saved together (one admin "Save") arrive as one alert.
            $n = (int) $r['n']; $ok = (int) $r['ok']; $bad = (int) $r['bad'];
            $title = $bad === 0 ? 'Price request approved' : ($ok === 0 ? 'Price request rejected' : 'Price request answered');
            $body = $n === 1
                ? $r['productName'] . ($ok ? ' — approved at ₹' . number_format((float) $r['approvedPrice'], 2) : '')
                : ($r['requestNo'] ? $r['requestNo'] . ': ' : '') . $ok . ' approved' . ($bad ? ', ' . $bad . ' rejected' : '');
            $add('price-answer-' . $r['gid'] . '-' . $r['respondedAt'], 'PRICE_REQUEST_ANSWERED', $title, $body, '/price-requests/', $r['respondedAt']);
        }

        // Trials
        if ($isManager) {
            foreach (self::rows(
                "SELECT t.id, t.trialNo, t.customerName, t.component, t.createdAt, u.name AS byName FROM `Trial` t
                 LEFT JOIN `User` u ON u.id = t.requestedById
                 WHERE t.status='PENDING_APPROVAL' AND t.createdAt>? AND t.requestedById<>? ORDER BY t.createdAt DESC LIMIT $per",
                [$since, $me]) as $r) {
                $add('trial-new-' . $r['id'], 'TRIAL_REQUESTED', 'New trial request',
                    $r['trialNo'] . ' · ' . trim(($r['customerName'] ?: '') . ' ' . ($r['component'] ? '— ' . $r['component'] : '')) . ' (by ' . ($r['byName'] ?: '—') . ')',
                    '/trials/#/t/' . rawurlencode($r['id']), $r['createdAt']);
            }
            foreach (self::rows(
                "SELECT t.id, t.trialNo, t.customerName, t.savingsPerYear, t.completedAt FROM `Trial` t
                 WHERE t.status='COMPLETED' AND t.completedAt>? AND t.requestedById<>? ORDER BY t.completedAt DESC LIMIT $per",
                [$since, $me]) as $r) {
                $add('trial-done-' . $r['id'], 'TRIAL_COMPLETED', 'Trial completed',
                    $r['trialNo'] . ' · ' . ($r['customerName'] ?: '') . ($r['savingsPerYear'] !== null ? ' — saving ₹' . number_format((float) $r['savingsPerYear']) . ' / year' : ''),
                    '/trials/#/t/' . rawurlencode($r['id']), $r['completedAt']);
            }
        }
        foreach (self::rows(
            "SELECT t.id, t.trialNo, t.status, t.decidedAt, t.approvalNote FROM `Trial` t
             WHERE t.requestedById=? AND t.decidedAt>? AND t.decidedById<>? AND t.status IN ('APPROVED','REJECTED','COMPLETED')
             ORDER BY t.decidedAt DESC LIMIT $per",
            [$me, $since, $me]) as $r) {
            $rej = $r['status'] === 'REJECTED';
            $add('trial-decided-' . $r['id'] . '-' . $r['decidedAt'], 'TRIAL_DECIDED', $rej ? 'Trial request rejected' : 'Trial request approved',
                $r['trialNo'] . ($rej && $r['approvalNote'] ? ' — ' . mb_substr($r['approvalNote'], 0, 80) : ($rej ? '' : ' — you can run the trial now')),
                '/trials/#/t/' . rawurlencode($r['id']), $r['decidedAt']);
        }

        // Chat messages to me
        try { new ChatController(); } catch (Throwable $e) {}
        foreach (self::rows(
            "SELECT m.id, m.body, m.createdAt, u.name AS fromName, m.fromId FROM `ChatMessage` m LEFT JOIN `User` u ON u.id=m.fromId
             WHERE m.toId=? AND m.createdAt>? AND m.readAt IS NULL ORDER BY m.createdAt DESC LIMIT $per", [$me, $since]) as $r) {
            $add('chat-' . $r['id'], 'CHAT_MESSAGE', 'Message from ' . ($r['fromName'] ?: 'admin'), mb_substr($r['body'], 0, 140), '/chat/#' . rawurlencode($r['fromId']), $r['createdAt']);
        }

        // Late punch-in: requests to admins, decisions back to the employee
        if (is_admin_tier($auth['role'])) {
            foreach (self::rows(
                "SELECT r.id, r.reason, r.createdAt, u.name FROM `PunchRequest` r LEFT JOIN `User` u ON u.id=r.userId
                 WHERE r.status='PENDING' AND r.createdAt>? AND r.userId<>? ORDER BY r.createdAt DESC LIMIT $per", [$since, $me]) as $r) {
                $add('late-punch-' . $r['id'], 'LATE_PUNCH_REQUEST', ($r['name'] ?: 'Employee') . ' wants to punch in late',
                    mb_substr($r['reason'], 0, 140) . ' — approve on the Attendance page', '/attendance/', $r['createdAt']);
            }
        }
        foreach (self::rows(
            "SELECT r.id, r.status, r.adminNote, r.decidedAt FROM `PunchRequest` r WHERE r.userId=? AND r.decidedAt>? ORDER BY r.decidedAt DESC LIMIT $per", [$me, $since]) as $r) {
            $add('late-punch-dec-' . $r['id'], 'LATE_PUNCH_DECIDED', $r['status'] === 'APPROVED' ? 'Punch-in released' : 'Late punch-in rejected',
                $r['status'] === 'APPROVED' ? 'Your request was approved — punch in now.' : ($r['adminNote'] ?: 'Your request was rejected.'), '/attendance/', $r['decidedAt']);
        }

        // Trial PDFs sent to admin (existing data on raising, comparison on completion)
        if ($isManager) {
            foreach (self::rows(
                "SELECT f.id, f.kind, f.createdAt, t.id AS tid, t.trialNo, t.customerName, u.name AS byName FROM `TrialFile` f
                 JOIN `Trial` t ON t.id=f.trialId LEFT JOIN `User` u ON u.id=f.uploadedById
                 WHERE f.createdAt>? AND f.uploadedById<>? ORDER BY f.createdAt DESC LIMIT $per", [$since, $me]) as $r) {
                $add('trial-file-' . $r['id'], 'TRIAL_PDF', ($r['kind'] === 'CMP' ? 'Trial comparison PDF' : 'Existing data PDF') . ' received',
                    $r['trialNo'] . ' · ' . ($r['customerName'] ?: '') . ' — from ' . ($r['byName'] ?: 'engineer') . ', open it on the trial',
                    '/trials/#/t/' . rawurlencode($r['tid']), $r['createdAt']);
            }
        }
        // DC approved for my trial
        foreach (self::rows(
            "SELECT t.id, t.trialNo, t.dcDate, t.dcApprovedAt FROM `Trial` t WHERE t.requestedById=? AND t.dcApprovedAt>? AND t.dcApprovedById<>? ORDER BY t.dcApprovedAt DESC LIMIT $per",
            [$me, $since, $me]) as $r) {
            $add('trial-dc-' . $r['id'] . '-' . $r['dcApprovedAt'], 'TRIAL_DECIDED', 'DC approved',
                $r['trialNo'] . ' — trial on ' . date('d M Y', strtotime($r['dcDate'])) . '. Fill the comparison after the trial.',
                '/trials/#/t/' . rawurlencode($r['id']) . '/savings', $r['dcApprovedAt']);
        }

        // Leave (make sure the permission-hours columns exist before selecting them)
        try { new LeaveController(); } catch (Throwable $e) {}
        $what = fn($r) => ($r['leaveType'] === 'PERMISSION' ? 'permission ' . ($r['fromTime'] ?? '') . '–' . ($r['toTime'] ?? '') . ' (' . rtrim(rtrim(number_format((float) ($r['hours'] ?? 0), 2), '0'), '.') . ' h)'
                         : strtolower(LeaveController::LABELS[$r['leaveType']] ?? str_replace('_', ' ', $r['leaveType']) . ' leave'));
        if ($isManager) {
            foreach (self::rows(
                "SELECT l.id, l.leaveType, l.fromDate, l.toDate, l.totalDays, l.fromTime, l.toTime, l.hours, l.createdAt, u.name AS byName FROM `Leave` l
                 LEFT JOIN `User` u ON u.id = l.userId
                 WHERE l.status='PENDING' AND l.createdAt>? AND l.userId<>? ORDER BY l.createdAt DESC LIMIT $per",
                [$since, $me]) as $r) {
                $add('leave-new-' . $r['id'], 'LEAVE_REQUESTED', $r['leaveType'] === 'PERMISSION' ? 'New permission request' : 'New leave request',
                    ($r['byName'] ?: 'Someone') . ' · ' . $what($r) . ($r['leaveType'] === 'PERMISSION' ? '' : ', ' . self::days($r['totalDays'])) .
                    ' (' . self::dmy($r['fromDate']) . ($r['toDate'] && substr($r['toDate'], 0, 10) !== substr($r['fromDate'], 0, 10) ? ' – ' . self::dmy($r['toDate']) : '') . ')',
                    '/leaves/', $r['createdAt']);
            }
        }
        foreach (self::rows(
            "SELECT l.id, l.leaveType, l.status, l.fromDate, l.fromTime, l.toTime, l.hours, l.approvedAt, l.adminNote FROM `Leave` l
             WHERE l.userId=? AND l.approvedAt>? AND l.status IN ('APPROVED','REJECTED') AND (l.approvedById IS NULL OR l.approvedById<>?)
             ORDER BY l.approvedAt DESC LIMIT $per",
            [$me, $since, $me]) as $r) {
            $ok = $r['status'] === 'APPROVED';
            $noun = $r['leaveType'] === 'PERMISSION' ? 'Permission' : 'Leave';
            $add('leave-decided-' . $r['id'] . '-' . $r['approvedAt'], 'LEAVE_DECIDED', $noun . ($ok ? ' approved' : ' rejected'),
                'Your ' . $what($r) . ' on ' . self::dmy($r['fromDate']) . ($r['adminNote'] ? ' — ' . mb_substr($r['adminNote'], 0, 80) : ''),
                '/leaves/', $r['approvedAt']);
        }

        // Breaks & location (Super Admin)
        if ($isSuper) {
            foreach (self::rows(
                "SELECT b.id, b.breakType, b.triggerType, b.startedAt, u.name AS whoName FROM `AttendanceBreak` b
                 LEFT JOIN `User` u ON u.id = b.userId
                 WHERE b.startedAt>? AND b.userId<>? ORDER BY b.startedAt DESC LIMIT $per",
                [$since, $me]) as $r) {
                $add('break-' . $r['id'], 'BREAK_STARTED', ($r['breakType'] === 'LUNCH' ? 'Lunch' : 'Tea') . ' break started',
                    ($r['whoName'] ?: 'Someone') . ' started a ' . strtolower($r['breakType']) . ' break' . ($r['triggerType'] === 'AUTO' ? ' (after 30+ min in one place)' : ''),
                    '/admin/location-history/', $r['startedAt']);
            }
            foreach (self::rows(
                "SELECT s.id, s.eventType, s.minutes, s.detectedAt, u.name AS whoName FROM `StationaryLog` s
                 LEFT JOIN `User` u ON u.id = s.userId
                 WHERE s.detectedAt>? AND s.userId<>? ORDER BY s.detectedAt DESC LIMIT $per",
                [$since, $me]) as $r) {
                $who = $r['whoName'] ?: 'Someone';
                if ($r['eventType'] === 'LOCATION_OFF') {
                    $add('loc-off-' . $r['id'], 'LOCATION_OFF', 'Location turned off', $who . ' is punched in but location is off — tracking is paused', '/admin/location-history/', $r['detectedAt']);
                } else {
                    $add('stationary-' . $r['id'], 'STATIONARY', 'In one place for ' . (int) $r['minutes'] . '+ min',
                        $who . ($r['eventType'] === 'STATIONARY_WORKING' ? ' says it is not a break (working there)' : ' did not answer the break prompt'),
                        '/admin/location-history/', $r['detectedAt']);
                }
            }
        }

        // Stock reminders (Manager and up): an item that just fell to / below its
        // minimum or ran out, plus one morning summary per day while any are low.
        if (is_admin_tier($auth['role'])) {
            try {
                StockLedger::ensure();
                foreach (self::rows(
                    "SELECT id, itemCode, itemName, brand, availableStock, minimumStock, lastUpdated FROM `Stock`
                     WHERE isActive=1 AND lastUpdated>? AND (availableStock<=0 OR (minimumStock>0 AND availableStock<=minimumStock))
                     ORDER BY lastUpdated DESC LIMIT $per", [$since]) as $r) {
                    $out = (float) $r['availableStock'] <= 0;
                    $add('stock-low-' . $r['id'] . '-' . $r['lastUpdated'], 'STOCK_LOW', $out ? 'Out of stock' : 'Low stock',
                        $r['itemCode'] . ' · ' . $r['itemName'] . ($r['brand'] ? ' (' . $r['brand'] . ')' : '') . ' — ' . rtrim(rtrim(number_format((float) $r['availableStock'], 2), '0'), '.') . ' left' . ((float) $r['minimumStock'] > 0 ? ', minimum ' . rtrim(rtrim(number_format((float) $r['minimumStock'], 2), '0'), '.') : ''),
                        '/stock/?status=' . ($out ? 'out' : 'low'), $r['lastUpdated']);
                }
                $morning = date('Y-m-d') . ' 09:30:00';
                if (date('Y-m-d H:i:s') >= $morning && $morning > $since) {
                    $c = self::rows("SELECT SUM(availableStock<=0) AS outN, SUM(availableStock>0 AND minimumStock>0 AND availableStock<=minimumStock) AS lowN
                                     FROM `Stock` WHERE isActive=1 AND (minimumStock>0 OR availableStock<0)", [])[0] ?? null;
                    if ($c && ((int) $c['outN'] + (int) $c['lowN']) > 0) {
                        $add('stock-daily-' . date('Y-m-d'), 'STOCK_LOW', 'Stock reminder',
                            (int) $c['lowN'] . ' item' . ((int) $c['lowN'] === 1 ? '' : 's') . ' low and ' . (int) $c['outN'] . ' out of stock — reorder before they run out.',
                            '/stock/?status=low', $morning);
                    }
                }
                // Saturday: check all the stock (9:30), and a second nudge at 4 pm if nobody marked it done.
                if (date('N') === '6') {
                    $sat = date('Y-m-d');
                    $doneS = db()->prepare('SELECT COUNT(*) FROM `StockCheck` WHERE checkDate=?'); $doneS->execute([$sat]);
                    $isDone = (int) $doneS->fetchColumn() > 0;
                    foreach ([['09:30:00', 'stock-check-', 'Saturday stock check', 'Check all the stock today — hand stock, local stock (every city) and state stock — and update the Stock page. Press "Mark stock check done" when finished.'],
                              ['16:00:00', 'stock-check-late-', 'Stock check not done yet', 'Today\'s Saturday stock check hasn\'t been marked done. Please check all the stock before closing.']] as $i => [$at, $idp, $title, $body]) {
                        $when = "$sat $at";
                        if ($i === 1 && $isDone) continue;
                        if (date('Y-m-d H:i:s') >= $when && $when > $since) $add($idp . $sat, 'STOCK_CHECK', $title, $body, '/stock/', $when);
                    }
                }
            } catch (Throwable $e) { error_log('Stock alerts: ' . $e->getMessage()); }
        }

        usort($ev, fn($a, $b) => strcmp($b['at'], $a['at']));
        return $ev;
    }

    private static function dmy(?string $d): string
    {
        return $d ? date('j M', strtotime($d)) : '';
    }
    private static function days($n): string
    {
        $n = (float) $n;
        return rtrim(rtrim(number_format($n, 1), '0'), '.') . ($n == 1 ? ' day' : ' days');
    }
}

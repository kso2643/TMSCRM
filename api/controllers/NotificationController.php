<?php
/**
 * Module 10 — Notifications: Salary Processing Due, Recovery Pending,
 * Advance Completed, Advance Overdue, Employee Birthday, Probation
 * Completion.
 *
 * There's no cron/scheduler anywhere in this codebase, so "due" conditions
 * are computed fresh each time index() is called (generate() below),
 * with a UNIQUE dedupeKey so the same condition never creates duplicate
 * rows — same check-then-insert-with-catch approach already used for
 * meeting follow-up alerts (MeetingController).
 *
 * Notifications are generated for whichever admin-tier user calls
 * index() — there's no "all admins" broadcast concept anywhere else in
 * this app either, so this mirrors the existing per-user alert model
 * rather than inventing a new one.
 *
 * IMPORTANT — what this does NOT do: send email or push/browser
 * notifications. There is no mailer (no PHPMailer/SMTP config, no
 * "from" address) anywhere in this codebase, and browser push needs a
 * service worker + subscription flow that's a frontend concern. This
 * only maintains the in-app "Dashboard Notification" bell data — see the
 * response for what you'd still need to add for email/push delivery.
 *
 * "Probation Completion" — the spec doesn't state a probation length, so
 * PROBATION_MONTHS below defaults to 6. Change it if your policy differs.
 */
class NotificationController
{
    private const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    private const PROBATION_MONTHS = 6;

    private function insertIfNew(string $forUserId, string $type, string $title, string $message, ?string $relatedType, ?string $relatedId, string $dedupeKey): void
    {
        try {
            db()->prepare(
                'INSERT INTO `Notification` (id,userId,type,title,message,relatedType,relatedId,dedupeKey,isRead,createdAt)
                 VALUES (?,?,?,?,?,?,?,?,0,?)'
            )->execute([gen_id(), $forUserId, $type, $title, $message, $relatedType, $relatedId, $dedupeKey, now_sql()]);
        } catch (PDOException $e) {
            // dedupeKey collision — this condition was already notified. Fine, skip it.
        }
    }

    private function generate(string $forUserId): void
    {
        $db = db();
        $today = new DateTime();
        $year = (int) $today->format('Y'); $month = (int) $today->format('n'); $day = (int) $today->format('j');
        $todayStr = $today->format('Y-m-d');

        // 1. Salary Processing Due — only once we're close to month-end, so
        //    this doesn't fire uselessly on the 1st of every month.
        if ($day >= 25) {
            $s = $db->prepare(
                'SELECT COUNT(*) FROM `User` u WHERE u.isActive=1
                 AND NOT EXISTS (SELECT 1 FROM `Payroll` p WHERE p.userId=u.id AND p.year=? AND p.month=?)'
            );
            $s->execute([$year, $month]);
            $pending = (int) $s->fetchColumn();
            if ($pending > 0) {
                $this->insertIfNew($forUserId, 'SALARY_PROCESSING_DUE', 'Salary processing due',
                    "$pending employee(s) still need payroll processed for " . self::MONTHS_FULL[$month - 1] . " $year.",
                    null, null, "SALARY_PROCESSING_DUE:$forUserId:$year:$month");
            }
        }

        // 2. Recovery Pending — active monthly-fixed advances not yet
        //    processed for the current month.
        $s = $db->prepare(
            "SELECT sa.id, u.name FROM `SalaryAdvance` sa JOIN `User` u ON u.id=sa.userId
             WHERE sa.status='ACTIVE' AND sa.recoveryType='MONTHLY_FIXED'
               AND NOT EXISTS (SELECT 1 FROM `AdvanceRecovery` ar WHERE ar.advanceId=sa.id AND ar.month=? AND ar.year=?)"
        );
        $s->execute([$month, $year]);
        foreach ($s->fetchAll() as $row) {
            $this->insertIfNew($forUserId, 'RECOVERY_PENDING', 'Recovery pending',
                "{$row['name']}'s advance recovery for this month hasn't been processed yet.",
                'SalaryAdvance', $row['id'], "RECOVERY_PENDING:{$row['id']}:$year:$month");
        }

        // 3. Advance Completed — became COMPLETED recently (no separate
        //    "notified" flag on SalaryAdvance, so this uses a 1-day recency
        //    window on updatedAt as a reasonable proxy).
        $s = $db->prepare("SELECT id,userId FROM `SalaryAdvance` WHERE status='COMPLETED' AND updatedAt >= ?");
        $s->execute([(new DateTime('-1 day'))->format('Y-m-d H:i:s')]);
        foreach ($s->fetchAll() as $row) {
            $n = $db->prepare('SELECT name FROM `User` WHERE id=?'); $n->execute([$row['userId']]);
            $name = $n->fetchColumn() ?: 'An employee';
            $this->insertIfNew($forUserId, 'ADVANCE_COMPLETED', 'Advance completed',
                "$name has fully repaid their salary advance.", 'SalaryAdvance', $row['id'], "ADVANCE_COMPLETED:{$row['id']}");
        }

        // 4. Advance Overdue — active advances past their projected closing date.
        $s = $db->query(
            "SELECT sa.*, u.name FROM `SalaryAdvance` sa JOIN `User` u ON u.id=sa.userId
             WHERE sa.status='ACTIVE' AND sa.recoveryType='MONTHLY_FIXED'"
        );
        foreach ($s->fetchAll() as $row) {
            $lastStmt = $db->prepare('SELECT month,year FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year DESC, month DESC LIMIT 1');
            $lastStmt->execute([$row['id']]);
            $last = $lastStmt->fetch();
            $proj = calc_advance_projection($row, $last['month'] ?? null, $last['year'] ?? null);
            if ($proj['expectedClosingDate'] && $proj['expectedClosingDate'] < $todayStr) {
                $this->insertIfNew($forUserId, 'ADVANCE_OVERDUE', 'Advance overdue',
                    "{$row['name']}'s advance is past its expected closing date.",
                    'SalaryAdvance', $row['id'], "ADVANCE_OVERDUE:{$row['id']}:" . $today->format('Y-m'));
            }
        }

        // 5. Employee Birthday.
        $s = $db->prepare('SELECT id,name FROM `User` WHERE isActive=1 AND dateOfBirth IS NOT NULL AND MONTH(dateOfBirth)=? AND DAY(dateOfBirth)=?');
        $s->execute([$month, $day]);
        foreach ($s->fetchAll() as $row) {
            $this->insertIfNew($forUserId, 'EMPLOYEE_BIRTHDAY', 'Employee birthday',
                "Today is {$row['name']}'s birthday!", 'User', $row['id'], "EMPLOYEE_BIRTHDAY:{$row['id']}:$year");
        }

        // 6. Probation Completion (see class header re: the assumed length).
        $s = $db->prepare(
            'SELECT id,name FROM `User` WHERE isActive=1 AND dateOfJoining IS NOT NULL
             AND DATE_ADD(dateOfJoining, INTERVAL ' . self::PROBATION_MONTHS . ' MONTH) = ?'
        );
        $s->execute([$todayStr]);
        foreach ($s->fetchAll() as $row) {
            $this->insertIfNew($forUserId, 'PROBATION_COMPLETION', 'Probation completion',
                "{$row['name']}'s probation period ends today.", 'User', $row['id'], "PROBATION_COMPLETION:{$row['id']}");
        }
    }

    // GET /api/notifications
    public function index(): void
    {
        $auth = authenticate(); require_admin($auth);
        $this->generate($auth['id']);

        $s = db()->prepare('SELECT * FROM `Notification` WHERE userId=? AND isRead=0 ORDER BY createdAt DESC LIMIT 50');
        $s->execute([$auth['id']]);
        $rows = array_map(function ($r) { $r['isRead'] = (bool) $r['isRead']; return $r; }, $s->fetchAll());
        sendSuccess(['notifications' => $rows, 'count' => count($rows)]);
    }

    // PATCH /api/notifications/:id/read
    public function markRead(string $id): void
    {
        $auth = authenticate();
        $s = db()->prepare('UPDATE `Notification` SET isRead=1 WHERE id=? AND userId=?');
        $s->execute([$id, $auth['id']]);
        if ($s->rowCount() === 0) sendError('Notification not found.', 404);
        sendSuccess([], 'Marked as read');
    }
}

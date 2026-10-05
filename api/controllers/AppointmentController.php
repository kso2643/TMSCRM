<?php
class AppointmentController
{
    public function __construct()
    {
        // Creates the Appointment tables if migration_appointments.sql was never
        // run (or failed) on this database — see includes/SchemaGuard.php.
        $schema = schema_from_sql_file(BASE_PATH . '/database/migration_appointments.sql');
        // A visit booked for several days is one row per day sharing a seriesId.
        if (isset($schema['Appointment'])) $schema['Appointment']['columns'] = [
            'seriesId'  => 'VARCHAR(30) NULL',
            'seriesDay' => 'INT NULL',
            'seriesLen' => 'INT NULL',
        ];
        ensure_schema($schema, 'migration_appointments.sql');
    }

    private const MAX_SERIES_DAYS = 31;

    private const VALID_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'RESCHEDULED'];

    // Evening threshold (24h, server/IST time) at which the "day before" reminder
    // becomes due. Easy to retune if the team wants an earlier/later heads-up.
    private const EVENING_HOUR = 18;

    // GET /api/appointments/meta
    public function meta(): void
    {
        authenticate();
        sendSuccess(['statuses' => self::VALID_STATUSES]);
    }

    // GET /api/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD&mine=1&assignedToId=&customerId=&status=
    // Powers both the monthly grid (from/to = first/last day of the month) and the day
    // view (from=to=that day) with a single call. Every authenticated user can see the
    // full calendar — same visibility MeetingController::index() already gives everyone
    // on Meetings — so a small team can see who's booked when. Pass mine=1 to narrow to
    // "my appointments" (assigned to the caller).
    public function index(): void
    {
        $auth = authenticate();
        $from = qp('from', '');
        $to   = qp('to', '');
        if (!$from || !$to) sendError('from and to date are required.', 400);

        $where = ['a.appointmentDate BETWEEN ? AND ?'];
        $params = [$from, $to];

        if (qp('mine')) { $where[] = 'a.assignedToId=?'; $params[] = $auth['id']; }
        $assignedToId = qp('assignedToId', '');
        if ($assignedToId) { $where[] = 'a.assignedToId=?'; $params[] = $assignedToId; }
        $customerId = qp('customerId', '');
        if ($customerId) { $where[] = 'a.customerId=?'; $params[] = $customerId; }
        $status = qp('status', '');
        if ($status) { $where[] = 'a.status=?'; $params[] = $status; }

        $w = 'WHERE ' . implode(' AND ', $where);
        $s = db()->prepare(
            "SELECT a.*,
                    c.id AS c_id, c.companyName, c.contactPerson, c.contactNumber, c.location AS c_location,
                    c.address AS c_address, c.lat AS c_lat, c.lng AS c_lng,
                    u.id AS u_id, u.name AS u_name,
                    e.id AS e_id, e.name AS e_name, e.role AS e_role
             FROM `Appointment` a
             LEFT JOIN `Customer` c ON c.id=a.customerId
             LEFT JOIN `User` u ON u.id=a.userId
             LEFT JOIN `User` e ON e.id=a.assignedToId
             $w
             ORDER BY a.appointmentDate ASC, a.appointmentTime ASC"
        );
        $s->execute($params);
        $rows = $s->fetchAll();
        sendSuccess(['appointments' => array_map([$this, 'shape'], $rows)]);
    }

    // GET /api/appointments/:id
    public function show(string $id, int $statusCode = 200): void
    {
        authenticate();
        $row = $this->fetchRow($id);
        if (!$row) sendError('Appointment not found.', 404);
        sendSuccess(['appointment' => $this->shape($row)], 'Success', $statusCode);
    }

    // GET /api/appointments/engineers
    // Lightweight, non-admin-gated list for the assign dropdown (unlike GET /api/users,
    // which is admin-only) — any authenticated user needs this to assign or self-assign.
    // Sales-engineer role sorts first since that's who "engineer" usually means here, but
    // every active user is included: some businesses also send a manager on visits.
    public function engineers(): void
    {
        authenticate();
        $s = db()->query(
            "SELECT id, name, role, department FROM `User` WHERE isActive=1
             ORDER BY (role='SALES_ENGINEER') DESC, name ASC"
        );
        sendSuccess(['engineers' => $s->fetchAll()]);
    }

    // POST /api/appointments
    public function create(): void
    {
        $auth = authenticate();
        $b = request_body();
        $customerId = trim((string)($b['customerId'] ?? ''));
        $title      = trim((string)($b['title'] ?? ''));
        // One or more visit days: appointmentDates[] (multi-day) or appointmentDate.
        $dates = [];
        foreach ((array) ($b['appointmentDates'] ?? []) as $d) { $d = to_date_only($d); if ($d) $dates[$d] = true; }
        if (!$dates && ($d = to_date_only($b['appointmentDate'] ?? null))) $dates[$d] = true;
        $dates = array_keys($dates); sort($dates);
        $date  = $dates[0] ?? null;
        if (!$customerId || !$title || !$date)
            sendError('Customer, title, and appointment date are required.', 400);
        if (count($dates) > self::MAX_SERIES_DAYS) sendError('Pick at most ' . self::MAX_SERIES_DAYS . ' visit days at a time.', 400);

        $cs = db()->prepare('SELECT companyName FROM `Customer` WHERE id=? AND isActive=1 LIMIT 1');
        $cs->execute([$customerId]);
        $customer = $cs->fetch();
        if (!$customer) sendError('Customer not found.', 404);

        // Self-assign by default: no assignedToId in the request means "assign to me".
        $assignedToId = trim((string)($b['assignedToId'] ?? '')) ?: $auth['id'];
        $us = db()->prepare('SELECT id FROM `User` WHERE id=? AND isActive=1 LIMIT 1');
        $us->execute([$assignedToId]);
        if (!$us->fetch()) sendError('Assigned engineer not found.', 404);

        $status = $b['status'] ?? 'SCHEDULED';
        if (!in_array($status, self::VALID_STATUSES)) sendError('Invalid status.', 400);

        $n = count($dates);
        $seriesId = $n > 1 ? gen_id() : null;
        $ids = [];
        $ins = db()->prepare(
            'INSERT INTO `Appointment`
             (id,customerId,userId,assignedToId,title,appointmentDate,appointmentTime,status,notes,seriesId,seriesDay,seriesLen,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        );
        db()->beginTransaction();
        foreach ($dates as $i => $d) {
            $ids[] = $id = gen_id();
            $ins->execute([
                $id, $customerId, $auth['id'], $assignedToId, $title, $d,
                $b['appointmentTime'] ?? null, $status, $b['notes'] ?? null,
                $seriesId, $seriesId ? $i + 1 : null, $seriesId ? $n : null,
                now_sql(), now_sql(),
            ]);
        }
        db()->commit();

        // One assignment ping for the visit; every day still gets its own evening-before reminder.
        $this->notifyAssignment($ids[0], $assignedToId, $auth['id'], $customer['companyName']);
        log_activity($auth['id'], 'APPOINTMENT_CREATED', 'Appointment', $ids[0],
            ['customer' => $customer['companyName'], 'date' => $date, 'days' => $n > 1 ? $dates : null]);
        if ($n === 1) $this->show($ids[0], 201);
        $out = array_map(fn($x) => $this->shape($this->fetchRow($x)), $ids);
        sendSuccess(['appointment' => $out[0], 'appointments' => $out, 'seriesId' => $seriesId],
            "$n visit days booked — a reminder goes out the evening before each day.", 201);
    }

    // PUT /api/appointments/:id
    public function update(string $id): void
    {
        $auth = authenticate();
        $b = request_body();
        $isAdmin = is_admin_tier($auth['role']);

        $existing = $this->fetchRow($id);
        if (!$existing) sendError('Appointment not found.', 404);
        $isOwner = $existing['userId'] === $auth['id'] || $existing['assignedToId'] === $auth['id'];
        if (!$isAdmin && !$isOwner)
            sendError('Can only edit your own or assigned appointments.', 403);

        $sets = []; $params = [];
        if (!empty($b['title']))           { $sets[]='title=?';           $params[]=$b['title']; }
        if (!empty($b['appointmentDate'])) { $sets[]='appointmentDate=?'; $params[]=to_date_only($b['appointmentDate']); }
        if (array_key_exists('appointmentTime', $b)) { $sets[]='appointmentTime=?'; $params[]=$b['appointmentTime']; }
        if (!empty($b['status'])) {
            if (!in_array($b['status'], self::VALID_STATUSES)) sendError('Invalid status.', 400);
            $sets[]='status=?'; $params[]=$b['status'];
        }
        if (array_key_exists('notes', $b)) { $sets[]='notes=?'; $params[]=$b['notes']; }
        if (!empty($b['customerId']) && $b['customerId'] !== $existing['customerId']) {
            $cs = db()->prepare('SELECT id FROM `Customer` WHERE id=? AND isActive=1 LIMIT 1');
            $cs->execute([$b['customerId']]);
            if (!$cs->fetch()) sendError('Customer not found.', 404);
            $sets[]='customerId=?'; $params[]=$b['customerId'];
        }

        if ($sets) {
            $sets[] = 'updatedAt=?'; $params[] = now_sql(); $params[] = $id;
            db()->prepare('UPDATE `Appointment` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);
        }

        if (array_key_exists('assignedToId', $b)) {
            $newAssignee = $b['assignedToId'] ?: null;
            if ($newAssignee && $newAssignee !== $existing['assignedToId']) {
                $us = db()->prepare('SELECT id FROM `User` WHERE id=? AND isActive=1 LIMIT 1');
                $us->execute([$newAssignee]);
                if (!$us->fetch()) sendError('Assigned engineer not found.', 404);
                db()->prepare('UPDATE `Appointment` SET assignedToId=?, updatedAt=? WHERE id=?')
                    ->execute([$newAssignee, now_sql(), $id]);
                $cs = db()->prepare('SELECT companyName FROM `Customer` WHERE id=? LIMIT 1');
                $cs->execute([$existing['customerId']]);
                $companyName = $cs->fetch()['companyName'] ?? null;
                $this->notifyAssignment($id, $newAssignee, $auth['id'], $companyName);
            }
        }

        $this->show($id);
    }

    // DELETE /api/appointments/:id
    public function delete(string $id): void
    {
        $auth = authenticate();
        $isAdmin = is_admin_tier($auth['role']);
        $existing = $this->fetchRow($id);
        if (!$existing) sendError('Appointment not found.', 404);
        if (!$isAdmin && $existing['userId'] !== $auth['id'])
            sendError('Can only delete appointments you created.', 403);

        // ?series=1 removes every day of a multi-day visit (that hasn't happened yet or not).
        if (qp('series') && !empty($existing['seriesId'])) {
            $s = db()->prepare('SELECT id FROM `Appointment` WHERE seriesId=?'); $s->execute([$existing['seriesId']]);
            $ids = array_column($s->fetchAll(), 'id');
            $in = implode(',', array_fill(0, count($ids), '?'));
            db()->prepare("DELETE FROM `AppointmentAlert` WHERE appointmentId IN ($in)")->execute($ids);
            db()->prepare("DELETE FROM `Appointment` WHERE id IN ($in)")->execute($ids);
            log_activity($auth['id'], 'APPOINTMENT_DELETED', 'Appointment', $id, ['series' => count($ids)]);
            sendSuccess(['deleted' => count($ids)], count($ids) . ' visit days deleted.');
        }
        db()->prepare('DELETE FROM `AppointmentAlert` WHERE appointmentId=?')->execute([$id]);
        db()->prepare('DELETE FROM `Appointment` WHERE id=?')->execute([$id]);
        log_activity($auth['id'], 'APPOINTMENT_DELETED', 'Appointment', $id, null);
        sendSuccess([], 'Appointment deleted.');
    }

    // GET /api/appointments/reminders
    // Generates (idempotently) and returns this user's due alerts: anything assigned to
    // them for tomorrow, from EVENING_HOUR onward the evening before, plus anything for
    // today they haven't seen yet (covers someone opening the CRM late, or the morning
    // of, having missed last night's window). The CRM polls this every few minutes while
    // it's open and plays a sound the first time a new alert appears — see
    // appointments-reminder-app.js. There's no push/SMS here: this only fires while a
    // browser tab with the CRM open is running, the same trade-off already documented for
    // this codebase's other in-app alerts (FollowUpAlert, Notification — see
    // NotificationController.php's header comment).
    public function reminders(): void
    {
        $auth = authenticate();
        $this->generateReminders($auth['id']);

        $s = db()->prepare(
            "SELECT al.*, a.title, a.appointmentDate, a.appointmentTime, a.seriesDay, a.seriesLen, c.companyName
             FROM `AppointmentAlert` al
             JOIN `Appointment` a ON a.id=al.appointmentId
             LEFT JOIN `Customer` c ON c.id=a.customerId
             WHERE al.userId=? AND al.isRead=0
             ORDER BY al.createdAt DESC LIMIT 20"
        );
        $s->execute([$auth['id']]);
        sendSuccess(['alerts' => $s->fetchAll()]);
    }

    // PATCH /api/appointments/alerts/:id/read
    public function markAlertRead(string $id): void
    {
        $auth = authenticate();
        db()->prepare('UPDATE `AppointmentAlert` SET isRead=1 WHERE id=? AND userId=?')
            ->execute([$id, $auth['id']]);
        sendSuccess([], 'Marked read.');
    }

    // ── Private helpers ───────────────────────────────────────────────
    private function fetchRow(string $id)
    {
        $s = db()->prepare(
            "SELECT a.*,
                    c.id AS c_id, c.companyName, c.contactPerson, c.contactNumber, c.location AS c_location,
                    c.address AS c_address, c.lat AS c_lat, c.lng AS c_lng,
                    u.id AS u_id, u.name AS u_name,
                    e.id AS e_id, e.name AS e_name, e.role AS e_role
             FROM `Appointment` a
             LEFT JOIN `Customer` c ON c.id=a.customerId
             LEFT JOIN `User` u ON u.id=a.userId
             LEFT JOIN `User` e ON e.id=a.assignedToId
             WHERE a.id=? LIMIT 1"
        );
        $s->execute([$id]);
        return $s->fetch();
    }

    private function generateReminders(string $userId): void
    {
        $today = date('Y-m-d');
        $tomorrow = date('Y-m-d', strtotime('+1 day'));
        $hour = (int) date('G');

        $dueDates = [$today]; // always catch up on today's appointments if unseen
        if ($hour >= self::EVENING_HOUR) $dueDates[] = $tomorrow;

        $s = db()->prepare(
            "SELECT id FROM `Appointment`
             WHERE assignedToId=? AND appointmentDate IN (?,?) AND status='SCHEDULED'"
        );
        $s->execute([$userId, $dueDates[0], $dueDates[1] ?? $dueDates[0]]);
        foreach ($s->fetchAll() as $appt) {
            try {
                db()->prepare(
                    "INSERT INTO `AppointmentAlert` (id,appointmentId,userId,alertType,isRead,createdAt)
                     VALUES (?,?,?,'REMINDER_EVENING_BEFORE',0,?)"
                )->execute([gen_id(), $appt['id'], $userId, now_sql()]);
            } catch (\Throwable $e) { /* already sent — unique key stops the duplicate */ }
        }
    }

    private function notifyAssignment(string $appointmentId, string $assignedToId, string $assignedById, ?string $companyName = null): void
    {
        if (!$assignedToId || $assignedToId === $assignedById) return; // no self-assign alert
        try {
            db()->prepare(
                "INSERT INTO `AppointmentAlert` (id,appointmentId,userId,alertType,isRead,createdAt)
                 VALUES (?,?,?,'TASK_ASSIGNED',0,?)"
            )->execute([gen_id(), $appointmentId, $assignedToId, now_sql()]);
            log_activity($assignedById, 'APPOINTMENT_ASSIGNED', 'Appointment', $appointmentId,
                ['assignedTo' => $assignedToId, 'customer' => $companyName]);
        } catch (\Throwable $e) { /* non-fatal, don't block the request */ }
    }

    private function shape(array $row): array
    {
        $row['customer'] = [
            'id'            => $row['c_id'] ?? $row['customerId'],
            'companyName'   => $row['companyName'] ?? null,
            'contactPerson' => $row['contactPerson'] ?? null,
            'contactNumber' => $row['contactNumber'] ?? null,
            'location'      => $row['c_location'] ?? null,
            'address'       => $row['c_address'] ?? null,
            'lat'           => isset($row['c_lat']) && $row['c_lat'] !== null ? (float)$row['c_lat'] : null,
            'lng'           => isset($row['c_lng']) && $row['c_lng'] !== null ? (float)$row['c_lng'] : null,
        ];
        $row['user']       = ['id' => $row['u_id'] ?? null, 'name' => $row['u_name'] ?? null];
        $row['assignedTo'] = ($row['e_id'] ?? null) ? ['id' => $row['e_id'], 'name' => $row['e_name'], 'role' => $row['e_role']] : null;
        foreach (['c_id','companyName','contactPerson','contactNumber','c_location','c_address','c_lat','c_lng','u_id','u_name','e_id','e_name','e_role'] as $k) unset($row[$k]);
        return $row;
    }
}

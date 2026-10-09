<?php
class AttendanceController
{
    // Punch-in window (server / IST time): on time until 09:30, late (grace) until 09:45.
    // After 09:45 punching in is locked until an admin approves a request with a reason.
    public const ON_TIME_UNTIL = '09:30';
    public const GRACE_UNTIL   = '09:45';

    public function __construct()
    {
        ensure_schema([
            'Attendance' => ['create' => '', 'columns' => [
                'checkInPhoto' => 'VARCHAR(120) NULL', 'checkOutPhoto' => 'VARCHAR(120) NULL', 'lateMinutes' => 'INT NULL', 'lateRequestId' => 'VARCHAR(30) NULL',
            ]],
            'PunchRequest' => ['create' => "CREATE TABLE IF NOT EXISTS `PunchRequest` (
  `id` VARCHAR(30) NOT NULL, `userId` VARCHAR(30) NOT NULL, `date` DATE NOT NULL, `reason` TEXT NOT NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'PENDING', `adminNote` TEXT NULL, `decidedById` VARCHAR(30) NULL, `decidedAt` DATETIME NULL,
  `createdAt` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`), KEY `PunchRequest_user_date_idx` (`userId`, `date`), KEY `PunchRequest_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"],
        ], 'Attendance punch-in window');
    }

    private static function nowTs(): int { return time(); }

    /** Where now falls in today's punch-in window: ON_TIME | GRACE | LOCKED, plus today's late request. */
    private function window(string $userId): array
    {
        $now = date('H:i', self::nowTs());
        $phase = $now < self::ON_TIME_UNTIL ? 'ON_TIME' : ($now < self::GRACE_UNTIL ? 'GRACE' : 'LOCKED');
        $s = db()->prepare('SELECT r.*, u.name AS decidedByName FROM `PunchRequest` r LEFT JOIN `User` u ON u.id=r.decidedById WHERE r.userId=? AND r.date=? ORDER BY FIELD(r.status,\'APPROVED\',\'PENDING\',\'REJECTED\'), r.createdAt DESC LIMIT 1');
        $s->execute([$userId, date('Y-m-d')]);
        $req = $s->fetch() ?: null;
        return ['now' => date('H:i:s', self::nowTs()), 'onTimeUntil' => self::ON_TIME_UNTIL, 'graceUntil' => self::GRACE_UNTIL, 'phase' => $phase,
                'request' => $req, 'canPunchIn' => $phase !== 'LOCKED' || ($req && $req['status'] === 'APPROVED')];
    }

    // A punch photo sent as data:image/...;base64 → [bytes, extension]; stops the request if unusable.
    private static function decodePhoto($photo, string $dir): array
    {
        $photo = (string) $photo;
        if (!preg_match('#^data:image/(jpeg|jpg|png|webp);base64,(.+)$#', $photo, $pm)) sendError('Take a photo to punch ' . $dir . '.', 400);
        $bin = base64_decode($pm[2], true);
        if ($bin === false || strlen($bin) < 1000) sendError('The photo could not be read — take it again.', 400);
        if (strlen($bin) > 4 * 1024 * 1024) sendError('The photo is too large.', 400);
        return [$bin, $pm[1] === 'png' ? 'png' : ($pm[1] === 'webp' ? 'webp' : 'jpg')];
    }

    private static function savePhoto(string $name, string $bin, string $ext): string
    {
        $dir = UPLOADS_PATH . '/attendance';
        if (!is_dir($dir)) @mkdir($dir, 0755, true);
        $file = $name . '.' . $ext;
        if (@file_put_contents("$dir/$file", $bin) === false) sendError('Could not save the photo on the server.', 500);
        return $file;
    }

    // POST /api/attendance/checkin — { lat, lng, photo: data:image/jpeg;base64,... }
    public function checkIn(): void
    {
        $auth = authenticate();
        $b = request_body();
        $start = start_of_day(); $end = start_of_day_plus(1);

        $s = db()->prepare('SELECT id FROM `Attendance` WHERE userId=? AND date>=? AND date<? LIMIT 1');
        $s->execute([$auth['id'], $start, $end]);
        if ($s->fetch()) sendError('Already checked in today.', 400);

        $win = $this->window($auth['id']);
        if (!$win['canPunchIn']) {
            $r = $win['request'];
            sendError($r && $r['status'] === 'PENDING' ? 'Punch-in is locked after ' . self::GRACE_UNTIL . '. Your request is waiting for admin approval.'
                : 'Punch-in closed at ' . self::GRACE_UNTIL . '. Send a request with the reason — an admin will release the punch-in.', 403);
        }
        // Photo is required (selfie at punch-in).
        [$bin, $ext] = self::decodePhoto($b['photo'] ?? '', 'in');

        $lat = isset($b['lat']) && is_numeric($b['lat']) ? (float)$b['lat'] : null;
        $lng = isset($b['lng']) && is_numeric($b['lng']) ? (float)$b['lng'] : null;
        // Location is mandatory: live tracking and the location history depend on it.
        if ($lat === null || $lng === null) {
            sendError('Location is required to punch in. Turn on location (GPS) on your device and allow this site to use it, then try again.', 400);
        }
        $id = gen_id();
        $photoName = self::savePhoto($id, $bin, $ext);
        $late = date('H:i', self::nowTs()) >= self::ON_TIME_UNTIL ? (int) floor((self::nowTs() - strtotime(date('Y-m-d') . ' ' . self::ON_TIME_UNTIL)) / 60) : 0;
        db()->prepare(
            'INSERT INTO `Attendance` (id,userId,date,checkIn,checkInLat,checkInLng,checkInPhoto,lateMinutes,lateRequestId,status,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,\'PRESENT\',?,?)'
        )->execute([$id, $auth['id'], $start, now_sql(), $lat, $lng, $photoName, $late ?: null,
                    ($win['phase'] === 'LOCKED' && $win['request']) ? $win['request']['id'] : null, now_sql(), now_sql()]);

        $s2 = db()->prepare('SELECT * FROM `Attendance` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['record' => $s2->fetch()], 'Check-in recorded', 201);
    }

    // POST /api/attendance/checkout
    public function checkOut(): void
    {
        $auth = authenticate();
        $b = request_body();
        $start = start_of_day(); $end = start_of_day_plus(1);

        $s = db()->prepare('SELECT * FROM `Attendance` WHERE userId=? AND date>=? AND date<? LIMIT 1');
        $s->execute([$auth['id'], $start, $end]);
        $record = $s->fetch();
        if (!$record) sendError('No check-in found for today.', 400);
        if ($record['checkOut']) sendError('Already checked out today.', 400);

        $checkInTs = strtotime($record['checkIn']);
        $hours = round((time() - $checkInTs) / 3600, 2);
        $lat = isset($b['lat']) && is_numeric($b['lat']) ? (float)$b['lat'] : null;
        $lng = isset($b['lng']) && is_numeric($b['lng']) ? (float)$b['lng'] : null;
        if ($lat === null || $lng === null) {
            sendError('Location is required to punch out. Turn on location (GPS) on your device and allow this site to use it, then try again.', 400);
        }
        // Photo is required at punch-out too.
        [$bin, $ext] = self::decodePhoto($b['photo'] ?? '', 'out');
        $outPhoto = self::savePhoto($record['id'] . '_out', $bin, $ext);
        // Punching out ends any break that's still running.
        LocationHistoryController::closeOpenBreaks($auth['id']);

        db()->prepare(
            'UPDATE `Attendance` SET checkOut=?,checkOutLat=?,checkOutLng=?,checkOutPhoto=?,workingHours=?,updatedAt=? WHERE id=?'
        )->execute([now_sql(), $lat, $lng, $outPhoto, $hours, now_sql(), $record['id']]);

        $s2 = db()->prepare('SELECT * FROM `Attendance` WHERE id=? LIMIT 1'); $s2->execute([$record['id']]);
        $upd = $s2->fetch();
        sendSuccess(['record' => $upd], "Checked out. Working hours: {$upd['workingHours']}h");
    }

    // GET /api/attendance
    public function index(): void
    {
        $auth = authenticate();
        [$page, $limit, $offset] = paginate(31);
        $now = new DateTime('now');
        $month = qp('month') ? (int)qp('month') - 1 : (int)$now->format('n') - 1;
        $year  = qp('year')  ? (int)qp('year')       : (int)$now->format('Y');
        $from  = (new DateTime("$year-" . ($month+1) . "-01 00:00:00"))->format('Y-m-d H:i:s');
        $to    = (new DateTime("$year-" . ($month+1) . "-01 00:00:00"))->modify('+1 month')->format('Y-m-d H:i:s');

        $targetUserId = ($auth['role'] === 'ADMIN' && qp('userId')) ? qp('userId') : $auth['id'];
        $where = ['a.userId=?','a.date>=?','a.date<?']; $params = [$targetUserId,$from,$to];
        if (qp('status')) { $where[] = 'a.status=?'; $params[] = qp('status'); }
        $w = 'WHERE ' . implode(' AND ', $where);

        $s = db()->prepare("SELECT COUNT(*) FROM `Attendance` a $w"); $s->execute($params);
        $total = (int)$s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT a.*, u.name AS u_name, u.department
             FROM `Attendance` a LEFT JOIN `User` u ON u.id=a.userId
             $w ORDER BY a.date DESC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $items = array_map(function($r) {
            $r['user'] = ['name'=>$r['u_name'],'department'=>$r['department']];
            $r['checkInFormatted'] = fmt_ampm($r['checkIn']);
            $r['checkOutFormatted'] = fmt_ampm($r['checkOut']);
            unset($r['u_name'],$r['department']); return $r;
        }, $s2->fetchAll());
        sendPaginated($items, $total, $page, $limit, 'Attendance fetched');
    }

    // GET /api/attendance/all — admin only. Every user's punch in/out, grouped date-wise
    // (most recent date first), for the attendance register view.
    public function all(): void
    {
        $auth = authenticate(); require_admin($auth);
        $now = new DateTime('now');
        $month = qp('month') ? (int)qp('month') - 1 : (int)$now->format('n') - 1;
        $year  = qp('year')  ? (int)qp('year')       : (int)$now->format('Y');
        $from  = (new DateTime("$year-" . ($month+1) . "-01 00:00:00"))->format('Y-m-d H:i:s');
        $to    = (new DateTime("$year-" . ($month+1) . "-01 00:00:00"))->modify('+1 month')->format('Y-m-d H:i:s');

        $where = ['a.date>=?','a.date<?']; $params = [$from,$to];
        if (qp('status'))     { $where[] = 'a.status=?';     $params[] = qp('status'); }
        if (qp('department')) { $where[] = 'u.department=?'; $params[] = qp('department'); }
        $w = 'WHERE ' . implode(' AND ', $where);

        $s = db()->prepare(
            "SELECT a.id,a.userId,a.date,a.checkIn,a.checkOut,a.workingHours,a.status,
                    a.checkInLat,a.checkInLng,a.checkOutLat,a.checkOutLng,a.checkInPhoto,a.checkOutPhoto,
                    u.name AS u_name, u.department
             FROM `Attendance` a LEFT JOIN `User` u ON u.id=a.userId
             $w ORDER BY a.date DESC, u.name ASC"
        );
        $s->execute($params);

        $grouped = [];
        foreach ($s->fetchAll() as $r) {
            $dateKey = (new DateTime($r['date']))->format('Y-m-d');
            $grouped[$dateKey][] = [
                'attendanceId'      => $r['id'],
                'user'              => ['id' => $r['userId'], 'name' => $r['u_name'], 'department' => $r['department']],
                'checkIn'           => $r['checkIn'],
                'checkOut'          => $r['checkOut'],
                'checkInFormatted'  => fmt_ampm($r['checkIn']),
                'checkOutFormatted' => fmt_ampm($r['checkOut']),
                'workingHours'      => $r['workingHours'],
                'status'            => $r['status'],
                'checkInLat'        => $r['checkInLat'] !== null ? (float)$r['checkInLat'] : null,
                'checkInLng'        => $r['checkInLng'] !== null ? (float)$r['checkInLng'] : null,
                'checkOutLat'       => $r['checkOutLat'] !== null ? (float)$r['checkOutLat'] : null,
                'checkOutLng'       => $r['checkOutLng'] !== null ? (float)$r['checkOutLng'] : null,
                'checkInPhoto'      => !empty($r['checkInPhoto']),
                'checkOutPhoto'     => !empty($r['checkOutPhoto']),
            ];
        }
        krsort($grouped); // newest date first

        $days = [];
        foreach ($grouped as $date => $records) {
            $days[] = ['date' => $date, 'records' => $records];
        }

        sendSuccess(['days' => $days, 'from' => $from, 'to' => $to], 'Attendance fetched for all users');
    }

    // GET /api/attendance/today
    public function today(): void
    {
        $auth = authenticate();
        $start = start_of_day(); $end = start_of_day_plus(1);
        $s = db()->prepare('SELECT * FROM `Attendance` WHERE userId=? AND date>=? AND date<? LIMIT 1');
        $s->execute([$auth['id'], $start, $end]);
        sendSuccess(['record' => $s->fetch() ?: null, 'window' => $this->window($auth['id'])]);
    }

    // POST /api/attendance/late-request { reason } — after the grace time, ask an admin to release punch-in
    public function lateRequest(): void
    {
        $auth = authenticate();
        $reason = trim((string) (request_body()['reason'] ?? ''));
        if ($reason === '') sendError('Give the reason you are late.', 400);
        $w = $this->window($auth['id']);
        if ($w['phase'] !== 'LOCKED') sendError('Punch-in is still open — punch in now.', 400);
        if ($w['request'] && in_array($w['request']['status'], ['PENDING', 'APPROVED'], true)) sendError('You already sent a request today.', 400);
        $id = gen_id();
        db()->prepare('INSERT INTO `PunchRequest` (id,userId,date,reason,status,createdAt) VALUES (?,?,?,?,\'PENDING\',?)')
            ->execute([$id, $auth['id'], date('Y-m-d'), mb_substr($reason, 0, 1000), now_sql()]);
        log_activity($auth['id'], 'LATE_PUNCH_REQUESTED', 'PunchRequest', $id, []);
        sendSuccess(['window' => $this->window($auth['id'])], 'Request sent — you can punch in once an admin approves it.', 201);
    }

    // GET /api/attendance/late-requests?status=PENDING — admin-tier: everyone's; others: their own
    public function lateRequests(): void
    {
        $auth = authenticate();
        $where = []; $p = [];
        if (!is_admin_tier($auth['role'])) { $where[] = 'r.userId=?'; $p[] = $auth['id']; }
        if (qp('status')) { $where[] = 'r.status=?'; $p[] = strtoupper(qp('status')); }
        $s = db()->prepare('SELECT r.*, u.name AS userName, u.department, d.name AS decidedByName FROM `PunchRequest` r
                            LEFT JOIN `User` u ON u.id=r.userId LEFT JOIN `User` d ON d.id=r.decidedById ' . ($where ? 'WHERE ' . implode(' AND ', $where) : '') . '
                            ORDER BY (r.status=\'PENDING\') DESC, r.createdAt DESC LIMIT 100');
        $s->execute($p);
        sendSuccess(['requests' => $s->fetchAll()]);
    }

    // PATCH /api/attendance/late-requests/:id { status: APPROVED|REJECTED, note }
    public function decideLateRequest(string $id): void
    {
        $auth = authenticate();
        if (!is_admin_tier($auth['role'])) sendError('Only managers and admins can release punch-in.', 403);
        $b = request_body();
        $st = strtoupper((string) ($b['status'] ?? ''));
        if (!in_array($st, ['APPROVED', 'REJECTED'], true)) sendError('Approve or reject.', 400);
        $note = trim((string) ($b['note'] ?? ''));
        if ($st === 'REJECTED' && $note === '') sendError('Give a reason for rejecting.', 400);
        $u = db()->prepare("UPDATE `PunchRequest` SET status=?, adminNote=?, decidedById=?, decidedAt=? WHERE id=? AND status='PENDING'");
        $u->execute([$st, $note ?: null, $auth['id'], now_sql(), $id]);
        if (!$u->rowCount()) sendError('Request not found or already decided.', 404);
        log_activity($auth['id'], 'LATE_PUNCH_' . $st, 'PunchRequest', $id, []);
        sendSuccess([], $st === 'APPROVED' ? 'Punch-in released' : 'Request rejected');
    }

    // GET /api/attendance/:id/photo[?kind=out] — the punch-in (or punch-out) photo (own, or admin-tier)
    public function photo(string $id): void
    {
        $auth = authenticate();
        $col = qp('kind') === 'out' ? 'checkOutPhoto' : 'checkInPhoto';
        $s = db()->prepare("SELECT userId, `$col` AS file FROM `Attendance` WHERE id=?"); $s->execute([$id]);
        $r = $s->fetch();
        if (!$r || !$r['file']) sendError('No photo.', 404);
        if ($r['userId'] !== $auth['id'] && !is_admin_tier($auth['role'])) sendError('Not allowed.', 403);
        $path = UPLOADS_PATH . '/attendance/' . basename($r['file']);
        if (!is_file($path)) sendError('Photo missing on the server.', 404);
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        header('Content-Type: ' . ($ext === 'png' ? 'image/png' : ($ext === 'webp' ? 'image/webp' : 'image/jpeg')));
        header('Cache-Control: private, max-age=86400');
        readfile($path); exit;
    }

    // POST /api/attendance/ping
    public function ping(): void
    {
        $auth = authenticate();
        $b = request_body();
        if (!isset($b['lat'],$b['lng'])) sendError('lat and lng are required.', 400);

        $start = start_of_day(); $end = start_of_day_plus(1);
        $s = db()->prepare(
            'SELECT id FROM `Attendance` WHERE userId=? AND date>=? AND date<? AND checkIn IS NOT NULL AND checkOut IS NULL LIMIT 1'
        );
        $s->execute([$auth['id'], $start, $end]);
        $rec = $s->fetch();
        if (!$rec) sendError('No active check-in session. Punch in first.', 400);

        $id = gen_id();
        db()->prepare('INSERT INTO `LocationPing` (id,attendanceId,lat,lng,accuracy,capturedAt) VALUES (?,?,?,?,?,?)')
           ->execute([$id, $rec['id'], (float)$b['lat'], (float)$b['lng'], isset($b['accuracy'])?(float)$b['accuracy']:null, now_sql()]);
        $s2 = db()->prepare('SELECT * FROM `LocationPing` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['ping' => $s2->fetch()], 'Location recorded', 201);
    }

    // GET /api/attendance/live
    public function live(): void
    {
        $auth = authenticate(); require_admin($auth);
        $start = start_of_day(); $end = start_of_day_plus(1);
        $s = db()->prepare(
            'SELECT a.id,a.checkIn,a.checkInLat,a.checkInLng,u.id AS u_id,u.name AS u_name,u.department,u.phone
             FROM `Attendance` a LEFT JOIN `User` u ON u.id=a.userId
             WHERE a.date>=? AND a.date<? AND a.checkIn IS NOT NULL AND a.checkOut IS NULL
             ORDER BY a.checkIn DESC'
        );
        $s->execute([$start, $end]);
        $records = $s->fetchAll();

        $live = [];
        foreach ($records as $r) {
            $ps = db()->prepare('SELECT lat,lng,capturedAt FROM `LocationPing` WHERE attendanceId=? ORDER BY capturedAt DESC LIMIT 1');
            $ps->execute([$r['id']]);
            $lastPing = $ps->fetch();
            $live[] = [
                'attendanceId' => $r['id'],
                'user'         => ['id'=>$r['u_id'],'name'=>$r['u_name'],'department'=>$r['department'],'phone'=>$r['phone']],
                'checkIn'      => $r['checkIn'],
                'checkInLat'   => $r['checkInLat'] !== null ? (float)$r['checkInLat'] : null,
                'checkInLng'   => $r['checkInLng'] !== null ? (float)$r['checkInLng'] : null,
                'lastLocation' => $lastPing
                    ? ['lat'=>(float)$lastPing['lat'],'lng'=>(float)$lastPing['lng'],'capturedAt'=>$lastPing['capturedAt']]
                    : ($r['checkInLat'] !== null ? ['lat'=>(float)$r['checkInLat'],'lng'=>(float)$r['checkInLng'],'capturedAt'=>$r['checkIn']] : null),
            ];
        }
        sendSuccess(['live' => $live, 'count' => count($live)], 'Live tracking data fetched');
    }

    // GET /api/attendance/:id/locations
    public function locations(string $id): void
    {
        $auth = authenticate();
        $s = db()->prepare('SELECT a.*,u.id AS u_id,u.name AS u_name FROM `Attendance` a LEFT JOIN `User` u ON u.id=a.userId WHERE a.id=? LIMIT 1');
        $s->execute([$id]);
        $record = $s->fetch();
        if (!$record) sendError('Attendance record not found.', 404);
        if (!is_admin_tier($auth['role']) && $record['userId'] !== $auth['id'])
            sendError('Not authorized to view this record.', 403);
        $record['user'] = ['id'=>$record['u_id'],'name'=>$record['u_name']];
        unset($record['u_id'],$record['u_name']);

        $ps = db()->prepare('SELECT * FROM `LocationPing` WHERE attendanceId=? ORDER BY capturedAt ASC');
        $ps->execute([$id]);
        sendSuccess(['record'=>$record,'pings'=>$ps->fetchAll()], 'Location trail fetched');
    }

    // PATCH /api/attendance/:id/approve
    public function approve(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();
        $status = $b['status'] ?? '';
        if (!in_array($status, ['APPROVED','REJECTED'])) sendError('Status must be APPROVED or REJECTED.', 400);
        $s = db()->prepare('UPDATE `Attendance` SET status=?,adminNote=?,approvedById=?,approvedAt=?,updatedAt=? WHERE id=?');
        if (!$s->execute([$status,$b['adminNote']??null,$auth['id'],now_sql(),now_sql(),$id])||$s->rowCount()===0)
            sendError('Attendance record not found.', 404);
        $s2 = db()->prepare('SELECT * FROM `Attendance` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['record'=>$s2->fetch()], 'Attendance ' . strtolower($status));
    }

    // GET /api/attendance/export
    public function export(): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->query('SELECT u.name,a.date,a.checkIn,a.checkOut,a.workingHours,a.status FROM `Attendance` a LEFT JOIN `User` u ON u.id=a.userId ORDER BY a.date DESC LIMIT 5000');
        $w = new XlsxWriter('Attendance');
        $w->addRow(['Employee','Date','Check In','Check Out','Working Hours','Status']);
        foreach($s->fetchAll() as $r) $w->addRow([$r['name'],$r['date'],$r['checkIn'],$r['checkOut'],$r['workingHours'],$r['status']]);
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="attendance-export.xlsx"');
        echo $w->output(); exit;
    }
}

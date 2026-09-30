 <?php
class AttendanceController
{
    // POST /api/attendance/checkin
    public function checkIn(): void
    {
        $auth = authenticate();
        $b = request_body();
        $start = start_of_day(); $end = start_of_day_plus(1);

        $s = db()->prepare('SELECT id FROM `Attendance` WHERE userId=? AND date>=? AND date<? LIMIT 1');
        $s->execute([$auth['id'], $start, $end]);
        if ($s->fetch()) sendError('Already checked in today.', 400);

        $lat = isset($b['lat']) ? (float)$b['lat'] : null;
        $lng = isset($b['lng']) ? (float)$b['lng'] : null;
        $id = gen_id();
        db()->prepare(
            'INSERT INTO `Attendance` (id,userId,date,checkIn,checkInLat,checkInLng,status,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,\'PRESENT\',?,?)'
        )->execute([$id, $auth['id'], $start, now_sql(), $lat, $lng, now_sql(), now_sql()]);

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
        $lat = isset($b['lat']) ? (float)$b['lat'] : null;
        $lng = isset($b['lng']) ? (float)$b['lng'] : null;

        db()->prepare(
            'UPDATE `Attendance` SET checkOut=?,checkOutLat=?,checkOutLng=?,workingHours=?,updatedAt=? WHERE id=?'
        )->execute([now_sql(), $lat, $lng, $hours, now_sql(), $record['id']]);

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
        sendSuccess(['record' => $s->fetch() ?: null]);
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
        if ($auth['role'] !== 'ADMIN' && $record['userId'] !== $auth['id'])
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

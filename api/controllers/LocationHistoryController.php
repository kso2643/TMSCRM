<?php
/**
 * Location history (any previous day), breaks, and stationary alerts.
 *
 * Tracking history — admin-tier (Super Admin, Admin, Manager):
 *   GET /api/tracking/users                     active people to pick from
 *   GET /api/tracking/days?userId=&month=YYYY-MM days that person punched in that month, with distance/points
 *   GET /api/tracking/history?userId=&date=YYYY-MM-DD
 *        punch in/out, every location point, breaks, stationary events, and
 *        computed stats: distance travelled, first/last point, and "stops"
 *        (10+ minutes within ~150 m), so a past day can be replayed on a map.
 *
 * Breaks — the signed-in employee:
 *   GET  /api/breaks/today          today's punch state, active break and breaks so far
 *   POST /api/breaks/start          { type: TEA|LUNCH, trigger: AUTO|MANUAL, lat?, lng? }
 *   POST /api/breaks/end
 *   POST /api/breaks/stationary     { eventType: STATIONARY_WORKING|STATIONARY_NO_RESPONSE|LOCATION_OFF,
 *                                     minutes?, sinceAt?, lat?, lng? }
 * crm/crm-global.js watches the location while you're punched in; after 30
 * minutes within ~150 m it asks "tea break or lunch break?" and records the
 * answer here. Super Admin is alerted through AlertFeedController.
 */
class LocationHistoryController
{
    private const BREAK_TYPES = ['TEA', 'LUNCH'];
    private const STATIONARY_TYPES = ['STATIONARY_WORKING', 'STATIONARY_NO_RESPONSE', 'LOCATION_OFF'];

    public function __construct()
    {
        ensure_schema(self::schema(), 'migration_breaks.sql');
    }

    /** Kept in sync with database/migration_breaks.sql. */
    public static function schema(): array
    {
        $tail = ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        $b = "
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
  KEY `AttendanceBreak_attendanceId_idx` (`attendanceId`)";
        $s = "
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
  KEY `StationaryLog_user_detected_idx` (`userId`, `detectedAt`)";
        $fk = fn($t) => ",\n  CONSTRAINT `{$t}_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE CASCADE ON UPDATE CASCADE";
        return [
            'AttendanceBreak' => ['create' => "CREATE TABLE IF NOT EXISTS `AttendanceBreak` ($b{$fk('AttendanceBreak')}\n$tail", 'fallback' => "CREATE TABLE IF NOT EXISTS `AttendanceBreak` ($b\n$tail"],
            'StationaryLog'   => ['create' => "CREATE TABLE IF NOT EXISTS `StationaryLog` ($s{$fk('StationaryLog')}\n$tail",     'fallback' => "CREATE TABLE IF NOT EXISTS `StationaryLog` ($s\n$tail"],
        ];
    }

    // ── geometry ─────────────────────────────────────────────────────
    public static function meters(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $r = 6371000; $p = M_PI / 180;
        $a = sin(($lat2 - $lat1) * $p / 2) ** 2 + cos($lat1 * $p) * cos($lat2 * $p) * sin(($lng2 - $lng1) * $p / 2) ** 2;
        return 2 * $r * asin(min(1, sqrt($a)));
    }

    /** Total path length in km, ignoring GPS jitter under 25 m between consecutive points. */
    public static function distanceKm(array $pts): float
    {
        $m = 0; $prev = null;
        foreach ($pts as $p) {
            if ($p['lat'] === null || $p['lng'] === null) continue;
            if ($prev) {
                $d = self::meters((float) $prev['lat'], (float) $prev['lng'], (float) $p['lat'], (float) $p['lng']);
                if ($d < 25) continue; // jitter — keep the previous anchor
                $m += $d;
            }
            $prev = $p;
        }
        return $m / 1000;
    }

    /** Groups consecutive points within 150 m into stops lasting 10+ minutes. */
    private static function stops(array $pts): array
    {
        $out = []; $i = 0; $n = count($pts);
        while ($i < $n) {
            $j = $i;
            while ($j + 1 < $n && self::meters((float) $pts[$i]['lat'], (float) $pts[$i]['lng'], (float) $pts[$j + 1]['lat'], (float) $pts[$j + 1]['lng']) <= 150) $j++;
            $mins = (strtotime($pts[$j]['capturedAt']) - strtotime($pts[$i]['capturedAt'])) / 60;
            if ($mins >= 10) {
                $out[] = ['from' => $pts[$i]['capturedAt'], 'to' => $pts[$j]['capturedAt'], 'minutes' => (int) round($mins),
                          'lat' => (float) $pts[$i]['lat'], 'lng' => (float) $pts[$i]['lng']];
            }
            $i = $j + 1;
        }
        return $out;
    }

    private function requireViewer(array $auth): void
    {
        if (!is_admin_tier($auth['role'])) sendError('Only Super Admin, Admin or Manager can view location history.', 403);
    }

    // GET /api/tracking/users
    public function users(): void
    {
        $auth = authenticate(); $this->requireViewer($auth);
        $s = db()->query("SELECT id, name, role, department FROM `User` WHERE isActive=1 ORDER BY name");
        sendSuccess(['users' => $s->fetchAll()]);
    }

    // GET /api/tracking/days?userId=&month=YYYY-MM
    public function days(): void
    {
        $auth = authenticate(); $this->requireViewer($auth);
        $uid = (string) qp('userId', '');
        if ($uid === '') sendError('Choose a person.', 400);
        $month = preg_match('/^\d{4}-\d{2}$/', (string) qp('month')) ? qp('month') : date('Y-m');
        $from = $month . '-01 00:00:00';
        $to = date('Y-m-d 00:00:00', strtotime($from . ' +1 month'));
        $s = db()->prepare("SELECT id, date, checkIn, checkOut, checkInLat FROM `Attendance` WHERE userId=? AND date>=? AND date<? AND checkIn IS NOT NULL ORDER BY date");
        $s->execute([$uid, $from, $to]);
        $c = db()->prepare('SELECT COUNT(*) FROM `LocationPing` WHERE attendanceId=?');
        $out = [];
        foreach ($s->fetchAll() as $r) {
            $c->execute([$r['id']]);
            $out[] = ['date' => substr($r['date'], 0, 10), 'checkIn' => $r['checkIn'], 'checkOut' => $r['checkOut'],
                      'points' => (int) $c->fetchColumn(), 'locationAtPunchIn' => $r['checkInLat'] !== null];
        }
        sendSuccess(['month' => $month, 'days' => $out]);
    }

    // GET /api/tracking/history?userId=&date=YYYY-MM-DD
    public function history(): void
    {
        $auth = authenticate(); $this->requireViewer($auth);
        $uid = (string) qp('userId', '');
        $date = to_date_only(qp('date')) ?? date('Y-m-d');
        if ($uid === '') sendError('Choose a person.', 400);
        $u = db()->prepare('SELECT id, name, role, department FROM `User` WHERE id=? LIMIT 1');
        $u->execute([$uid]);
        $user = $u->fetch();
        if (!$user) sendError('Person not found.', 404);

        $a = db()->prepare('SELECT * FROM `Attendance` WHERE userId=? AND date>=? AND date<? LIMIT 1');
        $a->execute([$uid, $date . ' 00:00:00', date('Y-m-d 00:00:00', strtotime($date . ' +1 day'))]);
        $att = $a->fetch() ?: null;

        $pts = []; $breaks = []; $events = [];
        if ($att) {
            $p = db()->prepare('SELECT lat, lng, accuracy, capturedAt FROM `LocationPing` WHERE attendanceId=? ORDER BY capturedAt');
            $p->execute([$att['id']]);
            $pts = array_map(fn($r) => ['lat' => (float) $r['lat'], 'lng' => (float) $r['lng'],
                'accuracy' => $r['accuracy'] !== null ? (float) $r['accuracy'] : null, 'capturedAt' => $r['capturedAt']], $p->fetchAll());
        }
        $b = db()->prepare("SELECT * FROM `AttendanceBreak` WHERE userId=? AND startedAt>=? AND startedAt<? ORDER BY startedAt");
        $b->execute([$uid, $date . ' 00:00:00', date('Y-m-d 00:00:00', strtotime($date . ' +1 day'))]);
        foreach ($b->fetchAll() as $r) {
            $breaks[] = ['type' => $r['breakType'], 'trigger' => $r['triggerType'], 'startedAt' => $r['startedAt'], 'endedAt' => $r['endedAt'],
                'seconds' => $r['endedAt'] ? (int) $r['durationSeconds'] : max(0, time() - strtotime($r['startedAt'])),
                'lat' => $r['lat'] !== null ? (float) $r['lat'] : null, 'lng' => $r['lng'] !== null ? (float) $r['lng'] : null];
        }
        $e = db()->prepare("SELECT * FROM `StationaryLog` WHERE userId=? AND detectedAt>=? AND detectedAt<? ORDER BY detectedAt");
        $e->execute([$uid, $date . ' 00:00:00', date('Y-m-d 00:00:00', strtotime($date . ' +1 day'))]);
        foreach ($e->fetchAll() as $r) {
            $events[] = ['type' => $r['eventType'], 'sinceAt' => $r['sinceAt'], 'detectedAt' => $r['detectedAt'], 'minutes' => $r['minutes'] !== null ? (int) $r['minutes'] : null,
                'lat' => $r['lat'] !== null ? (float) $r['lat'] : null, 'lng' => $r['lng'] !== null ? (float) $r['lng'] : null];
        }

        sendSuccess([
            'user' => $user, 'date' => $date,
            'attendance' => $att ? [
                'checkIn' => $att['checkIn'], 'checkOut' => $att['checkOut'], 'workingHours' => $att['workingHours'],
                'checkInLat' => $att['checkInLat'] !== null ? (float) $att['checkInLat'] : null, 'checkInLng' => $att['checkInLng'] !== null ? (float) $att['checkInLng'] : null,
                'checkOutLat' => $att['checkOutLat'] !== null ? (float) $att['checkOutLat'] : null, 'checkOutLng' => $att['checkOutLng'] !== null ? (float) $att['checkOutLng'] : null,
            ] : null,
            'points' => $pts, 'breaks' => $breaks, 'events' => $events, 'stops' => self::stops($pts),
            'stats' => [
                'points' => count($pts), 'distanceKm' => round(self::distanceKm($pts), 2),
                'firstPoint' => $pts ? $pts[0]['capturedAt'] : null, 'lastPoint' => $pts ? end($pts)['capturedAt'] : null,
                'breakSeconds' => array_sum(array_column($breaks, 'seconds')),
            ],
        ]);
    }

    // ── breaks (signed-in employee) ──────────────────────────────────
    private function todayAttendance(string $uid): ?array
    {
        $s = db()->prepare('SELECT * FROM `Attendance` WHERE userId=? AND date>=? AND date<? LIMIT 1');
        $s->execute([$uid, start_of_day(), start_of_day_plus(1)]);
        return $s->fetch() ?: null;
    }
    private function activeBreak(string $uid): ?array
    {
        $s = db()->prepare('SELECT * FROM `AttendanceBreak` WHERE userId=? AND endedAt IS NULL ORDER BY startedAt DESC LIMIT 1');
        $s->execute([$uid]);
        return $s->fetch() ?: null;
    }
    private static function shapeBreak(?array $r): ?array
    {
        if (!$r) return null;
        return ['id' => $r['id'], 'type' => $r['breakType'], 'trigger' => $r['triggerType'], 'startedAt' => $r['startedAt'], 'endedAt' => $r['endedAt'],
                'seconds' => $r['endedAt'] ? (int) $r['durationSeconds'] : max(0, time() - strtotime($r['startedAt']))];
    }

    /** Ends any open break for $uid (used by POST /breaks/end and on punch out). */
    public static function closeOpenBreaks(string $uid): void
    {
        try {
            db()->prepare('UPDATE `AttendanceBreak` SET endedAt=?, durationSeconds=TIMESTAMPDIFF(SECOND, startedAt, ?) WHERE userId=? AND endedAt IS NULL')
                ->execute([now_sql(), now_sql(), $uid]);
        } catch (PDOException $e) { /* table not created yet — nothing to close */ }
    }

    // GET /api/breaks/today
    public function today(): void
    {
        $auth = authenticate();
        $att = $this->todayAttendance($auth['id']);
        $s = db()->prepare('SELECT * FROM `AttendanceBreak` WHERE userId=? AND startedAt>=? ORDER BY startedAt');
        $s->execute([$auth['id'], start_of_day()]);
        sendSuccess([
            'punchedIn' => (bool) ($att && $att['checkIn'] && !$att['checkOut']),
            'checkIn' => $att['checkIn'] ?? null, 'checkOut' => $att['checkOut'] ?? null,
            'active' => self::shapeBreak($this->activeBreak($auth['id'])),
            'breaks' => array_map([self::class, 'shapeBreak'], $s->fetchAll()),
            'serverNow' => now_sql(),
        ]);
    }

    // POST /api/breaks/start
    public function start(): void
    {
        $auth = authenticate();
        $b = request_body();
        $type = strtoupper(trim((string) ($b['type'] ?? '')));
        if (!in_array($type, self::BREAK_TYPES, true)) sendError('Choose tea break or lunch break.', 400);
        $att = $this->todayAttendance($auth['id']);
        if (!$att || !$att['checkIn'] || $att['checkOut']) sendError('Punch in first to take a break.', 400);
        if ($this->activeBreak($auth['id'])) sendError('You are already on a break — end it first.', 400);
        $trigger = strtoupper((string) ($b['trigger'] ?? 'MANUAL')) === 'AUTO' ? 'AUTO' : 'MANUAL';
        $id = gen_id();
        db()->prepare('INSERT INTO `AttendanceBreak` (id,userId,attendanceId,breakType,triggerType,startedAt,lat,lng,createdAt) VALUES (?,?,?,?,?,?,?,?,?)')
            ->execute([$id, $auth['id'], $att['id'], $type, $trigger, now_sql(),
                       is_numeric($b['lat'] ?? null) ? (float) $b['lat'] : null, is_numeric($b['lng'] ?? null) ? (float) $b['lng'] : null, now_sql()]);
        log_activity($auth['id'], 'BREAK_STARTED', 'AttendanceBreak', $id, ['type' => $type, 'trigger' => $trigger]);
        sendSuccess(['active' => self::shapeBreak($this->activeBreak($auth['id']))], ($type === 'LUNCH' ? 'Lunch' : 'Tea') . ' break started', 201);
    }

    // POST /api/breaks/end
    public function end(): void
    {
        $auth = authenticate();
        $active = $this->activeBreak($auth['id']);
        if (!$active) sendError('You are not on a break.', 400);
        self::closeOpenBreaks($auth['id']);
        $s = db()->prepare('SELECT * FROM `AttendanceBreak` WHERE id=?');
        $s->execute([$active['id']]);
        log_activity($auth['id'], 'BREAK_ENDED', 'AttendanceBreak', $active['id'], []);
        sendSuccess(['break' => self::shapeBreak($s->fetch())], 'Break ended');
    }

    // POST /api/breaks/stationary
    public function stationary(): void
    {
        $auth = authenticate();
        $b = request_body();
        $type = strtoupper((string) ($b['eventType'] ?? ''));
        if (!in_array($type, self::STATIONARY_TYPES, true)) sendError('Unknown event type.', 400);
        $att = $this->todayAttendance($auth['id']);
        if (!$att || !$att['checkIn'] || $att['checkOut']) sendError('Not punched in.', 400);
        // At most one LOCATION_OFF per 30 minutes per person, so a flaky GPS doesn't flood Super Admin.
        if ($type === 'LOCATION_OFF') {
            $q = db()->prepare("SELECT COUNT(*) FROM `StationaryLog` WHERE userId=? AND eventType='LOCATION_OFF' AND detectedAt>?");
            $q->execute([$auth['id'], date('Y-m-d H:i:s', time() - 1800)]);
            if ((int) $q->fetchColumn() > 0) sendSuccess([], 'Already recorded');
        }
        db()->prepare('INSERT INTO `StationaryLog` (id,userId,attendanceId,eventType,sinceAt,detectedAt,minutes,lat,lng,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([gen_id(), $auth['id'], $att['id'], $type, to_dt($b['sinceAt'] ?? null), now_sql(),
                       is_numeric($b['minutes'] ?? null) ? (int) $b['minutes'] : null,
                       is_numeric($b['lat'] ?? null) ? (float) $b['lat'] : null, is_numeric($b['lng'] ?? null) ? (float) $b['lng'] : null, now_sql()]);
        sendSuccess([], 'Recorded', 201);
    }
}

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

    /** A stop is a stay of this many minutes or more in one place; it gets a pin on the map. */
    public const STOP_MINUTES = 30;
    /** A stay this long within a customer's saved location counts as reaching that customer (pin with the customer's name). */
    public const VISIT_MINUTES = 10;
    /** Stays this long or longer add no distance (GPS drift while standing still is not travel). */
    private const STAY_MINUTES = 10;
    private const STAY_RADIUS = 150;   // metres from the centre of the stay

    /** Usable fixes: real coordinates, not a vague tower / Wi-Fi guess (accuracy worse than 150 m). */
    private static function usable(array $pts): array
    {
        return array_values(array_filter($pts, fn($p) => $p['lat'] !== null && $p['lng'] !== null
            && !(isset($p['accuracy']) && $p['accuracy'] !== null && (float) $p['accuracy'] > 150)));
    }

    /**
     * Stays: consecutive points within STAY_RADIUS of the stay's (running) centre for at least
     * $minMinutes. Each: [first index, last index, from, to, minutes, lat, lng, points].
     */
    private static function stays(array $pts, int $minMinutes): array
    {
        $out = []; $n = count($pts); $i = 0;
        while ($i < $n) {
            $lat = (float) $pts[$i]['lat']; $lng = (float) $pts[$i]['lng']; $k = 1; $j = $i;
            while ($j + 1 < $n && self::meters($lat, $lng, (float) $pts[$j + 1]['lat'], (float) $pts[$j + 1]['lng']) <= self::STAY_RADIUS) {
                $j++; $k++;
                $lat += ((float) $pts[$j]['lat'] - $lat) / $k; $lng += ((float) $pts[$j]['lng'] - $lng) / $k;   // running centre
            }
            // points still arriving / already leaving (well away from the centre) are travel, not the stay
            $a = $i; $z = $j;
            $far = fn($q) => self::meters($lat, $lng, (float) $pts[$q]['lat'], (float) $pts[$q]['lng']) > max(60, (float) ($pts[$q]['accuracy'] ?? 0));
            while ($a < $z && $far($a)) $a++;
            while ($z > $a && $far($z)) $z--;
            $mins = (strtotime($pts[$z]['capturedAt']) - strtotime($pts[$a]['capturedAt'])) / 60;
            if ($z > $a && $mins >= $minMinutes) {
                $cl = 0; $cg = 0; for ($q = $a; $q <= $z; $q++) { $cl += (float) $pts[$q]['lat']; $cg += (float) $pts[$q]['lng']; }
                $c = $z - $a + 1;
                $out[] = ['i' => $a, 'j' => $z, 'from' => $pts[$a]['capturedAt'], 'to' => $pts[$z]['capturedAt'], 'minutes' => (int) round($mins),
                          'lat' => round($cl / $c, 6), 'lng' => round($cg / $c, 6), 'points' => $c];
                $i = $z + 1;
            } else $i++;
        }
        return $out;
    }

    /**
     * Total path length in km, close to the real road distance:
     *  - vague fixes (accuracy worse than 150 m) are skipped
     *  - a stay of 10+ minutes in one place counts as one point (its centre) — standing still adds nothing;
     *    the route into and out of the stay still counts, so tracking simply carries on once they move
     *  - GPS jitter is ignored: a point counts once it is more than max(25 m, its accuracy) from the last one
     *  - impossible jumps (faster than 150 km/h between two points) are dropped as glitches
     */
    /** The day's points with the punch-in place first and the punch-out place last, so the route starts and ends there. */
    public static function withEnds(array $pts, ?array $att): array
    {
        if (!$att) return $pts;
        $first = $pts ? (string) $pts[0]['capturedAt'] : null; $last = $pts ? (string) end($pts)['capturedAt'] : null;
        // only where the times fit (a wrong phone clock must not turn the whole route into "glitches")
        if (!empty($att['checkIn']) && isset($att['checkInLat']) && $att['checkInLat'] !== null && $att['checkInLng'] !== null && ($first === null || (string) $att['checkIn'] <= $first))
            array_unshift($pts, ['lat' => (float) $att['checkInLat'], 'lng' => (float) $att['checkInLng'], 'accuracy' => 30, 'capturedAt' => $att['checkIn']]);
        if (!empty($att['checkOut']) && isset($att['checkOutLat']) && $att['checkOutLat'] !== null && $att['checkOutLng'] !== null && ($last === null || (string) $att['checkOut'] >= $last))
            $pts[] = ['lat' => (float) $att['checkOutLat'], 'lng' => (float) $att['checkOutLng'], 'accuracy' => 30, 'capturedAt' => $att['checkOut']];
        return $pts;
    }

    public static function distanceKm(array $pts, ?array $att = null): float
    {
        if ($att) $pts = self::withEnds($pts, $att);
        $path = self::cleanPath($pts);
        return $path ? end($path)['km'] : 0.0;
    }

    /**
     * The route the km are measured on (see distanceKm): vague fixes, jitter and glitches removed,
     * each stay of 10+ min as one point. Each point: lat, lng, at, until, km (running total).
     */
    public static function cleanPath(array $pts): array
    {
        $pts = self::usable($pts);
        $path = []; $k = 0;
        foreach (self::stays($pts, self::STAY_MINUTES) as $st) {
            for (; $k < $st['i']; $k++) $path[] = $pts[$k];
            $path[] = ['lat' => $st['lat'], 'lng' => $st['lng'], 'accuracy' => 0, 'capturedAt' => $st['from'], 'until' => $st['to']];
            $k = $st['j'] + 1;
        }
        for ($n = count($pts); $k < $n; $k++) $path[] = $pts[$k];
        $m = 0; $prev = null; $out = [];
        foreach ($path as $p) {
            $acc = isset($p['accuracy']) && $p['accuracy'] !== null ? (float) $p['accuracy'] : 0;
            if ($prev) {
                $d = self::meters((float) $prev['lat'], (float) $prev['lng'], (float) $p['lat'], (float) $p['lng']);
                if ($d < max(25, $acc) && !isset($p['until'])) continue; // jitter — keep the previous anchor
                $t0 = $prev['until'] ?? $prev['capturedAt'] ?? null;
                $secs = isset($p['capturedAt']) && $t0 ? max(1, strtotime($p['capturedAt']) - strtotime($t0)) : null;
                if ($secs !== null && $d / $secs > 41.7) continue; // > 150 km/h: a glitch, not a drive
                if ($d >= max(25, $acc)) $m += $d;
            }
            $out[] = ['lat' => round((float) $p['lat'], 6), 'lng' => round((float) $p['lng'], 6), 'at' => $p['capturedAt'], 'until' => $p['until'] ?? $p['capturedAt'], 'km' => round($m / 1000, 3)];
            $prev = $p;
        }
        return $out;
    }

    /** Km travelled on the clean path between two times. */
    private static function kmAt(array $path, ?string $t): float
    {
        if (!$path || !$t) return 0.0;
        $km = 0.0;
        foreach ($path as $p) { if ($p['at'] <= $t) $km = $p['km']; else break; }
        return $km;
    }

    /**
     * The day as pins, in order: start (punch in) → stops of 30+ min and customers reached → end (punch out,
     * or the last point while still working), each with the km from the pin before. Customers come from a
     * visit check-in, or from a 10+ min stay within the customer's saved location.
     */
    public static function pins(?array $att, array $pts, string $uid, string $date): array
    {
        $pts = self::withEnds($pts, $att);
        $path = self::cleanPath($pts);
        $use = self::usable($pts);
        $cand = [];
        foreach (self::stays($use, self::STOP_MINUTES) as $st) $cand[] = ['kind' => 'STOP', 'lat' => $st['lat'], 'lng' => $st['lng'], 'from' => $st['from'], 'to' => $st['to'], 'minutes' => $st['minutes']];
        // customers with a saved location near the day's route
        $custs = [];
        if ($use) {
            $la = array_column($use, 'lat'); $lo = array_column($use, 'lng');
            try {
                $c = db()->prepare('SELECT id, companyName, lat, lng, geoFenceRadius FROM `Customer` WHERE isActive=1 AND lat IS NOT NULL AND lng IS NOT NULL AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?');
                $c->execute([min($la) - 0.01, max($la) + 0.01, min($lo) - 0.01, max($lo) + 0.01]);
                $custs = $c->fetchAll();
            } catch (PDOException $e) {}
        }
        $near = function (float $lat, float $lng) use ($custs): ?array {
            $best = null; $bd = INF;
            foreach ($custs as $c) {
                $d = self::meters($lat, $lng, (float) $c['lat'], (float) $c['lng']);
                if ($d <= max(200, (float) ($c['geoFenceRadius'] ?? 0)) && $d < $bd) { $bd = $d; $best = $c; }
            }
            return $best;
        };
        foreach (self::stays($use, self::VISIT_MINUTES) as $st) {
            $c = $near($st['lat'], $st['lng']);
            if ($c) $cand[] = ['kind' => 'VISIT', 'lat' => $st['lat'], 'lng' => $st['lng'], 'from' => $st['from'], 'to' => $st['to'], 'minutes' => $st['minutes'], 'customerId' => $c['id'], 'customer' => $c['companyName'], 'how' => 'location'];
        }
        // visit check-ins (Meetings) on this day
        try {
            $m = db()->prepare("SELECT m.id, m.checkInLat, m.checkInLng, m.checkedInAt, m.visitDurationMinutes, m.timerEndedAt, m.meetingType, c.id AS cid, c.companyName, c.lat AS clat, c.lng AS clng
                FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId
                WHERE (m.userId=? OR m.assignedToId=?) AND m.checkedInAt>=? AND m.checkedInAt<? ORDER BY m.checkedInAt");
            $m->execute([$uid, $uid, $date . ' 00:00:00', date('Y-m-d 00:00:00', strtotime($date . ' +1 day'))]);
            foreach ($m->fetchAll() as $r) {
                $lat = $r['checkInLat'] !== null ? (float) $r['checkInLat'] : ($r['clat'] !== null ? (float) $r['clat'] : null);
                $lng = $r['checkInLng'] !== null ? (float) $r['checkInLng'] : ($r['clng'] !== null ? (float) $r['clng'] : null);
                if ($lat === null || $lng === null) continue;
                $mins = $r['visitDurationMinutes'] !== null ? (int) $r['visitDurationMinutes'] : ($r['timerEndedAt'] ? (int) round((strtotime($r['timerEndedAt']) - strtotime($r['checkedInAt'])) / 60) : 0);
                $cand[] = ['kind' => 'VISIT', 'lat' => $lat, 'lng' => $lng, 'from' => $r['checkedInAt'], 'to' => date('Y-m-d H:i:s', strtotime($r['checkedInAt']) + max(0, $mins) * 60), 'minutes' => max(0, $mins),
                           'customerId' => $r['cid'], 'customer' => $r['companyName'] ?: 'Customer visit', 'meetingId' => $r['id'], 'how' => 'check-in'];
            }
        } catch (PDOException $e) {}
        usort($cand, fn($x, $y) => strcmp($x['from'], $y['from']));
        // same place at the same time → one pin (a customer name wins over a plain stop)
        $pins = [];
        foreach ($cand as $c) {
            $hit = null;
            foreach ($pins as $k => $p) {
                $close = self::meters($p['lat'], $p['lng'], $c['lat'], $c['lng']) <= 250;
                $overlap = strtotime($c['from']) <= strtotime($p['to']) + 1800 && strtotime($c['to']) >= strtotime($p['from']) - 1800;
                if ($close && $overlap) { $hit = $k; break; }
            }
            if ($hit === null) { $pins[] = $c; continue; }
            $p = &$pins[$hit];
            if ($c['kind'] === 'VISIT' && ($p['kind'] !== 'VISIT' || ($c['how'] ?? '') === 'check-in')) { $p['kind'] = 'VISIT'; $p['customer'] = $c['customer']; $p['customerId'] = $c['customerId'] ?? null; $p['how'] = $c['how'] ?? null; if (!empty($c['meetingId'])) $p['meetingId'] = $c['meetingId']; }
            if ($c['from'] < $p['from']) $p['from'] = $c['from'];
            if ($c['to'] > $p['to']) $p['to'] = $c['to'];
            $p['minutes'] = (int) round((strtotime($p['to']) - strtotime($p['from'])) / 60);
            unset($p);
        }
        usort($pins, fn($x, $y) => strcmp($x['from'], $y['from']));
        // start and end
        if ($att && $att['checkIn']) {
            $sl = $att['checkInLat'] !== null ? (float) $att['checkInLat'] : ($path[0]['lat'] ?? null); $sg = $att['checkInLng'] !== null ? (float) $att['checkInLng'] : ($path[0]['lng'] ?? null);
            if ($sl !== null) array_unshift($pins, ['kind' => 'START', 'lat' => $sl, 'lng' => $sg, 'from' => $att['checkIn'], 'to' => $att['checkIn'], 'minutes' => 0]);
        }
        $last = $path ? end($path) : null;
        if ($att && $att['checkOut'] && $att['checkOutLat'] !== null) $pins[] = ['kind' => 'END', 'lat' => (float) $att['checkOutLat'], 'lng' => (float) $att['checkOutLng'], 'from' => $att['checkOut'], 'to' => $att['checkOut'], 'minutes' => 0];
        elseif ($last) $pins[] = ['kind' => $att && $att['checkOut'] ? 'END' : 'NOW', 'lat' => $last['lat'], 'lng' => $last['lng'], 'from' => $last['until'], 'to' => $last['until'], 'minutes' => 0];
        // number them and measure each leg on the clean path
        $prevT = null; $n = 0; $s = 0;
        foreach ($pins as $i => &$p) {
            $p['n'] = ++$n;
            if ($p['kind'] === 'STOP' || $p['kind'] === 'VISIT') $p['stopNo'] = ++$s;
            $p['kmFromPrev'] = $prevT === null ? 0.0 : round(max(0, self::kmAt($path, $p['from']) - self::kmAt($path, $prevT)), 2);
            $prevT = $p['to'];
        }
        unset($p);
        $legs = round(array_sum(array_column($pins, 'kmFromPrev')), 2);
        $customers = [];
        foreach ($pins as $p) if ($p['kind'] === 'VISIT') $customers[] = ['customer' => $p['customer'], 'customerId' => $p['customerId'] ?? null, 'at' => $p['from'], 'minutes' => $p['minutes'], 'how' => $p['how'] ?? null];
        return ['pins' => $pins, 'path' => $path, 'pinKm' => $legs, 'customers' => $customers];
    }

    /** Stops of 30+ minutes in one place (pinned on the map), numbered in order. */
    public static function stops(array $pts): array
    {
        $out = [];
        foreach (self::stays(self::usable($pts), self::STOP_MINUTES) as $n => $st) {
            unset($st['i'], $st['j']);
            $out[] = ['n' => $n + 1] + $st;
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

    // GET /api/tracking/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
    // Kilometres travelled per person over the period (GPS route, and the odometer km they entered),
    // days worked, location points, and how often the location went off.
    public function summary(): void
    {
        $auth = authenticate(); $this->requireViewer($auth);
        $from = to_date_only(qp('from')) ?? date('Y-m-01');
        $to = to_date_only(qp('to')) ?? date('Y-m-d');
        if ($to < $from) [$from, $to] = [$to, $from];
        $end = date('Y-m-d 00:00:00', strtotime($to . ' +1 day'));
        try { new AttendanceController(); } catch (Throwable $e) {}   // makes sure manualKm exists
        $att = db()->prepare("SELECT a.id, a.userId, a.date, a.manualKm, a.checkIn, a.checkInLat, a.checkInLng, a.checkOut, a.checkOutLat, a.checkOutLng, u.name, u.role FROM `Attendance` a JOIN `User` u ON u.id=a.userId
                              WHERE a.date>=? AND a.date<? AND a.checkIn IS NOT NULL ORDER BY u.name, a.date");
        $att->execute([$from . ' 00:00:00', $end]);
        $pp = db()->prepare('SELECT lat, lng, accuracy, capturedAt FROM `LocationPing` WHERE attendanceId=? ORDER BY capturedAt');
        $odo = [];
        try {
            $o = db()->prepare("SELECT userId, SUM(COALESCE(officialKm, IF(closingMeter IS NOT NULL, closingMeter-openingMeter, 0))) AS km FROM `FuelExpense` WHERE date>=? AND date<? GROUP BY userId");
            $o->execute([$from . ' 00:00:00', $end]);
            foreach ($o->fetchAll() as $r) $odo[$r['userId']] = (float) $r['km'];
        } catch (PDOException $e) {}
        $off = [];
        $s = db()->prepare("SELECT userId, COUNT(*) AS n FROM `StationaryLog` WHERE eventType='LOCATION_OFF' AND detectedAt>=? AND detectedAt<? GROUP BY userId");
        $s->execute([$from . ' 00:00:00', $end]);
        foreach ($s->fetchAll() as $r) $off[$r['userId']] = (int) $r['n'];
        $people = [];
        foreach ($att->fetchAll() as $a) {
            $pp->execute([$a['id']]);
            $pts = $pp->fetchAll();
            $km = self::distanceKm($pts, $a);
            $x = &$people[$a['userId']];
            $x = $x ?? ['id' => $a['userId'], 'name' => $a['name'], 'role' => $a['role'], 'days' => 0, 'km' => 0.0, 'manualKm' => 0.0, 'points' => 0, 'perDay' => []];
            $mk = $a['manualKm'] !== null ? (float) $a['manualKm'] : 0.0;   // km typed at punch out for the time GPS was off
            $x['days']++; $x['km'] += $km; $x['manualKm'] += $mk; $x['points'] += count($pts);
            $x['perDay'][] = ['date' => substr($a['date'], 0, 10), 'km' => round($km, 2), 'manualKm' => $mk ?: null, 'points' => count($pts)];
            unset($x);
        }
        $out = array_values(array_map(function ($p) use ($odo, $off) {
            $p['km'] = round($p['km'], 1); $p['manualKm'] = round($p['manualKm'], 1); $p['totalKm'] = round($p['km'] + $p['manualKm'], 1);
            $p['odometerKm'] = isset($odo[$p['id']]) ? round($odo[$p['id']], 1) : null;
            $p['locationOff'] = $off[$p['id']] ?? 0;
            return $p;
        }, $people));
        usort($out, fn($a, $b) => $b['km'] <=> $a['km']);
        sendSuccess(['from' => $from, 'to' => $to, 'people' => $out,
                     'totals' => ['km' => round(array_sum(array_column($out, 'km')), 1), 'days' => array_sum(array_column($out, 'days')),
                                  'odometerKm' => round(array_sum(array_map(fn($p) => (float) $p['odometerKm'], $out)), 1)]]);
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
            'points' => $pts, 'breaks' => $breaks, 'events' => $events, 'stops' => ($stops = self::stops(self::withEnds($pts, $att))),
            'pins' => ($pp = self::pins($att, $pts, $uid, $date))['pins'], 'path' => $pp['path'], 'customers' => $pp['customers'],
            'stats' => [
                'points' => count($pts), 'distanceKm' => round(self::distanceKm($pts, $att), 2), 'pinKm' => $pp['pinKm'], 'customersReached' => count($pp['customers']),
                'manualKm' => $att && isset($att['manualKm']) && $att['manualKm'] !== null ? (float) $att['manualKm'] : null,
                'stops' => count($stops), 'stoppedMinutes' => array_sum(array_column($stops, 'minutes')), 'stopMinutes' => self::STOP_MINUTES,
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
        $lat = is_numeric($b['lat'] ?? null) ? (float) $b['lat'] : null; $lng = is_numeric($b['lng'] ?? null) ? (float) $b['lng'] : null;
        if ($lat === null && $type === 'LOCATION_OFF') {   // where it went off: the last point we have
            $p = db()->prepare('SELECT lat, lng FROM `LocationPing` WHERE attendanceId=? ORDER BY capturedAt DESC LIMIT 1');
            $p->execute([$att['id']]);
            if ($last = $p->fetch()) { $lat = (float) $last['lat']; $lng = (float) $last['lng']; }
            elseif ($att['checkInLat'] !== null) { $lat = (float) $att['checkInLat']; $lng = (float) $att['checkInLng']; }
        }
        db()->prepare('INSERT INTO `StationaryLog` (id,userId,attendanceId,eventType,sinceAt,detectedAt,minutes,lat,lng,createdAt) VALUES (?,?,?,?,?,?,?,?,?,?)')
            ->execute([gen_id(), $auth['id'], $att['id'], $type, to_dt($b['sinceAt'] ?? null), now_sql(),
                       is_numeric($b['minutes'] ?? null) ? (int) $b['minutes'] : null, $lat, $lng, now_sql()]);
        sendSuccess([], 'Recorded', 201);
    }
}

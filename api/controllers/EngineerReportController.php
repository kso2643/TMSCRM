<?php
/**
 * Engineer day summary + performance report (v11.45) — Super Admin / Admin / Manager.
 *
 *   GET /api/engineer-report/day?date=YYYY-MM-DD
 *       Every field engineer's day: the plan (appointments, follow-ups due) and what was done —
 *       punch in / out, hours, km travelled, stops, visits (joint or alone), orders and value,
 *       quotations, price requests — plus team totals. (Mobile "day summary".)
 *
 *   GET /api/engineer-report/performance?from=&to=[&userId=][&format=excel|pdf]
 *       With userId: the engineer's detailed report — where he went (every visit with customer,
 *       time, duration, joint), how far he travelled (GPS km, odometer km, stops), how long he
 *       worked, follow-ups, orders (number, customer, value) and quotations, day by day.
 *       Without userId: one summary line per engineer for the period.
 */
class EngineerReportController extends ExportController
{
    private static function auth(): array
    {
        $a = authenticate();
        if (!is_admin_tier($a['role'])) sendError('Only Super Admin, Admin or Manager can see engineer reports.', 403);
        new MeetingController();   // joint-visit / follow-up columns
        return $a;
    }

    private static function rows(string $sql, array $p): array
    {
        try { $s = db()->prepare($sql); $s->execute($p); return $s->fetchAll(); } catch (Throwable $e) { return []; }
    }

    /** Field engineers + anyone who punched in during the period. */
    private static function people(string $from, string $end, ?string $only = null): array
    {
        if ($only) return self::rows('SELECT id, name, role, department FROM `User` WHERE id=?', [$only]);
        return self::rows("SELECT id, name, role, department FROM `User` u WHERE u.isActive=1 AND (u.role IN ('SALES','SALES_ENGINEER','MANAGER')
                OR EXISTS (SELECT 1 FROM `Attendance` a WHERE a.userId=u.id AND a.date>=? AND a.date<? AND a.checkIn IS NOT NULL)) ORDER BY u.name", [$from, $end]);
    }

    private static function hrs($in, $out): float
    {
        if (!$in) return 0.0;
        $o = $out ? strtotime($out) : min(time(), strtotime(substr($in, 0, 10) . ' 23:59:59'));
        return max(0, round(($o - strtotime($in)) / 3600, 2));
    }

    /** Everything about one engineer in [from, end). */
    private static function collect(array $u, string $from, string $end, bool $detail): array
    {
        $uid = $u['id']; $like = '%"' . $uid . '"%';
        $days = [];
        $day = function ($d) use (&$days) {
            $d = substr((string) $d, 0, 10);
            if (!isset($days[$d])) $days[$d] = ['date' => $d, 'checkIn' => null, 'checkOut' => null, 'hours' => 0.0, 'km' => 0.0, 'odometerKm' => null, 'stops' => 0,
                'visits' => 0, 'customers' => [], 'joint' => 0, 'orders' => 0, 'orderValue' => 0.0, 'quotations' => 0, 'quoteValue' => 0.0];
            return $d;
        };
        // attendance, km, stops
        $att = self::rows('SELECT id, date, checkIn, checkOut, lateMinutes, checkInLat, checkInLng, checkOutLat, checkOutLng FROM `Attendance` WHERE userId=? AND date>=? AND date<? AND checkIn IS NOT NULL ORDER BY date', [$uid, $from, $end]);
        $pp = db()->prepare('SELECT lat, lng, accuracy, capturedAt FROM `LocationPing` WHERE attendanceId=? ORDER BY capturedAt');
        $stopsAll = [];
        foreach ($att as $a) {
            $d = $day($a['date']);
            $pp->execute([$a['id']]); $pts = $pp->fetchAll();
            $st = LocationHistoryController::stops($pts);
            $days[$d]['checkIn'] = $a['checkIn']; $days[$d]['checkOut'] = $a['checkOut'];
            $days[$d]['hours'] = self::hrs($a['checkIn'], $a['checkOut']);
            $days[$d]['km'] = round(LocationHistoryController::distanceKm($pts, $a), 2);
            $days[$d]['stops'] = count($st);
            $days[$d]['late'] = $a['lateMinutes'] !== null ? (int) $a['lateMinutes'] : null;
            foreach ($st as $x) $stopsAll[] = $x + ['date' => $d];
        }
        foreach (self::rows('SELECT date, COALESCE(officialKm, IF(closingMeter IS NOT NULL, closingMeter-openingMeter, NULL)) AS km FROM `FuelExpense` WHERE userId=? AND date>=? AND date<?', [$uid, $from, $end]) as $f)
            if ($f['km'] !== null) { $d = $day($f['date']); $days[$d]['odometerKm'] = round((float) $f['km'], 1); }
        // visits (own) and joint visits as a colleague
        $visits = self::rows("SELECT m.id, m.meetingDate, m.meetingType, m.status, m.summary, m.notes, m.checkedInAt, m.visitDurationMinutes, m.isGeoVerified,
                    m.jointVisit, m.jointWith, m.jointOthers, m.nextFollowUp, m.userId, c.companyName, c.location, u.name AS byName
             FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId LEFT JOIN `User` u ON u.id=m.userId
             WHERE (m.userId=? OR m.jointWith LIKE ?) AND m.meetingDate>=? AND m.meetingDate<? ORDER BY m.meetingDate", [$uid, $like, $from, $end]);
        $vlist = []; $types = []; $cust = []; $jointOwn = 0; $jointAsColleague = 0; $verified = 0; $visitMinutes = 0;
        foreach ($visits as $v) {
            $d = $day($v['meetingDate']);
            $mine = $v['userId'] === $uid;
            $jw = json_decode((string) ($v['jointWith'] ?? ''), true) ?: [];
            $with = array_values(array_filter(array_map(fn($i) => $i === $uid ? null : self::name($i), array_merge($mine ? [] : [$v['userId']], $jw))));
            if ($v['jointOthers']) $with[] = $v['jointOthers'];
            if ($mine) { $types[$v['meetingType']] = ($types[$v['meetingType']] ?? 0) + 1; if ($v['jointVisit']) $jointOwn++; } else $jointAsColleague++;
            if ($v['isGeoVerified']) $verified++;
            $visitMinutes += (int) $v['visitDurationMinutes'];
            $cn = $v['companyName'] ?: '—';
            $cust[$cn] = ($cust[$cn] ?? 0) + 1;
            $days[$d]['visits']++; $days[$d]['customers'][$cn] = true; if ($v['jointVisit'] || !$mine) $days[$d]['joint']++;
            $vlist[] = ['id' => $v['id'], 'at' => $v['meetingDate'], 'customer' => $cn, 'location' => $v['location'], 'type' => $v['meetingType'], 'status' => $v['status'],
                'minutes' => $v['visitDurationMinutes'] !== null ? (int) $v['visitDurationMinutes'] : null, 'checkedIn' => $v['checkedInAt'], 'verified' => (bool) $v['isGeoVerified'],
                'joint' => (bool) $v['jointVisit'] || !$mine, 'with' => $with, 'loggedBy' => $mine ? null : $v['byName'],
                'summary' => mb_substr(trim((string) ($v['summary'] ?: $v['notes'])), 0, 300)];
        }
        // plan: appointments + follow-ups due
        $appts = self::rows("SELECT a.title, a.appointmentDate, a.appointmentTime, a.status, a.visitStatus, c.companyName FROM `Appointment` a LEFT JOIN `Customer` c ON c.id=a.customerId
             WHERE (a.userId=? OR a.assignedToId=?) AND a.appointmentDate>=? AND a.appointmentDate<? ORDER BY a.appointmentDate, a.appointmentTime", [$uid, $uid, $from, $end]);
        $fus = self::rows("SELECT m.id, m.nextFollowUp, m.followUpTime, m.status, c.companyName,
                (SELECT COUNT(*) FROM `Meeting` x WHERE x.customerId=m.customerId AND x.id<>m.id AND x.meetingDate>=DATE(m.nextFollowUp) AND (x.userId=? OR x.jointWith LIKE ?)) AS done
             FROM `Meeting` m LEFT JOIN `Customer` c ON c.id=m.customerId
             WHERE (m.userId=? OR m.assignedToId=? OR m.followUpAssignees LIKE ?) AND m.nextFollowUp>=? AND m.nextFollowUp<? ORDER BY m.nextFollowUp", [$uid, $like, $uid, $uid, $like, $from, $end]);
        $overdue = self::rows("SELECT COUNT(*) AS n FROM `Meeting` m WHERE (m.userId=? OR m.assignedToId=? OR m.followUpAssignees LIKE ?) AND m.nextFollowUp<? AND m.status NOT IN ('CLOSED','LOST')", [$uid, $uid, $like, now_sql()]);
        // orders, invoices, quotations, price requests, trials
        $orders = self::rows("SELECT o.id, o.orderNo, o.orderDate, o.createdAt, o.orderType, o.firm, o.orderValue, o.deliveryStatus, c.companyName FROM `CustomerOrder` o LEFT JOIN `Customer` c ON c.id=o.customerId
             WHERE o.engineerId=? AND o.createdAt>=? AND o.createdAt<? ORDER BY o.createdAt", [$uid, $from, $end]);
        $ov = 0.0; $byFirm = [];
        foreach ($orders as $o) {
            $d = $day($o['createdAt']); $val = (float) $o['orderValue'];
            $days[$d]['orders']++; $days[$d]['orderValue'] += $val; $ov += $val;
            $f = $o['firm'] ?: '—'; $byFirm[$f] = ['count' => ($byFirm[$f]['count'] ?? 0) + 1, 'value' => round(($byFirm[$f]['value'] ?? 0) + $val, 2)];
        }
        $inv = self::rows("SELECT COUNT(*) AS n, COALESCE(SUM(i.amount),0) AS v FROM `OrderInvoice` i JOIN `CustomerOrder` o ON o.id=i.orderId WHERE o.engineerId=? AND i.createdAt>=? AND i.createdAt<?", [$uid, $from, $end]);
        $quotes = self::rows("SELECT q.quotationNumber, q.createdAt, q.totalAmount, q.company, q.status, c.companyName FROM `Quotation` q LEFT JOIN `Customer` c ON c.id=q.customerId
             WHERE q.userId=? AND q.createdAt>=? AND q.createdAt<? ORDER BY q.createdAt", [$uid, $from, $end]);
        $qv = 0.0;
        foreach ($quotes as $q) { $d = $day($q['createdAt']); $days[$d]['quotations']++; $days[$d]['quoteValue'] += (float) $q['totalAmount']; $qv += (float) $q['totalAmount']; }
        $prs = self::rows("SELECT COUNT(*) AS n FROM `PriceRequestBatch` WHERE requestedById=? AND createdAt>=? AND createdAt<?", [$uid, $from, $end]);
        $trials = self::rows("SELECT COUNT(*) AS n FROM `Trial` WHERE requestedById=? AND createdAt>=? AND createdAt<?", [$uid, $from, $end]);

        ksort($days);
        $dayList = array_values(array_map(function ($d) {
            $d['customers'] = array_keys($d['customers']); $d['orderValue'] = round($d['orderValue'], 2); $d['quoteValue'] = round($d['quoteValue'], 2); return $d;
        }, $days));
        $present = count(array_filter($dayList, fn($d) => $d['checkIn']));
        $own = array_sum($types);
        arsort($cust);
        $sum = [
            'daysPresent' => $present, 'hours' => round(array_sum(array_column($dayList, 'hours')), 1),
            'km' => round(array_sum(array_column($dayList, 'km')), 1), 'odometerKm' => round(array_sum(array_map(fn($d) => (float) $d['odometerKm'], $dayList)), 1),
            'stops' => count($stopsAll), 'stopMinutes' => array_sum(array_column($stopsAll, 'minutes')),
            'visits' => $own, 'visitTypes' => $types, 'jointVisits' => $jointOwn, 'jointAsColleague' => $jointAsColleague, 'geoVerified' => $verified,
            'visitMinutes' => $visitMinutes, 'customersVisited' => count($cust),
            'appointments' => count($appts), 'appointmentsVisited' => count(array_filter($appts, fn($a) => in_array($a['visitStatus'], ['VISITED', 'DONE', 'COMPLETED'], true))),
            'followUpsDue' => count($fus), 'followUpsDone' => count(array_filter($fus, fn($f) => (int) $f['done'] > 0)), 'followUpsOverdue' => (int) ($overdue[0]['n'] ?? 0),
            'orders' => count($orders), 'orderValue' => round($ov, 2), 'ordersByFirm' => $byFirm,
            'invoices' => (int) ($inv[0]['n'] ?? 0), 'invoiceValue' => round((float) ($inv[0]['v'] ?? 0), 2),
            'quotations' => count($quotes), 'quoteValue' => round($qv, 2), 'priceRequests' => (int) ($prs[0]['n'] ?? 0), 'trials' => (int) ($trials[0]['n'] ?? 0),
            'kmPerDay' => $present ? round(array_sum(array_column($dayList, 'km')) / $present, 1) : 0, 'visitsPerDay' => $present ? round($own / $present, 1) : 0,
            'conversion' => $own ? round(count($orders) / $own * 100) : 0,
        ];
        $out = ['user' => $u, 'summary' => $sum];
        if ($detail) {
            $out += ['days' => $dayList, 'visits' => $vlist, 'stops' => $stopsAll, 'topCustomers' => array_slice(array_map(fn($k, $v) => ['customer' => $k, 'visits' => $v], array_keys($cust), $cust), 0, 10),
                'appointments' => $appts, 'followUps' => array_map(fn($f) => ['at' => $f['nextFollowUp'], 'time' => $f['followUpTime'], 'customer' => $f['companyName'], 'status' => $f['status'], 'done' => (int) $f['done'] > 0, 'meetingId' => $f['id']], $fus),
                'orders' => array_map(fn($o) => ['orderNo' => $o['orderNo'], 'date' => substr($o['createdAt'], 0, 10), 'customer' => $o['companyName'], 'type' => $o['orderType'], 'firm' => $o['firm'],
                    'value' => $o['orderValue'] !== null ? (float) $o['orderValue'] : null, 'delivery' => $o['deliveryStatus']], $orders),
                'quotations' => array_map(fn($q) => ['number' => $q['quotationNumber'], 'date' => substr($q['createdAt'], 0, 10), 'customer' => $q['companyName'], 'value' => (float) $q['totalAmount'], 'status' => $q['status']], $quotes)];
        }
        return $out;
    }

    private static function name(?string $id): ?string
    {
        static $c = [];
        if (!$id) return null;
        if (!array_key_exists($id, $c)) { $q = db()->prepare('SELECT name FROM `User` WHERE id=?'); $q->execute([$id]); $c[$id] = $q->fetchColumn() ?: null; }
        return $c[$id];
    }

    // GET /api/engineer-report/day?date=
    public function day(): void
    {
        self::auth();
        $date = to_date_only(qp('date')) ?? date('Y-m-d');
        $from = $date . ' 00:00:00'; $end = date('Y-m-d 00:00:00', strtotime($date . ' +1 day'));
        $team = [];
        foreach (self::people($from, $end) as $u) {
            $r = self::collect($u, $from, $end, true);
            $d = $r['days'][0] ?? null;
            $team[] = ['user' => $u, 'summary' => $r['summary'], 'checkIn' => $d['checkIn'] ?? null, 'checkOut' => $d['checkOut'] ?? null, 'late' => $d['late'] ?? null,
                'plan' => ['appointments' => $r['appointments'], 'followUps' => $r['followUps']], 'visits' => $r['visits'], 'orders' => $r['orders'], 'quotations' => $r['quotations'], 'stops' => $r['stops']];
        }
        usort($team, fn($a, $b) => [$b['checkIn'] ? 1 : 0, $b['summary']['visits']] <=> [$a['checkIn'] ? 1 : 0, $a['summary']['visits']]);
        $t = fn($k) => array_sum(array_map(fn($x) => $x['summary'][$k], $team));
        sendSuccess(['date' => $date, 'team' => $team, 'totals' => [
            'engineers' => count($team), 'present' => count(array_filter($team, fn($x) => $x['checkIn'])),
            'planned' => $t('appointments') + $t('followUpsDue'), 'visits' => $t('visits'), 'jointVisits' => $t('jointVisits'), 'km' => round($t('km'), 1), 'hours' => round($t('hours'), 1),
            'orders' => $t('orders'), 'orderValue' => round($t('orderValue'), 2), 'quotations' => $t('quotations'), 'quoteValue' => round($t('quoteValue'), 2), 'priceRequests' => $t('priceRequests'),
        ]]);
    }

    // GET /api/engineer-report/performance?from=&to=[&userId=][&format=excel|pdf]
    public function performance(): void
    {
        self::auth();
        $from = to_date_only(qp('from')) ?? date('Y-m-01');
        $to = to_date_only(qp('to')) ?? date('Y-m-d');
        if ($to < $from) [$from, $to] = [$to, $from];
        $f0 = $from . ' 00:00:00'; $end = date('Y-m-d 00:00:00', strtotime($to . ' +1 day'));
        $uid = trim((string) qp('userId', ''));
        $fmt = strtolower((string) qp('format', ''));
        $money = fn($v) => $v ? '₹' . number_format((float) $v, 2) : '';
        if ($uid !== '') {
            $ppl = self::people($f0, $end, $uid);
            if (!$ppl) sendError('Engineer not found.', 404);
            $r = self::collect($ppl[0], $f0, $end, true);
            if (in_array($fmt, ['excel', 'xlsx', 'pdf', 'csv'], true)) {
                $s = $r['summary'];
                $title = 'Engineer performance — ' . $ppl[0]['name'] . ' — ' . date('d M Y', strtotime($from)) . ' to ' . date('d M Y', strtotime($to)) .
                    ' | ' . $s['daysPresent'] . ' days, ' . $s['hours'] . ' h, ' . $s['km'] . ' km, ' . $s['visits'] . ' visits (' . $s['jointVisits'] . ' joint), ' .
                    $s['orders'] . ' orders ' . $money($s['orderValue']) . ', ' . $s['quotations'] . ' quotations ' . $money($s['quoteValue']);
                $this->sendExport($r['days'], [
                    ['label' => 'Date', 'value' => fn($d) => date('d/m/Y', strtotime($d['date']))],
                    ['label' => 'Punch in', 'value' => fn($d) => $d['checkIn'] ? date('g:i a', strtotime($d['checkIn'])) : ''],
                    ['label' => 'Punch out', 'value' => fn($d) => $d['checkOut'] ? date('g:i a', strtotime($d['checkOut'])) : ''],
                    ['label' => 'Hours', 'value' => fn($d) => $d['hours'] ?: ''],
                    ['label' => 'GPS km', 'value' => fn($d) => $d['km'] ?: ''],
                    ['label' => 'Odometer km', 'value' => fn($d) => $d['odometerKm'] ?? ''],
                    ['label' => 'Stops (20+ min)', 'value' => fn($d) => $d['stops'] ?: ''],
                    ['label' => 'Visits', 'value' => fn($d) => $d['visits'] ?: ''],
                    ['label' => 'Joint', 'value' => fn($d) => $d['joint'] ?: ''],
                    ['label' => 'Where he went (customers)', 'value' => fn($d) => implode(', ', $d['customers'])],
                    ['label' => 'Orders', 'value' => fn($d) => $d['orders'] ?: ''],
                    ['label' => 'Order value', 'value' => fn($d) => $money($d['orderValue'])],
                    ['label' => 'Quotations', 'value' => fn($d) => $d['quotations'] ?: ''],
                    ['label' => 'Quote value', 'value' => fn($d) => $money($d['quoteValue'])],
                ], 'engineer-performance-' . preg_replace('/[^a-z0-9]+/i', '-', $ppl[0]['name']) . '-' . $from . '-' . $to, $title);
            }
            sendSuccess(['from' => $from, 'to' => $to] + $r);
        }
        $team = array_map(fn($u) => self::collect($u, $f0, $end, false), self::people($f0, $end));
        usort($team, fn($a, $b) => $b['summary']['orderValue'] <=> $a['summary']['orderValue'] ?: $b['summary']['visits'] <=> $a['summary']['visits']);
        if (in_array($fmt, ['excel', 'xlsx', 'pdf', 'csv'], true)) {
            $this->sendExport($team, [
                ['label' => 'Engineer', 'value' => fn($t) => $t['user']['name']],
                ['label' => 'Days', 'value' => fn($t) => $t['summary']['daysPresent']],
                ['label' => 'Hours', 'value' => fn($t) => $t['summary']['hours']],
                ['label' => 'GPS km', 'value' => fn($t) => $t['summary']['km']],
                ['label' => 'Odometer km', 'value' => fn($t) => $t['summary']['odometerKm'] ?: ''],
                ['label' => 'Visits', 'value' => fn($t) => $t['summary']['visits']],
                ['label' => 'Joint visits', 'value' => fn($t) => $t['summary']['jointVisits'] + $t['summary']['jointAsColleague']],
                ['label' => 'Customers visited', 'value' => fn($t) => $t['summary']['customersVisited']],
                ['label' => 'Follow-ups due / done', 'value' => fn($t) => $t['summary']['followUpsDue'] . ' / ' . $t['summary']['followUpsDone']],
                ['label' => 'Orders', 'value' => fn($t) => $t['summary']['orders']],
                ['label' => 'Order value', 'value' => fn($t) => $money($t['summary']['orderValue'])],
                ['label' => 'Quotations', 'value' => fn($t) => $t['summary']['quotations']],
                ['label' => 'Quote value', 'value' => fn($t) => $money($t['summary']['quoteValue'])],
                ['label' => 'Price requests', 'value' => fn($t) => $t['summary']['priceRequests']],
            ], 'engineer-performance-team-' . $from . '-' . $to, 'Engineer performance — team — ' . date('d M Y', strtotime($from)) . ' to ' . date('d M Y', strtotime($to)));
        }
        sendSuccess(['from' => $from, 'to' => $to, 'team' => $team]);
    }
}

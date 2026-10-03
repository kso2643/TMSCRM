<?php
/**
 * Downloads for the modules added after the original build, so the
 * Reports page covers every page: Orders, Tasks, Price requests, Trials,
 * Appointments, Breaks, and a daily location-tracking summary.
 *
 * GET /api/reports/<name>?from=YYYY-MM-DD&to=YYYY-MM-DD&format=csv|excel|pdf
 *
 * Same output (CSV / Excel / PDF) and date-range rules as ExportController,
 * whose helpers this reuses. Manager and above, like the existing reports.
 * Each report reads a table that may not exist yet if its module was never
 * opened; that gives an empty report instead of an error.
 */
class ReportsController extends ExportController
{
    private function rows(string $sql, array $params): array
    {
        try {
            $s = db()->prepare($sql);
            $s->execute($params);
            return $s->fetchAll();
        } catch (PDOException $e) {
            if ($e->getCode() === '42S02') return []; // table doesn't exist yet
            throw $e;
        }
    }
    private static function d(?string $v): string { return $v ? date('d/m/Y', strtotime($v)) : ''; }
    private static function dt(?string $v): string { return $v ? date('d/m/Y h:i A', strtotime($v)) : ''; }
    private static function hms($sec): string
    {
        $sec = (int) $sec;
        return sprintf('%02d:%02d:%02d', intdiv($sec, 3600), intdiv($sec % 3600, 60), $sec % 60);
    }
    private function where(string $col, array $extra = []): array
    {
        [$c, $p] = $this->dateRange($col);
        $c = array_merge($c, $extra);
        return [$c ? 'WHERE ' . implode(' AND ', $c) : '', $p];
    }

    // GET /api/reports/orders
    public function orders(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('o.orderDate');
        $rows = $this->rows(
            "SELECT o.*, c.companyName, u.name AS engineerName,
                    (SELECT GROUP_CONCAT(CONCAT(i.productName, ' x', i.quantity, IF(i.supplied=1, ' (supplied)', '')) SEPARATOR '; ')
                       FROM `CustomerOrderItem` i WHERE i.orderId=o.id) AS items
             FROM `CustomerOrder` o
             LEFT JOIN `Customer` c ON c.id=o.customerId
             LEFT JOIN `User` u ON u.id=o.engineerId
             $w ORDER BY o.orderDate DESC", $p);
        $this->sendExport($rows, [
            ['label' => 'Order date',      'value' => fn($r) => self::d($r['orderDate'])],
            ['label' => 'Customer',        'value' => fn($r) => $r['companyName'] ?? ''],
            ['label' => 'Sales engineer',  'value' => fn($r) => $r['engineerName'] ?? ''],
            ['label' => 'Type',            'value' => fn($r) => $r['orderType']],
            ['label' => 'Items',           'value' => fn($r) => $r['items'] ?? ''],
            ['label' => 'Price/proforma',  'value' => fn($r) => $r['proformaStatus'] ?? ''],
            ['label' => 'Procurement',     'value' => fn($r) => $r['procurementStatus'] ?? ''],
            ['label' => 'Expected date',   'value' => fn($r) => self::d($r['expectedDeliveryDate'] ?? null)],
            ['label' => 'Delivery',        'value' => fn($r) => $r['deliveryStatus']],
            ['label' => 'Delivered date',  'value' => fn($r) => self::d($r['deliveredDate'])],
            ['label' => 'Reason',          'value' => fn($r) => $r['notDeliveredReason'] ?? ''],
        ], 'orders-' . $this->stamp(), 'Orders Report');
    }

    // GET /api/reports/tasks
    public function tasks(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('t.createdAt');
        $rows = $this->rows(
            "SELECT t.*, a.name AS toName, b.name AS byName, c.companyName FROM `AdminTask` t
             LEFT JOIN `User` a ON a.id=t.assignedToId LEFT JOIN `User` b ON b.id=t.assignedById
             LEFT JOIN `Customer` c ON c.id=t.customerId
             $w ORDER BY t.createdAt DESC", $p);
        $this->sendExport($rows, [
            ['label' => 'Task',          'value' => fn($r) => $r['title']],
            ['label' => 'Assigned to',   'value' => fn($r) => $r['toName'] ?? ''],
            ['label' => 'Assigned by',   'value' => fn($r) => $r['byName'] ?? ''],
            ['label' => 'Customer',      'value' => fn($r) => $r['companyName'] ?? ''],
            ['label' => 'Priority',      'value' => fn($r) => $r['priority']],
            ['label' => 'Status',        'value' => fn($r) => $r['status']],
            ['label' => 'Assigned at',   'value' => fn($r) => self::dt($r['createdAt'])],
            ['label' => 'Started at',    'value' => fn($r) => self::dt($r['startedAt'])],
            ['label' => 'Completed at',  'value' => fn($r) => self::dt($r['completedAt'])],
            ['label' => 'Time worked',   'value' => fn($r) => self::hms($r['workedSeconds'])],
            ['label' => 'Due date',      'value' => fn($r) => self::d($r['dueDate'])],
            ['label' => 'Completion note','value' => fn($r) => $r['completionNote'] ?? ''],
        ], 'tasks-' . $this->stamp(), 'Tasks Report');
    }

    // GET /api/reports/price-requests
    public function priceRequests(): void
    {
        $auth = authenticate(); require_manager($auth);
        try { ensure_schema(PriceRequestController::schema(), 'migration_tasks_price_requests.sql'); } catch (Throwable $e) {}
        [$w, $p] = $this->where('r.createdAt');
        $rows = $this->rows(
            "SELECT r.*, u.name AS byName, a.name AS respName, c.companyName, b.requestNo FROM `PriceRequest` r
             LEFT JOIN `User` u ON u.id=r.requestedById LEFT JOIN `User` a ON a.id=r.respondedById
             LEFT JOIN `Customer` c ON c.id=r.customerId LEFT JOIN `PriceRequestBatch` b ON b.id=r.batchId
             $w ORDER BY r.createdAt DESC, r.batchId, r.sortOrder", $p);
        $this->sendExport($rows, [
            ['label' => 'Raised',          'value' => fn($r) => self::dt($r['createdAt'])],
            ['label' => 'Request no.',     'value' => fn($r) => $r['requestNo'] ?? ''],
            ['label' => 'Requested by',    'value' => fn($r) => $r['byName'] ?? ''],
            ['label' => 'Customer',        'value' => fn($r) => $r['companyName'] ?? ''],
            ['label' => 'Product',         'value' => fn($r) => $r['productName'] . ($r['itemCode'] ? ' (' . $r['itemCode'] . ')' : '')],
            ['label' => 'Category',        'value' => fn($r) => $r['category'] ?? ''],
            ['label' => 'Brand',           'value' => fn($r) => $r['brand'] ?? ''],
            ['label' => 'Regular / One time', 'value' => fn($r) => PriceRequestController::SUPPLY_TYPES[$r['supplyType'] ?? ''] ?? ''],
            ['label' => 'Qty',             'value' => fn($r) => ($r['quantity'] ?? '') . (!empty($r['unit']) ? ' ' . $r['unit'] : '')],
            ['label' => 'List price',      'value' => fn($r) => $r['listPrice'] ?? ''],
            ['label' => 'Asked price',     'value' => fn($r) => $r['requestedPrice'] ?? ''],
            ['label' => 'Asked discount %', 'value' => fn($r) => $r['discount'] ?? ''],
            ['label' => 'Engineer note',   'value' => fn($r) => $r['notes'] ?? ''],
            ['label' => 'Status',          'value' => fn($r) => $r['status']],
            ['label' => 'Approved price',  'value' => fn($r) => $r['approvedPrice'] ?? ''],
            ['label' => 'Approved discount %', 'value' => fn($r) => $r['approvedDiscount'] ?? ''],
            ['label' => 'Decided by',      'value' => fn($r) => $r['respName'] ?? ''],
            ['label' => 'Note',            'value' => fn($r) => $r['responseNote'] ?? ''],
        ], 'price-requests-' . $this->stamp(), 'Price Requests Report');
    }

    // GET /api/reports/trials
    public function trials(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('t.createdAt');
        $rows = $this->rows(
            "SELECT t.id, t.trialNo, t.customerName, t.component, t.status, t.recommendations, t.approvalNote, t.decidedAt,
                    t.bestTool, t.savingsPerYear, t.savingsPct, t.completedAt, t.createdAt,
                    u.name AS byName, d.name AS decName, c.companyName
             FROM `Trial` t LEFT JOIN `User` u ON u.id=t.requestedById LEFT JOIN `User` d ON d.id=t.decidedById
             LEFT JOIN `Customer` c ON c.id=t.customerId
             $w ORDER BY t.createdAt DESC", $p);
        $recs = function ($r) {
            $a = json_decode((string) $r['recommendations'], true) ?: [];
            return implode('; ', array_map(fn($x) => $x['category'] . ': ' . $x['spec'] . (!empty($x['grade']) ? ' / ' . $x['grade'] : ''), $a));
        };
        $this->sendExport($rows, [
            ['label' => 'Trial no.',       'value' => fn($r) => $r['trialNo']],
            ['label' => 'Raised',          'value' => fn($r) => self::d($r['createdAt'])],
            ['label' => 'Customer',        'value' => fn($r) => $r['companyName'] ?: ($r['customerName'] ?? '')],
            ['label' => 'Component',       'value' => fn($r) => $r['component'] ?? ''],
            ['label' => 'Requested by',    'value' => fn($r) => $r['byName'] ?? ''],
            ['label' => 'Status',          'value' => fn($r) => $r['status']],
            ['label' => 'Recommendation',  'value' => $recs],
            ['label' => 'Decided by',      'value' => fn($r) => $r['decName'] ?? ''],
            ['label' => 'Best tool',       'value' => fn($r) => $r['bestTool'] ?? ''],
            ['label' => 'Saving / year',   'value' => fn($r) => $r['savingsPerYear'] ?? ''],
            ['label' => 'Saving %',        'value' => fn($r) => $r['savingsPct'] ?? ''],
            ['label' => 'Completed',       'value' => fn($r) => self::d($r['completedAt'])],
        ], 'trials-' . $this->stamp(), 'Trials Report');
    }

    // GET /api/reports/appointments
    public function appointments(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('a.appointmentDate');
        $rows = $this->rows(
            "SELECT a.*, c.companyName, u.name AS byName, e.name AS engName FROM `Appointment` a
             LEFT JOIN `Customer` c ON c.id=a.customerId LEFT JOIN `User` u ON u.id=a.userId LEFT JOIN `User` e ON e.id=a.assignedToId
             $w ORDER BY a.appointmentDate DESC, a.appointmentTime", $p);
        $this->sendExport($rows, [
            ['label' => 'Date',      'value' => fn($r) => self::d($r['appointmentDate'])],
            ['label' => 'Time',      'value' => fn($r) => $r['appointmentTime'] ?? ''],
            ['label' => 'Title',     'value' => fn($r) => $r['title']],
            ['label' => 'Customer',  'value' => fn($r) => $r['companyName'] ?? ''],
            ['label' => 'Engineer',  'value' => fn($r) => $r['engName'] ?? ''],
            ['label' => 'Booked by', 'value' => fn($r) => $r['byName'] ?? ''],
            ['label' => 'Status',    'value' => fn($r) => $r['status']],
            ['label' => 'Notes',     'value' => fn($r) => $r['notes'] ?? ''],
        ], 'appointments-' . $this->stamp(), 'Appointments Report');
    }

    // GET /api/reports/breaks
    public function breaks(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('b.startedAt');
        $rows = $this->rows(
            "SELECT b.*, u.name AS who FROM `AttendanceBreak` b LEFT JOIN `User` u ON u.id=b.userId
             $w ORDER BY b.startedAt DESC", $p);
        $this->sendExport($rows, [
            ['label' => 'Employee',  'value' => fn($r) => $r['who'] ?? ''],
            ['label' => 'Date',      'value' => fn($r) => self::d($r['startedAt'])],
            ['label' => 'Break',     'value' => fn($r) => $r['breakType']],
            ['label' => 'Started',   'value' => fn($r) => $r['startedAt'] ? date('h:i A', strtotime($r['startedAt'])) : ''],
            ['label' => 'Ended',     'value' => fn($r) => $r['endedAt'] ? date('h:i A', strtotime($r['endedAt'])) : 'Still on break'],
            ['label' => 'Duration',  'value' => fn($r) => $r['endedAt'] ? self::hms($r['durationSeconds']) : ''],
            ['label' => 'How',       'value' => fn($r) => $r['triggerType'] === 'AUTO' ? 'After 30+ min stationary prompt' : 'Started by employee'],
        ], 'breaks-' . $this->stamp(), 'Breaks Report');
    }

    // GET /api/reports/tracking — one row per person per day: punch times,
    // location points recorded, distance travelled, breaks taken.
    public function tracking(): void
    {
        $auth = authenticate(); require_manager($auth);
        [$w, $p] = $this->where('a.date', ['a.checkIn IS NOT NULL']);
        $rows = $this->rows(
            "SELECT a.id, a.date, a.checkIn, a.checkOut, a.workingHours, a.checkInLat, a.checkOutLat, u.name AS who
             FROM `Attendance` a LEFT JOIN `User` u ON u.id=a.userId $w ORDER BY a.date DESC, u.name", $p);
        $ping = db()->prepare('SELECT lat,lng FROM `LocationPing` WHERE attendanceId=? ORDER BY capturedAt');
        foreach ($rows as &$r) {
            $ping->execute([$r['id']]);
            $pts = $ping->fetchAll();
            $r['points'] = count($pts);
            $r['km'] = round(LocationHistoryController::distanceKm($pts), 2);
            $b = $this->rows("SELECT COUNT(*) AS n, COALESCE(SUM(durationSeconds),0) AS s FROM `AttendanceBreak` WHERE attendanceId=?", [$r['id']]);
            $r['breaks'] = $b ? (int) $b[0]['n'] : 0;
            $r['breakSec'] = $b ? (int) $b[0]['s'] : 0;
        }
        unset($r);
        $this->sendExport($rows, [
            ['label' => 'Employee',         'value' => fn($r) => $r['who'] ?? ''],
            ['label' => 'Date',             'value' => fn($r) => self::d($r['date'])],
            ['label' => 'Punch in',         'value' => fn($r) => $r['checkIn'] ? date('h:i A', strtotime($r['checkIn'])) : ''],
            ['label' => 'Punch out',        'value' => fn($r) => $r['checkOut'] ? date('h:i A', strtotime($r['checkOut'])) : ''],
            ['label' => 'Hours',            'value' => fn($r) => $r['workingHours'] ?? ''],
            ['label' => 'Location at punch in', 'value' => fn($r) => $r['checkInLat'] !== null ? 'Yes' : 'No'],
            ['label' => 'Location points',  'value' => fn($r) => $r['points']],
            ['label' => 'Distance (km)',    'value' => fn($r) => $r['km']],
            ['label' => 'Breaks',           'value' => fn($r) => $r['breaks']],
            ['label' => 'Break time',       'value' => fn($r) => self::hms($r['breakSec'])],
        ], 'tracking-' . $this->stamp(), 'Daily Tracking Report');
    }
}

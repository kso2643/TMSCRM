<?php
/**
 * Fuel expense log tied to the Attendance punch in/out cycle.
 *
 * One FuelExpense row per Attendance day:
 *   - start()  is called right after punch in  → records the opening
 *              (starting) odometer reading, snapshots the employee's
 *              vehicle profile (mileage/fuel price) for this day.
 *   - close()  is called right after punch out → records the closing
 *              odometer reading and computes officialKm/fuelCost/total.
 *
 * officialKm = closingMeter - openingMeter - personalKm
 * fuelCost   = (officialKm / mileageUsed) * fuelPriceUsed
 * totalAmount = fuelCost + miscAmount
 */
class FuelExpenseController
{
    /** Today's Attendance record for $userId, or null. Mirrors the lookup AttendanceController uses. */
    private function todaysAttendance(string $userId): ?array
    {
        $start = start_of_day(); $end = start_of_day_plus(1);
        $s = db()->prepare('SELECT * FROM `Attendance` WHERE userId=? AND date>=? AND date<? LIMIT 1');
        $s->execute([$userId, $start, $end]);
        return $s->fetch() ?: null;
    }

    private function findByAttendanceId(string $attendanceId): ?array
    {
        $s = db()->prepare('SELECT * FROM `FuelExpense` WHERE attendanceId=? LIMIT 1');
        $s->execute([$attendanceId]);
        return $s->fetch() ?: null;
    }

    private function officialKm(float $opening, float $closing, float $personal): float
    {
        return round2($closing - $opening - $personal);
    }

    private function fuelCost(float $officialKm, ?float $mileage, ?float $fuelPrice): float
    {
        if (!$mileage || $mileage <= 0 || !$fuelPrice) return 0.0;
        return round2(($officialKm / $mileage) * $fuelPrice);
    }

    /** "46,220" style formatting for a km value inside a warning message. */
    private function fmtKm(float $n): string
    {
        return number_format($n, $n == (int)$n ? 0 : 1);
    }

    // POST /api/fuel-expense/start
    public function start(): void
    {
        $auth = authenticate();
        $b = request_body();

        if (!isset($b['openingMeter']) || $b['openingMeter'] === '' || !is_numeric($b['openingMeter'])) {
            sendError('Starting meter reading is required.', 400);
        }
        $opening = (float) $b['openingMeter'];
        if ($opening < 0) sendError('Starting meter reading cannot be negative.', 400);

        $attendance = $this->todaysAttendance($auth['id']);
        if (!$attendance || !$attendance['checkIn']) sendError('Please punch in first.', 400);

        $existing = $this->findByAttendanceId($attendance['id']);
        if ($existing && $existing['status'] === 'CLOSED') {
            sendError('Today\'s fuel expense entry is already closed.', 400);
        }

        // Vehicle profile: use whatever was passed in this request to update the
        // employee's standing profile, falling back to what's already on file.
        $vehicleType    = bp_trim($b, 'vehicleType');
        $vehicleDetails = bp_trim($b, 'vehicleDetails');
        $mileage        = isset($b['mileage'])   && $b['mileage']   !== '' && is_numeric($b['mileage'])   ? (float)$b['mileage']   : null;
        $fuelPrice      = isset($b['fuelPrice']) && $b['fuelPrice'] !== '' && is_numeric($b['fuelPrice']) ? (float)$b['fuelPrice'] : null;

        $u = db()->prepare('SELECT vehicleType,vehicleDetails,vehicleMileage,vehicleFuelPrice FROM `User` WHERE id=? LIMIT 1');
        $u->execute([$auth['id']]);
        $profile = $u->fetch() ?: [];

        $finalType    = $vehicleType    ?? ($profile['vehicleType']    ?? null);
        $finalDetails = $vehicleDetails ?? ($profile['vehicleDetails'] ?? null);
        $finalMileage = $mileage        ?? (isset($profile['vehicleMileage'])   ? (float)$profile['vehicleMileage']   : null);
        $finalPrice   = $fuelPrice      ?? (isset($profile['vehicleFuelPrice']) ? (float)$profile['vehicleFuelPrice'] : null);

        // Persist anything newly supplied back onto the profile for next time.
        if ($vehicleType !== null || $vehicleDetails !== null || $mileage !== null || $fuelPrice !== null) {
            db()->prepare('UPDATE `User` SET vehicleType=?,vehicleDetails=?,vehicleMileage=?,vehicleFuelPrice=?,updatedAt=? WHERE id=?')
                ->execute([$finalType, $finalDetails, $finalMileage, $finalPrice, now_sql(), $auth['id']]);
        }

        // Soft continuity check against the most recent prior closed day —
        // catches odometer typos without blocking the punch-in flow.
        $warning = null;
        $p = db()->prepare(
            'SELECT closingMeter FROM `FuelExpense` WHERE userId=? AND closingMeter IS NOT NULL AND attendanceId<>? ORDER BY date DESC LIMIT 1'
        );
        $p->execute([$auth['id'], $attendance['id']]);
        $prev = $p->fetch();
        if ($prev && $prev['closingMeter'] !== null) {
            $diff = $opening - (float)$prev['closingMeter'];
            if ($diff < 0) {
                $warning = 'This is lower than your last recorded closing reading (' . $this->fmtKm((float)$prev['closingMeter']) . '). Please double-check.';
            } elseif ($diff > 500) {
                $warning = 'This is ' . $this->fmtKm($diff) . ' km above your last closing reading (' . $this->fmtKm((float)$prev['closingMeter']) . '). Please double-check.';
            }
        }

        if ($existing) {
            db()->prepare(
                'UPDATE `FuelExpense` SET openingMeter=?,vehicleType=?,vehicleDetails=?,mileageUsed=?,fuelPriceUsed=?,updatedAt=? WHERE id=?'
            )->execute([$opening, $finalType, $finalDetails, $finalMileage, $finalPrice, now_sql(), $existing['id']]);
            $id = $existing['id'];
        } else {
            $id = gen_id();
            db()->prepare(
                'INSERT INTO `FuelExpense`
                    (id,attendanceId,userId,date,vehicleType,vehicleDetails,mileageUsed,fuelPriceUsed,openingMeter,personalKm,miscAmount,status,createdAt,updatedAt)
                 VALUES (?,?,?,?,?,?,?,?,?,0,0,\'OPEN\',?,?)'
            )->execute([$id, $attendance['id'], $auth['id'], $attendance['date'], $finalType, $finalDetails, $finalMileage, $finalPrice, $opening, now_sql(), now_sql()]);
        }

        $s2 = db()->prepare('SELECT * FROM `FuelExpense` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['record' => $s2->fetch(), 'warning' => $warning], 'Starting meter reading recorded', $existing ? 200 : 201);
    }

    // POST /api/fuel-expense/close
    public function close(): void
    {
        $auth = authenticate();
        $b = request_body();

        if (!isset($b['closingMeter']) || $b['closingMeter'] === '' || !is_numeric($b['closingMeter'])) {
            sendError('Closing meter reading is required.', 400);
        }
        $closing = (float) $b['closingMeter'];
        $personal = isset($b['personalKm']) && $b['personalKm'] !== '' && is_numeric($b['personalKm']) ? (float)$b['personalKm'] : 0.0;
        if ($personal < 0) sendError('Personal km cannot be negative.', 400);

        $attendance = $this->todaysAttendance($auth['id']);
        if (!$attendance) sendError('No attendance record found for today.', 400);
        if (!$attendance['checkOut']) sendError('Please punch out first.', 400);

        $existing = $this->findByAttendanceId($attendance['id']);
        if (!$existing) sendError('No starting meter reading found for today. Please punch in first.', 400);
        if ($existing['status'] === 'CLOSED') sendError('Today\'s fuel expense entry is already closed.', 400);

        $opening = (float) $existing['openingMeter'];
        if ($closing < $opening) {
            sendError("Closing reading ($closing) can't be less than the starting reading ($opening).", 400);
        }
        $officialKm = $this->officialKm($opening, $closing, $personal);
        if ($officialKm < 0) {
            sendError('Official km works out negative once personal km is subtracted — please recheck the readings.', 400);
        }
        $fuelCost = $this->fuelCost($officialKm, $existing['mileageUsed'] !== null ? (float)$existing['mileageUsed'] : null, $existing['fuelPriceUsed'] !== null ? (float)$existing['fuelPriceUsed'] : null);
        $miscAmount = isset($b['miscAmount']) && $b['miscAmount'] !== '' && is_numeric($b['miscAmount']) ? (float)$b['miscAmount'] : 0.0;
        if ($miscAmount < 0) sendError('Misc. amount cannot be negative.', 400);
        $totalAmount = round2($fuelCost + $miscAmount);
        $miscDesc = bp_trim($b, 'miscDesc');
        $customersVisited = bp_trim($b, 'customersVisited');

        db()->prepare(
            'UPDATE `FuelExpense` SET closingMeter=?,personalKm=?,officialKm=?,fuelCost=?,miscDesc=?,miscAmount=?,totalAmount=?,customersVisited=?,status=\'CLOSED\',updatedAt=? WHERE id=?'
        )->execute([$closing, $personal, $officialKm, $fuelCost, $miscDesc, $miscAmount, $totalAmount, $customersVisited, now_sql(), $existing['id']]);

        $s2 = db()->prepare('SELECT * FROM `FuelExpense` WHERE id=? LIMIT 1'); $s2->execute([$existing['id']]);
        sendSuccess(['record' => $s2->fetch()], "Closing reading recorded. Official distance: {$officialKm}km");
    }

    // GET /api/fuel-expense/today
    public function today(): void
    {
        $auth = authenticate();
        $attendance = $this->todaysAttendance($auth['id']);
        $record = $attendance ? $this->findByAttendanceId($attendance['id']) : null;
        sendSuccess([
            'record'          => $record,
            'checkedIn'       => (bool) ($attendance['checkIn'] ?? false),
            'checkedOut'      => (bool) ($attendance['checkOut'] ?? false),
            'needsOpening'    => (bool) ($attendance['checkIn'] ?? false) && !$record,
            'needsClosing'    => (bool) ($attendance['checkOut'] ?? false) && $record && $record['status'] === 'OPEN',
        ]);
    }

    // GET /api/fuel-expense
    public function index(): void
    {
        $auth = authenticate();
        [$page, $limit, $offset] = paginate(31);
        $now = new DateTime('now');
        $month = qp('month') ? (int)qp('month') - 1 : (int)$now->format('n') - 1;
        $year  = qp('year')  ? (int)qp('year')       : (int)$now->format('Y');
        $from  = (new DateTime("$year-" . ($month+1) . "-01 00:00:00"))->format('Y-m-d H:i:s');
        $to    = (new DateTime("$year-" . ($month+1) . "-01 00:00:00"))->modify('+1 month')->format('Y-m-d H:i:s');

        $targetUserId = (is_admin_tier($auth['role']) && qp('userId')) ? qp('userId') : $auth['id'];
        $where = ['userId=?','date>=?','date<?']; $params = [$targetUserId,$from,$to];
        $w = 'WHERE ' . implode(' AND ', $where);

        $s = db()->prepare("SELECT COUNT(*) FROM `FuelExpense` $w"); $s->execute($params);
        $total = (int) $s->fetchColumn();

        $s2 = db()->prepare("SELECT * FROM `FuelExpense` $w ORDER BY date DESC LIMIT ? OFFSET ?");
        $s2->execute(array_merge($params, [$limit, $offset]));
        $items = $s2->fetchAll();

        $sumStmt = db()->prepare("SELECT COALESCE(SUM(officialKm),0) officialKm, COALESCE(SUM(fuelCost),0) fuelCost, COALESCE(SUM(miscAmount),0) miscAmount, COALESCE(SUM(totalAmount),0) totalAmount FROM `FuelExpense` $w");
        $sumStmt->execute($params);
        $summary = $sumStmt->fetch();

        http_response_code(200);
        header('Content-Type: application/json');
        echo json_encode([
            'success' => true,
            'message' => 'Fuel expense fetched',
            'data' => [
                'items' => $items, 'total' => $total, 'page' => (int)$page, 'limit' => $limit,
                'totalPages' => (int) ceil($total / $limit),
                'summary' => [
                    'officialKm'  => round2((float)$summary['officialKm']),
                    'fuelCost'    => round2((float)$summary['fuelCost']),
                    'miscAmount'  => round2((float)$summary['miscAmount']),
                    'totalAmount' => round2((float)$summary['totalAmount']),
                ],
            ],
        ], JSON_UNESCAPED_UNICODE);
        exit;
    }

    // GET /api/fuel-expense/all — admin only, every user's entries grouped date-wise
    public function all(): void
    {
        $auth = authenticate(); require_admin($auth);
        $now = new DateTime('now');
        $month = qp('month') ? (int)qp('month') - 1 : (int)$now->format('n') - 1;
        $year  = qp('year')  ? (int)qp('year')       : (int)$now->format('Y');
        $from  = (new DateTime("$year-" . ($month+1) . "-01 00:00:00"))->format('Y-m-d H:i:s');
        $to    = (new DateTime("$year-" . ($month+1) . "-01 00:00:00"))->modify('+1 month')->format('Y-m-d H:i:s');

        $where = ['f.date>=?','f.date<?']; $params = [$from,$to];
        if (qp('userId')) { $where[] = 'f.userId=?'; $params[] = qp('userId'); }
        $w = 'WHERE ' . implode(' AND ', $where);

        $s = db()->prepare(
            "SELECT f.*, u.name AS u_name, u.department
             FROM `FuelExpense` f LEFT JOIN `User` u ON u.id=f.userId
             $w ORDER BY f.date DESC, u.name ASC"
        );
        $s->execute($params);

        $grouped = [];
        foreach ($s->fetchAll() as $r) {
            $dateKey = (new DateTime($r['date']))->format('Y-m-d');
            $r['user'] = ['id' => $r['userId'], 'name' => $r['u_name'], 'department' => $r['department']];
            unset($r['u_name'], $r['department']);
            $grouped[$dateKey][] = $r;
        }
        krsort($grouped);
        $days = [];
        foreach ($grouped as $date => $records) $days[] = ['date' => $date, 'records' => $records];

        sendSuccess(['days' => $days, 'from' => $from, 'to' => $to], 'Fuel expense fetched for all users');
    }

    // PATCH /api/fuel-expense/:id — corrections (owner or admin)
    public function update(string $id): void
    {
        $auth = authenticate();
        $b = request_body();
        $s = db()->prepare('SELECT * FROM `FuelExpense` WHERE id=? LIMIT 1'); $s->execute([$id]);
        $rec = $s->fetch();
        if (!$rec) sendError('Fuel expense record not found.', 404);
        if ($rec['userId'] !== $auth['id'] && !is_admin_tier($auth['role'])) {
            sendError('Not authorized to edit this record.', 403);
        }

        $opening = bp_has($b, 'openingMeter') ? num($b['openingMeter'], (float)$rec['openingMeter']) : (float)$rec['openingMeter'];
        $closing = bp_has($b, 'closingMeter') ? num($b['closingMeter'], $rec['closingMeter'] !== null ? (float)$rec['closingMeter'] : 0) : ($rec['closingMeter'] !== null ? (float)$rec['closingMeter'] : null);
        $personal = bp_has($b, 'personalKm') ? num($b['personalKm'], (float)$rec['personalKm']) : (float)$rec['personalKm'];
        $miscDesc = bp_has($b, 'miscDesc') ? bp_trim($b, 'miscDesc') : $rec['miscDesc'];
        $miscAmount = bp_has($b, 'miscAmount') ? num($b['miscAmount'], (float)$rec['miscAmount']) : (float)$rec['miscAmount'];
        $customersVisited = bp_has($b, 'customersVisited') ? bp_trim($b, 'customersVisited') : $rec['customersVisited'];

        $officialKm = $rec['officialKm'] !== null ? (float)$rec['officialKm'] : null;
        $fuelCost   = $rec['fuelCost']   !== null ? (float)$rec['fuelCost']   : null;
        $totalAmount = $rec['totalAmount'] !== null ? (float)$rec['totalAmount'] : null;
        if ($closing !== null) {
            $officialKm = $this->officialKm($opening, $closing, $personal);
            $fuelCost = $this->fuelCost($officialKm, $rec['mileageUsed'] !== null ? (float)$rec['mileageUsed'] : null, $rec['fuelPriceUsed'] !== null ? (float)$rec['fuelPriceUsed'] : null);
            $totalAmount = round2($fuelCost + $miscAmount);
        }

        db()->prepare(
            'UPDATE `FuelExpense` SET openingMeter=?,closingMeter=?,personalKm=?,officialKm=?,fuelCost=?,miscDesc=?,miscAmount=?,totalAmount=?,customersVisited=?,updatedAt=? WHERE id=?'
        )->execute([$opening, $closing, $personal, $officialKm, $fuelCost, $miscDesc, $miscAmount, $totalAmount, $customersVisited, now_sql(), $id]);

        $s2 = db()->prepare('SELECT * FROM `FuelExpense` WHERE id=? LIMIT 1'); $s2->execute([$id]);
        sendSuccess(['record' => $s2->fetch()], 'Fuel expense record updated');
    }

    // GET /api/vehicle-profile
    public function getProfile(): void
    {
        $auth = authenticate();
        $targetUserId = (is_admin_tier($auth['role']) && qp('userId')) ? qp('userId') : $auth['id'];
        $s = db()->prepare('SELECT id,name,vehicleType,vehicleDetails,vehicleMileage,vehicleFuelPrice FROM `User` WHERE id=? LIMIT 1');
        $s->execute([$targetUserId]);
        $row = $s->fetch();
        if (!$row) sendError('User not found.', 404);
        sendSuccess(['profile' => $row]);
    }

    // PUT /api/vehicle-profile
    public function updateProfile(): void
    {
        $auth = authenticate();
        $b = request_body();
        $targetUserId = $auth['id'];
        if (bp_has($b, 'userId') && $b['userId'] !== $auth['id']) {
            require_admin($auth);
            $targetUserId = $b['userId'];
        }

        $vehicleType    = bp_trim($b, 'vehicleType');
        $vehicleDetails = bp_trim($b, 'vehicleDetails');
        $mileage        = isset($b['mileage'])   && $b['mileage']   !== '' && is_numeric($b['mileage'])   ? (float)$b['mileage']   : null;
        $fuelPrice      = isset($b['fuelPrice']) && $b['fuelPrice'] !== '' && is_numeric($b['fuelPrice']) ? (float)$b['fuelPrice'] : null;

        $s = db()->prepare('UPDATE `User` SET vehicleType=?,vehicleDetails=?,vehicleMileage=?,vehicleFuelPrice=?,updatedAt=? WHERE id=?');
        if (!$s->execute([$vehicleType, $vehicleDetails, $mileage, $fuelPrice, now_sql(), $targetUserId]) || $s->rowCount() === 0) {
            $chk = db()->prepare('SELECT id FROM `User` WHERE id=? LIMIT 1'); $chk->execute([$targetUserId]);
            if (!$chk->fetch()) sendError('User not found.', 404);
        }

        $s2 = db()->prepare('SELECT id,name,vehicleType,vehicleDetails,vehicleMileage,vehicleFuelPrice FROM `User` WHERE id=? LIMIT 1');
        $s2->execute([$targetUserId]);
        sendSuccess(['profile' => $s2->fetch()], 'Vehicle profile updated');
    }
}

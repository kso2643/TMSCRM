<?php
/**
 * Modules 3, 5 & 6 — Salary Advance Management, the Monthly Recovery
 * screen, and Unpaid Recovery handling.
 *
 * Every route here is admin-tier only (require_admin), same convention
 * as PayrollController — this is an HR/finance back-office feature, not
 * an employee self-service one, matching how the spec describes it
 * (Payroll → Advance Recovery, "Approved By", etc).
 *
 * The actual recovery math + the auto/manual recording logic lives in
 * includes/AdvanceRecoveryCalc.php, shared with PayrollController's
 * automatic monthly deduction (Module 4) — see that file's header.
 */
class SalaryAdvanceController
{
    private const RECOVERY_TYPES = ['MONTHLY_FIXED', 'MANUAL'];
    private const STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];

    private function userExists(string $userId): bool
    {
        $s = db()->prepare('SELECT id FROM `User` WHERE id=? LIMIT 1');
        $s->execute([$userId]);
        return (bool) $s->fetch();
    }

    /** Most recent recovered-for month/year for an advance, or [null,null] if none yet. */
    private function lastRecoveryPeriod(string $advanceId): array
    {
        $s = db()->prepare('SELECT month,year FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year DESC, month DESC LIMIT 1');
        $s->execute([$advanceId]);
        $row = $s->fetch();
        return [$row['month'] ?? null, $row['year'] ?? null];
    }

    private function withProjection(array $advance): array
    {
        [$m, $y] = $this->lastRecoveryPeriod($advance['id']);
        return array_merge($advance, calc_advance_projection($advance, $m, $y));
    }

    // GET /api/salary-advances?userId=&status=&department=
    public function index(): void
    {
        $auth = authenticate(); require_admin($auth);

        $where = []; $params = [];
        if ($userId = qp('userId'))       { $where[] = 'sa.userId=?';        $params[] = $userId; }
        if ($status = qp('status'))       { $where[] = 'sa.status=?';        $params[] = strtoupper($status); }
        if ($dept   = qp('department'))   { $where[] = 'u.department=?';    $params[] = $dept; }
        $whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

        $s = db()->prepare(
            "SELECT sa.*, u.name AS employeeName, u.employeeCode, u.department
             FROM `SalaryAdvance` sa
             JOIN `User` u ON u.id = sa.userId
             $whereSql
             ORDER BY sa.advanceDate DESC"
        );
        $s->execute($params);
        $rows = array_map([$this, 'withProjection'], $s->fetchAll());
        sendSuccess(['advances' => $rows, 'count' => count($rows)]);
    }

    // GET /api/salary-advances/:id
    public function show(string $id): void
    {
        $auth = authenticate(); require_admin($auth);

        $s = db()->prepare(
            'SELECT sa.*, u.name AS employeeName, u.employeeCode, u.department
             FROM `SalaryAdvance` sa JOIN `User` u ON u.id=sa.userId WHERE sa.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $advance = $s->fetch();
        if (!$advance) sendError('Salary advance not found.', 404);

        $hist = db()->prepare(
            'SELECT ar.*, p.name AS recordedByName
             FROM `AdvanceRecovery` ar LEFT JOIN `User` p ON p.id=ar.recordedById
             WHERE ar.advanceId=? ORDER BY ar.year DESC, ar.month DESC'
        );
        $hist->execute([$id]);
        $history = array_map(function ($r) {
            $r['amountRecovered'] = (float) $r['amountRecovered'];
            return $r;
        }, $hist->fetchAll());

        sendSuccess(['advance' => $this->withProjection($advance), 'recoveryHistory' => $history]);
    }

    // POST /api/salary-advances
    public function create(): void
    {
        $auth = authenticate(); require_admin($auth);
        $body = request_body();

        $userId = bp_trim($body, 'userId');
        if (!$userId || !$this->userExists($userId)) sendError('A valid userId is required.', 400);

        $advanceAmount = num($body['advanceAmount'] ?? null);
        if ($advanceAmount <= 0) sendError('advanceAmount must be greater than 0.', 400);

        $advanceDate = to_date_only($body['advanceDate'] ?? null);
        if (!$advanceDate) sendError('A valid advanceDate is required.', 400);

        $recoveryType = strtoupper(bp_trim($body, 'recoveryType') ?: 'MONTHLY_FIXED');
        if (!in_array($recoveryType, self::RECOVERY_TYPES, true)) {
            sendError('recoveryType must be MONTHLY_FIXED or MANUAL.', 400);
        }

        $monthlyRecoveryAmount = num($body['monthlyRecoveryAmount'] ?? null);
        if ($recoveryType === 'MONTHLY_FIXED' && (!$monthlyRecoveryAmount || $monthlyRecoveryAmount <= 0)) {
            sendError('monthlyRecoveryAmount is required and must be greater than 0 for MONTHLY_FIXED recovery.', 400);
        }

        $startMonth = (int) ($body['recoveryStartMonth'] ?? 0);
        $startYear  = (int) ($body['recoveryStartYear'] ?? 0);
        if ($startMonth < 1 || $startMonth > 12 || $startYear < 2000) {
            sendError('A valid recoveryStartMonth (1-12) and recoveryStartYear are required.', 400);
        }

        $approvedById = bp_trim($body, 'approvedById');
        if ($approvedById && !$this->userExists($approvedById)) sendError('approvedById does not match a known user.', 400);

        $id = gen_id();
        $now = now_sql();
        db()->prepare(
            'INSERT INTO `SalaryAdvance`
             (id,userId,advanceDate,advanceAmount,reason,approvedById,recoveryStartMonth,recoveryStartYear,
              recoveryType,monthlyRecoveryAmount,status,recoveredAmount,createdById,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,\'ACTIVE\',0,?,?,?)'
        )->execute([
            $id, $userId, $advanceDate, $advanceAmount, bp_trim($body, 'reason'), $approvedById ?: null,
            $startMonth, $startYear, $recoveryType, $monthlyRecoveryAmount ?: null,
            $auth['id'], $now, $now,
        ]);

        log_activity($auth['id'], 'SALARY_ADVANCE_CREATED', 'SalaryAdvance', $id, ['userId' => $userId, 'amount' => $advanceAmount]);

        $s = db()->prepare('SELECT * FROM `SalaryAdvance` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        sendSuccess(['advance' => $this->withProjection($s->fetch())], 'Salary advance created', 201);
    }

    // PUT /api/salary-advances/:id
    public function update(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $body = request_body();

        $s = db()->prepare('SELECT * FROM `SalaryAdvance` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        $advance = $s->fetch();
        if (!$advance) sendError('Salary advance not found.', 404);

        $countStmt = db()->prepare('SELECT COUNT(*) FROM `AdvanceRecovery` WHERE advanceId=?');
        $countStmt->execute([$id]);
        $recoveredCount = (int) $countStmt->fetchColumn();

        $sets = []; $params = [];
        foreach (['reason' => 'reason'] as $bodyKey => $col) {
            if (array_key_exists($bodyKey, $body)) { $sets[] = "$col=?"; $params[] = bp_trim($body, $bodyKey); }
        }
        if (array_key_exists('approvedById', $body)) {
            $ap = bp_trim($body, 'approvedById');
            if ($ap && !$this->userExists($ap)) sendError('approvedById does not match a known user.', 400);
            $sets[] = 'approvedById=?'; $params[] = $ap ?: null;
        }

        // Terms that affect the recovery schedule can only change before any
        // recovery has actually been recorded against them — editing them
        // afterwards would silently invalidate past AdvanceRecovery rows.
        if ($recoveredCount === 0) {
            if (array_key_exists('advanceAmount', $body)) {
                $amt = num($body['advanceAmount']);
                if ($amt <= 0) sendError('advanceAmount must be greater than 0.', 400);
                $sets[] = 'advanceAmount=?'; $params[] = $amt;
            }
            if (array_key_exists('recoveryType', $body)) {
                $rt = strtoupper(bp_trim($body, 'recoveryType'));
                if (!in_array($rt, self::RECOVERY_TYPES, true)) sendError('recoveryType must be MONTHLY_FIXED or MANUAL.', 400);
                $sets[] = 'recoveryType=?'; $params[] = $rt;
            }
            if (array_key_exists('monthlyRecoveryAmount', $body)) {
                $sets[] = 'monthlyRecoveryAmount=?'; $params[] = num($body['monthlyRecoveryAmount']);
            }
            if (array_key_exists('recoveryStartMonth', $body)) { $sets[] = 'recoveryStartMonth=?'; $params[] = (int) $body['recoveryStartMonth']; }
            if (array_key_exists('recoveryStartYear', $body))  { $sets[] = 'recoveryStartYear=?';  $params[] = (int) $body['recoveryStartYear']; }
        } elseif (array_key_exists('advanceAmount', $body) || array_key_exists('recoveryType', $body) || array_key_exists('monthlyRecoveryAmount', $body)) {
            sendError('Cannot change advance amount or recovery terms once a recovery has been recorded against this advance.', 409);
        }

        if (empty($sets)) sendError('No recognized fields to update.', 400);

        $sets[] = 'updatedAt=?'; $params[] = now_sql();
        $params[] = $id;
        db()->prepare('UPDATE `SalaryAdvance` SET ' . implode(',', $sets) . ' WHERE id=?')->execute($params);

        log_activity($auth['id'], 'SALARY_ADVANCE_UPDATED', 'SalaryAdvance', $id, []);

        $s = db()->prepare('SELECT * FROM `SalaryAdvance` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        sendSuccess(['advance' => $this->withProjection($s->fetch())], 'Salary advance updated');
    }

    // PATCH /api/salary-advances/:id/cancel
    public function cancel(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->prepare('SELECT id,status FROM `SalaryAdvance` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        $advance = $s->fetch();
        if (!$advance) sendError('Salary advance not found.', 404);
        if ($advance['status'] === 'CANCELLED') sendError('This advance is already cancelled.', 400);

        db()->prepare('UPDATE `SalaryAdvance` SET status=\'CANCELLED\', updatedAt=? WHERE id=?')->execute([now_sql(), $id]);
        log_activity($auth['id'], 'SALARY_ADVANCE_CANCELLED', 'SalaryAdvance', $id, []);
        sendSuccess([], 'Salary advance cancelled');
    }

    // ── Module 5 — Monthly Recovery screen ──────────────────────────────

    // GET /api/advance-recovery?month=&year=&userId=&department=
    public function recoveryScreen(): void
    {
        $auth = authenticate(); require_admin($auth);

        $month = (int) qp('month', (int) date('n'));
        $year  = (int) qp('year', (int) date('Y'));
        if ($month < 1 || $month > 12) sendError('month must be between 1 and 12.', 400);

        $where = ["sa.status IN ('ACTIVE','COMPLETED')"]; $params = [$month, $year];
        if ($userId = qp('userId'))     { $where[] = 'sa.userId=?';     $params[] = $userId; }
        if ($dept   = qp('department')) { $where[] = 'u.department=?'; $params[] = $dept; }
        $whereSql = implode(' AND ', $where);

        $s = db()->prepare(
            "SELECT sa.id AS advanceId, sa.userId, u.name AS employeeName, u.employeeCode, u.department,
                    sa.advanceAmount, sa.recoveredAmount, sa.status AS advanceStatus,
                    ar.id AS recoveryId, ar.amountRecovered AS currentMonthRecovery, ar.status AS currentMonthStatus, ar.remarks
             FROM `SalaryAdvance` sa
             JOIN `User` u ON u.id = sa.userId
             LEFT JOIN `AdvanceRecovery` ar ON ar.advanceId = sa.id AND ar.month=? AND ar.year=?
             WHERE $whereSql
             ORDER BY u.name ASC"
        );
        $s->execute($params);
        $rows = array_map(function ($r) {
            $advanceAmount = (float) $r['advanceAmount'];
            $recovered     = (float) $r['recoveredAmount'];
            return [
                'advanceId'           => $r['advanceId'],
                'userId'              => $r['userId'],
                'employeeName'        => $r['employeeName'],
                'employeeCode'        => $r['employeeCode'],
                'department'          => $r['department'],
                'advanceAmount'       => $advanceAmount,
                'recovered'           => $recovered,
                'remaining'           => max(0.0, round2($advanceAmount - $recovered)),
                'currentMonthRecovery'=> $r['currentMonthRecovery'] !== null ? (float) $r['currentMonthRecovery'] : null,
                'currentMonthStatus'  => $r['currentMonthStatus'], // null = not yet processed this month
                'remarks'             => $r['remarks'],
                'status'              => $r['advanceStatus'],
            ];
        }, $s->fetchAll());

        sendSuccess(['month' => $month, 'year' => $year, 'rows' => $rows, 'count' => count($rows)]);
    }

    // PUT /api/salary-advances/:id/recovery  { month, year, amount, status, remarks }
    // Used both for recording a month's recovery for the first time and for
    // editing it afterwards (Module 5's "Allow editing current month
    // recovery") — apply_advance_recovery() upserts either way.
    public function recordRecovery(string $advanceId): void
    {
        $auth = authenticate(); require_admin($auth);
        $body = request_body();

        $month = (int) ($body['month'] ?? 0);
        $year  = (int) ($body['year'] ?? 0);
        if ($month < 1 || $month > 12 || $year < 2000) sendError('A valid month (1-12) and year are required.', 400);

        $status = strtoupper(bp_trim($body, 'status') ?: 'PAID');
        $amount = num($body['amount'] ?? null);
        $remarks = bp_trim($body, 'remarks');

        $updated = apply_advance_recovery($advanceId, $month, $year, $amount, 'MANUAL', $status, $remarks, $auth['id']);
        sendSuccess(['advance' => $updated], 'Recovery recorded');
    }

    // GET /api/salary-advances/:id/pdf — Module 3's "Employee Advance PDF"
    public function exportPdf(string $id): void
    {
        $auth = authenticate(); require_admin($auth);

        $s = db()->prepare(
            'SELECT sa.*, u.name AS employeeName, u.employeeCode, u.department, u.designation
             FROM `SalaryAdvance` sa JOIN `User` u ON u.id=sa.userId WHERE sa.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $advance = $s->fetch();
        if (!$advance) sendError('Salary advance not found.', 404);
        $advance = $this->withProjection($advance);

        $histStmt = db()->prepare('SELECT * FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year ASC, month ASC');
        $histStmt->execute([$id]);
        $history = $histStmt->fetchAll();

        $approvedByName = null;
        if ($advance['approvedById']) {
            $ap = db()->prepare('SELECT name FROM `User` WHERE id=? LIMIT 1');
            $ap->execute([$advance['approvedById']]);
            $approvedByName = $ap->fetchColumn() ?: null;
        }

        $pdf = new EmployeeDocumentPdf('Employee Advance Statement');
        $pdf->detailsBlock('Employee Details', [
            'Name'          => $advance['employeeName'],
            'Employee Code' => $advance['employeeCode'],
            'Department'    => $advance['department'],
            'Designation'   => $advance['designation'],
        ]);
        $pdf->detailsBlock('Advance Details', [
            'Advance Date'     => $advance['advanceDate'],
            'Advance Amount'   => number_format((float) $advance['advanceAmount'], 2),
            'Recovery Type'    => $advance['recoveryType'] === 'MONTHLY_FIXED' ? 'Monthly Fixed' : 'Manual',
            'Monthly Recovery' => $advance['monthlyRecoveryAmount'] ? number_format((float) $advance['monthlyRecoveryAmount'], 2) : '—',
            'Approved By'      => $approvedByName,
            'Status'           => $advance['status'],
        ]);

        if ($history) {
            $pdf->table(['Month/Year', 'Amount', 'Mode', 'Status', 'Remarks'], array_map(fn ($h) => [
                str_pad((string) $h['month'], 2, '0', STR_PAD_LEFT) . '/' . $h['year'],
                number_format((float) $h['amountRecovered'], 2),
                $h['recoveryMode'],
                $h['status'],
                $h['remarks'] ?: '',
            ], $history));
        }

        $pdf->summaryBox([
            'Remaining Balance'     => number_format($advance['remainingAmount'], 2),
            'Months Remaining'      => $advance['monthsRemaining'] ?? '—',
            'Expected Closing Date' => $advance['expectedClosingDate'] ?? '—',
        ]);

        $pdf->remarks($advance['reason']);
        $pdf->signatureAndSeal();

        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="advance-' . $id . '.pdf"');
        echo $pdf->output();
        exit;
    }
}

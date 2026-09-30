<?php
/**
 * Payroll & HR module.
 *
 * HR *profile* fields (DOB, DOJ, bank details, PAN, etc.) live directly on
 * the `User` table and are managed through UserController::create()/update()
 * — see the "HR profile" block in that file. This controller handles:
 *   - Payroll: one row per employee per pay period (month/year).
 *   - Salary Advances: money advanced to an employee, recovered over time
 *     either as a fixed monthly amount or manually decided each month.
 *   - Advance Recovery: the month-by-month ledger of what's been recovered
 *     against each active advance.
 *   - Employee Ledger: a combined read view (+ PDF/Excel) of one employee's
 *     payroll, advance, and recovery history.
 *   - Payroll dashboard stats (dashboardStats(), called via
 *     DashboardController::payroll() in DashboardAnalyticsController.php).
 *
 * Every route here is admin-tier only (require_admin — ADMIN or
 * SUPER_ADMIN), matching the "admin manages everyone's records" scope.
 */
class PayrollController
{
    private const STATUSES = ['DRAFT', 'PROCESSED', 'PAID'];
    private const ADVANCE_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'];
    private const RECOVERY_TYPES = ['MONTHLY_FIXED', 'MANUAL'];
    private const RECOVERY_STATUSES = ['PAID', 'UNPAID'];
    private const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    // GET /api/payroll
    public function index(): void
    {
        $auth = authenticate(); require_admin($auth);
        [$page, $limit, $offset] = paginate(20);
        $userId = qp('userId', '');
        $year   = qp('year', '');
        $month  = qp('month', '');
        $status = qp('status', '');

        $where = []; $params = [];
        if ($userId) { $where[] = 'p.userId=?'; $params[] = $userId; }
        if ($year)   { $where[] = 'p.year=?';   $params[] = (int)$year; }
        if ($month)  { $where[] = 'p.month=?';  $params[] = (int)$month; }
        if ($status) { $where[] = 'p.status=?'; $params[] = $status; }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare("SELECT COUNT(*) FROM `Payroll` p $w"); $s->execute($params);
        $total = (int)$s->fetchColumn();

        $s2 = db()->prepare(
            "SELECT p.*, u.name AS u_name, u.employeeCode AS u_employeeCode,
                    u.designation AS u_designation, u.department AS u_department
             FROM `Payroll` p LEFT JOIN `User` u ON u.id=p.userId
             $w ORDER BY p.year DESC, p.month DESC, u.name ASC LIMIT ? OFFSET ?"
        );
        $s2->execute(array_merge($params, [$limit, $offset]));
        $items = array_map([$this, 'shape'], $s2->fetchAll());
        sendPaginated($items, $total, $page, $limit, 'Payroll records fetched');
    }

    // GET /api/payroll/stats?year=&month=
    public function stats(): void
    {
        $auth = authenticate(); require_admin($auth);
        $year  = (int)qp('year', date('Y'));
        $month = (int)qp('month', date('n'));

        $s = db()->prepare('SELECT status,netSalary,grossSalary FROM `Payroll` WHERE year=? AND month=?');
        $s->execute([$year, $month]);
        $rows = $s->fetchAll();

        $totalNet = 0; $totalGross = 0; $byStatus = ['DRAFT' => 0, 'PROCESSED' => 0, 'PAID' => 0];
        foreach ($rows as $r) {
            $totalNet   += (float)$r['netSalary'];
            $totalGross += (float)$r['grossSalary'];
            if (isset($byStatus[$r['status']])) $byStatus[$r['status']]++;
        }
        $headcount = (int)db()->query('SELECT COUNT(*) FROM `User` WHERE isActive=1')->fetchColumn();

        sendSuccess([
            'year' => $year, 'month' => $month,
            'processedCount' => count($rows), 'totalEmployees' => $headcount,
            'pendingCount' => max(0, $headcount - count($rows)),
            'totalGross' => round2($totalGross), 'totalNet' => round2($totalNet),
            'byStatus' => $byStatus,
        ]);
    }

    // GET /api/payroll/:id
    public function show(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $row = $this->fetchOne($id);
        if (!$row) sendError('Payroll record not found.', 404);
        sendSuccess(['payroll' => $row]);
    }

    // POST /api/payroll
    public function create(): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();

        $userId = trim($b['userId'] ?? '');
        $month  = (int)($b['month'] ?? 0);
        $year   = (int)($b['year'] ?? 0);
        if (!$userId || $month < 1 || $month > 12 || $year < 2000)
            sendError('userId, a valid month (1-12), and a valid year are required.', 400);

        $us = db()->prepare('SELECT id,name FROM `User` WHERE id=? LIMIT 1'); $us->execute([$userId]);
        $user = $us->fetch();
        if (!$user) sendError('Employee not found.', 404);

        $dup = db()->prepare('SELECT id FROM `Payroll` WHERE userId=? AND month=? AND year=? LIMIT 1');
        $dup->execute([$userId, $month, $year]);
        if ($dup->fetch()) sendError("A payroll record for {$user['name']} already exists for {$month}/{$year}. Edit that record instead.", 409);

        $calc = $this->computeTotals($b);
        $id = gen_id();
        db()->prepare(
            'INSERT INTO `Payroll`
             (id,userId,month,year,basicSalary,hra,conveyanceAllowance,medicalAllowance,specialAllowance,otherAllowance,
              grossSalary,pfDeduction,esiDeduction,professionalTax,tds,otherDeductions,totalDeductions,netSalary,
              workingDays,presentDays,lopDays,status,remarks,generatedById,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $id, $userId, $month, $year,
            $calc['basicSalary'], $calc['hra'], $calc['conveyanceAllowance'], $calc['medicalAllowance'],
            $calc['specialAllowance'], $calc['otherAllowance'], $calc['grossSalary'],
            $calc['pfDeduction'], $calc['esiDeduction'], $calc['professionalTax'], $calc['tds'], $calc['otherDeductions'],
            $calc['totalDeductions'], $calc['netSalary'],
            isset($b['workingDays']) && $b['workingDays'] !== '' ? (int)$b['workingDays'] : null,
            isset($b['presentDays']) && $b['presentDays'] !== '' ? (float)$b['presentDays'] : null,
            num($b['lopDays'] ?? 0),
            in_array($b['status'] ?? '', self::STATUSES) ? $b['status'] : 'DRAFT',
            bp_trim($b, 'remarks') ?: null,
            $auth['id'], now_sql(), now_sql(),
        ]);

        log_activity($auth['id'], 'PAYROLL_CREATED', 'Payroll', $id, ['userId' => $userId, 'month' => $month, 'year' => $year]);
        sendSuccess(['payroll' => $this->fetchOne($id)], 'Payroll record created', 201);
    }

    // PUT /api/payroll/:id
    public function update(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $existing = $this->fetchOne($id);
        if (!$existing) sendError('Payroll record not found.', 404);
        $b = request_body();

        // Merge incoming values over the existing record so totals recompute correctly
        // even when the caller only sends the fields that changed.
        $merged = array_merge($existing, array_filter($b, fn($v) => $v !== null));
        $calc = $this->computeTotals($merged);

        $status = in_array($b['status'] ?? '', self::STATUSES) ? $b['status'] : $existing['status'];
        $paidOn = $status === 'PAID' ? ($existing['paidOn'] ?? now_sql()) : null;

        db()->prepare(
            'UPDATE `Payroll` SET
                basicSalary=?,hra=?,conveyanceAllowance=?,medicalAllowance=?,specialAllowance=?,otherAllowance=?,
                grossSalary=?,pfDeduction=?,esiDeduction=?,professionalTax=?,tds=?,otherDeductions=?,totalDeductions=?,netSalary=?,
                workingDays=?,presentDays=?,lopDays=?,status=?,paidOn=?,remarks=?,updatedAt=?
             WHERE id=?'
        )->execute([
            $calc['basicSalary'], $calc['hra'], $calc['conveyanceAllowance'], $calc['medicalAllowance'],
            $calc['specialAllowance'], $calc['otherAllowance'], $calc['grossSalary'],
            $calc['pfDeduction'], $calc['esiDeduction'], $calc['professionalTax'], $calc['tds'], $calc['otherDeductions'],
            $calc['totalDeductions'], $calc['netSalary'],
            isset($b['workingDays']) && $b['workingDays'] !== '' ? (int)$b['workingDays'] : ($existing['workingDays'] ?? null),
            isset($b['presentDays']) && $b['presentDays'] !== '' ? (float)$b['presentDays'] : ($existing['presentDays'] ?? null),
            num($b['lopDays'] ?? $existing['lopDays'] ?? 0),
            $status, $paidOn,
            array_key_exists('remarks', $b) ? (bp_trim($b, 'remarks') ?: null) : ($existing['remarks'] ?? null),
            now_sql(), $id,
        ]);

        log_activity($auth['id'], 'PAYROLL_UPDATED', 'Payroll', $id);
        sendSuccess(['payroll' => $this->fetchOne($id)], 'Payroll record updated');
    }

    // PATCH /api/payroll/:id/mark-paid
    public function markPaid(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();
        $status = $b['status'] ?? 'PAID';
        if (!in_array($status, self::STATUSES)) sendError('Status must be one of: ' . implode(', ', self::STATUSES), 400);

        $paidOn = $status === 'PAID' ? now_sql() : null;
        $s = db()->prepare('UPDATE `Payroll` SET status=?,paidOn=?,updatedAt=? WHERE id=?');
        if (!$s->execute([$status, $paidOn, now_sql(), $id]) || $s->rowCount() === 0)
            sendError('Payroll record not found.', 404);

        log_activity($auth['id'], 'PAYROLL_STATUS_CHANGED', 'Payroll', $id, ['status' => $status]);
        sendSuccess(['payroll' => $this->fetchOne($id)], $status === 'PAID' ? 'Marked as paid' : 'Status updated');
    }

    // DELETE /api/payroll/:id
    public function delete(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $s = db()->prepare('DELETE FROM `Payroll` WHERE id=?');
        if (!$s->execute([$id]) || $s->rowCount() === 0) sendError('Payroll record not found.', 404);
        log_activity($auth['id'], 'PAYROLL_DELETED', 'Payroll', $id);
        sendSuccess([], 'Payroll record deleted');
    }

    // GET /api/payroll/export
    public function export(): void
    {
        $auth = authenticate(); require_admin($auth);
        $year  = qp('year', ''); $month = qp('month', '');
        $where = []; $params = [];
        if ($year)  { $where[] = 'p.year=?';  $params[] = (int)$year; }
        if ($month) { $where[] = 'p.month=?'; $params[] = (int)$month; }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare(
            "SELECT p.*, u.name AS u_name, u.employeeCode AS u_employeeCode, u.department AS u_department
             FROM `Payroll` p LEFT JOIN `User` u ON u.id=p.userId $w
             ORDER BY p.year DESC, p.month DESC, u.name ASC"
        );
        $s->execute($params);

        $wr = new XlsxWriter('Payroll');
        $wr->addRow(['Employee','Employee Code','Department','Month','Year','Basic','HRA','Conveyance','Medical','Special','Other Allowance',
            'Gross','PF','ESI','Prof. Tax','TDS','Other Deductions','Total Deductions','Net Salary','Present Days','LOP Days','Status','Paid On']);
        foreach ($s->fetchAll() as $r) {
            $wr->addRow([
                $r['u_name'], $r['u_employeeCode'], $r['u_department'], $r['month'], $r['year'],
                $r['basicSalary'], $r['hra'], $r['conveyanceAllowance'], $r['medicalAllowance'], $r['specialAllowance'], $r['otherAllowance'],
                $r['grossSalary'], $r['pfDeduction'], $r['esiDeduction'], $r['professionalTax'], $r['tds'], $r['otherDeductions'],
                $r['totalDeductions'], $r['netSalary'], $r['presentDays'], $r['lopDays'], $r['status'], $r['paidOn'],
            ]);
        }
        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="payroll-export.xlsx"');
        echo $wr->output(); exit;
    }

    /** Sums the salary components into gross/totalDeductions/net, coercing every input to a safe float. */
    private function computeTotals(array $b): array
    {
        $basic       = num($b['basicSalary'] ?? 0);
        $hra         = num($b['hra'] ?? 0);
        $conveyance  = num($b['conveyanceAllowance'] ?? 0);
        $medical     = num($b['medicalAllowance'] ?? 0);
        $special     = num($b['specialAllowance'] ?? 0);
        $otherAllow  = num($b['otherAllowance'] ?? 0);
        $gross       = $basic + $hra + $conveyance + $medical + $special + $otherAllow;

        $pf          = num($b['pfDeduction'] ?? 0);
        $esi         = num($b['esiDeduction'] ?? 0);
        $profTax     = num($b['professionalTax'] ?? 0);
        $tds         = num($b['tds'] ?? 0);
        $otherDeduct = num($b['otherDeductions'] ?? 0);
        $totalDeduct = $pf + $esi + $profTax + $tds + $otherDeduct;

        return [
            'basicSalary' => round2($basic), 'hra' => round2($hra), 'conveyanceAllowance' => round2($conveyance),
            'medicalAllowance' => round2($medical), 'specialAllowance' => round2($special), 'otherAllowance' => round2($otherAllow),
            'grossSalary' => round2($gross),
            'pfDeduction' => round2($pf), 'esiDeduction' => round2($esi), 'professionalTax' => round2($profTax),
            'tds' => round2($tds), 'otherDeductions' => round2($otherDeduct),
            'totalDeductions' => round2($totalDeduct),
            'netSalary' => round2($gross - $totalDeduct),
        ];
    }

    private function fetchOne(string $id): ?array
    {
        $s = db()->prepare(
            'SELECT p.*, u.name AS u_name, u.employeeCode AS u_employeeCode,
                    u.designation AS u_designation, u.department AS u_department, u.avatar AS u_avatar
             FROM `Payroll` p LEFT JOIN `User` u ON u.id=p.userId WHERE p.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $row = $s->fetch();
        return $row ? $this->shape($row) : null;
    }

    private function shape(array $r): array
    {
        foreach (['basicSalary','hra','conveyanceAllowance','medicalAllowance','specialAllowance','otherAllowance',
                  'grossSalary','pfDeduction','esiDeduction','professionalTax','tds','otherDeductions','totalDeductions','netSalary'] as $k) {
            $r[$k] = (float)$r[$k];
        }
        $r['presentDays'] = $r['presentDays'] !== null ? (float)$r['presentDays'] : null;
        $r['lopDays'] = (float)$r['lopDays'];
        $r['workingDays'] = $r['workingDays'] !== null ? (int)$r['workingDays'] : null;
        $r['employee'] = [
            'id' => $r['userId'], 'name' => $r['u_name'] ?? null, 'employeeCode' => $r['u_employeeCode'] ?? null,
            'designation' => $r['u_designation'] ?? null, 'department' => $r['u_department'] ?? null,
            'avatar' => $r['u_avatar'] ?? null,
        ];
        foreach (['u_name','u_employeeCode','u_designation','u_department','u_avatar'] as $k) unset($r[$k]);
        return $r;
    }

    // ═══════════════════════════════════════════════════════════════════
    // Salary Advances
    // ═══════════════════════════════════════════════════════════════════

    // GET /api/salary-advances?status=&userId=
    public function listAdvances(): void
    {
        $auth = authenticate(); require_admin($auth);
        $status = qp('status', '');
        $userId = qp('userId', '');

        $where = []; $params = [];
        if ($status && in_array($status, self::ADVANCE_STATUSES, true)) { $where[] = 'sa.status=?'; $params[] = $status; }
        if ($userId) { $where[] = 'sa.userId=?'; $params[] = $userId; }
        $w = $where ? 'WHERE ' . implode(' AND ', $where) : '';

        $s = db()->prepare(
            "SELECT sa.*, u.name AS u_name, u.employeeCode AS u_employeeCode, u.department AS u_department
             FROM `SalaryAdvance` sa LEFT JOIN `User` u ON u.id=sa.userId
             $w ORDER BY sa.advanceDate DESC, u.name ASC"
        );
        $s->execute($params);
        $advances = array_map([$this, 'shapeAdvance'], $s->fetchAll());
        sendSuccess(['advances' => $advances]);
    }

    // POST /api/salary-advances
    public function createAdvance(): void
    {
        $auth = authenticate(); require_admin($auth);
        $b = request_body();

        $userId = trim($b['userId'] ?? '');
        $advanceDate = to_date_only($b['advanceDate'] ?? null);
        $advanceAmount = num($b['advanceAmount'] ?? 0);
        $recoveryType = in_array($b['recoveryType'] ?? '', self::RECOVERY_TYPES, true) ? $b['recoveryType'] : 'MONTHLY_FIXED';
        $recoveryStartMonth = (int)($b['recoveryStartMonth'] ?? 0);
        $recoveryStartYear = (int)($b['recoveryStartYear'] ?? 0);
        $monthlyRecoveryAmount = $recoveryType === 'MONTHLY_FIXED' ? num($b['monthlyRecoveryAmount'] ?? 0) : null;

        if (!$userId) sendError('userId is required.', 400);
        if (!$advanceDate) sendError('A valid advanceDate is required.', 400);
        if ($advanceAmount <= 0) sendError('advanceAmount must be greater than zero.', 400);
        if ($recoveryStartMonth < 1 || $recoveryStartMonth > 12) sendError('recoveryStartMonth must be between 1 and 12.', 400);
        if ($recoveryStartYear < 2000) sendError('A valid recoveryStartYear is required.', 400);
        if ($recoveryType === 'MONTHLY_FIXED' && $monthlyRecoveryAmount <= 0)
            sendError('monthlyRecoveryAmount must be greater than zero for Monthly Fixed recovery.', 400);

        $us = db()->prepare('SELECT id,name FROM `User` WHERE id=? LIMIT 1'); $us->execute([$userId]);
        $user = $us->fetch();
        if (!$user) sendError('Employee not found.', 404);

        $id = gen_id();
        db()->prepare(
            'INSERT INTO `SalaryAdvance`
             (id,userId,advanceDate,advanceAmount,reason,recoveryType,monthlyRecoveryAmount,
              recoveryStartMonth,recoveryStartYear,remainingAmount,status,createdById,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $id, $userId, $advanceDate, round2($advanceAmount), bp_trim($b, 'reason') ?: null,
            $recoveryType, $monthlyRecoveryAmount !== null ? round2($monthlyRecoveryAmount) : null,
            $recoveryStartMonth, $recoveryStartYear, round2($advanceAmount), 'ACTIVE',
            $auth['id'], now_sql(), now_sql(),
        ]);

        log_activity($auth['id'], 'SALARY_ADVANCE_CREATED', 'SalaryAdvance', $id, ['userId' => $userId, 'amount' => $advanceAmount]);
        sendSuccess(['advance' => $this->fetchAdvance($id)], 'Salary advance created', 201);
    }

    // PATCH /api/salary-advances/:id/cancel
    public function cancelAdvance(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $existing = $this->fetchAdvance($id);
        if (!$existing) sendError('Salary advance not found.', 404);
        if ($existing['status'] !== 'ACTIVE') sendError('Only an active advance can be cancelled.', 400);

        db()->prepare('UPDATE `SalaryAdvance` SET status=?, cancelledAt=?, updatedAt=? WHERE id=?')
            ->execute(['CANCELLED', now_sql(), now_sql(), $id]);

        log_activity($auth['id'], 'SALARY_ADVANCE_CANCELLED', 'SalaryAdvance', $id);
        sendSuccess(['advance' => $this->fetchAdvance($id)], 'Salary advance cancelled');
    }

    // GET /api/salary-advances/:id/pdf
    public function advancePdf(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $a = $this->fetchAdvance($id);
        if (!$a) sendError('Salary advance not found.', 404);

        $rs = db()->prepare('SELECT * FROM `SalaryAdvanceRecovery` WHERE advanceId=? ORDER BY year,month'); $rs->execute([$id]);
        $recoveries = $rs->fetchAll();

        $pdf = new SimplePdf();
        $pdf->addPage();
        $margin = 40; $y = $margin;
        $pageW = SimplePdf::A4_WIDTH; $pageH = SimplePdf::A4_HEIGHT;

        $pdf->setFont('Helvetica-Bold', 16); $pdf->setFillColor('#1E3A5F');
        $pdf->text('Salary Advance Slip', $margin, $y); $y += 26;
        $pdf->setFont('Helvetica', 9); $pdf->setFillColor('#9CA3AF');
        $pdf->text('Generated ' . date('d/m/Y H:i'), $margin, $y); $y += 24;

        $pdf->line($margin, $y, $pageW - $margin, $y, '#E5E7EB'); $y += 18;

        $rowPair = function (string $label, string $value) use ($pdf, $margin, &$y) {
            $pdf->setFont('Helvetica', 10); $pdf->setFillColor('#6B7280');
            $pdf->text($label, $margin, $y, ['width' => 160]);
            $pdf->setFont('Helvetica-Bold', 10); $pdf->setFillColor('#111827');
            $pdf->text($value, $margin + 160, $y, ['width' => 300]);
            $y += 20;
        };

        $rowPair('Employee', ($a['employeeName'] ?? '—') . ' (' . ($a['employeeCode'] ?? '—') . ')');
        $rowPair('Department', $a['department'] ?? '—');
        $rowPair('Advance Date', $a['advanceDate'] ? date('d/m/Y', strtotime($a['advanceDate'])) : '—');
        $rowPair('Advance Amount', 'Rs. ' . number_format($a['advanceAmount'], 2));
        $rowPair('Recovery Type', $a['recoveryType'] === 'MONTHLY_FIXED' ? 'Monthly Fixed' : 'Manual');
        if ($a['recoveryType'] === 'MONTHLY_FIXED') {
            $rowPair('Monthly Recovery', 'Rs. ' . number_format($a['monthlyRecoveryAmount'] ?? 0, 2));
        }
        $rowPair('Recovery Start', self::MONTH_NAMES[$a['recoveryStartMonth'] - 1] . ' ' . $a['recoveryStartYear']);
        $rowPair('Status', $a['status']);
        $rowPair('Remaining Balance', 'Rs. ' . number_format($a['remainingAmount'], 2));
        if ($a['reason']) $rowPair('Reason', $a['reason']);

        $y += 8;
        $pdf->line($margin, $y, $pageW - $margin, $y, '#E5E7EB'); $y += 20;

        $pdf->setFont('Helvetica-Bold', 12); $pdf->setFillColor('#1E3A5F');
        $pdf->text('Recovery History', $margin, $y); $y += 20;

        if (!$recoveries) {
            $pdf->setFont('Helvetica', 9.5); $pdf->setFillColor('#9CA3AF');
            $pdf->text('No recoveries recorded yet.', $margin, $y); $y += 18;
        } else {
            $cols = [['Month', 130], ['Amount', 110], ['Status', 90], ['Remarks', 200]];
            $pdf->rect($margin, $y, $pageW - 2 * $margin, 18, '#1E3A5F');
            $pdf->setFont('Helvetica-Bold', 8.5); $pdf->setFillColor('#FFFFFF');
            $cx = $margin;
            foreach ($cols as [$label, $cw]) { $pdf->text($label, $cx + 4, $y + 5); $cx += $cw; }
            $y += 18;

            $pdf->setFont('Helvetica', 8.5);
            foreach ($recoveries as $i => $r) {
                if ($y > $pageH - $margin - 20) { $pdf->addPage($pageW, $pageH); $y = $margin; }
                if ($i % 2 === 0) $pdf->rect($margin, $y - 2, $pageW - 2 * $margin, 18, '#F8FAFC');
                $pdf->setFillColor('#374151');
                $cx = $margin;
                $vals = [
                    self::MONTH_NAMES[$r['month'] - 1] . ' ' . $r['year'],
                    'Rs. ' . number_format((float)$r['amountRecovered'], 2),
                    $r['status'],
                    $r['remarks'] ?? '',
                ];
                foreach ($vals as $vi => $val) { $pdf->text((string)$val, $cx + 4, $y + 2, ['width' => $cols[$vi][1] - 8]); $cx += $cols[$vi][1]; }
                $y += 18;
            }
        }

        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="advance-' . $id . '.pdf"');
        echo $pdf->output(); exit;
    }

    private function fetchAdvanceRaw(string $id): ?array
    {
        $s = db()->prepare('SELECT * FROM `SalaryAdvance` WHERE id=? LIMIT 1');
        $s->execute([$id]);
        $row = $s->fetch();
        return $row ?: null;
    }

    private function fetchAdvance(string $id): ?array
    {
        $s = db()->prepare(
            'SELECT sa.*, u.name AS u_name, u.employeeCode AS u_employeeCode, u.department AS u_department
             FROM `SalaryAdvance` sa LEFT JOIN `User` u ON u.id=sa.userId WHERE sa.id=? LIMIT 1'
        );
        $s->execute([$id]);
        $row = $s->fetch();
        return $row ? $this->shapeAdvance($row) : null;
    }

    /** Shapes a raw SalaryAdvance row (optionally joined with u_name/u_employeeCode/u_department) into the API shape. */
    private function shapeAdvance(array $r): array
    {
        $advanceAmount = (float)$r['advanceAmount'];
        $remaining = (float)$r['remainingAmount'];
        $recoveryPercent = $advanceAmount > 0 ? max(0, min(100, round(($advanceAmount - $remaining) / $advanceAmount * 100))) : 0;

        $expectedClosingDate = null;
        if ($r['status'] === 'ACTIVE' && $r['recoveryType'] === 'MONTHLY_FIXED' && (float)($r['monthlyRecoveryAmount'] ?? 0) > 0) {
            $monthsNeeded = max(1, (int)ceil($remaining / (float)$r['monthlyRecoveryAmount']));
            $d = new DateTime(sprintf('%04d-%02d-01', (int)$r['recoveryStartYear'], (int)$r['recoveryStartMonth']));
            $d->modify('+' . ($monthsNeeded - 1) . ' months');
            $expectedClosingDate = $d->format('Y-m-d');
        }

        return [
            'id' => $r['id'],
            'userId' => $r['userId'],
            'employeeName' => $r['u_name'] ?? null,
            'employeeCode' => $r['u_employeeCode'] ?? null,
            'department' => $r['u_department'] ?? null,
            'advanceDate' => $r['advanceDate'],
            'advanceAmount' => $advanceAmount,
            'reason' => $r['reason'],
            'recoveryType' => $r['recoveryType'],
            'monthlyRecoveryAmount' => $r['monthlyRecoveryAmount'] !== null ? (float)$r['monthlyRecoveryAmount'] : null,
            'recoveryStartMonth' => (int)$r['recoveryStartMonth'],
            'recoveryStartYear' => (int)$r['recoveryStartYear'],
            'remainingAmount' => $remaining,
            'recoveryPercent' => (float)$recoveryPercent,
            'expectedClosingDate' => $expectedClosingDate,
            'status' => $r['status'],
            'cancelledAt' => $r['cancelledAt'],
        ];
    }

    // ═══════════════════════════════════════════════════════════════════
    // Advance Recovery
    // ═══════════════════════════════════════════════════════════════════

    // GET /api/advance-recovery?month=&year=&department=&userId=
    public function recoveryList(): void
    {
        $auth = authenticate(); require_admin($auth);
        $month = (int)qp('month', date('n'));
        $year  = (int)qp('year', date('Y'));
        $department = trim((string)qp('department', ''));
        $userId = trim((string)qp('userId', ''));
        if ($month < 1 || $month > 12) sendError('month must be between 1 and 12.', 400);
        if ($year < 2000) sendError('A valid year is required.', 400);

        // Only ACTIVE advances whose recovery schedule has started by the selected period.
        $where = ['sa.status=?', '(sa.recoveryStartYear < ? OR (sa.recoveryStartYear = ? AND sa.recoveryStartMonth <= ?))'];
        $params = ['ACTIVE', $year, $year, $month];
        if ($department) { $where[] = 'u.department=?'; $params[] = $department; }
        if ($userId)     { $where[] = 'sa.userId=?';     $params[] = $userId; }
        $w = 'WHERE ' . implode(' AND ', $where);

        $s = db()->prepare(
            "SELECT sa.*, u.name AS u_name, u.employeeCode AS u_employeeCode, u.department AS u_department,
                    r.amountRecovered AS cm_amount, r.status AS cm_status, r.remarks AS cm_remarks
             FROM `SalaryAdvance` sa
             LEFT JOIN `User` u ON u.id = sa.userId
             LEFT JOIN `SalaryAdvanceRecovery` r ON r.advanceId = sa.id AND r.month = ? AND r.year = ?
             $w
             ORDER BY u.name ASC"
        );
        // The LEFT JOIN's month/year placeholders are positioned before the WHERE clause's.
        $s->execute(array_merge([$month, $year], $params));

        $out = array_map(function ($r) {
            $advanceAmount = (float)$r['advanceAmount'];
            $remaining = (float)$r['remainingAmount'];
            return [
                'advanceId' => $r['id'],
                'userId' => $r['userId'],
                'employeeName' => $r['u_name'],
                'employeeCode' => $r['u_employeeCode'],
                'department' => $r['u_department'],
                'advanceAmount' => $advanceAmount,
                'recovered' => round2($advanceAmount - $remaining),
                'remaining' => $remaining,
                'currentMonthRecovery' => $r['cm_amount'] !== null ? (float)$r['cm_amount'] : null,
                'currentMonthStatus' => $r['cm_status'],
                'remarks' => $r['cm_remarks'],
                'status' => $r['status'],
            ];
        }, $s->fetchAll());

        sendSuccess(['rows' => $out]);
    }

    // PUT /api/salary-advances/:id/recovery
    public function saveRecovery(string $id): void
    {
        $auth = authenticate(); require_admin($auth);
        $advance = $this->fetchAdvanceRaw($id);
        if (!$advance) sendError('Salary advance not found.', 404);

        $b = request_body();
        $month = (int)($b['month'] ?? 0);
        $year  = (int)($b['year'] ?? 0);
        $amount = num($b['amount'] ?? 0);
        $status = in_array($b['status'] ?? '', self::RECOVERY_STATUSES, true) ? $b['status'] : null;
        $remarks = bp_trim($b, 'remarks');

        if ($month < 1 || $month > 12) sendError('A valid month (1-12) is required.', 400);
        if ($year < 2000) sendError('A valid year is required.', 400);
        if (!$status) sendError('status must be PAID or UNPAID.', 400);
        if ($status === 'UNPAID' && !$remarks) sendError('Remarks are required when marking a month unpaid.', 400);

        $recoveryMode = $advance['recoveryType'] === 'MANUAL' ? 'MANUAL' : 'AUTOMATIC';

        $existing = db()->prepare('SELECT id FROM `SalaryAdvanceRecovery` WHERE advanceId=? AND month=? AND year=? LIMIT 1');
        $existing->execute([$id, $month, $year]);
        $row = $existing->fetch();

        if ($row) {
            db()->prepare('UPDATE `SalaryAdvanceRecovery` SET amountRecovered=?,status=?,recoveryMode=?,remarks=?,recordedById=?,updatedAt=? WHERE id=?')
                ->execute([round2($amount), $status, $recoveryMode, $remarks, $auth['id'], now_sql(), $row['id']]);
        } else {
            db()->prepare(
                'INSERT INTO `SalaryAdvanceRecovery` (id,advanceId,month,year,amountRecovered,status,recoveryMode,remarks,recordedById,createdAt,updatedAt)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)'
            )->execute([gen_id(), $id, $month, $year, round2($amount), $status, $recoveryMode, $remarks, $auth['id'], now_sql(), now_sql()]);
        }

        $this->recomputeAdvanceRemaining($id);

        log_activity($auth['id'], 'SALARY_ADVANCE_RECOVERY_SAVED', 'SalaryAdvance', $id, ['month' => $month, 'year' => $year, 'amount' => $amount, 'status' => $status]);
        sendSuccess(['advance' => $this->fetchAdvance($id)], 'Recovery saved');
    }

    /** Recomputes remainingAmount from PAID recoveries and flips status between ACTIVE/COMPLETED accordingly (never touches CANCELLED). */
    private function recomputeAdvanceRemaining(string $advanceId): void
    {
        $a = db()->prepare('SELECT advanceAmount,status FROM `SalaryAdvance` WHERE id=? LIMIT 1');
        $a->execute([$advanceId]);
        $adv = $a->fetch();
        if (!$adv) return;

        $r = db()->prepare("SELECT COALESCE(SUM(amountRecovered),0) FROM `SalaryAdvanceRecovery` WHERE advanceId=? AND status='PAID'");
        $r->execute([$advanceId]);
        $recovered = (float)$r->fetchColumn();

        $remaining = round2(max(0, (float)$adv['advanceAmount'] - $recovered));
        $status = $adv['status'];
        if ($status !== 'CANCELLED') {
            $status = $remaining <= 0 ? 'COMPLETED' : 'ACTIVE';
        }

        db()->prepare('UPDATE `SalaryAdvance` SET remainingAmount=?, status=?, updatedAt=? WHERE id=?')
            ->execute([$remaining, $status, now_sql(), $advanceId]);
    }

    // ═══════════════════════════════════════════════════════════════════
    // Employee Ledger
    // ═══════════════════════════════════════════════════════════════════

    // GET /api/employee-ledger/:userId
    public function employeeLedger(string $userId): void
    {
        $auth = authenticate(); require_admin($auth);
        $data = $this->buildLedger($userId);
        if (!$data) sendError('Employee not found.', 404);
        sendSuccess($data);
    }

    // GET /api/employee-ledger/:userId/pdf
    public function employeeLedgerPdf(string $userId): void
    {
        $auth = authenticate(); require_admin($auth);
        $data = $this->buildLedger($userId);
        if (!$data) sendError('Employee not found.', 404);

        $pdf = new SimplePdf();
        $pdf->addPage();
        $margin = 40; $y = $margin;
        $pageW = SimplePdf::A4_WIDTH; $pageH = SimplePdf::A4_HEIGHT;
        $maxY = $pageH - $margin - 20;

        $newPageIfNeeded = function () use ($pdf, &$y, $margin, $maxY, $pageW, $pageH) {
            if ($y > $maxY) { $pdf->addPage($pageW, $pageH); $y = $margin; }
        };

        $emp = $data['employee'];
        $pdf->setFont('Helvetica-Bold', 16); $pdf->setFillColor('#1E3A5F');
        $pdf->text('Employee Ledger', $margin, $y); $y += 24;
        $pdf->setFont('Helvetica-Bold', 12); $pdf->setFillColor('#111827');
        $pdf->text($emp['name'] . ' (' . ($emp['employeeCode'] ?? '—') . ')', $margin, $y); $y += 16;
        $pdf->setFont('Helvetica', 9.5); $pdf->setFillColor('#6B7280');
        $pdf->text(implode(' · ', array_filter([$emp['department'], $emp['designation']])), $margin, $y); $y += 22;

        $pdf->line($margin, $y, $pageW - $margin, $y, '#E5E7EB'); $y += 16;

        $pdf->setFont('Helvetica-Bold', 11); $pdf->setFillColor('#1E3A5F');
        $pdf->text('Summary', $margin, $y); $y += 18;
        $sum = $data['summary'];
        foreach ([
            ['Total Salary Paid', $sum['totalSalaryPaid']], ['Total Advance Given', $sum['totalAdvanceGiven']],
            ['Total Recovered', $sum['totalRecovered']], ['Pending Balance', $sum['totalPendingBalance']],
        ] as [$label, $val]) {
            $pdf->setFont('Helvetica', 9.5); $pdf->setFillColor('#6B7280');
            $pdf->text($label, $margin, $y, ['width' => 160]);
            $pdf->setFont('Helvetica-Bold', 9.5); $pdf->setFillColor('#111827');
            $pdf->text('Rs. ' . number_format((float)$val, 2), $margin + 160, $y);
            $y += 16;
        }
        $y += 8;

        $drawTable = function (string $title, array $headers, array $colWidths, array $rows) use ($pdf, &$y, $margin, $pageW, $newPageIfNeeded) {
            $newPageIfNeeded();
            $pdf->setFont('Helvetica-Bold', 11); $pdf->setFillColor('#1E3A5F');
            $pdf->text($title, $margin, $y); $y += 18;

            if (!$rows) {
                $pdf->setFont('Helvetica', 9); $pdf->setFillColor('#9CA3AF');
                $pdf->text('No records.', $margin, $y); $y += 20;
                return;
            }

            $newPageIfNeeded();
            $pdf->rect($margin, $y, $pageW - 2 * $margin, 18, '#1E3A5F');
            $pdf->setFont('Helvetica-Bold', 8); $pdf->setFillColor('#FFFFFF');
            $cx = $margin;
            foreach ($headers as $i => $h) { $pdf->text($h, $cx + 4, $y + 5); $cx += $colWidths[$i]; }
            $y += 18;

            $pdf->setFont('Helvetica', 8.5);
            foreach ($rows as $i => $row) {
                $newPageIfNeeded();
                if ($i % 2 === 0) $pdf->rect($margin, $y - 2, $pageW - 2 * $margin, 18, '#F8FAFC');
                $pdf->setFillColor('#374151');
                $cx = $margin;
                foreach ($row as $ci => $val) { $pdf->text((string)$val, $cx + 4, $y + 2, ['width' => $colWidths[$ci] - 8]); $cx += $colWidths[$ci]; }
                $y += 18;
            }
            $y += 10;
        };

        $drawTable('Salary History', ['Month', 'Gross', 'Deductions', 'Net Salary', 'Status'], [90, 110, 110, 110, 90],
            array_map(fn($p) => [
                self::MONTH_NAMES[$p['month'] - 1] . ' ' . $p['year'],
                'Rs. ' . number_format($p['grossSalary'], 2),
                'Rs. ' . number_format($p['totalDeductions'], 2),
                'Rs. ' . number_format($p['netSalary'], 2),
                $p['status'],
            ], $data['payrollHistory']));

        $drawTable('Advance History', ['Date', 'Amount', 'Remaining', 'Recovered', 'Status'], [90, 110, 110, 90, 100],
            array_map(fn($a) => [
                $a['advanceDate'] ? date('d/m/Y', strtotime($a['advanceDate'])) : '—',
                'Rs. ' . number_format($a['advanceAmount'], 2),
                'Rs. ' . number_format($a['remainingAmount'], 2),
                round($a['recoveryPercent']) . '%',
                $a['status'],
            ], $data['advanceHistory']));

        $drawTable('Recovery History', ['Month', 'Amount', 'Mode', 'Status', 'Remarks'], [90, 100, 90, 80, 140],
            array_map(fn($r) => [
                self::MONTH_NAMES[$r['month'] - 1] . ' ' . $r['year'],
                'Rs. ' . number_format($r['amountRecovered'], 2),
                $r['recoveryMode'] === 'MANUAL' ? 'Manual' : 'Automatic',
                $r['status'],
                $r['remarks'] ?? '',
            ], $data['recoveryHistory']));

        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="ledger-' . $userId . '.pdf"');
        echo $pdf->output(); exit;
    }

    // GET /api/employee-ledger/:userId/excel
    public function employeeLedgerExcel(string $userId): void
    {
        $auth = authenticate(); require_admin($auth);
        $data = $this->buildLedger($userId);
        if (!$data) sendError('Employee not found.', 404);

        $emp = $data['employee']; $sum = $data['summary'];
        $wr = new XlsxWriter('Ledger');
        $wr->addRow(['Employee', $emp['name'], 'Code', $emp['employeeCode'], 'Department', $emp['department']]);
        $wr->addRow([]);
        $wr->addRow(['Total Salary Paid', $sum['totalSalaryPaid'], 'Total Advance Given', $sum['totalAdvanceGiven'], 'Total Recovered', $sum['totalRecovered'], 'Pending Balance', $sum['totalPendingBalance']]);
        $wr->addRow([]);

        $wr->addRow(['Salary History']);
        $wr->addRow(['Month', 'Year', 'Gross', 'Deductions', 'Net Salary', 'Status']);
        foreach ($data['payrollHistory'] as $p) {
            $wr->addRow([self::MONTH_NAMES[$p['month'] - 1], $p['year'], $p['grossSalary'], $p['totalDeductions'], $p['netSalary'], $p['status']]);
        }
        $wr->addRow([]);

        $wr->addRow(['Advance History']);
        $wr->addRow(['Date', 'Amount', 'Remaining', 'Recovery %', 'Status']);
        foreach ($data['advanceHistory'] as $a) {
            $wr->addRow([$a['advanceDate'], $a['advanceAmount'], $a['remainingAmount'], round($a['recoveryPercent']), $a['status']]);
        }
        $wr->addRow([]);

        $wr->addRow(['Recovery History']);
        $wr->addRow(['Month', 'Year', 'Amount', 'Mode', 'Status', 'Remarks']);
        foreach ($data['recoveryHistory'] as $r) {
            $wr->addRow([self::MONTH_NAMES[$r['month'] - 1], $r['year'], $r['amountRecovered'], $r['recoveryMode'], $r['status'], $r['remarks'] ?? '']);
        }

        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="ledger-' . $userId . '.xlsx"');
        echo $wr->output(); exit;
    }

    /** Shared data-builder for the ledger JSON/PDF/Excel endpoints. Returns null if the employee doesn't exist. */
    private function buildLedger(string $userId): ?array
    {
        $us = db()->prepare('SELECT id,name,employeeCode,department,designation,dateOfJoining FROM `User` WHERE id=? LIMIT 1');
        $us->execute([$userId]);
        $user = $us->fetch();
        if (!$user) return null;

        $ps = db()->prepare('SELECT month,year,grossSalary,totalDeductions,netSalary,status FROM `Payroll` WHERE userId=? ORDER BY year DESC, month DESC');
        $ps->execute([$userId]);
        $payrollHistory = array_map(fn($r) => [
            'month' => (int)$r['month'], 'year' => (int)$r['year'],
            'grossSalary' => (float)$r['grossSalary'], 'totalDeductions' => (float)$r['totalDeductions'],
            'netSalary' => (float)$r['netSalary'], 'status' => $r['status'],
        ], $ps->fetchAll());

        $as = db()->prepare('SELECT * FROM `SalaryAdvance` WHERE userId=? ORDER BY advanceDate DESC');
        $as->execute([$userId]);
        $advanceHistory = array_map([$this, 'shapeAdvance'], $as->fetchAll());

        $rs = db()->prepare(
            'SELECT r.* FROM `SalaryAdvanceRecovery` r
             INNER JOIN `SalaryAdvance` sa ON sa.id = r.advanceId
             WHERE sa.userId = ? ORDER BY r.year DESC, r.month DESC'
        );
        $rs->execute([$userId]);
        $recoveryHistory = array_map(fn($r) => [
            'month' => (int)$r['month'], 'year' => (int)$r['year'],
            'amountRecovered' => (float)$r['amountRecovered'], 'status' => $r['status'],
            'recoveryMode' => $r['recoveryMode'], 'remarks' => $r['remarks'],
        ], $rs->fetchAll());

        $totalSalaryPaid = array_sum(array_column($payrollHistory, 'netSalary'));
        $totalAdvanceGiven = array_sum(array_map(fn($a) => $a['status'] !== 'CANCELLED' ? $a['advanceAmount'] : 0, $advanceHistory));
        $totalRecovered = array_sum(array_map(fn($r) => $r['status'] === 'PAID' ? $r['amountRecovered'] : 0, $recoveryHistory));
        $totalPendingBalance = array_sum(array_map(fn($a) => $a['status'] === 'ACTIVE' ? $a['remainingAmount'] : 0, $advanceHistory));

        return [
            'employee' => [
                'name' => $user['name'], 'employeeCode' => $user['employeeCode'],
                'department' => $user['department'], 'designation' => $user['designation'],
                'dateOfJoining' => $user['dateOfJoining'],
            ],
            'payrollHistory' => $payrollHistory,
            'advanceHistory' => $advanceHistory,
            'recoveryHistory' => $recoveryHistory,
            'summary' => [
                'totalSalaryPaid' => round2($totalSalaryPaid), 'totalAdvanceGiven' => round2($totalAdvanceGiven),
                'totalRecovered' => round2($totalRecovered), 'totalPendingBalance' => round2($totalPendingBalance),
            ],
        ];
    }

    // ═══════════════════════════════════════════════════════════════════
    // Payroll Dashboard — GET /api/dashboard/payroll (delegated from
    // DashboardController::payroll() in DashboardAnalyticsController.php)
    // ═══════════════════════════════════════════════════════════════════

    public function dashboardStats(): void
    {
        $auth = authenticate(); require_admin($auth);
        $now = new DateTime('now');
        $month = (int)$now->format('n'); $year = (int)$now->format('Y');

        $totalEmployees = (int)db()->query('SELECT COUNT(*) FROM `User` WHERE isActive=1')->fetchColumn();

        $sm = db()->prepare('SELECT COALESCE(SUM(netSalary),0) FROM `Payroll` WHERE month=? AND year=?');
        $sm->execute([$month, $year]);
        $salaryThisMonth = round2((float)$sm->fetchColumn());

        $ta = db()->prepare("SELECT COALESCE(SUM(remainingAmount),0) AS totalOutstanding, COUNT(DISTINCT userId) AS empCount FROM `SalaryAdvance` WHERE status='ACTIVE'");
        $ta->execute();
        $taRow = $ta->fetch();
        $totalAdvances = (float)$taRow['totalOutstanding'];
        $employeesWithOutstandingAdvances = (int)$taRow['empCount'];

        // Active advances whose recovery schedule has started by this month — split into
        // "already recorded as PAID this month" vs "still due this month".
        $due = db()->prepare(
            "SELECT sa.recoveryType, sa.monthlyRecoveryAmount, r.status AS cm_status
             FROM `SalaryAdvance` sa
             LEFT JOIN `SalaryAdvanceRecovery` r ON r.advanceId = sa.id AND r.month=? AND r.year=? AND r.status='PAID'
             WHERE sa.status='ACTIVE'
               AND (sa.recoveryStartYear < ? OR (sa.recoveryStartYear = ? AND sa.recoveryStartMonth <= ?))"
        );
        $due->execute([$month, $year, $year, $year, $month]);

        $completedRecoveries = 0; $upcomingRecoveries = 0; $pendingRecoveries = 0.0;
        foreach ($due->fetchAll() as $row) {
            if ($row['cm_status'] === 'PAID') {
                $completedRecoveries++;
            } else {
                $upcomingRecoveries++;
                if ($row['recoveryType'] === 'MONTHLY_FIXED') $pendingRecoveries += (float)$row['monthlyRecoveryAmount'];
            }
        }

        sendSuccess([
            'cards' => [
                'totalEmployees' => $totalEmployees,
                'salaryThisMonth' => $salaryThisMonth,
                'totalAdvances' => round2($totalAdvances),
                'pendingRecoveries' => round2($pendingRecoveries),
                'completedRecoveries' => $completedRecoveries,
                'upcomingRecoveries' => $upcomingRecoveries,
                'employeesWithOutstandingAdvances' => $employeesWithOutstandingAdvances,
            ],
            'monthlySalaryTrend' => $this->monthlyTrend("SELECT COALESCE(SUM(netSalary),0) FROM `Payroll` WHERE month=? AND year=?", $month, $year),
            'advanceTrend' => $this->monthlyTrend("SELECT COALESCE(SUM(advanceAmount),0) FROM `SalaryAdvance` WHERE MONTH(advanceDate)=? AND YEAR(advanceDate)=? AND status!='CANCELLED'", $month, $year),
            'recoveryTrend' => $this->monthlyTrend("SELECT COALESCE(SUM(amountRecovered),0) FROM `SalaryAdvanceRecovery` WHERE month=? AND year=? AND status='PAID'", $month, $year),
            'departmentSalaryChart' => $this->departmentSalaryChart($month, $year),
        ]);
    }

    /** Runs $sql (which must take (month,year) as its only two placeholders) for each of the last 6 months, oldest first. */
    private function monthlyTrend(string $sql, int $month, int $year): array
    {
        $out = [];
        for ($i = 5; $i >= 0; $i--) {
            $m = $month - $i; $y = $year;
            while ($m < 1) { $m += 12; $y--; }
            $s = db()->prepare($sql);
            $s->execute([$m, $y]);
            $out[] = ['month' => self::MONTH_NAMES[$m - 1] . " '" . substr((string)$y, 2), 'total' => round2((float)$s->fetchColumn())];
        }
        return $out;
    }

    private function departmentSalaryChart(int $month, int $year): array
    {
        $s = db()->prepare(
            "SELECT COALESCE(NULLIF(u.department,''),'Unassigned') AS department, SUM(p.netSalary) AS total
             FROM `Payroll` p LEFT JOIN `User` u ON u.id=p.userId
             WHERE p.month=? AND p.year=?
             GROUP BY department ORDER BY total DESC LIMIT 8"
        );
        $s->execute([$month, $year]);
        return array_map(fn($r) => ['department' => $r['department'], 'total' => round2((float)$r['total'])], $s->fetchAll());
    }
}

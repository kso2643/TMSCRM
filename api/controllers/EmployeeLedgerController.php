<?php
/**
 * Module 8 — Employee Ledger: a combined view of an employee's joining
 * date, payroll history, advance history, and recovery history, with
 * running pending/remaining totals.
 *
 * Exports as PDF (via the shared EmployeeDocumentPdf builder, same
 * letterhead as the Employee Advance PDF) or Excel (one sheet with
 * labeled sections — XlsxWriter only supports a single sheet per file).
 * "Print" is a browser action on whatever page renders this data —
 * nothing further to build server-side for that.
 *
 * Admin-tier only, same convention as PayrollController / SalaryAdvanceController.
 */
class EmployeeLedgerController
{
    private function loadEmployee(string $userId): array
    {
        $s = db()->prepare(
            'SELECT id,name,employeeCode,department,designation,dateOfJoining FROM `User` WHERE id=? LIMIT 1'
        );
        $s->execute([$userId]);
        $u = $s->fetch();
        if (!$u) sendError('Employee not found.', 404);
        return $u;
    }

    private function payrollHistory(string $userId): array
    {
        $s = db()->prepare('SELECT * FROM `Payroll` WHERE userId=? ORDER BY year DESC, month DESC');
        $s->execute([$userId]);
        return $s->fetchAll();
    }

    private function advanceHistory(string $userId): array
    {
        $s = db()->prepare('SELECT * FROM `SalaryAdvance` WHERE userId=? ORDER BY advanceDate DESC');
        $s->execute([$userId]);
        return array_map(function ($a) {
            $lastStmt = db()->prepare('SELECT month,year FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year DESC, month DESC LIMIT 1');
            $lastStmt->execute([$a['id']]);
            $last = $lastStmt->fetch();
            return array_merge($a, calc_advance_projection($a, $last['month'] ?? null, $last['year'] ?? null));
        }, $s->fetchAll());
    }

    private function recoveryHistory(string $userId): array
    {
        $s = db()->prepare('SELECT * FROM `AdvanceRecovery` WHERE userId=? ORDER BY year DESC, month DESC');
        $s->execute([$userId]);
        return $s->fetchAll();
    }

    private function summary(array $advances, array $recoveries): array
    {
        return [
            'totalAdvanceGiven'   => round2(array_sum(array_map(fn ($a) => (float) $a['advanceAmount'], $advances))),
            'totalRecovered'      => round2(array_sum(array_map(fn ($a) => (float) $a['recoveredAmount'], $advances))),
            'totalPendingBalance' => round2(array_sum(array_map(fn ($a) => (float) $a['remainingAmount'], $advances))),
            'manualRecoveryTotal' => round2(array_sum(array_map(
                fn ($r) => (float) $r['amountRecovered'],
                array_filter($recoveries, fn ($r) => $r['recoveryMode'] === 'MANUAL')
            ))),
        ];
    }

    // GET /api/employee-ledger/:userId
    public function show(string $userId): void
    {
        $auth = authenticate(); require_admin($auth);
        $employee   = $this->loadEmployee($userId);
        $payroll    = $this->payrollHistory($userId);
        $advances   = $this->advanceHistory($userId);
        $recoveries = $this->recoveryHistory($userId);

        $summary = $this->summary($advances, $recoveries);
        $summary['totalSalaryPaid'] = round2(array_sum(array_map(
            fn ($p) => (float) $p['netSalary'],
            array_filter($payroll, fn ($p) => $p['status'] === 'PAID')
        )));

        sendSuccess([
            'employee'        => $employee,
            'payrollHistory'  => $payroll,
            'advanceHistory'  => $advances,
            'recoveryHistory' => $recoveries,
            'summary'         => $summary,
        ]);
    }

    // GET /api/employee-ledger/:userId/pdf
    public function exportPdf(string $userId): void
    {
        $auth = authenticate(); require_admin($auth);
        $employee   = $this->loadEmployee($userId);
        $payroll    = $this->payrollHistory($userId);
        $advances   = $this->advanceHistory($userId);
        $recoveries = $this->recoveryHistory($userId);
        $summary    = $this->summary($advances, $recoveries);
        $totalSalaryPaid = array_sum(array_map(fn ($p) => (float) $p['netSalary'], array_filter($payroll, fn ($p) => $p['status'] === 'PAID')));

        $pdf = new EmployeeDocumentPdf('Employee Ledger');
        $pdf->detailsBlock('Employee Details', [
            'Name'          => $employee['name'],
            'Employee Code' => $employee['employeeCode'],
            'Department'    => $employee['department'],
            'Designation'   => $employee['designation'],
            'Joining Date'  => $employee['dateOfJoining'],
        ]);

        if ($payroll) {
            $pdf->table(['Month/Year', 'Gross', 'Deductions', 'Net Salary', 'Status'], array_map(fn ($p) => [
                str_pad((string) $p['month'], 2, '0', STR_PAD_LEFT) . '/' . $p['year'],
                number_format((float) $p['grossSalary'], 2),
                number_format((float) $p['totalDeductions'], 2),
                number_format((float) $p['netSalary'], 2),
                $p['status'],
            ], $payroll));
        }

        if ($advances) {
            $pdf->table(['Advance Date', 'Amount', 'Recovered', 'Remaining', 'Status'], array_map(fn ($a) => [
                $a['advanceDate'],
                number_format((float) $a['advanceAmount'], 2),
                number_format((float) $a['recoveredAmount'], 2),
                number_format((float) $a['remainingAmount'], 2),
                $a['status'],
            ], $advances));
        }

        $pdf->summaryBox([
            'Total Salary Paid'   => number_format($totalSalaryPaid, 2),
            'Total Advance Given' => number_format($summary['totalAdvanceGiven'], 2),
            'Total Recovered'     => number_format($summary['totalRecovered'], 2),
            'Pending Balance'     => number_format($summary['totalPendingBalance'], 2),
        ]);

        $pdf->signatureAndSeal();

        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="employee-ledger-' . $userId . '.pdf"');
        echo $pdf->output();
        exit;
    }

    // GET /api/employee-ledger/:userId/excel
    public function exportExcel(string $userId): void
    {
        $auth = authenticate(); require_admin($auth);
        $employee   = $this->loadEmployee($userId);
        $payroll    = $this->payrollHistory($userId);
        $advances   = $this->advanceHistory($userId);
        $recoveries = $this->recoveryHistory($userId);

        $wr = new XlsxWriter('Employee Ledger');
        $wr->addRow(['Employee Ledger — ' . $employee['name'], $employee['employeeCode'] ?? '']);
        $wr->addRow(['Joining Date', $employee['dateOfJoining'] ?? '']);
        $wr->addRow([]);

        $wr->addRow(['Payroll History']);
        $wr->addRow(['Month', 'Year', 'Gross', 'Deductions', 'Net Salary', 'Status']);
        foreach ($payroll as $p) {
            $wr->addRow([$p['month'], $p['year'], $p['grossSalary'], $p['totalDeductions'], $p['netSalary'], $p['status']]);
        }
        $wr->addRow([]);

        $wr->addRow(['Advance History']);
        $wr->addRow(['Advance Date', 'Amount', 'Recovered', 'Remaining', 'Status']);
        foreach ($advances as $a) {
            $wr->addRow([$a['advanceDate'], $a['advanceAmount'], $a['recoveredAmount'], $a['remainingAmount'], $a['status']]);
        }
        $wr->addRow([]);

        $wr->addRow(['Recovery History (includes Manual Recovery entries)']);
        $wr->addRow(['Month', 'Year', 'Amount Recovered', 'Mode', 'Status', 'Remarks']);
        foreach ($recoveries as $r) {
            $wr->addRow([$r['month'], $r['year'], $r['amountRecovered'], $r['recoveryMode'], $r['status'], $r['remarks']]);
        }

        header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        header('Content-Disposition: attachment; filename="employee-ledger-' . $userId . '.xlsx"');
        echo $wr->output();
        exit;
    }
}

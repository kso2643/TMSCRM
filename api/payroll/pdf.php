<?php
require __DIR__ . '/config.php';
require_payroll_login();
require API_DIR . '/includes/SimplePdf.php';
require API_DIR . '/includes/EmployeeDocumentPdf.php';
require API_DIR . '/config/config.php'; // COMPANY_NAME / COMPANY_ADDRESS (harmless if already loaded)

$dbc = db();
$type = $_GET['type'] ?? '';

if ($type === 'advance') {
    $id = $_GET['id'] ?? '';
    $s = $dbc->prepare(
        'SELECT sa.*, u.name AS employeeName, u.employeeCode, u.department, u.designation
         FROM `SalaryAdvance` sa JOIN `User` u ON u.id=sa.userId WHERE sa.id=? LIMIT 1'
    );
    $s->execute([$id]);
    $advance = $s->fetch();
    if (!$advance) { http_response_code(404); die('Advance not found.'); }

    $lastStmt = $dbc->prepare('SELECT month,year FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year DESC, month DESC LIMIT 1');
    $lastStmt->execute([$id]);
    $last = $lastStmt->fetch();
    $advance = array_merge($advance, calc_advance_projection($advance, $last['month'] ?? null, $last['year'] ?? null));

    $histStmt = $dbc->prepare('SELECT * FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year ASC, month ASC');
    $histStmt->execute([$id]);
    $history = $histStmt->fetchAll();

    $approvedByName = null;
    if ($advance['approvedById']) {
        $ap = $dbc->prepare('SELECT name FROM `User` WHERE id=? LIMIT 1');
        $ap->execute([$advance['approvedById']]);
        $approvedByName = $ap->fetchColumn() ?: null;
    }

    $pdf = new EmployeeDocumentPdf('Employee Advance Statement');
    $pdf->detailsBlock('Employee Details', [
        'Name' => $advance['employeeName'], 'Employee Code' => $advance['employeeCode'],
        'Department' => $advance['department'], 'Designation' => $advance['designation'],
    ]);
    $pdf->detailsBlock('Advance Details', [
        'Advance Date' => $advance['advanceDate'],
        'Advance Amount' => number_format((float) $advance['advanceAmount'], 2),
        'Recovery Type' => $advance['recoveryType'] === 'MONTHLY_FIXED' ? 'Monthly Fixed' : 'Manual',
        'Monthly Recovery' => $advance['monthlyRecoveryAmount'] ? number_format((float) $advance['monthlyRecoveryAmount'], 2) : '—',
        'Approved By' => $approvedByName,
        'Status' => $advance['status'],
    ]);
    if ($history) {
        $pdf->table(['Month/Year', 'Amount', 'Mode', 'Status', 'Remarks'], array_map(fn ($h) => [
            str_pad((string) $h['month'], 2, '0', STR_PAD_LEFT) . '/' . $h['year'],
            number_format((float) $h['amountRecovered'], 2), $h['recoveryMode'], $h['status'], $h['remarks'] ?: '',
        ], $history));
    }
    $pdf->summaryBox([
        'Remaining Balance' => number_format($advance['remainingAmount'], 2),
        'Months Remaining' => $advance['monthsRemaining'] ?? '—',
        'Expected Closing Date' => $advance['expectedClosingDate'] ?? '—',
    ]);
    $pdf->remarks($advance['reason']);
    $pdf->signatureAndSeal();

    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="advance-' . $id . '.pdf"');
    echo $pdf->output();
    exit;
}

if ($type === 'ledger') {
    $userId = $_GET['userId'] ?? '';
    $es = $dbc->prepare('SELECT id,name,employeeCode,department,designation,dateOfJoining FROM `User` WHERE id=? LIMIT 1');
    $es->execute([$userId]);
    $employee = $es->fetch();
    if (!$employee) { http_response_code(404); die('Employee not found.'); }

    $ps = $dbc->prepare('SELECT * FROM `Payroll` WHERE userId=? ORDER BY year DESC, month DESC');
    $ps->execute([$userId]);
    $payroll = $ps->fetchAll();

    $as = $dbc->prepare('SELECT * FROM `SalaryAdvance` WHERE userId=? ORDER BY advanceDate DESC');
    $as->execute([$userId]);
    $advances = $as->fetchAll();

    $totalSalaryPaid = array_sum(array_map(fn ($p) => (float) $p['netSalary'], array_filter($payroll, fn ($p) => $p['status'] === 'PAID')));
    $totalAdvanceGiven = array_sum(array_map(fn ($a) => (float) $a['advanceAmount'], $advances));
    $totalRecovered = array_sum(array_map(fn ($a) => (float) $a['recoveredAmount'], $advances));
    $totalPending = array_sum(array_map(fn ($a) => (float) $a['advanceAmount'] - (float) $a['recoveredAmount'], $advances));

    $pdf = new EmployeeDocumentPdf('Employee Ledger');
    $pdf->detailsBlock('Employee Details', [
        'Name' => $employee['name'], 'Employee Code' => $employee['employeeCode'],
        'Department' => $employee['department'], 'Designation' => $employee['designation'],
        'Joining Date' => $employee['dateOfJoining'],
    ]);
    if ($payroll) {
        $pdf->table(['Month/Year', 'Gross', 'Deductions', 'Net Salary', 'Status'], array_map(fn ($p) => [
            str_pad((string) $p['month'], 2, '0', STR_PAD_LEFT) . '/' . $p['year'],
            number_format((float) $p['grossSalary'], 2), number_format((float) $p['totalDeductions'], 2),
            number_format((float) $p['netSalary'], 2), $p['status'],
        ], $payroll));
    }
    if ($advances) {
        $pdf->table(['Advance Date', 'Amount', 'Recovered', 'Status'], array_map(fn ($a) => [
            $a['advanceDate'], number_format((float) $a['advanceAmount'], 2), number_format((float) $a['recoveredAmount'], 2), $a['status'],
        ], $advances));
    }
    $pdf->summaryBox([
        'Total Salary Paid' => number_format($totalSalaryPaid, 2),
        'Total Advance Given' => number_format($totalAdvanceGiven, 2),
        'Total Recovered' => number_format($totalRecovered, 2),
        'Pending Balance' => number_format($totalPending, 2),
    ]);
    $pdf->signatureAndSeal();

    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="employee-ledger-' . $userId . '.pdf"');
    echo $pdf->output();
    exit;
}

http_response_code(400);
die('Unknown PDF type.');

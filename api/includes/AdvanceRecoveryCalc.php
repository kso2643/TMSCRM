<?php
/**
 * Shared math + recovery-application logic for the Salary Advance system
 * (Modules 3-6). Both PayrollController::create() (automatic monthly
 * deduction, Module 4) and SalaryAdvanceController (manual recovery entry
 * / edits from the Monthly Recovery screen, Module 5-6) call
 * apply_advance_recovery() so the two paths can never drift out of sync
 * with each other — there is exactly one place this logic lives.
 */

/**
 * Pure projection math for a SalaryAdvance row — never touches the DB.
 * $lastRecoveryMonth/$lastRecoveryYear should be the most recent month
 * that already HAS an AdvanceRecovery row for this advance (paid or
 * unpaid — either way that month's slot is used), or null if none yet.
 */
function calc_advance_projection(array $advance, ?int $lastRecoveryMonth, ?int $lastRecoveryYear): array
{
    $advanceAmount = (float) $advance['advanceAmount'];
    $recovered     = (float) $advance['recoveredAmount'];
    $remaining     = max(0.0, round2($advanceAmount - $recovered));
    $percent       = $advanceAmount > 0 ? round(($recovered / $advanceAmount) * 100, 2) : 0.0;

    $out = [
        'remainingAmount'     => $remaining,
        'recoveredAmount'     => round2($recovered),
        'recoveryPercent'     => $percent,
        'monthsRequired'      => null,
        'monthsRemaining'     => null,
        'expectedClosingDate' => null,
    ];

    // MANUAL recovery type has no fixed monthly figure, so there's nothing
    // to project a schedule from — only the running totals above apply.
    if ($advance['recoveryType'] !== 'MONTHLY_FIXED' || (float) ($advance['monthlyRecoveryAmount'] ?? 0) <= 0) {
        return $out;
    }

    $monthly = (float) $advance['monthlyRecoveryAmount'];
    $out['monthsRequired']  = (int) ceil($advanceAmount / $monthly);
    $out['monthsRemaining'] = $remaining > 0 ? (int) ceil($remaining / $monthly) : 0;

    if ($out['monthsRemaining'] > 0) {
        if ($lastRecoveryMonth && $lastRecoveryYear) {
            $next = DateTime::createFromFormat('Y-n-j', "$lastRecoveryYear-$lastRecoveryMonth-1");
            $next->modify('+1 month');
        } else {
            $next = DateTime::createFromFormat('Y-n-j', $advance['recoveryStartYear'] . '-' . $advance['recoveryStartMonth'] . '-1');
        }
        $next->modify('+' . ($out['monthsRemaining'] - 1) . ' months');
        $next->modify('last day of this month');
        $out['expectedClosingDate'] = $next->format('Y-m-d');
    }

    return $out;
}

/**
 * Records (or overwrites) one month's recovery for an advance, then
 * recalculates SalaryAdvance.recoveredAmount + status from the sum of all
 * PAID recoveries, and returns the refreshed advance merged with its
 * projection (remaining/months/closing date). $status of 'UNPAID' requires
 * non-empty $remarks (Module 6).
 */
function apply_advance_recovery(
    string $advanceId, int $month, int $year, float $amount, string $mode,
    string $status, ?string $remarks, string $recordedById, ?string $payrollId = null
): array {
    if ($status === 'UNPAID' && trim((string) $remarks) === '') {
        sendError('Remarks are required when a recovery is marked UNPAID.', 400);
    }
    if (!in_array($status, ['PAID', 'UNPAID'], true)) {
        sendError('status must be PAID or UNPAID.', 400);
    }

    $advStmt = db()->prepare('SELECT * FROM `SalaryAdvance` WHERE id=? LIMIT 1');
    $advStmt->execute([$advanceId]);
    $advance = $advStmt->fetch();
    if (!$advance) sendError('Salary advance not found.', 404);

    $existingStmt = db()->prepare('SELECT id FROM `AdvanceRecovery` WHERE advanceId=? AND month=? AND year=? LIMIT 1');
    $existingStmt->execute([$advanceId, $month, $year]);
    $existing = $existingStmt->fetch();
    $now = now_sql();
    $recovered = $status === 'PAID' ? $amount : 0.0; // an UNPAID month recovers nothing, regardless of $amount

    if ($existing) {
        db()->prepare(
            'UPDATE `AdvanceRecovery`
             SET amountRecovered=?, recoveryMode=?, status=?, remarks=?, payrollId=COALESCE(?,payrollId), recordedById=?, updatedAt=?
             WHERE id=?'
        )->execute([round2($recovered), $mode, $status, $remarks ?: null, $payrollId, $recordedById, $now, $existing['id']]);
        $recoveryId = $existing['id'];
    } else {
        $recoveryId = gen_id();
        db()->prepare(
            'INSERT INTO `AdvanceRecovery`
             (id,advanceId,userId,month,year,amountRecovered,recoveryMode,status,remarks,payrollId,recordedById,createdAt,updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $recoveryId, $advanceId, $advance['userId'], $month, $year,
            round2($recovered), $mode, $status, $remarks ?: null, $payrollId, $recordedById, $now, $now,
        ]);
    }

    // Recompute the cached total strictly from PAID rows — an UNPAID month
    // contributes nothing, matching Module 6's "recovery skipped" handling.
    $sumStmt = db()->prepare("SELECT COALESCE(SUM(amountRecovered),0) FROM `AdvanceRecovery` WHERE advanceId=? AND status='PAID'");
    $sumStmt->execute([$advanceId]);
    $totalRecovered = (float) $sumStmt->fetchColumn();

    $newStatus = $advance['status'];
    if ($advance['status'] === 'ACTIVE' && $totalRecovered >= (float) $advance['advanceAmount']) {
        $newStatus = 'COMPLETED';
    } elseif ($advance['status'] === 'COMPLETED' && $totalRecovered < (float) $advance['advanceAmount']) {
        $newStatus = 'ACTIVE'; // a correction pushed the total back below the advance amount
    }

    db()->prepare('UPDATE `SalaryAdvance` SET recoveredAmount=?, status=?, updatedAt=? WHERE id=?')
        ->execute([round2($totalRecovered), $newStatus, $now, $advanceId]);

    log_activity($recordedById, 'ADVANCE_RECOVERY_RECORDED', 'AdvanceRecovery', $recoveryId, [
        'advanceId' => $advanceId, 'month' => $month, 'year' => $year, 'amount' => $recovered, 'mode' => $mode, 'status' => $status,
    ]);

    $lastStmt = db()->prepare('SELECT month,year FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year DESC, month DESC LIMIT 1');
    $lastStmt->execute([$advanceId]);
    $last = $lastStmt->fetch();

    $freshStmt = db()->prepare('SELECT * FROM `SalaryAdvance` WHERE id=? LIMIT 1');
    $freshStmt->execute([$advanceId]);
    $fresh = $freshStmt->fetch();

    return array_merge($fresh, calc_advance_projection($fresh, $last['month'] ?? null, $last['year'] ?? null));
}

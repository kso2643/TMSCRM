<?php
require __DIR__ . '/config.php';
require_payroll_login();
$pageTitle = 'Employee Ledger';
$activeNav = 'ledger';
$dbc = db();

$userId = trim($_GET['userId'] ?? '');
$employee = null;
$payroll = [];
$advances = [];
$recoveries = [];

if ($userId) {
    $es = $dbc->prepare('SELECT id,name,employeeCode,department,designation,dateOfJoining FROM `User` WHERE id=? LIMIT 1');
    $es->execute([$userId]);
    $employee = $es->fetch();

    if ($employee) {
        $ps = $dbc->prepare('SELECT * FROM `Payroll` WHERE userId=? ORDER BY year DESC, month DESC');
        $ps->execute([$userId]);
        $payroll = $ps->fetchAll();

        $as = $dbc->prepare('SELECT * FROM `SalaryAdvance` WHERE userId=? ORDER BY advanceDate DESC');
        $as->execute([$userId]);
        foreach ($as->fetchAll() as $row) {
            $lastStmt = $dbc->prepare('SELECT month,year FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year DESC, month DESC LIMIT 1');
            $lastStmt->execute([$row['id']]);
            $last = $lastStmt->fetch();
            $advances[] = array_merge($row, calc_advance_projection($row, $last['month'] ?? null, $last['year'] ?? null));
        }

        $rs = $dbc->prepare('SELECT * FROM `AdvanceRecovery` WHERE userId=? ORDER BY year DESC, month DESC');
        $rs->execute([$userId]);
        $recoveries = $rs->fetchAll();
    }
}

$totalSalaryPaid = array_sum(array_map(fn ($p) => (float) $p['netSalary'], array_filter($payroll, fn ($p) => $p['status'] === 'PAID')));
$totalAdvanceGiven = array_sum(array_map(fn ($a) => (float) $a['advanceAmount'], $advances));
$totalRecovered = array_sum(array_map(fn ($a) => (float) $a['recoveredAmount'], $advances));
$totalPending = array_sum(array_map(fn ($a) => $a['remainingAmount'], $advances));

require __DIR__ . '/includes/layout_header.php';
?>

<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; flex-wrap:wrap; gap:10px;">
  <h1 class="page-title"><?= svg_icon('book-text') ?> Employee Ledger</h1>
  <?php if ($employee): ?>
    <a href="pdf.php?type=ledger&userId=<?= urlencode($userId) ?>" class="btn-primary" target="_blank">Download PDF</a>
  <?php endif; ?>
</div>

<form method="get" style="margin-bottom:20px; display:flex; gap:10px;">
  <input class="input" name="userId" placeholder="Employee ID" value="<?= e($userId) ?>" style="max-width:320px;">
  <button type="submit" class="btn-secondary">Look up</button>
</form>

<?php if ($userId && !$employee): ?>
  <div class="empty-state"><div class="empty-state-title">No employee found</div>Check the employee ID and try again.</div>
<?php elseif (!$employee): ?>
  <div class="empty-state"><div class="empty-state-title">Enter an employee ID above</div>Their combined payroll, advance, and recovery history will show here.</div>
<?php else: ?>

  <div class="card" style="padding:18px; margin-bottom:24px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
    <div style="display:flex; align-items:center; gap:12px;">
      <div class="avatar-circle"><?= e(mb_strtoupper(mb_substr($employee['name'], 0, 1))) ?></div>
      <div>
        <div style="font-weight:600; font-size:1.05rem;"><?= e($employee['name']) ?></div>
        <div style="font-size:.85rem; color:var(--slate-500);"><?= e($employee['employeeCode']) ?> · <?= e($employee['department']) ?> · <?= e($employee['designation']) ?></div>
      </div>
    </div>
    <div style="font-size:.85rem; color:var(--slate-500);">Joined <?= fmt_date($employee['dateOfJoining']) ?></div>
  </div>

  <div style="display:grid; grid-template-columns:repeat(2,1fr); gap:14px; margin-bottom:28px;" class="md-grid-4">
    <div class="stat-card"><div class="stat-icon primary"><?= svg_icon('wallet') ?></div><div class="stat-value tabular"><?= money($totalSalaryPaid) ?></div><div class="stat-label">Total Salary Paid</div></div>
    <div class="stat-card"><div class="stat-icon amber"><?= svg_icon('wallet') ?></div><div class="stat-value tabular"><?= money($totalAdvanceGiven) ?></div><div class="stat-label">Total Advance Given</div></div>
    <div class="stat-card"><div class="stat-icon green"><?= svg_icon('clipboard-list') ?></div><div class="stat-value tabular"><?= money($totalRecovered) ?></div><div class="stat-label">Total Recovered</div></div>
    <div class="stat-card"><div class="stat-icon red"><?= svg_icon('clipboard-list') ?></div><div class="stat-value tabular"><?= money($totalPending) ?></div><div class="stat-label">Pending Balance</div></div>
  </div>

  <h2 class="section-title" style="margin-bottom:12px;">Salary history</h2>
  <?php if (!$payroll): ?>
    <div class="empty-state" style="padding:24px;"><div class="empty-state-title">No payroll processed yet</div></div>
  <?php else: ?>
    <div class="card" style="overflow-x:auto; margin-bottom:24px;">
      <table class="data-table">
        <thead><tr><th>Month</th><th>Gross</th><th>Deductions</th><th>Net Salary</th><th>Status</th></tr></thead>
        <tbody>
        <?php foreach ($payroll as $p): ?>
          <tr>
            <td><?= e(month_label((int) $p['month'], (int) $p['year'])) ?></td>
            <td class="tabular"><?= money((float) $p['grossSalary']) ?></td>
            <td class="tabular"><?= money((float) $p['totalDeductions']) ?></td>
            <td class="tabular"><?= money((float) $p['netSalary']) ?></td>
            <td><span class="badge badge-<?= strtolower(e($p['status'])) ?>"><?= e($p['status']) ?></span></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  <?php endif; ?>

  <h2 class="section-title" style="margin-bottom:12px;">Advance history</h2>
  <?php if (!$advances): ?>
    <div class="empty-state" style="padding:24px; margin-bottom:24px;"><div class="empty-state-title">No salary advances</div></div>
  <?php else: ?>
    <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:24px;">
      <?php foreach ($advances as $a): $pct = (int) round($a['recoveryPercent']); ?>
        <div class="card" style="padding:14px; display:flex; align-items:center; gap:14px;">
          <div style="width:40px; height:40px; border-radius:50%; flex-shrink:0; background:conic-gradient(var(--amber) <?= $pct ?>%, var(--slate-200) 0); display:flex; align-items:center; justify-content:center;">
            <div style="width:31px; height:31px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; font-size:.62rem; font-weight:700;"><?= $pct ?>%</div>
          </div>
          <div style="flex:1;">
            <div style="font-size:.85rem;"><?= fmt_date($a['advanceDate']) ?> · <?= money((float) $a['advanceAmount']) ?></div>
            <div style="font-size:.75rem; color:var(--slate-400);"><?= money($a['remainingAmount']) ?> remaining</div>
          </div>
          <span class="badge badge-<?= strtolower(e($a['status'])) ?>"><?= e($a['status']) ?></span>
        </div>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>

  <h2 class="section-title" style="margin-bottom:12px;">Recovery history</h2>
  <?php if (!$recoveries): ?>
    <div class="empty-state" style="padding:24px;"><div class="empty-state-title">No recoveries recorded</div></div>
  <?php else: ?>
    <div class="card" style="overflow-x:auto;">
      <table class="data-table">
        <thead><tr><th>Month</th><th>Amount</th><th>Mode</th><th>Status</th><th>Remarks</th></tr></thead>
        <tbody>
        <?php foreach ($recoveries as $r): ?>
          <tr>
            <td><?= e(month_label((int) $r['month'], (int) $r['year'])) ?></td>
            <td class="tabular"><?= money((float) $r['amountRecovered']) ?></td>
            <td><?= $r['recoveryMode'] === 'MANUAL' ? 'Manual' : 'Automatic' ?></td>
            <td><span class="badge badge-<?= strtolower(e($r['status'])) ?>"><?= e($r['status']) ?></span></td>
            <td><?= e($r['remarks'] ?? '—') ?></td>
          </tr>
        <?php endforeach; ?>
        </tbody>
      </table>
    </div>
  <?php endif; ?>

<?php endif; ?>

<style>@media (min-width:768px){.md-grid-4{grid-template-columns:repeat(4,1fr) !important;}}</style>

<?php require __DIR__ . '/includes/layout_footer.php'; ?>

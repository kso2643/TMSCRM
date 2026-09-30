<?php
require __DIR__ . '/config.php';
$currentUser = require_payroll_login();
$pageTitle = 'Advance Recovery';
$activeNav = 'recovery';
$dbc = db();

$month = (int) ($_GET['month'] ?? date('n'));
$year = (int) ($_GET['year'] ?? date('Y'));
$department = trim($_GET['department'] ?? '');
$userIdFilter = trim($_GET['userId'] ?? '');

// ── Save a recovery entry ───────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'save') {
    require_csrf();
    $advanceId = $_POST['advanceId'] ?? '';
    $rMonth = (int) ($_POST['month'] ?? $month);
    $rYear = (int) ($_POST['year'] ?? $year);
    $amount = (float) ($_POST['amount'] ?? 0);
    $status = in_array($_POST['status'] ?? '', ['PAID', 'UNPAID'], true) ? $_POST['status'] : 'PAID';
    $remarks = trim($_POST['remarks'] ?? '');

    if ($status === 'UNPAID' && $remarks === '') {
        flash_set('error', 'Remarks are required when marking a month unpaid.');
        redirect("advance-recovery.php?month=$rMonth&year=$rYear&edit=" . urlencode($advanceId));
    }

    apply_advance_recovery($advanceId, $rMonth, $rYear, $amount, 'MANUAL', $status, $remarks ?: null, $currentUser['id']);
    flash_set('success', 'Recovery saved.');
    redirect("advance-recovery.php?month=$rMonth&year=$rYear");
}

// ── Screen data ──────────────────────────────────────────────────────
$where = ["sa.status IN ('ACTIVE','COMPLETED')"];
$params = [$month, $year];
if ($userIdFilter) { $where[] = 'sa.userId=?'; $params[] = $userIdFilter; }
if ($department) { $where[] = 'u.department=?'; $params[] = $department; }
$whereSql = implode(' AND ', $where);

$s = $dbc->prepare(
    "SELECT sa.id AS advanceId, sa.userId, u.name AS employeeName, u.employeeCode, u.department,
            sa.advanceAmount, sa.recoveredAmount, sa.status AS advanceStatus,
            ar.amountRecovered AS currentMonthRecovery, ar.status AS currentMonthStatus, ar.remarks
     FROM `SalaryAdvance` sa
     JOIN `User` u ON u.id = sa.userId
     LEFT JOIN `AdvanceRecovery` ar ON ar.advanceId = sa.id AND ar.month=? AND ar.year=?
     WHERE $whereSql
     ORDER BY u.name ASC"
);
$s->execute($params);
$rows = $s->fetchAll();

$editingId = $_GET['edit'] ?? null;

require __DIR__ . '/includes/layout_header.php';
?>

<h1 class="page-title" style="margin-bottom:4px;"><?= svg_icon('clipboard-list') ?> Advance Recovery</h1>
<p class="page-subtitle" style="margin-bottom:20px;"><?= e(month_label($month, $year)) ?></p>

<form method="get" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:18px;">
  <select name="month" class="input" style="width:150px;">
    <?php $months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    foreach ($months as $i => $m): ?>
      <option value="<?= $i + 1 ?>" <?= $month === $i + 1 ? 'selected' : '' ?>><?= e($m) ?></option>
    <?php endforeach; ?>
  </select>
  <input class="input" type="number" name="year" value="<?= e((string) $year) ?>" style="width:90px;">
  <input class="input" name="department" placeholder="Department" value="<?= e($department) ?>" style="width:180px;">
  <input class="input" name="userId" placeholder="Employee ID" value="<?= e($userIdFilter) ?>" style="width:200px;">
  <button type="submit" class="btn-secondary">Filter</button>
</form>

<?php if (!$rows): ?>
  <div class="empty-state">
    <div class="empty-state-title">Nothing to recover this month</div>
    No active advances match these filters for the selected month.
  </div>
<?php else: ?>
  <div class="card" style="overflow-x:auto;">
    <table class="data-table">
      <thead>
        <tr>
          <th>Employee</th><th>Advance Amount</th><th>Recovered</th><th>Remaining</th><th>This Month</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        <?php foreach ($rows as $row):
          $remaining = (float) $row['advanceAmount'] - (float) $row['recoveredAmount'];
          $isEditing = $editingId === $row['advanceId'];
        ?>
          <tr>
            <td>
              <div style="display:flex; align-items:center; gap:10px;">
                <div class="avatar-circle sm"><?= e(mb_strtoupper(mb_substr($row['employeeName'], 0, 1))) ?></div>
                <div>
                  <strong><?= e($row['employeeName']) ?></strong><br>
                  <span style="font-size:.75rem; color:var(--slate-400);"><?= e($row['employeeCode']) ?> · <?= e($row['department']) ?></span>
                </div>
              </div>
            </td>
            <td class="tabular"><?= money((float) $row['advanceAmount']) ?></td>
            <td class="tabular"><?= money((float) $row['recoveredAmount']) ?></td>
            <td class="tabular"><?= money($remaining) ?></td>
            <td class="tabular">
              <?= $row['currentMonthRecovery'] !== null ? money((float) $row['currentMonthRecovery']) : '<span style="color:var(--slate-400); font-weight:400;">Not processed</span>' ?>
            </td>
            <td>
              <?php $st = $row['currentMonthStatus'] ?? $row['advanceStatus']; ?>
              <span class="badge badge-<?= strtolower(e($st)) ?>"><?= e($st) ?></span>
            </td>
            <td>
              <a href="?month=<?= $month ?>&year=<?= $year ?>&department=<?= urlencode($department) ?>&userId=<?= urlencode($userIdFilter) ?>&edit=<?= $isEditing ? '' : urlencode($row['advanceId']) ?>"
                 class="btn-ghost" style="font-size:.78rem;">
                <?= $isEditing ? 'Close' : 'Edit' ?>
              </a>
            </td>
          </tr>
          <?php if ($isEditing): ?>
            <tr>
              <td colspan="7" style="padding:0;">
                <form method="post" style="background:var(--amber-50); padding:16px; display:flex; gap:14px; align-items:flex-end; flex-wrap:wrap; margin:0;">
                  <?= csrf_field() ?>
                  <input type="hidden" name="action" value="save">
                  <input type="hidden" name="advanceId" value="<?= e($row['advanceId']) ?>">
                  <input type="hidden" name="month" value="<?= $month ?>">
                  <input type="hidden" name="year" value="<?= $year ?>">
                  <div>
                    <label class="form-label">Amount (₹)</label>
                    <input class="input" type="number" name="amount" style="width:130px;" value="<?= e((string) ($row['currentMonthRecovery'] ?? '')) ?>">
                  </div>
                  <div>
                    <label class="form-label">Status</label>
                    <select class="input" name="status" style="width:120px;">
                      <option value="PAID" <?= ($row['currentMonthStatus'] ?? 'PAID') === 'PAID' ? 'selected' : '' ?>>Paid</option>
                      <option value="UNPAID" <?= ($row['currentMonthStatus'] ?? '') === 'UNPAID' ? 'selected' : '' ?>>Unpaid</option>
                    </select>
                  </div>
                  <div style="flex:1; min-width:220px;">
                    <label class="form-label">Remarks</label>
                    <input class="input" name="remarks" list="remarksList" value="<?= e($row['remarks'] ?? '') ?>" placeholder="e.g. Employee on Leave, Salary Hold, Resigned">
                    <datalist id="remarksList">
                      <option value="Employee on Leave"><option value="Salary Hold"><option value="Recovery Deferred">
                      <option value="Management Approval"><option value="Medical Leave"><option value="Resigned">
                    </datalist>
                  </div>
                  <button type="submit" class="btn-primary">Save</button>
                </form>
              </td>
            </tr>
          <?php endif; ?>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
<?php endif; ?>

<?php require __DIR__ . '/includes/layout_footer.php'; ?>

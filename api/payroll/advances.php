<?php
require __DIR__ . '/config.php';
$currentUser = require_payroll_login();
$pageTitle = 'Salary Advances';
$activeNav = 'advances';
$dbc = db();

// ── Create ───────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'create') {
    require_csrf();
    $userId = trim($_POST['userId'] ?? '');
    $advanceAmount = (float) ($_POST['advanceAmount'] ?? 0);
    $advanceDate = $_POST['advanceDate'] ?? '';
    $recoveryType = in_array($_POST['recoveryType'] ?? '', ['MONTHLY_FIXED', 'MANUAL'], true) ? $_POST['recoveryType'] : 'MONTHLY_FIXED';
    $monthlyRecoveryAmount = (float) ($_POST['monthlyRecoveryAmount'] ?? 0);
    $recoveryStartMonth = (int) ($_POST['recoveryStartMonth'] ?? date('n'));
    $recoveryStartYear = (int) ($_POST['recoveryStartYear'] ?? date('Y'));
    $reason = trim($_POST['reason'] ?? '');

    $errors = [];
    if (!$userId) {
        $errors[] = 'Employee ID is required.';
    } else {
        $chk = $dbc->prepare('SELECT id FROM `User` WHERE id=? LIMIT 1');
        $chk->execute([$userId]);
        if (!$chk->fetch()) $errors[] = 'No employee found with that ID.';
    }
    if ($advanceAmount <= 0) $errors[] = 'Advance amount must be greater than 0.';
    if (!$advanceDate) $errors[] = 'Advance date is required.';
    if ($recoveryType === 'MONTHLY_FIXED' && $monthlyRecoveryAmount <= 0) $errors[] = 'Monthly recovery amount is required.';

    if ($errors) {
        flash_set('error', implode(' ', $errors));
        redirect('advances.php?new=1');
    }

    $id = gen_id();
    $now = now_sql();
    $dbc->prepare(
        'INSERT INTO `SalaryAdvance`
         (id,userId,advanceDate,advanceAmount,reason,recoveryStartMonth,recoveryStartYear,recoveryType,monthlyRecoveryAmount,status,recoveredAmount,createdById,createdAt,updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,\'ACTIVE\',0,?,?,?)'
    )->execute([
        $id, $userId, $advanceDate, $advanceAmount, $reason ?: null, $recoveryStartMonth, $recoveryStartYear,
        $recoveryType, $recoveryType === 'MONTHLY_FIXED' ? $monthlyRecoveryAmount : null,
        $currentUser['id'], $now, $now,
    ]);
    log_activity($currentUser['id'], 'SALARY_ADVANCE_CREATED', 'SalaryAdvance', $id, ['userId' => $userId, 'amount' => $advanceAmount]);

    flash_set('success', 'Salary advance created.');
    redirect('advances.php');
}

// ── Cancel ───────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'cancel') {
    require_csrf();
    $id = $_POST['id'] ?? '';
    $dbc->prepare("UPDATE `SalaryAdvance` SET status='CANCELLED', updatedAt=? WHERE id=? AND status='ACTIVE'")->execute([now_sql(), $id]);
    log_activity($currentUser['id'], 'SALARY_ADVANCE_CANCELLED', 'SalaryAdvance', $id, []);
    flash_set('success', 'Advance cancelled.');
    redirect('advances.php');
}

// ── List ─────────────────────────────────────────────────────────────
$statusFilter = $_GET['status'] ?? '';
$where = [];
$params = [];
if ($statusFilter) { $where[] = 'sa.status=?'; $params[] = $statusFilter; }
$whereSql = $where ? 'WHERE ' . implode(' AND ', $where) : '';
$s = $dbc->prepare("SELECT sa.*, u.name AS employeeName, u.employeeCode, u.department FROM `SalaryAdvance` sa JOIN `User` u ON u.id=sa.userId $whereSql ORDER BY sa.advanceDate DESC");
$s->execute($params);

$advances = [];
foreach ($s->fetchAll() as $row) {
    $lastStmt = $dbc->prepare('SELECT month,year FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year DESC, month DESC LIMIT 1');
    $lastStmt->execute([$row['id']]);
    $last = $lastStmt->fetch();
    $advances[] = array_merge($row, calc_advance_projection($row, $last['month'] ?? null, $last['year'] ?? null));
}

require __DIR__ . '/includes/layout_header.php';
?>

<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;">
  <h1 class="page-title"><?= svg_icon('wallet') ?> Salary Advances</h1>
  <a href="?new=1<?= $statusFilter ? '&status=' . e($statusFilter) : '' ?>" class="btn-primary">+ New Advance</a>
</div>

<form method="get" style="margin-bottom:18px;">
  <select name="status" class="input" style="width:200px;" onchange="this.form.submit()">
    <option value="">All statuses</option>
    <option value="ACTIVE" <?= $statusFilter === 'ACTIVE' ? 'selected' : '' ?>>Active</option>
    <option value="COMPLETED" <?= $statusFilter === 'COMPLETED' ? 'selected' : '' ?>>Completed</option>
    <option value="CANCELLED" <?= $statusFilter === 'CANCELLED' ? 'selected' : '' ?>>Cancelled</option>
  </select>
</form>

<?php if (!$advances): ?>
  <div class="empty-state">
    <div class="empty-state-title">No salary advances yet</div>
    Advances given to employees will show up here, with automatic recovery tracking.
  </div>
<?php else: ?>
  <div style="display:flex; flex-direction:column; gap:12px;">
    <?php foreach ($advances as $a): $pct = (int) round($a['recoveryPercent']); ?>
      <div class="card" style="padding:16px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;">
        <div style="width:48px; height:48px; border-radius:50%; flex-shrink:0; background:conic-gradient(var(--amber) <?= $pct ?>%, var(--slate-200) 0); display:flex; align-items:center; justify-content:center;">
          <div style="width:38px; height:38px; border-radius:50%; background:#fff; display:flex; align-items:center; justify-content:center; font-size:.68rem; font-weight:700;"><?= $pct ?>%</div>
        </div>
        <div class="avatar-circle sm"><?= e(mb_strtoupper(mb_substr($a['employeeName'], 0, 1))) ?></div>
        <div style="flex:1; min-width:180px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <strong><?= e($a['employeeName']) ?></strong>
            <span class="badge badge-<?= strtolower(e($a['status'])) ?>"><?= e($a['status']) ?></span>
          </div>
          <div style="font-size:.78rem; color:var(--slate-500); margin-top:2px;">
            <?= e($a['employeeCode']) ?> · <?= e($a['department']) ?> · Given <?= fmt_date($a['advanceDate']) ?>
          </div>
        </div>
        <div style="text-align:right;">
          <div class="tabular" style="font-weight:600;"><?= money($a['remainingAmount']) ?> <span style="font-weight:400; color:var(--slate-400);">remaining</span></div>
          <div style="font-size:.78rem; color:var(--slate-400);">of <?= money((float) $a['advanceAmount']) ?></div>
          <?php if ($a['expectedClosingDate']): ?>
            <div style="font-size:.72rem; color:var(--slate-400);">Closes <?= fmt_date($a['expectedClosingDate']) ?></div>
          <?php endif; ?>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px;">
          <a href="pdf.php?type=advance&id=<?= urlencode($a['id']) ?>" class="btn-secondary" style="font-size:.75rem; padding:5px 10px;" target="_blank">PDF</a>
          <?php if ($a['status'] === 'ACTIVE'): ?>
            <form method="post" onsubmit="return confirm('Cancel this advance for <?= e(addslashes($a['employeeName'])) ?>?');" style="margin:0;">
              <?= csrf_field() ?>
              <input type="hidden" name="action" value="cancel">
              <input type="hidden" name="id" value="<?= e($a['id']) ?>">
              <button type="submit" class="btn-danger" style="font-size:.75rem; padding:5px 10px;">Cancel</button>
            </form>
          <?php endif; ?>
        </div>
      </div>
    <?php endforeach; ?>
  </div>
<?php endif; ?>

<?php if (isset($_GET['new'])): ?>
<div class="modal-backdrop">
  <div class="modal">
    <div class="modal-header">
      <h2 style="margin:0; font-size:1rem; font-weight:600;">New salary advance</h2>
      <a href="advances.php" class="btn-ghost">✕</a>
    </div>
    <form method="post">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="create">
      <div class="modal-body" style="display:grid; grid-template-columns:1fr 1fr; gap:14px;">
        <div>
          <label class="form-label">Employee ID *</label>
          <input class="input" name="userId" required>
        </div>
        <div>
          <label class="form-label">Advance Date *</label>
          <input class="input" type="date" name="advanceDate" value="<?= e(date('Y-m-d')) ?>" required>
        </div>
        <div>
          <label class="form-label">Advance Amount (₹) *</label>
          <input class="input" type="number" name="advanceAmount" min="1" required>
        </div>
        <div>
          <label class="form-label">Recovery Type</label>
          <select class="input" name="recoveryType" id="recoveryType" onchange="document.getElementById('monthlyWrap').style.display=this.value==='MONTHLY_FIXED'?'block':'none';">
            <option value="MONTHLY_FIXED">Monthly Fixed Amount</option>
            <option value="MANUAL">Manual Recovery</option>
          </select>
        </div>
        <div id="monthlyWrap">
          <label class="form-label">Monthly Recovery (₹) *</label>
          <input class="input" type="number" name="monthlyRecoveryAmount" min="1">
        </div>
        <div>
          <label class="form-label">Recovery Start Month</label>
          <div style="display:flex; gap:8px;">
            <select class="input" name="recoveryStartMonth">
              <?php $months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
              foreach ($months as $i => $m): ?>
                <option value="<?= $i + 1 ?>" <?= (int) date('n') === $i + 1 ? 'selected' : '' ?>><?= e($m) ?></option>
              <?php endforeach; ?>
            </select>
            <input class="input" type="number" name="recoveryStartYear" value="<?= e(date('Y')) ?>" style="width:90px;">
          </div>
        </div>
        <div style="grid-column:1 / -1;">
          <label class="form-label">Reason</label>
          <textarea class="input" name="reason" rows="2"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <a href="advances.php" class="btn-secondary">Cancel</a>
        <button type="submit" class="btn-primary">Create advance</button>
      </div>
    </form>
  </div>
</div>
<?php endif; ?>

<?php require __DIR__ . '/includes/layout_footer.php'; ?>

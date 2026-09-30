<?php
require __DIR__ . '/config.php';
require_payroll_login();
$pageTitle = 'Employees';
$activeNav = 'employees';
$dbc = db();

$search = trim($_GET['search'] ?? '');
$where = ['isActive=1'];
$params = [];
if ($search) {
    $where[] = '(name LIKE ? OR email LIKE ? OR department LIKE ? OR employeeCode LIKE ?)';
    $term = "%$search%";
    $params = [$term, $term, $term, $term];
}
$s = $dbc->prepare('SELECT id,name,email,department,employeeCode FROM `User` WHERE ' . implode(' AND ', $where) . ' ORDER BY name ASC');
$s->execute($params);
$employees = $s->fetchAll();

// Who currently has an active advance — shown as a small badge, same
// "flex items-center gap-1 ... rounded-full font-medium" treatment your
// Team members page uses for its role badge.
$outstanding = [];
foreach ($dbc->query("SELECT DISTINCT userId FROM `SalaryAdvance` WHERE status='ACTIVE'")->fetchAll() as $row) {
    $outstanding[$row['userId']] = true;
}

require __DIR__ . '/includes/layout_header.php';
?>

<div class="mb-6">
  <h1 class="page-title"><?= svg_icon('users') ?> Employees</h1>
  <p class="page-subtitle"><?= count($employees) ?> active employee<?= count($employees) === 1 ? '' : 's' ?></p>
</div>

<form method="get" style="margin-bottom:20px;">
  <input class="input" name="search" placeholder="Search name, email, department, employee code…" value="<?= e($search) ?>" style="max-width:380px;">
</form>

<?php if (!$employees): ?>
  <div class="empty-state">
    <div class="empty-state-title">No employees found</div>
    <?= $search ? 'Try a different search.' : 'Active employees will show up here.' ?>
  </div>
<?php else: ?>
  <div class="employee-grid" style="display:grid; grid-template-columns:1fr; gap:16px;">
    <?php foreach ($employees as $emp): ?>
      <a href="ledger.php?userId=<?= urlencode($emp['id']) ?>" class="card" style="padding:16px; display:flex; align-items:center; gap:12px; text-decoration:none; color:inherit;">
        <div class="avatar-circle"><?= e(mb_strtoupper(mb_substr($emp['name'] ?: '?', 0, 1))) ?></div>
        <div style="min-width:0; flex:1;">
          <div style="font-weight:600; font-size:.9rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><?= e($emp['name']) ?></div>
          <div style="font-size:.78rem; color:var(--slate-500); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><?= e($emp['email']) ?></div>
          <?php if ($emp['department']): ?>
            <div style="font-size:.75rem; color:var(--slate-400); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><?= e($emp['department']) ?></div>
          <?php endif; ?>
        </div>
        <?php if (isset($outstanding[$emp['id']])): ?>
          <span class="badge badge-pending" style="flex-shrink:0;">Active Advance</span>
        <?php endif; ?>
      </a>
    <?php endforeach; ?>
  </div>
<?php endif; ?>

<style>
@media (min-width: 640px)  { .employee-grid { grid-template-columns: repeat(2, 1fr) !important; } }
@media (min-width: 1024px) { .employee-grid { grid-template-columns: repeat(3, 1fr) !important; } }
</style>

<?php require __DIR__ . '/includes/layout_footer.php'; ?>

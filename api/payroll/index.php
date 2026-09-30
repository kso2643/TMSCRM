<?php
require __DIR__ . '/config.php';
require_payroll_login();

$pageTitle = 'Dashboard';
$activeNav = 'dashboard';

$dbc = db();
$year = (int) date('Y');
$month = (int) date('n');

// ── Cards (mirrors DashboardController::payroll() in api/) ─────────────
$totalEmployees = (int) $dbc->query('SELECT COUNT(*) FROM `User` WHERE isActive=1')->fetchColumn();

$s = $dbc->prepare('SELECT COALESCE(SUM(netSalary),0) FROM `Payroll` WHERE year=? AND month=?');
$s->execute([$year, $month]);
$salaryThisMonth = (float) $s->fetchColumn();

$totalAdvances = (float) $dbc->query("SELECT COALESCE(SUM(advanceAmount),0) FROM `SalaryAdvance` WHERE status IN ('ACTIVE','COMPLETED')")->fetchColumn();
$pendingRecoveries = (float) $dbc->query("SELECT COALESCE(SUM(advanceAmount - recoveredAmount),0) FROM `SalaryAdvance` WHERE status='ACTIVE'")->fetchColumn();
$completedRecoveries = (int) $dbc->query("SELECT COUNT(*) FROM `SalaryAdvance` WHERE status='COMPLETED'")->fetchColumn();

$s = $dbc->prepare(
    "SELECT COUNT(*) FROM `SalaryAdvance` sa
     WHERE sa.status='ACTIVE' AND sa.recoveryType='MONTHLY_FIXED'
       AND NOT EXISTS (SELECT 1 FROM `AdvanceRecovery` ar WHERE ar.advanceId=sa.id AND ar.month=? AND ar.year=?)"
);
$s->execute([$month, $year]);
$upcomingRecoveries = (int) $s->fetchColumn();

$employeesWithOutstanding = (int) $dbc->query("SELECT COUNT(DISTINCT userId) FROM `SalaryAdvance` WHERE status='ACTIVE'")->fetchColumn();

// ── Department breakdown ────────────────────────────────────────────────
$deptStmt = $dbc->prepare(
    "SELECT COALESCE(u.department,'Unassigned') AS department, COALESCE(SUM(p.netSalary),0) AS total
     FROM `Payroll` p JOIN `User` u ON u.id=p.userId
     WHERE p.year=? AND p.month=? GROUP BY u.department ORDER BY total DESC"
);
$deptStmt->execute([$year, $month]);
$deptChart = $deptStmt->fetchAll();

// ── 6-month trends, for Chart.js (loaded via CDN — no build step here) ──
function payroll_monthly_trend(PDO $dbc, string $metric, int $months = 6): array
{
    $labels = [];
    $values = [];
    for ($i = $months - 1; $i >= 0; $i--) {
        $d = new DateTime("first day of -$i month midnight");
        $y = (int) $d->format('Y');
        $m = (int) $d->format('n');
        if ($metric === 'salary') {
            $s = $dbc->prepare('SELECT COALESCE(SUM(netSalary),0) FROM `Payroll` WHERE year=? AND month=?');
            $s->execute([$y, $m]);
        } elseif ($metric === 'advance') {
            $from = $d->format('Y-m-d');
            $to = (clone $d)->modify('+1 month')->format('Y-m-d');
            $s = $dbc->prepare('SELECT COALESCE(SUM(advanceAmount),0) FROM `SalaryAdvance` WHERE advanceDate>=? AND advanceDate<?');
            $s->execute([$from, $to]);
        } else {
            $s = $dbc->prepare("SELECT COALESCE(SUM(amountRecovered),0) FROM `AdvanceRecovery` WHERE year=? AND month=? AND status='PAID'");
            $s->execute([$y, $m]);
        }
        $labels[] = month_label($m, $y);
        $values[] = round((float) $s->fetchColumn(), 2);
    }
    return [$labels, $values];
}

[$salaryLabels, $salaryValues] = payroll_monthly_trend($dbc, 'salary');
[, $advanceValues] = payroll_monthly_trend($dbc, 'advance');
[, $recoveryValues] = payroll_monthly_trend($dbc, 'recovery');

require __DIR__ . '/includes/layout_header.php';
?>

<h1 class="page-title" style="margin-bottom:20px;"><?= svg_icon('layout-dashboard') ?> Payroll Dashboard</h1>

<div style="display:grid; grid-template-columns:repeat(2,1fr); gap:16px; margin-bottom:28px;" class="md-grid-4">
  <?php
  $cards = [
      ['label' => 'Total Employees', 'value' => (string) $totalEmployees, 'icon' => 'layout-dashboard', 'color' => 'primary'],
      ['label' => 'Salary This Month', 'value' => money($salaryThisMonth), 'icon' => 'wallet', 'color' => 'primary'],
      ['label' => 'Total Advances', 'value' => money($totalAdvances), 'icon' => 'wallet', 'color' => 'amber'],
      ['label' => 'Pending Recoveries', 'value' => money($pendingRecoveries), 'icon' => 'clipboard-list', 'color' => 'amber'],
      ['label' => 'Completed Recoveries', 'value' => (string) $completedRecoveries, 'icon' => 'clipboard-list', 'color' => 'green'],
      ['label' => 'Upcoming Recoveries', 'value' => (string) $upcomingRecoveries, 'icon' => 'clipboard-list', 'color' => 'amber'],
      ['label' => 'Employees w/ Advances', 'value' => (string) $employeesWithOutstanding, 'icon' => 'book-text', 'color' => 'red'],
  ];
  foreach ($cards as $c): ?>
    <div class="stat-card">
      <div class="stat-icon <?= e($c['color']) ?>"><?= svg_icon($c['icon']) ?></div>
      <div class="stat-value tabular"><?= e($c['value']) ?></div>
      <div class="stat-label"><?= e($c['label']) ?></div>
    </div>
  <?php endforeach; ?>
</div>

<div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;" class="md-grid-2">
  <div class="card" style="padding:20px;">
    <h2 class="section-title" style="margin-bottom:14px;">Monthly Salary Trend</h2>
    <canvas id="chartSalary" height="160"></canvas>
  </div>
  <div class="card" style="padding:20px;">
    <h2 class="section-title" style="margin-bottom:14px;">Advance Trend</h2>
    <canvas id="chartAdvance" height="160"></canvas>
  </div>
  <div class="card" style="padding:20px;">
    <h2 class="section-title" style="margin-bottom:14px;">Recovery Trend</h2>
    <canvas id="chartRecovery" height="160"></canvas>
  </div>
  <div class="card" style="padding:20px;">
    <h2 class="section-title" style="margin-bottom:14px;">Salary by Department — <?= e(month_label($month, $year)) ?></h2>
    <?php if (!$deptChart): ?>
      <div class="empty-state"><div class="empty-state-title">No payroll processed this month yet</div></div>
    <?php else: ?>
      <?php $maxDept = max(array_column($deptChart, 'total')) ?: 1; ?>
      <div style="display:flex; flex-direction:column; gap:12px;">
        <?php foreach ($deptChart as $row): ?>
          <div>
            <div style="display:flex; justify-content:space-between; font-size:.82rem; margin-bottom:4px;">
              <span><?= e($row['department']) ?></span>
              <span class="tabular" style="font-weight:600;"><?= money((float) $row['total']) ?></span>
            </div>
            <div style="background:var(--slate-100); border-radius:6px; height:8px; overflow:hidden;">
              <div style="background:var(--primary); height:100%; width:<?= round(((float) $row['total'] / $maxDept) * 100) ?>%;"></div>
            </div>
          </div>
        <?php endforeach; ?>
      </div>
    <?php endif; ?>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
const labels = <?= json_encode($salaryLabels) ?>;
const baseOpts = (color) => ({
  type: 'line',
  data: { labels, datasets: [{ data: null, borderColor: color, backgroundColor: color + '22', fill: true, tension: 0.35, pointRadius: 3 }] },
  options: { plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '₹' + v.toLocaleString('en-IN') } } } },
});
function renderChart(canvasId, values, color) {
  const cfg = baseOpts(color);
  cfg.data.datasets[0].data = values;
  new Chart(document.getElementById(canvasId), cfg);
}
renderChart('chartSalary', <?= json_encode($salaryValues) ?>, '#1E3A5F');
renderChart('chartAdvance', <?= json_encode($advanceValues) ?>, '#F59E0B');
renderChart('chartRecovery', <?= json_encode($recoveryValues) ?>, '#16A34A');
</script>

<style>
@media (min-width: 768px) {
  .md-grid-4 { grid-template-columns: repeat(4, 1fr) !important; }
  .md-grid-2 { grid-template-columns: 1fr 1fr !important; }
}
</style>

<?php require __DIR__ . '/includes/layout_footer.php'; ?>

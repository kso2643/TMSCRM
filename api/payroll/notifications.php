<?php
require __DIR__ . '/config.php';
$currentUser = require_payroll_login();
$pageTitle = 'Notifications';
$activeNav = 'notifications';
$dbc = db();

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const PROBATION_MONTHS = 6; // see api/controllers/NotificationController.php for the same note — not stated in the original spec

function insert_if_new(PDO $dbc, string $forUserId, string $type, string $title, string $message, ?string $relatedType, ?string $relatedId, string $dedupeKey): void
{
    try {
        $dbc->prepare(
            'INSERT INTO `Notification` (id,userId,type,title,message,relatedType,relatedId,dedupeKey,isRead,createdAt)
             VALUES (?,?,?,?,?,?,?,?,0,?)'
        )->execute([gen_id(), $forUserId, $type, $title, $message, $relatedType, $relatedId, $dedupeKey, now_sql()]);
    } catch (PDOException $e) {
        // dedupeKey collision — already notified, fine.
    }
}

function generate_notifications(PDO $dbc, string $forUserId): void
{
    $today = new DateTime();
    $year = (int) $today->format('Y');
    $month = (int) $today->format('n');
    $day = (int) $today->format('j');
    $todayStr = $today->format('Y-m-d');

    if ($day >= 25) {
        $s = $dbc->prepare(
            'SELECT COUNT(*) FROM `User` u WHERE u.isActive=1
             AND NOT EXISTS (SELECT 1 FROM `Payroll` p WHERE p.userId=u.id AND p.year=? AND p.month=?)'
        );
        $s->execute([$year, $month]);
        $pending = (int) $s->fetchColumn();
        if ($pending > 0) {
            insert_if_new($dbc, $forUserId, 'SALARY_PROCESSING_DUE', 'Salary processing due',
                "$pending employee(s) still need payroll processed for " . MONTHS_FULL[$month - 1] . " $year.",
                null, null, "SALARY_PROCESSING_DUE:$forUserId:$year:$month");
        }
    }

    $s = $dbc->prepare(
        "SELECT sa.id, u.name FROM `SalaryAdvance` sa JOIN `User` u ON u.id=sa.userId
         WHERE sa.status='ACTIVE' AND sa.recoveryType='MONTHLY_FIXED'
           AND NOT EXISTS (SELECT 1 FROM `AdvanceRecovery` ar WHERE ar.advanceId=sa.id AND ar.month=? AND ar.year=?)"
    );
    $s->execute([$month, $year]);
    foreach ($s->fetchAll() as $row) {
        insert_if_new($dbc, $forUserId, 'RECOVERY_PENDING', 'Recovery pending',
            "{$row['name']}'s advance recovery for this month hasn't been processed yet.",
            'SalaryAdvance', $row['id'], "RECOVERY_PENDING:{$row['id']}:$year:$month");
    }

    $s = $dbc->prepare("SELECT id,userId FROM `SalaryAdvance` WHERE status='COMPLETED' AND updatedAt >= ?");
    $s->execute([(new DateTime('-1 day'))->format('Y-m-d H:i:s')]);
    foreach ($s->fetchAll() as $row) {
        $n = $dbc->prepare('SELECT name FROM `User` WHERE id=?');
        $n->execute([$row['userId']]);
        $name = $n->fetchColumn() ?: 'An employee';
        insert_if_new($dbc, $forUserId, 'ADVANCE_COMPLETED', 'Advance completed',
            "$name has fully repaid their salary advance.", 'SalaryAdvance', $row['id'], "ADVANCE_COMPLETED:{$row['id']}");
    }

    $s = $dbc->query("SELECT sa.*, u.name FROM `SalaryAdvance` sa JOIN `User` u ON u.id=sa.userId WHERE sa.status='ACTIVE' AND sa.recoveryType='MONTHLY_FIXED'");
    foreach ($s->fetchAll() as $row) {
        $lastStmt = $dbc->prepare('SELECT month,year FROM `AdvanceRecovery` WHERE advanceId=? ORDER BY year DESC, month DESC LIMIT 1');
        $lastStmt->execute([$row['id']]);
        $last = $lastStmt->fetch();
        $proj = calc_advance_projection($row, $last['month'] ?? null, $last['year'] ?? null);
        if ($proj['expectedClosingDate'] && $proj['expectedClosingDate'] < $todayStr) {
            insert_if_new($dbc, $forUserId, 'ADVANCE_OVERDUE', 'Advance overdue',
                "{$row['name']}'s advance is past its expected closing date.", 'SalaryAdvance', $row['id'], "ADVANCE_OVERDUE:{$row['id']}:" . $today->format('Y-m'));
        }
    }

    $s = $dbc->prepare('SELECT id,name FROM `User` WHERE isActive=1 AND dateOfBirth IS NOT NULL AND MONTH(dateOfBirth)=? AND DAY(dateOfBirth)=?');
    $s->execute([$month, $day]);
    foreach ($s->fetchAll() as $row) {
        insert_if_new($dbc, $forUserId, 'EMPLOYEE_BIRTHDAY', 'Employee birthday',
            "Today is {$row['name']}'s birthday!", 'User', $row['id'], "EMPLOYEE_BIRTHDAY:{$row['id']}:$year");
    }

    $s = $dbc->prepare('SELECT id,name FROM `User` WHERE isActive=1 AND dateOfJoining IS NOT NULL AND DATE_ADD(dateOfJoining, INTERVAL ' . PROBATION_MONTHS . ' MONTH) = ?');
    $s->execute([$todayStr]);
    foreach ($s->fetchAll() as $row) {
        insert_if_new($dbc, $forUserId, 'PROBATION_COMPLETION', 'Probation completion',
            "{$row['name']}'s probation period ends today.", 'User', $row['id'], "PROBATION_COMPLETION:{$row['id']}");
    }
}

// ── Mark read ────────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'read') {
    require_csrf();
    $dbc->prepare('UPDATE `Notification` SET isRead=1 WHERE id=? AND userId=?')->execute([$_POST['id'] ?? '', $currentUser['id']]);
    redirect('notifications.php');
}
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'read-all') {
    require_csrf();
    $dbc->prepare('UPDATE `Notification` SET isRead=1 WHERE userId=? AND isRead=0')->execute([$currentUser['id']]);
    redirect('notifications.php');
}

generate_notifications($dbc, $currentUser['id']);

$s = $dbc->prepare('SELECT * FROM `Notification` WHERE userId=? AND isRead=0 ORDER BY createdAt DESC LIMIT 50');
$s->execute([$currentUser['id']]);
$notifications = $s->fetchAll();

require __DIR__ . '/includes/layout_header.php';
?>

<div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px;">
  <h1 class="page-title"><?= svg_icon('bell') ?> Notifications</h1>
  <?php if ($notifications): ?>
    <form method="post" style="margin:0;">
      <?= csrf_field() ?>
      <input type="hidden" name="action" value="read-all">
      <button type="submit" class="btn-secondary">Mark all read</button>
    </form>
  <?php endif; ?>
</div>

<?php if (!$notifications): ?>
  <div class="empty-state"><div class="empty-state-title">You're all caught up</div>No pending reminders right now.</div>
<?php else: ?>
  <div style="display:flex; flex-direction:column; gap:10px;">
    <?php foreach ($notifications as $n): ?>
      <div class="card" style="padding:14px 16px; display:flex; justify-content:space-between; align-items:flex-start; gap:14px;">
        <div>
          <div style="font-weight:600; font-size:.9rem;"><?= e($n['title']) ?></div>
          <div style="font-size:.82rem; color:var(--slate-500); margin-top:2px;"><?= e($n['message']) ?></div>
          <div style="font-size:.72rem; color:var(--slate-400); margin-top:4px;"><?= fmt_date($n['createdAt']) ?></div>
        </div>
        <form method="post" style="margin:0; flex-shrink:0;">
          <?= csrf_field() ?>
          <input type="hidden" name="action" value="read">
          <input type="hidden" name="id" value="<?= e($n['id']) ?>">
          <button type="submit" class="btn-ghost" style="font-size:.75rem;">Dismiss</button>
        </form>
      </div>
    <?php endforeach; ?>
  </div>
<?php endif; ?>

<div class="flash" style="background:var(--slate-100); color:var(--slate-500); margin-top:24px;">
  This covers the in-app list only. Email and browser-push delivery need mailer/push infrastructure this project doesn't have yet — see the note in api/controllers/NotificationController.php.
</div>

<?php require __DIR__ . '/includes/layout_footer.php'; ?>

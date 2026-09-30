<?php
/**
 * Shared shell for every page. Each page sets $pageTitle and $activeNav
 * before requiring this file.
 *
 * @var string $pageTitle
 * @var string $activeNav one of: dashboard | advances | recovery | ledger | notifications
 */

$user = payroll_current_user();

// If your main CRM lives at a known URL, put it here for the "Back to CRM" link.
if (!defined('CRM_APP_URL')) {
    define('CRM_APP_URL', '#');
}

$navItems = [
    ['key' => 'dashboard',     'label' => 'Dashboard',         'href' => 'index.php',              'icon' => 'layout-dashboard'],
    ['key' => 'advances',      'label' => 'Salary Advances',   'href' => 'advances.php',           'icon' => 'wallet'],
    ['key' => 'recovery',      'label' => 'Advance Recovery',  'href' => 'advance-recovery.php',   'icon' => 'clipboard-list'],
    ['key' => 'ledger',        'label' => 'Employee Ledger',   'href' => 'ledger.php',              'icon' => 'book-text'],
    ['key' => 'notifications', 'label' => 'Notifications',     'href' => 'notifications.php',       'icon' => 'bell'],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title><?= e($pageTitle ?? 'Payroll') ?> · Payroll</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="includes/style.css">
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <div class="sidebar-brand">Payroll</div>
    <nav style="padding:8px 0; flex:1;">
      <?php foreach ($navItems as $item): ?>
        <a href="<?= e($item['href']) ?>" class="sidebar-link<?= ($activeNav ?? '') === $item['key'] ? ' sidebar-link-active' : '' ?>">
          <?= svg_icon($item['icon']) ?>
          <span><?= e($item['label']) ?></span>
        </a>
      <?php endforeach; ?>
    </nav>
    <div style="padding:14px; border-top:1px solid #f1f5f9;">
      <a href="<?= e(CRM_APP_URL) ?>" class="sidebar-link" style="margin:0; padding:6px 0;">← Back to CRM</a>
    </div>
  </aside>

  <div class="main">
    <div class="topbar">
      <div style="font-size:.85rem; color:#64748b;">Signed in as <strong><?= e($user['name'] ?? '') ?></strong></div>
      <form method="post" action="logout.php" style="margin:0;">
        <?= csrf_field() ?>
        <button type="submit" class="btn-secondary">Sign out</button>
      </form>
    </div>
    <div class="content">
      <?php if ($flash = flash_get()): ?>
        <div class="flash flash-<?= e($flash['type']) ?>"><?= e($flash['message']) ?></div>
      <?php endif; ?>

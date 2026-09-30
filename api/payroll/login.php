<?php
require __DIR__ . '/config.php';

if (payroll_current_user()) {
    redirect('index.php');
}

$error = null;
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    require_csrf();
    $email = trim($_POST['email'] ?? '');
    $password = (string) ($_POST['password'] ?? '');
    if ($email === '' || $password === '') {
        $error = 'Enter both email and password.';
    } else {
        $error = payroll_login($email, $password);
        if ($error === null) {
            $redirectTo = $_SESSION['login_redirect'] ?? 'index.php';
            unset($_SESSION['login_redirect']);
            redirect($redirectTo ?: 'index.php');
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign in · Payroll</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="includes/style.css">
</head>
<body style="display:flex; align-items:center; justify-content:center; min-height:100vh; background:var(--slate-50,#f8fafc);">
  <div class="card" style="width:100%; max-width:360px; padding:32px;">
    <div style="text-align:center; margin-bottom:24px;">
      <div style="font-weight:700; font-size:1.2rem; color:#1E3A5F;">Payroll</div>
      <div style="font-size:.85rem; color:#64748b; margin-top:2px;">Sign in to continue</div>
    </div>
    <?php if ($error): ?>
      <div class="flash flash-error"><?= e($error) ?></div>
    <?php endif; ?>
    <form method="post" action="login.php">
      <?= csrf_field() ?>
      <div style="margin-bottom:14px;">
        <label class="form-label">Email</label>
        <input class="input" type="email" name="email" required value="<?= e($_POST['email'] ?? '') ?>" autofocus>
      </div>
      <div style="margin-bottom:20px;">
        <label class="form-label">Password</label>
        <input class="input" type="password" name="password" required>
      </div>
      <button type="submit" class="btn-primary" style="width:100%; justify-content:center;">Sign in</button>
    </form>
  </div>
</body>
</html>

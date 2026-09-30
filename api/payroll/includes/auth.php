<?php
/**
 * Session-based auth for the standalone payroll app — deliberately
 * separate from the API's JWT auth (that's built for the Next.js SPA's
 * HTTP calls; bridging a browser-stored JWT into a server-rendered app
 * safely is more trouble than it's worth). This checks against the exact
 * same `User` table and bcrypt hashes though, so the same email/password
 * that works in the CRM works here too.
 */

const PAYROLL_ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN'];

function payroll_current_user(): ?array
{
    if (empty($_SESSION['user_id'])) return null;
    static $cached = null;
    if ($cached !== null) return $cached;

    $s = db()->prepare('SELECT id,name,email,role,isActive,isLocked FROM `User` WHERE id=? LIMIT 1');
    $s->execute([$_SESSION['user_id']]);
    $u = $s->fetch();
    if (!$u || !$u['isActive'] || $u['isLocked']) {
        $_SESSION = [];
        return null;
    }
    return $cached = $u;
}

/** Call at the top of every protected page. Redirects to login if not an admin-tier user. */
function require_payroll_login(): array
{
    $user = payroll_current_user();
    if (!$user || !in_array($user['role'], PAYROLL_ADMIN_ROLES, true)) {
        $_SESSION['login_redirect'] = $_SERVER['REQUEST_URI'] ?? 'index.php';
        header('Location: login.php');
        exit;
    }
    return $user;
}

/** Returns null on success, or a user-facing error message. */
function payroll_login(string $email, string $password): ?string
{
    $s = db()->prepare('SELECT id,password,isActive,isLocked,role FROM `User` WHERE email=? LIMIT 1');
    $s->execute([$email]);
    $u = $s->fetch();

    // Same message for "no such user" and "wrong password" — don't reveal which one it was.
    if (!$u || !password_verify($password, $u['password'])) return 'Invalid email or password.';
    if (!$u['isActive']) return 'This account is deactivated.';
    if ($u['isLocked']) return 'This account is locked. Contact an administrator.';
    if (!in_array($u['role'], PAYROLL_ADMIN_ROLES, true)) return 'This account does not have payroll access.';

    session_regenerate_id(true);
    $_SESSION['user_id'] = $u['id'];
    db()->prepare('UPDATE `User` SET lastLoginAt=? WHERE id=?')->execute([now_sql(), $u['id']]);
    log_activity($u['id'], 'PAYROLL_APP_LOGIN', 'User', $u['id'], []);
    return null;
}

function payroll_logout(): void
{
    $user = payroll_current_user();
    if ($user) log_activity($user['id'], 'PAYROLL_APP_LOGOUT', 'User', $user['id'], []);
    $_SESSION = [];
    session_destroy();
}

// ── CSRF protection for every POST form in this app ─────────────────────
function csrf_token(): string
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf_token'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="csrf_token" value="' . htmlspecialchars(csrf_token(), ENT_QUOTES) . '">';
}

function require_csrf(): void
{
    $token = $_POST['csrf_token'] ?? '';
    if ($token === '' || !hash_equals($_SESSION['csrf_token'] ?? '', $token)) {
        http_response_code(419);
        die('Your session expired — go back and try again.');
    }
}

<?php
/**
 * Mirrors backend/src/middleware/auth.js. Express middleware chains
 * (authenticate, requireAdmin, ...) become plain functions called inline
 * at the top of each route handler — same checks, same order, same error
 * messages/status codes.
 */

define('ROLE_LEVELS', [
    'SUPER_ADMIN'    => 5,
    'ADMIN'          => 4,
    'MANAGER'        => 3,
    'SALES_ENGINEER' => 2,
    'SALES'          => 1,
]);

/** Reads the Authorization header across Apache / PHP-FPM / built-in server. */
function get_authorization_header(): ?string
{
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) return $value;
        }
    }
    if (!empty($_SERVER['HTTP_AUTHORIZATION'])) return $_SERVER['HTTP_AUTHORIZATION'];
    if (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) return $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    return null;
}

/**
 * Verifies the bearer token and loads the user. Halts the request
 * (sendError + exit) on any failure — exactly like the Express
 * middleware did when it called next(err) / res.json(...) without next().
 */
function authenticate(): array
{
    $authHeader = get_authorization_header();
    if (!$authHeader || !str_starts_with($authHeader, 'Bearer ')) {
        sendError('Access denied. No token provided.', 401);
    }

    $token = substr($authHeader, 7);

    try {
        $decoded = JWT::verify($token, JWT_SECRET);
    } catch (TokenExpiredException $e) {
        sendError('Token expired. Please login again.', 401);
    } catch (JWTException $e) {
        sendError('Invalid token.', 401);
    }

    $stmt = db()->prepare('SELECT id, name, email, role, isActive, isLocked FROM `User` WHERE id = ? LIMIT 1');
    $stmt->execute([$decoded['id'] ?? '']);
    $user = $stmt->fetch();

    if (!$user) sendError('User not found.', 401);
    if (!(bool) $user['isActive']) sendError('Account deactivated. Contact admin.', 403);
    if ((bool) $user['isLocked']) sendError('Account locked. Contact your admin.', 403);

    $user['isActive'] = (bool) $user['isActive'];
    $user['isLocked'] = (bool) $user['isLocked'];

    return $user;
}

/** Halts the request with 403 unless $user's role meets $minRole's level. */
function require_role(array $user, string $minRole): void
{
    $userLevel = ROLE_LEVELS[$user['role']] ?? 0;
    $requiredLevel = ROLE_LEVELS[$minRole] ?? 99;
    if ($userLevel < $requiredLevel) {
        sendError("Access denied. {$minRole} or higher required.", 403);
    }
}

function require_admin(array $user): void      { require_role($user, 'ADMIN'); }
function require_super_admin(array $user): void { require_role($user, 'SUPER_ADMIN'); }
function require_manager(array $user): void     { require_role($user, 'MANAGER'); }

/** True if $requestingUser may view/edit $targetUserId's data. (Kept for parity — unused by any route, same as in the original.) */
function can_access_user(array $requestingUser, string $targetUserId): bool
{
    if (in_array($requestingUser['role'], ['SUPER_ADMIN', 'ADMIN'], true)) return true;
    if ($requestingUser['role'] === 'MANAGER') return true;
    return $requestingUser['id'] === $targetUserId;
}

/** True if the role counts as "admin-tier" for the many `req.user.role !== 'ADMIN'` / isAdmin checks scattered across controllers. */
function is_admin_tier(string $role): bool
{
    return in_array($role, ['ADMIN', 'SUPER_ADMIN', 'MANAGER'], true);
}

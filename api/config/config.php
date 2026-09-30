<?php
/**
 * Loads `.env` (if present) and defines configuration constants used
 * throughout the app. Mirrors backend/.env.example from the Node version —
 * same variable *names* where they map directly, so migrating the env file
 * is mostly a copy/rename job (see README.md).
 */

// ── Minimal .env loader (no Composer / vlucas dependency needed) ─────────
function load_env(string $path): void
{
    if (!is_file($path)) return;
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) continue;
        if (!str_contains($line, '=')) continue;
        [$key, $value] = explode('=', $line, 2);
        $key = trim($key);
        $value = trim($value);
        // Strip matching surrounding quotes
        if (strlen($value) >= 2) {
            $first = $value[0];
            $last = $value[strlen($value) - 1];
            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                $value = substr($value, 1, -1);
            }
        }
        if (getenv($key) === false) {
            putenv("$key=$value");
            $_ENV[$key] = $value;
        }
    }
}

load_env(__DIR__ . '/../.env');

function env(string $key, $default = null)
{
    $val = getenv($key);
    return $val === false ? $default : $val;
}

// ── Database ───────────────────────────────────────────────────────────
define('DB_HOST', env('DB_HOST', '127.0.0.1'));
define('DB_PORT', env('DB_PORT', '3306'));
define('DB_NAME', env('DB_NAME', 'industrial_crm'));
define('DB_USER', env('DB_USER', 'root'));
define('DB_PASS', env('DB_PASS', ''));

// ── Auth ───────────────────────────────────────────────────────────────
define('JWT_SECRET', env('JWT_SECRET', 'change_this_to_a_long_random_secret_in_production'));
define('JWT_EXPIRES_IN', env('JWT_EXPIRES_IN', '7d')); // e.g. "7d", "12h", "30m", "3600" (seconds)

// ── Server / CORS ─────────────────────────────────────────────────────
define('APP_PORT', env('PORT', '5000'));
define('FRONTEND_URL', env('FRONTEND_URL', 'http://localhost:3000'));
define('APP_ENV', env('NODE_ENV', env('APP_ENV', 'development')));

// ── Paths ──────────────────────────────────────────────────────────────
define('BASE_PATH', dirname(__DIR__));
define('UPLOADS_PATH', BASE_PATH . '/uploads');

// ── Rate limiting (very small in-file counters, see includes/RateLimit.php)
define('RATE_LIMIT_WINDOW_SECONDS', 15 * 60);
define('RATE_LIMIT_MAX', 200);
define('AUTH_RATE_LIMIT_MAX', 20);

date_default_timezone_set(env('APP_TIMEZONE', 'Asia/Kolkata'));

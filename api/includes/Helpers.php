<?php
/**
 * General-purpose helpers used across controllers. Centralises the small
 * bits of glue code that Express + Prisma gave for free (req.body parsing,
 * req.query, Prisma's cuid() ID generation, Date coercion, etc.)
 */

/** Generates an opaque, URL-safe unique ID — a drop-in stand-in for Prisma's cuid(). */
function gen_id(): string
{
    $time = base_convert((string) floor(microtime(true) * 1000), 10, 36);
    $rand = bin2hex(random_bytes(9)); // 18 hex chars
    return substr('c' . $time . $rand, 0, 25);
}

/** Parsed JSON (or form) request body, cached per-request. */
function request_body_real(): array
{
    static $cached = null;
    if ($cached !== null) return $cached;

    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    if (str_contains($contentType, 'multipart/form-data')) {
        // multer-equivalent: fields land in $_POST, files in $_FILES
        $cached = $_POST;
        return $cached;
    }

    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        $cached = [];
        return $cached;
    }
    $decoded = json_decode($raw, true);
    $cached = is_array($decoded) ? $decoded : [];
    return $cached;
}

/** $_GET shortcut with default, mirrors Express's req.query.x */
function qp(string $key, $default = null)
{
    return $_GET[$key] ?? $default;
}

/** Body field shortcut with default + auto-trim for strings, mirrors req.body.x */
function bp(array $body, string $key, $default = null)
{
    if (!array_key_exists($key, $body) || $body[$key] === null) return $default;
    $val = $body[$key];
    return is_string($val) ? $val : $val;
}

/** Trim a body string field, returning null for empty/absent (matches `?.trim()` patterns). */
function bp_trim(array $body, string $key): ?string
{
    if (!array_key_exists($key, $body) || $body[$key] === null) return null;
    $val = trim((string) $body[$key]);
    return $val;
}

/** True if the key was present in the body at all (matters for `!== undefined` checks). */
function bp_has(array $body, string $key): bool
{
    return array_key_exists($key, $body);
}

/** Coerce a value to float, defaulting safely (matches JS `Number(x) || 0` patterns). */
function num($value, float $default = 0): float
{
    if ($value === null || $value === '') return $default;
    if (!is_numeric($value)) return $default;
    return (float) $value;
}

/** Coerce common truthy representations ("true", "1", 1, true) to bool. */
function bool_val($value): bool
{
    if (is_bool($value)) return $value;
    if (is_numeric($value)) return ((float) $value) != 0;
    return in_array(strtolower((string) $value), ['true', '1', 'yes', 'on'], true);
}

/** Convert an incoming date-ish string (ISO, "Y-m-d", etc.) to MySQL DATETIME, or null. */
function to_dt(?string $value): ?string
{
    if ($value === null || trim($value) === '') return null;
    try {
        $d = new DateTime($value);
        return $d->format('Y-m-d H:i:s');
    } catch (Exception $e) {
        return null;
    }
}

/** Current UTC datetime in MySQL format. */
function now_sql(): string
{
    return (new DateTime('now'))->format('Y-m-d H:i:s');
}

/** Convert an incoming date-ish string (ISO, "Y-m-d", etc.) to a MySQL DATE (no time part), or null.
 *  Used for date-only HR/payroll columns (DOB, DOJ, DOL, advanceDate) — mirrors to_dt() above. */
function to_date_only(?string $value): ?string
{
    if ($value === null || trim($value) === '') return null;
    try {
        $d = new DateTime($value);
        return $d->format('Y-m-d');
    } catch (Exception $e) {
        return null;
    }
}

/** Format a MySQL DATETIME/date string as 12-hour clock time with AM/PM (e.g. "02:30 PM").
 *  Returns '' for null/empty/unparseable input — safe to use directly in report/table cells. */
function fmt_ampm(?string $value): string
{
    if ($value === null || trim($value) === '') return '';
    try {
        return (new DateTime($value))->format('h:i A');
    } catch (Exception $e) {
        return '';
    }
}

/** Start-of-day (00:00:00) for a given date (defaults to today), MySQL format. */
function start_of_day(?string $date = null): string
{
    $d = $date ? new DateTime($date) : new DateTime('now');
    $d->setTime(0, 0, 0);
    return $d->format('Y-m-d H:i:s');
}

/** Start-of-day + N days, MySQL format. */
function start_of_day_plus(int $days, ?string $date = null): string
{
    $d = $date ? new DateTime($date) : new DateTime('now');
    $d->setTime(0, 0, 0);
    $d->modify("+{$days} day");
    return $d->format('Y-m-d H:i:s');
}

/** First day of month containing $date (default: now), MySQL format. */
function start_of_month(?string $date = null, int $monthOffset = 0): string
{
    $d = $date ? new DateTime($date) : new DateTime('now');
    $d->modify('first day of this month');
    $d->setTime(0, 0, 0);
    if ($monthOffset !== 0) {
        $d->modify(($monthOffset > 0 ? '+' : '') . $monthOffset . ' month');
    }
    return $d->format('Y-m-d H:i:s');
}

/** Client IP, mirrors Express's req.ip (best-effort, respects common proxy headers). */
function client_ip(): string
{
    foreach (['HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $key) {
        if (!empty($_SERVER[$key])) {
            $val = $_SERVER[$key];
            return trim(explode(',', $val)[0]);
        }
    }
    return '';
}

function user_agent(): string
{
    return substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 500);
}

/** [page, limit, offset] from query params, with sane defaults. */
function paginate(int $defaultLimit = 20): array
{
    $page = max(1, (int) qp('page', 1));
    $limit = max(1, (int) qp('limit', $defaultLimit));
    $offset = ($page - 1) * $limit;
    return [$page, $limit, $offset];
}

/** json_encode shortcut that never escapes unicode/slashes (for stored JSON-string columns). */
function json_str($value): string
{
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/** Round to 2dp the way the original JS code does: Math.round(x*100)/100 */
function round2(float $n): float
{
    return round($n, 2);
}

/** Testable alias — use request_body() everywhere; test runner can override. */
if (!function_exists('request_body')) {
    function request_body(): array { return request_body_real(); }
}

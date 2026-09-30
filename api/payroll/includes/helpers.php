<?php
/** HTML-escape shorthand — use this around every value printed into a page. */
function e($value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
}

function money(float $amount): string
{
    return '₹' . number_format($amount, 0);
}

function money_precise(float $amount): string
{
    return '₹' . number_format($amount, 2);
}

function month_label(int $month, int $year): string
{
    $names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return ($names[$month - 1] ?? '?') . ' ' . $year;
}

function fmt_date(?string $raw): string
{
    if (!$raw) return '—';
    try {
        return (new DateTime($raw))->format('d M Y');
    } catch (Exception $e) {
        return '—';
    }
}

// ── Flash messages — one-time banners shown once after a redirect, the
//    standard pattern for a form-post-redirect-get flow in a classic
//    (non-SPA) app. ─────────────────────────────────────────────────────
function flash_set(string $type, string $message): void
{
    $_SESSION['flash'] = ['type' => $type, 'message' => $message];
}

function flash_get(): ?array
{
    if (empty($_SESSION['flash'])) return null;
    $f = $_SESSION['flash'];
    unset($_SESSION['flash']);
    return $f;
}

function redirect(string $path): void
{
    header('Location: ' . $path);
    exit;
}

// ── A handful of lucide-style icons (24x24, 2px stroke) for the sidebar —
//    hand-written since this buildless app has no npm access to the real
//    lucide-react package your Next.js app uses. ────────────────────────
function svg_icon(string $name): string
{
    $paths = [
        'layout-dashboard' => '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
        'wallet'            => '<path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-4a2 2 0 0 1 0-4Z"/>',
        'clipboard-list'    => '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h6M9 8h1"/>',
        'book-text'         => '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/><path d="M9 7h7M9 11h7"/>',
        'bell'              => '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    ];
    $p = $paths[$name] ?? '';
    return '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' . $p . '</svg>';
}

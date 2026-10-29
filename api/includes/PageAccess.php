<?php
/**
 * Page access per user — set by the Super Admin on the Users page.
 *
 * For each business page a user gets one level:
 *   full    view, add, edit and delete (the default — nothing changes until set)
 *   edit    view, add and edit, but no delete
 *   view    read only: nothing can be added, changed or deleted
 *   hidden  the page is removed from the menu and cannot be opened
 *
 * Stored as JSON in User.pageAccess ({"orders":"view", ...}). The API enforces it
 * here, before routing (writes are refused: POST/PUT/PATCH for "view" and "hidden",
 * DELETE for everything but "full"); crm-global.js hides the menu links, the page
 * and the add / edit / delete buttons. The Super Admin always has full access.
 * "Hidden" still allows reading through the API so other pages' look-ups (e.g. the
 * customer search on the order form) keep working.
 *
 *   GET /api/page-access/me           my levels + the page list
 *   GET /api/page-access/users/:id    Super Admin
 *   PUT /api/page-access/users/:id    Super Admin { access: { page: level } }
 */
class PageAccess
{
    public const LEVELS = ['full' => 'Full access', 'edit' => 'Edit (no delete)', 'view' => 'View only', 'hidden' => 'Hidden'];

    /** key => [label, page paths, API prefixes] */
    public const PAGES = [
        'customers'      => ['Customers', ['/customers'], ['customers']],
        'meetings'       => ['Meetings & follow-ups', ['/meetings'], ['meetings']],
        'products'       => ['Products', ['/products'], ['products']],
        'stock'          => ['Stock', ['/stock'], ['products/stock']],
        'catalogue'      => ['Product catalogue', ['/catalogue'], ['catalog']],
        'documents'      => ['Catalogues & documents', ['/documents'], ['catalog/files']],
        'quotations'     => ['Quotations', ['/quotations'], ['quotations', 'quote-follow']],
        'orders'         => ['Orders', ['/orders'], ['orders', 'regular-items']],
        'trials'         => ['Trials', ['/trials'], ['trials']],
        'price-requests' => ['Price requests', ['/price-requests'], ['price-requests']],
        'tooling'        => ['Projects & Tooled-up', ['/projects', '/tooled-up'], ['tooling']],
        'cpr'            => ['CPR & weekly review', ['/cpr'], ['cpr']],
        'appointments'   => ['Appointments', ['/appointments'], ['appointments']],
        'tasks'          => ['Tasks', ['/tasks'], ['tasks']],
        'vendors'        => ['Vendors & purchase orders', ['/vendors'], ['vendors', 'purchase-orders', 'inwards']],
        'accounts'       => ['Accounts', ['/accounts'], ['accounts']],
        'md-desk'        => ['CEO Desk', ['/md-desk'], ['md-desk']],
        'sales-report'   => ['Sales report', ['/sales-report'], ['sales-report']],
        'internal-meetings' => ['Internal meetings', ['/internal-meetings'], ['internal-meetings']],
        'mom'            => ['MOM (minutes of meeting)', ['/mom'], ['mom']],
        // everyone's own alert sounds (the company settings and branding stay Super Admin / Admin only)
        'notifications'  => ['Notifications & sounds', ['/admin/notifications'], ['app-settings/my-notifications']],
        // a tab on the Fuel expense page, so no page path of its own
        'petty-cash'     => ['Petty cash (Fuel expense page)', [], ['petty-cash']],
    ];

    /**
     * Pages that are hidden unless given: only these roles have full access by
     * default; everyone else is hidden until the Super Admin sets a level.
     */
    public const RESTRICTED = ['petty-cash' => ['SUPER_ADMIN', 'ADMIN', 'ACCOUNTS']];

    /** Default level per restricted page for a role (pages not listed default to full). */
    public static function defaults(string $role): array
    {
        $out = [];
        foreach (self::RESTRICTED as $k => $roles) $out[$k] = in_array($role, $roles, true) ? 'full' : 'hidden';
        return $out;
    }

    /** The levels that apply to a user: role defaults, then what the Super Admin set. "full" entries are left out. */
    public static function effective(?string $json, string $role): array
    {
        if ($role === 'SUPER_ADMIN') return [];
        return array_filter(array_merge(self::defaults($role), self::decode($json)), fn($v) => $v !== 'full');
    }

    /** One page's level for the signed-in user. */
    public static function levelFor(array $auth, string $page): string
    {
        if ($auth['role'] === 'SUPER_ADMIN') return 'full';
        self::ensure();
        $s = db()->prepare('SELECT pageAccess FROM `User` WHERE id=?'); $s->execute([$auth['id']]);
        return self::effective($s->fetchColumn() ?: null, $auth['role'])[$page] ?? 'full';
    }

    /** Writes that stay allowed whatever the level (pop-ups being acknowledged, reminders read). */
    private const ALWAYS = ['#^appointments/alerts/[^/]+/read$#', '#^md-desk/[^/]+/ack$#'];

    public static function ensure(): void
    {
        static $done = false;
        if ($done) return;
        $done = true;
        try { ensure_schema(['User' => ['create' => '', 'columns' => ['pageAccess' => 'MEDIUMTEXT NULL']]], 'Page access'); } catch (Throwable $e) {}
    }

    public static function decode(?string $json): array
    {
        $a = $json ? (json_decode($json, true) ?: []) : [];
        // "full" is the default, so it is only kept for restricted pages (where the default is hidden)
        return array_filter($a, fn($v, $k) => isset(self::PAGES[$k]) && isset(self::LEVELS[$v]) && ($v !== 'full' || isset(self::RESTRICTED[$k])), ARRAY_FILTER_USE_BOTH);
    }

    /** Page key for an API path (longest prefix wins), or null. */
    public static function pageFor(string $apiPath): ?string
    {
        $best = null; $len = 0;
        foreach (self::PAGES as $k => $p) foreach ($p[2] as $pre) {
            if (($apiPath === $pre || str_starts_with($apiPath, $pre . '/')) && strlen($pre) > $len) { $best = $k; $len = strlen($pre); }
        }
        return $best;
    }

    /** Called from index.php before routing. Refuses writes the user's level does not allow. */
    public static function guard(string $method, array $segs): void
    {
        if ($method === 'GET' || $method === 'HEAD' || !$segs) return;
        $apiPath = implode('/', $segs);
        $page = self::pageFor($apiPath);
        if (!$page) return;
        foreach (self::ALWAYS as $re) if (preg_match($re, $apiPath)) return;
        $h = get_authorization_header();
        if (!$h || !str_starts_with($h, 'Bearer ')) return;      // the controller answers 401
        try { $d = JWT::verify(substr($h, 7), JWT_SECRET); } catch (Throwable $e) { return; }
        self::ensure();
        try {
            $s = db()->prepare('SELECT role, pageAccess FROM `User` WHERE id=?'); $s->execute([$d['id'] ?? '']);
            $u = $s->fetch();
        } catch (Throwable $e) { return; }
        if (!$u || $u['role'] === 'SUPER_ADMIN') return;
        $lvl = self::effective($u['pageAccess'], $u['role'])[$page] ?? 'full';
        $label = self::PAGES[$page][0];
        if ($lvl === 'hidden') sendError("You do not have access to $label — ask the Super Admin.", 403);
        if ($lvl === 'view') sendError("You have view-only access to $label — ask the Super Admin to change it.", 403);
        if ($lvl === 'edit' && $method === 'DELETE') sendError("You can add and edit on $label but not delete — ask the Super Admin.", 403);
    }

    private static function pagesOut(): array
    {
        $out = [];
        foreach (self::PAGES as $k => $p) $out[] = ['key' => $k, 'label' => $p[0], 'paths' => $p[1]];
        return $out;
    }

    // GET /api/page-access/me
    public static function me(): void
    {
        $auth = authenticate(); self::ensure();
        $s = db()->prepare('SELECT pageAccess FROM `User` WHERE id=?'); $s->execute([$auth['id']]);
        sendSuccess(['access' => (object) self::effective($s->fetchColumn() ?: null, $auth['role']), 'pages' => self::pagesOut(), 'levels' => self::LEVELS]);
    }

    // GET /api/page-access/users/:id
    public static function getUser(string $id): void
    {
        $auth = authenticate(); require_super_admin($auth); self::ensure();
        $s = db()->prepare('SELECT id, name, role, pageAccess FROM `User` WHERE id=?'); $s->execute([$id]);
        $u = $s->fetch();
        if (!$u) sendError('User not found.', 404);
        sendSuccess(['user' => ['id' => $u['id'], 'name' => $u['name'], 'role' => $u['role']], 'access' => (object) self::decode($u['pageAccess']),
                     'defaults' => (object) self::defaults($u['role']), 'pages' => self::pagesOut(), 'levels' => self::LEVELS]);
    }

    // PUT /api/page-access/users/:id  { access: { page: level } }
    public static function setUser(string $id): void
    {
        $auth = authenticate(); require_super_admin($auth); self::ensure();
        $s = db()->prepare('SELECT id, name, role FROM `User` WHERE id=?'); $s->execute([$id]);
        $u = $s->fetch();
        if (!$u) sendError('User not found.', 404);
        if ($u['role'] === 'SUPER_ADMIN') sendError('The Super Admin always has full access.', 400);
        $in = (array) (request_body()['access'] ?? []);
        foreach ($in as $k => $v) {
            if (!isset(self::PAGES[$k])) sendError("Unknown page: $k", 400);
            if (!isset(self::LEVELS[$v])) sendError("Unknown access level: $v", 400);
        }
        // keep only what differs from the role's default (full, or hidden for restricted pages)
        $def = self::defaults($u['role']);
        $clean = array_filter(self::decode(json_encode($in)), fn($v, $k) => $v !== ($def[$k] ?? 'full'), ARRAY_FILTER_USE_BOTH);
        db()->prepare('UPDATE `User` SET pageAccess=? WHERE id=?')->execute([$clean ? json_encode($clean) : null, $id]);
        log_activity($auth['id'], 'PAGE_ACCESS_SET', 'User', $id, $clean);
        $n = count(array_filter($clean, fn($v) => $v !== 'full'));
        sendSuccess(['access' => (object) $clean], $n ? "Saved — $n page" . ($n === 1 ? '' : 's') . ' limited for ' . $u['name'] : 'Saved — ' . $u['name'] . ' has full access to every page');
    }
}

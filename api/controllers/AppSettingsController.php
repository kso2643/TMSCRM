<?php
/**
 * App settings set by the Super Admin / Admin on Admin → Notifications & branding.
 *
 *   notifications  per alert type: { on, sound, push, title, body }
 *                  on    false = the alert is not shown at all
 *                  sound default | chime | urgent | bell | ding | pop | alarm | soft | none
 *                  push  false = no phone top-bar / desktop notification (toast only)
 *                  title / body  replace the alert text; {title} and {body} put the original text in
 *   branding       { name, short } shown in the sidebar, page titles and login; logo image
 *   nu:<userId>    one person's own sound per alert type (overrides the company sound on their devices;
 *                  an alert the admin turned off stays off)
 *
 *   GET    /api/app-settings              signed-in users: notifications + branding
 *   GET    /api/app-settings/public       anyone: branding (login page)
 *   GET    /api/app-settings/logo         anyone: the logo image
 *   PUT    /api/app-settings/notifications { types: { TYPE: {...} } }
 *   PUT    /api/app-settings/my-notifications { sounds: { TYPE: sound } }   anyone: their own alert sounds
 *   PUT    /api/app-settings/branding      { name, short }
 *   POST   /api/app-settings/logo          multipart "file" (PNG / JPG / WebP, ≤ 2 MB)
 *   DELETE /api/app-settings/logo
 */
class AppSettingsController
{
    public const SOUNDS = ['default', 'chime', 'urgent', 'bell', 'ding', 'pop', 'alarm', 'soft', 'none'];

    public function __construct()
    {
        ensure_schema(['AppSetting' => ['create' => "CREATE TABLE IF NOT EXISTS `AppSetting` (
  `k` VARCHAR(40) NOT NULL, `v` MEDIUMTEXT NULL, `updatedById` VARCHAR(30) NULL, `updatedAt` DATETIME NULL,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"]], 'App settings');
    }

    private static function get(string $k): array
    {
        $s = db()->prepare('SELECT v FROM `AppSetting` WHERE k=?'); $s->execute([$k]);
        $v = json_decode((string) $s->fetchColumn(), true);
        return is_array($v) ? $v : [];
    }
    private static function put(string $k, array $v, string $by): void
    {
        db()->prepare('INSERT INTO `AppSetting` (k,v,updatedById,updatedAt) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE v=VALUES(v), updatedById=VALUES(updatedById), updatedAt=VALUES(updatedAt)')
            ->execute([$k, json_encode($v, JSON_UNESCAPED_UNICODE), $by, now_sql()]);
    }
    private static function admin(): array
    {
        $auth = authenticate();
        if (!in_array($auth['role'], ['SUPER_ADMIN', 'ADMIN'], true)) sendError('Only the Super Admin or an Admin can change these settings.', 403);
        return $auth;
    }
    private static function dir(): string { return UPLOADS_PATH . '/branding'; }
    private static function logoFile(): ?string
    {
        foreach (['png', 'jpg', 'webp'] as $e) { $f = self::dir() . '/logo.' . $e; if (is_file($f)) return $f; }
        return null;
    }
    private static function branding(): array
    {
        $b = self::get('branding');
        $f = self::logoFile();
        return ['name' => $b['name'] ?? null, 'short' => $b['short'] ?? null, 'logo' => $f ? '/api/app-settings/logo?v=' . filemtime($f) : null];
    }

    // GET /api/app-settings
    public function index(): void
    {
        $auth = authenticate();
        sendSuccess(['notifications' => (object) self::get('notifications'), 'mine' => (object) self::get('nu:' . $auth['id']),
            'branding' => self::branding(), 'sounds' => self::SOUNDS]);
    }

    // PUT /api/app-settings/my-notifications   (Page access "Notifications & sounds" decides who may save)
    public function saveMine(): void
    {
        $auth = authenticate();
        $in = (array) (request_body()['sounds'] ?? []);
        if (count($in) > 100) sendError('Too many alert types.', 400);
        $out = [];
        foreach ($in as $type => $snd) {
            if (!preg_match('/^[A-Z][A-Z_]{2,40}$/', (string) $type)) continue;
            $snd = (string) $snd;
            if (!in_array($snd, self::SOUNDS, true)) sendError("Unknown sound “{$snd}”.", 400);
            if ($snd !== 'default') $out[$type] = $snd;   // "default" = use the company's sound
        }
        self::put('nu:' . $auth['id'], $out, $auth['id']);
        sendSuccess(['mine' => (object) $out], 'Your alert sounds are saved');
    }

    // GET /api/app-settings/public
    public function publicInfo(): void
    {
        sendSuccess(['branding' => self::branding()]);
    }

    // PUT /api/app-settings/notifications
    public function saveNotifications(): void
    {
        $auth = self::admin();
        $in = (array) (request_body()['types'] ?? []);
        if (count($in) > 100) sendError('Too many alert types.', 400);
        $out = [];
        foreach ($in as $type => $c) {
            if (!preg_match('/^[A-Z][A-Z_]{2,40}$/', (string) $type) || !is_array($c)) continue;
            $x = [];
            if (array_key_exists('on', $c) && !$c['on']) $x['on'] = false;
            if (array_key_exists('push', $c) && !$c['push']) $x['push'] = false;
            $snd = (string) ($c['sound'] ?? 'default');
            if (!in_array($snd, self::SOUNDS, true)) sendError("Unknown sound “{$snd}”.", 400);
            if ($snd !== 'default') $x['sound'] = $snd;
            foreach (['title' => 120, 'body' => 300] as $k => $max) { $t = trim((string) ($c[$k] ?? '')); if ($t !== '') $x[$k] = mb_substr($t, 0, $max); }
            if ($x) $out[$type] = $x;   // only what differs from the default is kept
        }
        self::put('notifications', $out, $auth['id']);
        log_activity($auth['id'], 'NOTIFICATION_SETTINGS_SAVED', 'AppSetting', 'notifications', ['types' => count($out)]);
        sendSuccess(['notifications' => (object) $out], 'Notification settings saved — they apply on every page within a minute');
    }

    // PUT /api/app-settings/branding
    public function saveBranding(): void
    {
        $auth = self::admin();
        $b = request_body();
        $name = mb_substr(trim((string) ($b['name'] ?? '')), 0, 60);
        $short = mb_substr(trim((string) ($b['short'] ?? '')), 0, 30);
        self::put('branding', ['name' => $name ?: null, 'short' => $short ?: null], $auth['id']);
        log_activity($auth['id'], 'BRANDING_SAVED', 'AppSetting', 'branding', ['name' => $name]);
        sendSuccess(['branding' => self::branding()], 'Name saved');
    }

    // POST /api/app-settings/logo
    public function uploadLogo(): void
    {
        $auth = self::admin();
        $f = $_FILES['file'] ?? null;
        if (!$f || $f['error'] !== UPLOAD_ERR_OK) sendError('Choose the logo image.', 400);
        if ($f['size'] <= 0 || $f['size'] > 2 * 1024 * 1024) sendError('The logo must be under 2 MB.', 400);
        $info = @getimagesize($f['tmp_name']);
        $ext = [IMAGETYPE_PNG => 'png', IMAGETYPE_JPEG => 'jpg', IMAGETYPE_WEBP => 'webp'][$info[2] ?? 0] ?? null;
        if (!$ext) sendError('Upload the logo as a PNG, JPG or WebP image.', 400);
        $dir = self::dir();
        if (!is_dir($dir) && !@mkdir($dir, 0755, true)) sendError('Could not save the logo on the server.', 500);
        foreach (['png', 'jpg', 'webp'] as $e) @unlink("$dir/logo.$e");
        if (!move_uploaded_file($f['tmp_name'], "$dir/logo.$ext") && !rename($f['tmp_name'], "$dir/logo.$ext")) sendError('Could not save the logo on the server.', 500);
        log_activity($auth['id'], 'BRANDING_LOGO_SAVED', 'AppSetting', 'branding', []);
        sendSuccess(['branding' => self::branding()], 'Logo saved');
    }

    // DELETE /api/app-settings/logo
    public function deleteLogo(): void
    {
        self::admin();
        foreach (['png', 'jpg', 'webp'] as $e) @unlink(self::dir() . "/logo.$e");
        sendSuccess(['branding' => self::branding()], 'Logo removed — the default icon is back');
    }

    // GET /api/app-settings/logo
    public function logo(): void
    {
        $f = self::logoFile();
        if (!$f) sendError('No logo.', 404);
        $types = ['png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp'];
        while (ob_get_level()) ob_end_clean();
        header('Content-Type: ' . $types[pathinfo($f, PATHINFO_EXTENSION)]);
        header('Cache-Control: public, max-age=86400');
        header('Content-Length: ' . filesize($f));
        readfile($f); exit;
    }
}

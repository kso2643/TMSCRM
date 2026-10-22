<?php
/**
 * Sales engineers can only save data with their location turned on.
 *
 * crm-global.js keeps a live location fix on every page for SALES / SALES_ENGINEER
 * users and sends it with each API call as
 *     X-CRM-Geo: <lat>,<lng>,<accuracy m>,<age of the fix in seconds>
 * (the age, not a timestamp, so a wrong phone clock does not matter). Here,
 * before routing, every write (POST / PUT / PATCH / DELETE) from those roles is
 * refused with 423 when the header is missing, invalid or older than 15 minutes.
 * The page also shows a full-screen "Turn on location" lock while it is off.
 * Signing in / out and the location-off report itself are always allowed.
 */
class LocationGuard
{
    public const ROLES = ['SALES', 'SALES_ENGINEER'];
    private const MAX_AGE_SEC = 900;
    private const OPEN = ['#^auth(/|$)#', '#^breaks/stationary$#', '#^attendance/ping$#'];

    /** [lat, lng, accuracy, ageSec] from the header, or null. */
    public static function fix(): ?array
    {
        $h = trim((string) ($_SERVER['HTTP_X_CRM_GEO'] ?? ''));
        if ($h === '' || !preg_match('/^(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+)$/', $h, $m)) return null;
        [$lat, $lng, $acc, $age] = [(float) $m[1], (float) $m[2], (float) $m[3], (int) $m[4]];
        if (abs($lat) > 90 || abs($lng) > 180 || ($lat == 0.0 && $lng == 0.0)) return null;
        return [$lat, $lng, $acc, $age];
    }

    public static function guard(string $method, array $segs): void
    {
        if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true) || !$segs) return;
        $path = implode('/', $segs);
        foreach (self::OPEN as $re) if (preg_match($re, $path)) return;
        $h = get_authorization_header();
        if (!$h || !str_starts_with($h, 'Bearer ')) return;      // the controller answers 401
        try { $d = JWT::verify(substr($h, 7), JWT_SECRET); } catch (Throwable $e) { return; }
        try {
            $s = db()->prepare('SELECT role FROM `User` WHERE id=?'); $s->execute([$d['id'] ?? '']);
            $role = (string) $s->fetchColumn();
        } catch (Throwable $e) { return; }
        if (!in_array($role, self::ROLES, true)) return;
        $fix = self::fix();
        if ($fix === null) sendError('📍 Your location is off. Turn on Location / GPS and allow the CRM to use it — sales engineers can save data only with location on.', 423);
        if ($fix[3] > self::MAX_AGE_SEC) sendError('📍 Your location has not updated for ' . intdiv($fix[3], 60) . ' minutes. Check that Location / GPS is on, then try again.', 423);
    }
}

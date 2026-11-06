package in.apjtech.crm;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Looper;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Keeps CRM alerts coming to the phone like WhatsApp messages — also when the app is closed.
 *
 * Checks GET /api/alerts-feed every 30 seconds with the signed-in user's login (handed over by
 * the CRM page through CRMNative.setSession) and shows new alerts with AlertNotifier. While the
 * app is on screen the page shows them itself, so nothing is posted twice. Signing out
 * (CRMNative.clearSession) or an expired login stops it.
 *
 * The checks are woken by AlarmManager (AlertAlarmReceiver), not a timer: a plain timer stops
 * as soon as the screen is off and the phone sleeps, which is why alerts only came when the app
 * was opened. An alarm wakes the phone for each check (with a short wake lock), keeps working
 * if Android kills the app in the background, and is started again after a restart. When the
 * phone is in deep sleep Android allows such alarms about every 9 minutes; letting the app
 * "run in the background" (battery optimisation off) keeps its internet working then.
 *
 * Android only lets an app run like this with a small "alerts are on" notification; it sits in a
 * silent, collapsed channel the user can hide.
 */
public class AlertService extends Service {
    static final String API = "https://api.apjtech.in";
    private static final int ID = 1;
    static final long POLL_MS = 30_000L;
    static volatile boolean running = false;

    static boolean hasSession(Context c) { return !AlertNotifier.prefs(c).getString("token", "").isEmpty(); }

    static void start(Context c) {
        if (!hasSession(c)) return;
        try { ContextCompat.startForegroundService(c, new Intent(c, AlertService.class)); } catch (Exception ignored) { /* not allowed right now — tried again next time the app opens */ }
    }

    static void stop(Context c) { cancel(c); c.stopService(new Intent(c, AlertService.class)); }

    private static PendingIntent alarmIntent(Context c, String action, int req) {
        Intent i = new Intent(c, AlertAlarmReceiver.class);
        i.setAction(action);
        return PendingIntent.getBroadcast(c, req, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Wake the phone for the next check in delayMs (exact when Android allows it). */
    static void schedule(Context c, long delayMs) { setAlarm(c, alarmIntent(c, AlertAlarmReceiver.ACTION_POLL, 77), delayMs); }

    /** "Send test alert": a sample notification in delayMs, so you can lock the phone and see it arrive. */
    static void scheduleTest(Context c, long delayMs) { setAlarm(c, alarmIntent(c, AlertAlarmReceiver.ACTION_TEST, 78), delayMs); }

    static boolean exactAllowed(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        return am != null && (Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms());
    }

    private static void setAlarm(Context c, PendingIntent pi, long delayMs) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = SystemClock.elapsedRealtime() + delayMs;
        try {
            if (Build.VERSION.SDK_INT >= 23 && exactAllowed(c)) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
            else if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
            else am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
        } catch (SecurityException e) {
            am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi);
        }
    }

    static void cancel(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(alarmIntent(c, AlertAlarmReceiver.ACTION_POLL, 77));
    }

    /** One check now, on a background thread, with the phone kept awake until it is done. */
    static void pollInBackground(Context c, Runnable done) {
        final Context app = c.getApplicationContext();
        PowerManager pm = (PowerManager) app.getSystemService(Context.POWER_SERVICE);
        final PowerManager.WakeLock wl = pm == null ? null : pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "apjcrm:alerts");
        if (wl != null) wl.acquire(25_000L);
        new Thread(() -> {
            try { pollOnce(app); } catch (Exception e) { status(app, "error", String.valueOf(e.getMessage())); }
            finally {
                if (hasSession(app)) schedule(app, POLL_MS);
                if (wl != null && wl.isHeld()) wl.release();
                if (done != null) done.run();
            }
        }, "crm-alerts").start();
    }

    private static void status(Context c, String key, String value) {
        AlertNotifier.prefs(c).edit().putLong("lastPollAt", System.currentTimeMillis()).putString("lastResult", key).putString("lastError", "ok".equals(key) ? "" : value).apply();
    }

    @Override public void onCreate() {
        super.onCreate();
        AlertNotifier.createChannels(this);
        running = true;
    }

    // ── Location tracking while punched in (also when the app is closed) ────────────────
    // The page says when someone is punched in (CRMNative.setTracking). The phone's GPS then sends
    // a point every 30 s while moving and every 2 min when standing still (vague fixes > 100 m only
    // when nothing better came for 5 min) to /api/attendance/ping, so the route and km are complete.
    // GPS switched off → the CEO is told where (LOCATION_OFF with the last point).
    static volatile boolean trackingActive = false;
    private LocationManager lm;
    private Location lastSent, lastGood;
    private long lastSentAt = 0;
    private final LocationListener listener = new LocationListener() {
        @Override public void onLocationChanged(Location l) { onFix(l); }
        @Override public void onProviderDisabled(String provider) { if (LocationManager.GPS_PROVIDER.equals(provider)) locationOff(); }
        // GPS (or network location) switched back on → start using it again straight away; before,
        // a provider that was off when tracking began was never asked again until the app restarted.
        @Override public void onProviderEnabled(String provider) {
            if (trackingActive) requestProvider(provider);
            if (LocationManager.GPS_PROVIDER.equals(provider)) try { androidx.core.app.NotificationManagerCompat.from(AlertService.this).cancel(7301); } catch (Exception ignored) { }
        }
        @Override public void onStatusChanged(String provider, int status, Bundle extras) { }
    };

    static boolean wantsTracking(Context c) { return AlertNotifier.prefs(c).getBoolean("tracking", false) && hasSession(c); }
    static boolean canLocate(Context c) {
        return ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestProvider(String provider) {
        if (lm == null) return;
        try {
            long every = LocationManager.NETWORK_PROVIDER.equals(provider) ? 30_000L : 15_000L;
            if (LocationManager.PASSIVE_PROVIDER.equals(provider) || lm.isProviderEnabled(provider))
                lm.requestLocationUpdates(provider, every, 0f, listener, Looper.getMainLooper());   // re-requesting just replaces the old request
        } catch (SecurityException | IllegalArgumentException ignored) { }
    }

    private void startTracking() {
        if (trackingActive) return;
        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return;
        try {
            // passive first: it also keeps the listener registered so onProviderEnabled fires when GPS comes back
            lm.requestLocationUpdates(LocationManager.PASSIVE_PROVIDER, 15_000L, 0f, listener, Looper.getMainLooper());
            trackingActive = true;
        } catch (SecurityException | IllegalArgumentException e) { trackingActive = false; return; }
        requestProvider(LocationManager.GPS_PROVIDER);
        requestProvider(LocationManager.NETWORK_PROVIDER);
    }

    private void stopTracking() {
        if (lm != null) try { lm.removeUpdates(listener); } catch (Exception ignored) { }
        trackingActive = false;
    }

    private void onFix(Location l) {
        if (l == null) return;
        long now = System.currentTimeMillis();
        boolean isGps = LocationManager.GPS_PROVIDER.equals(l.getProvider());
        // A real GPS fix in the last minute beats a network (tower / Wi-Fi) guess: skip the guess.
        if (!isGps && lastGood != null && LocationManager.GPS_PROVIDER.equals(lastGood.getProvider()) && now - lastGood.getTime() < 60_000L) return;
        boolean good = l.hasAccuracy() && l.getAccuracy() <= 100;
        if (good) lastGood = l;
        Location use = good ? l : (now - lastSentAt > 5 * 60_000L ? (lastGood != null && now - lastGood.getTime() < 120_000L ? lastGood : l) : null);
        if (use == null) return;
        long since = now - lastSentAt;
        float moved = lastSent == null ? Float.MAX_VALUE : lastSent.distanceTo(use);
        // Driving fast: a point every 15 s so bends in the road count towards the km.
        boolean fast = use.hasSpeed() && use.getSpeed() > 8f;
        boolean send = since >= 120_000L || (since >= 30_000L && moved > Math.max(50f, use.getAccuracy()))
            || (fast && since >= 15_000L && moved > Math.max(100f, use.getAccuracy()));
        if (!send) return;
        lastSent = use; lastSentAt = now;
        final JSONObject point;
        try {
            point = new JSONObject().put("lat", use.getLatitude()).put("lng", use.getLongitude()).put("accuracy", use.hasAccuracy() ? use.getAccuracy() : JSONObject.NULL)
                .put("at", use.getTime() > 0 ? use.getTime() : now).put("source", "app");
        } catch (Exception e) { return; }
        final String token = AlertNotifier.prefs(this).getString("token", "");
        new Thread(() -> sendPoint(token, point), "crm-ping").start();
    }

    // Points that could not be sent (no network) are kept (up to 300) and sent, with their own time, once the network is back.
    private static final Object QUEUE_LOCK = new Object();
    private void sendPoint(String token, JSONObject point) {
        SharedPreferences p = AlertNotifier.prefs(this);
        try {
            String[] r = http("POST", "/api/attendance/ping", token, point.toString(), null);
            if ("400".equals(r[0]) && r[1].contains("Punch in")) { p.edit().putBoolean("tracking", false).putString("pingQueue", "[]").apply(); return; }   // punched out elsewhere
            if (!r[0].startsWith("2")) { if (r[0].startsWith("5") || "0".equals(r[0])) queuePoint(point); return; }
            p.edit().putLong("lastPingAt", System.currentTimeMillis()).apply();
            flushQueue(token);
        } catch (Exception e) { queuePoint(point); }
    }
    private void queuePoint(JSONObject point) {
        synchronized (QUEUE_LOCK) {
            SharedPreferences p = AlertNotifier.prefs(this);
            try {
                JSONArray q = new JSONArray(p.getString("pingQueue", "[]"));
                q.put(point);
                JSONArray keep = new JSONArray();
                for (int i = Math.max(0, q.length() - 300); i < q.length(); i++) keep.put(q.get(i));
                p.edit().putString("pingQueue", keep.toString()).apply();
            } catch (Exception ignored) { }
        }
    }
    private void flushQueue(String token) {
        JSONArray q;
        synchronized (QUEUE_LOCK) {
            SharedPreferences p = AlertNotifier.prefs(this);
            try { q = new JSONArray(p.getString("pingQueue", "[]")); } catch (Exception e) { q = new JSONArray(); }
            if (q.length() == 0) return;
            p.edit().putString("pingQueue", "[]").apply();
        }
        for (int i = 0; i < q.length(); i++) {
            try {
                String[] r = http("POST", "/api/attendance/ping", token, q.getJSONObject(i).toString(), null);
                if ("400".equals(r[0])) continue;   // e.g. punched out since — drop it
                if (!r[0].startsWith("2")) { for (int k = i; k < q.length(); k++) queuePoint(q.getJSONObject(k)); return; }
            } catch (Exception e) {
                try { for (int k = i; k < q.length(); k++) queuePoint(q.getJSONObject(k)); } catch (Exception ignored) { }
                return;
            }
        }
    }

    private void locationOff() {
        // tell the person straight away, on the phone: turn location back on
        try {
            Intent loc = new Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent pi = PendingIntent.getActivity(this, 7301, loc, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification n = new NotificationCompat.Builder(this, AlertNotifier.CHANNEL_DEFAULT)
                    .setSmallIcon(R.drawable.ic_stat_notify)
                    .setColor(0xFFDC2626)
                    .setContentTitle("Location is turned off")
                    .setContentText("You are punched in — turn on Location / GPS so your route and km are recorded.")
                    .setStyle(new NotificationCompat.BigTextStyle().bigText("You are punched in — turn on Location / GPS so your route and km are recorded. Tap to open the location settings."))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setAutoCancel(true)
                    .setContentIntent(pi)
                    .build();
            androidx.core.app.NotificationManagerCompat.from(this).notify(7301, n);
        } catch (SecurityException | IllegalArgumentException ignored) { }   // notifications not allowed on this phone
        final String token = AlertNotifier.prefs(this).getString("token", "");
        final Location l = lastSent != null ? lastSent : lastGood;
        new Thread(() -> {
            try {
                JSONObject b = new JSONObject().put("eventType", "LOCATION_OFF");
                if (l != null) b.put("lat", l.getLatitude()).put("lng", l.getLongitude());
                http("POST", "/api/breaks/stationary", token, b.toString(), null);
            } catch (Exception ignored) { }
        }, "crm-locoff").start();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = new NotificationCompat.Builder(this, AlertNotifier.CHANNEL_SERVICE)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(0xFF1E3A5F)
                .setContentTitle(AlertNotifier.prefs(this).getString("brand", "APJ CRM") + " — alerts are on")
                .setContentText("You get CRM alerts even when the app is closed.")
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setOngoing(true)
                .setShowWhen(false)
                .setContentIntent(AlertNotifier.openIntent(this, null, null, ID))
                .build();
        boolean track = wantsTracking(this) && canLocate(this);
        boolean located = false;
        try {
            if (Build.VERSION.SDK_INT >= 29 && track) {   // location type: allowed while the app is open (Android checks)
                startForeground(ID, n, (Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING : 0) | ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
                located = true;
            }
        } catch (Exception e) { located = false; }
        if (!located) {
            try {
                if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
                else startForeground(ID, n);
            } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        }
        if (!hasSession(this)) { stopSelf(); return START_NOT_STICKY; }
        if (track && (located || Build.VERSION.SDK_INT < 29)) startTracking(); else if (!track) stopTracking();
        pollInBackground(this, null);   // check now; it books the next check itself
        return START_STICKY;
    }

    @Override public void onDestroy() {
        stopTracking();
        running = false;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private static synchronized void pollOnce(Context ctx) throws Exception {
        SharedPreferences p = AlertNotifier.prefs(ctx);
        String token = p.getString("token", "");
        if (token.isEmpty()) { stop(ctx); return; }
        String since = p.getString("since", "");
        String[] res = http("GET", "/api/alerts-feed" + (since.isEmpty() ? "" : "?since=" + URLEncoder.encode(since, "UTF-8")), token, null, null);
        if ("401".equals(res[0])) {   // login expired / signed out elsewhere: stop until the app is opened again
            p.edit().remove("token").apply();
            status(ctx, "signed-out", "Sign in to the app again to get alerts");
            stop(ctx);
            return;
        }
        if (!res[0].startsWith("2")) { status(ctx, "error", "Server answered " + res[0]); return; }
        JSONObject data = new JSONObject(res[1]).optJSONObject("data");
        if (data == null) return;
        Set<String> seen = new LinkedHashSet<>();
        JSONArray old = new JSONArray(p.getString("seen", "[]"));
        for (int i = 0; i < old.length(); i++) seen.add(old.optString(i));
        boolean baseline = since.isEmpty();   // first check after sign-in: older alerts were already shown in the app
        JSONArray evs = data.optJSONArray("events");
        if (evs != null) {
            for (int i = evs.length() - 1; i >= 0; i--) {   // oldest first, so the chat reads in order
                JSONObject ev = evs.optJSONObject(i);
                if (ev == null || !seen.add(ev.optString("id"))) continue;
                if (!baseline && !MainActivity.appVisible) AlertNotifier.post(ctx, ev);
            }
        }
        JSONArray keep = new JSONArray();
        int skip = Math.max(0, seen.size() - 300), k = 0;
        for (String s : seen) if (k++ >= skip) keep.put(s);
        p.edit().putString("since", data.optString("now", since)).putString("seen", keep.toString()).apply();
        status(ctx, "ok", "");
    }

    /** Small HTTPS helper: returns {status code, body}. */
    static String[] http(String method, String path, String token, String json, String geo) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(API + path).openConnection();
        c.setRequestMethod(method);
        c.setConnectTimeout(15000);
        c.setReadTimeout(20000);
        c.setRequestProperty("Authorization", "Bearer " + token);
        c.setRequestProperty("Accept", "application/json");
        if (geo != null) c.setRequestProperty("X-CRM-Geo", geo);
        if (json != null) {
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) { os.write(json.getBytes(StandardCharsets.UTF_8)); }
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        if (in != null) { byte[] buf = new byte[8192]; int n; while ((n = in.read(buf)) > 0) out.write(buf, 0, n); in.close(); }
        c.disconnect();
        return new String[]{String.valueOf(code), out.toString("UTF-8")};
    }
}

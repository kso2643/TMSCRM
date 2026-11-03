package in.apjtech.crm;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
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
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING);
            else startForeground(ID, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        if (!hasSession(this)) { stopSelf(); return START_NOT_STICKY; }
        pollInBackground(this, null);   // check now; it books the next check itself
        return START_STICKY;
    }

    @Override public void onDestroy() {
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

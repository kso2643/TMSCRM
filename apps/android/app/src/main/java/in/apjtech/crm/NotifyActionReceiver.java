package in.apjtech.crm;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Bundle;

import androidx.core.app.RemoteInput;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.util.Locale;

/** The buttons on an alert notification: Reply (chat), Mark as read, and swiping it away. */
public class NotifyActionReceiver extends BroadcastReceiver {
    static final String ACTION_REPLY = "in.apjtech.crm.REPLY";
    static final String ACTION_READ = "in.apjtech.crm.READ";
    static final String ACTION_DISMISS = "in.apjtech.crm.DISMISS";

    @Override public void onReceive(Context c, Intent i) {
        String act = i.getAction(), thread = i.getStringExtra("thread"), link = i.getStringExtra("link");
        if (thread == null || act == null) return;
        if (ACTION_DISMISS.equals(act)) { AlertNotifier.clearThread(c, thread, false); return; }
        final String token = AlertNotifier.prefs(c).getString("token", "");
        final String peer = chatPeer(link);
        if (ACTION_READ.equals(act)) {
            AlertNotifier.clearThread(c, thread, true);
            if (peer != null && !token.isEmpty()) {
                final PendingResult pr = goAsync();
                new Thread(() -> {
                    try { AlertService.http("GET", "/api/chat/thread/" + Uri.encode(peer), token, null, null); } catch (Exception ignored) { }
                    pr.finish();
                }).start();
            }
            return;
        }
        if (ACTION_REPLY.equals(act)) {
            Bundle in = RemoteInput.getResultsFromIntent(i);
            CharSequence cs = in == null ? null : in.getCharSequence(AlertNotifier.KEY_REPLY);
            final String text = cs == null ? "" : cs.toString().trim();
            if (text.isEmpty() || peer == null) return;
            final String geo = geoHeader(c);
            final PendingResult pr = goAsync();
            new Thread(() -> {
                String shown;
                try {
                    String[] r = token.isEmpty() ? new String[]{"401", ""}
                            : AlertService.http("POST", "/api/chat/send", token, new JSONObject().put("toId", peer).put("body", text).toString(), geo);
                    if (r[0].startsWith("2")) {
                        shown = text;
                        try { AlertService.http("GET", "/api/chat/thread/" + Uri.encode(peer), token, null, null); } catch (Exception ignored) { }
                    } else if ("423".equals(r[0])) shown = "⚠ Not sent — turn on location and open the app: " + text;
                    else shown = "⚠ Not sent — open the app to reply: " + text;
                } catch (Exception e) { shown = "⚠ Not sent (no internet) — " + text; }
                AlertNotifier.addOwn(c, thread, shown);
                pr.finish();
            }).start();
        }
    }

    /** "/chat/#<userId>" → the user id the chat is with. */
    static String chatPeer(String link) {
        if (link == null) return null;
        int h = link.indexOf("/chat/#");
        if (h < 0) return null;
        String id = Uri.decode(link.substring(h + 7));
        return id.isEmpty() ? null : id;
    }

    /** Sales engineers' saves need a recent location (X-CRM-Geo); use the phone's last known fix. */
    private static String geoHeader(Context c) {
        if (ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED
                && ContextCompat.checkSelfPermission(c, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) return null;
        try {
            LocationManager lm = (LocationManager) c.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return null;
            Location best = null;
            for (String prov : lm.getProviders(true)) {
                @SuppressWarnings("MissingPermission") Location l = lm.getLastKnownLocation(prov);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
            if (best == null) return null;
            long age = Math.max(0, (System.currentTimeMillis() - best.getTime()) / 1000);
            return String.format(Locale.US, "%.6f,%.6f,%d,%d", best.getLatitude(), best.getLongitude(), Math.round(best.getAccuracy()), age);
        } catch (SecurityException e) { return null; }
    }
}

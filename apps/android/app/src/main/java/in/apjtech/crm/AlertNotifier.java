package in.apjtech.crm;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;
import androidx.core.app.RemoteInput;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;
import java.util.regex.Pattern;

/**
 * WhatsApp-style phone notifications for CRM alerts.
 *
 *  - one notification per conversation: each chat sender, and each CRM page (Tasks, Leave, Trials…);
 *    new alerts are added to it as messages, so it reads like a chat
 *  - all of them bundled under one "APJ CRM · 5 new alerts" summary
 *  - heads-up banner with the sound chosen for that alert type, shown on the lock screen
 *    (content hidden until unlocked), app badge count
 *  - buttons: Reply (chat messages, typed in the notification) and Mark as read
 *  - the admin's notification settings apply: alert off, no phone notification, templates,
 *    and each person's own sound choice
 */
final class AlertNotifier {
    static final String PREFS = "crm_alerts";
    static final String CHANNEL_DEFAULT = "crm_alerts_v1";
    static final String CHANNEL_SERVICE = "crm_service_v1";
    static final String GROUP = "in.apjtech.crm.ALERTS";
    static final String KEY_REPLY = "reply";
    static final int SUMMARY_ID = 2;
    private static final int MAX_MESSAGES = 7;
    private static final int COLOR = 0xFF1E3A5F;

    /** Sounds the CRM can ask for (res/raw/snd_*.wav — the same notes the website plays). */
    static final String[] SOUND_NAMES = {"chime", "urgent", "bell", "ding", "pop", "alarm", "soft", "none"};

    private AlertNotifier() { }

    static boolean strong(String snd) { return "urgent".equals(snd) || "alarm".equals(snd); }

    static String channelFor(String snd) {
        for (String s : SOUND_NAMES) if (s.equals(snd)) return "crm_snd_" + s + "_v1";
        return CHANNEL_DEFAULT;   // "default" → the phone's own notification sound
    }

    static Uri soundUri(Context c, String snd) {
        int id;
        switch (snd == null ? "" : snd) {
            case "chime": id = R.raw.snd_chime; break;
            case "urgent": id = R.raw.snd_urgent; break;
            case "bell": id = R.raw.snd_bell; break;
            case "ding": id = R.raw.snd_ding; break;
            case "pop": id = R.raw.snd_pop; break;
            case "alarm": id = R.raw.snd_alarm; break;
            case "soft": id = R.raw.snd_soft; break;
            default: return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        }
        return Uri.parse("android.resource://" + c.getPackageName() + "/" + id);
    }

    static void createChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm == null) return;
        AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();
        NotificationChannel ch = new NotificationChannel(CHANNEL_DEFAULT, "CRM alerts", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Tasks, CEO Desk messages, reminders and other CRM alerts");
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 180, 80, 180});
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), aa);
        ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
        nm.createNotificationChannel(ch);
        // One channel per alert sound chosen in Notifications & branding (Android fixes a channel's sound).
        for (String snd : SOUND_NAMES) {
            NotificationChannel x = new NotificationChannel(channelFor(snd), "CRM alerts — " + snd + " sound", NotificationManager.IMPORTANCE_HIGH);
            x.setDescription("CRM alerts set to the " + snd + " sound");
            x.enableVibration(true);
            x.setVibrationPattern(strong(snd) ? new long[]{0, 180, 80, 180, 80, 180} : new long[]{0, 180, 80, 180});
            if ("none".equals(snd)) x.setSound(null, null); else x.setSound(soundUri(c, snd), aa);
            x.setLockscreenVisibility(android.app.Notification.VISIBILITY_PRIVATE);
            nm.createNotificationChannel(x);
        }
        NotificationChannel svc = new NotificationChannel(CHANNEL_SERVICE, "Alerts running in the background", NotificationManager.IMPORTANCE_MIN);
        svc.setDescription("Keeps CRM alerts coming when the app is closed. You can hide this notification here.");
        svc.setSound(null, null);
        svc.setShowBadge(false);
        nm.createNotificationChannel(svc);
    }

    // ── which page an alert belongs to (same groups as the Notifications page) ──
    static String groupOf(String type) {
        if (type == null) return "CRM";
        if (type.startsWith("PUNCH") || type.startsWith("LATE_PUNCH") || type.equals("BREAK_STARTED") || type.equals("STATIONARY") || type.equals("LOCATION_OFF")) return "Attendance";
        if (type.startsWith("APPOINTMENT")) return "Appointments";
        if (type.startsWith("MD_DESK") || type.startsWith("TASK_")) return "CEO Desk & Tasks";
        if (type.startsWith("PRICE_REQUEST")) return "Price requests";
        if (type.startsWith("STOCK") || type.equals("RESTOCK_NEEDED")) return "Stock";
        if (type.startsWith("TRIAL")) return "Trials";
        if (type.startsWith("LEAVE")) return "Leave";
        if (type.equals("INVOICE_OVERDUE") || type.equals("BILL_DUE")) return "Accounts";
        if (type.startsWith("PETTY_CASH")) return "Petty cash";
        if (type.equals("CHANGE_NOTICE")) return "Changes to your requests";
        return "CRM";
    }

    private static final Pattern URGENT_TEXT = Pattern.compile("urgent|out of stock|overdue", Pattern.CASE_INSENSITIVE);
    static boolean urgent(String type, String text) {
        return "PUNCH_REMINDER".equals(type) || "LOCATION_OFF".equals(type) || "LATE_PUNCH_REQUEST".equals(type) || URGENT_TEXT.matcher(text).find();
    }

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** Title, text and sound after the notification settings — or null when it must not show on the phone. */
    static String[] shape(Context c, String type, String title, String body) {
        SharedPreferences p = prefs(c);
        String sound = urgent(type, title + " " + body) ? "urgent" : "default";
        try {
            JSONObject all = new JSONObject(p.getString("settings", "{}"));
            JSONObject r = all.optJSONObject("n") == null ? null : all.optJSONObject("n").optJSONObject(type);
            String mine = all.optJSONObject("m") == null ? "" : all.optJSONObject("m").optString(type, "");
            if (r != null) {
                if (r.has("on") && !r.optBoolean("on", true)) return null;
                if (r.has("push") && !r.optBoolean("push", true)) return null;
                String brand = p.getString("brand", "APJ CRM");
                String t = r.optString("title", ""), b = r.optString("body", "");
                String ot = title, ob = body;
                if (!t.isEmpty()) title = t.replace("{title}", ot).replace("{body}", ob).replace("{name}", brand);
                if (!b.isEmpty()) body = b.replace("{title}", ot).replace("{body}", ob).replace("{name}", brand);
                if (!r.optString("sound", "").isEmpty()) sound = r.optString("sound");
            }
            if (!mine.isEmpty() && !"default".equals(mine)) sound = mine;
        } catch (Exception ignored) { }
        return new String[]{title, body, sound};
    }

    // ── conversations ────────────────────────────────────────────────────
    static int idFor(String thread) { return 1000 + (thread.hashCode() & 0x3fffffff); }

    private static JSONObject threads(Context c) {
        try { return new JSONObject(prefs(c).getString("threads", "{}")); } catch (Exception e) { return new JSONObject(); }
    }
    private static void saveThreads(Context c, JSONObject t) { prefs(c).edit().putString("threads", t.toString()).apply(); }

    /** A new alert from the CRM → added to its conversation and shown (with sound). */
    static synchronized void post(Context c, JSONObject ev) {
        String type = ev.optString("type"), title = ev.optString("title"), body = ev.optString("body"), link = ev.optString("link");
        String[] s = shape(c, type, title, body);
        if (s == null) return;
        boolean chat = "CHAT_MESSAGE".equals(type);
        String thread = chat ? "chat|" + link : "page|" + groupOf(type);
        String who, text;
        if (chat) { who = title.replaceFirst("^Message from ", ""); text = s[1].isEmpty() ? s[0] : s[1]; }
        else if (s[1].isEmpty()) { who = groupOf(type); text = s[0]; }
        else { who = s[0]; text = s[1]; }
        try {
            JSONObject all = threads(c);
            JSONObject t = all.optJSONObject(thread);
            if (t == null) t = new JSONObject();
            t.put("label", chat ? who : groupOf(type));
            t.put("chat", chat);
            t.put("link", link);
            t.put("sound", s[2]);
            JSONArray msgs = t.optJSONArray("msgs");
            if (msgs == null) msgs = new JSONArray();
            msgs.put(new JSONObject().put("who", who).put("text", text).put("at", System.currentTimeMillis()));
            while (msgs.length() > MAX_MESSAGES) msgs.remove(0);
            t.put("msgs", msgs);
            all.put(thread, t);
            saveThreads(c, all);
            show(c, thread, t, false);
            summary(c, all);
        } catch (Exception ignored) { }
    }

    /** Your reply (or why it could not be sent) added to the chat, without a sound — like WhatsApp. */
    static synchronized void addOwn(Context c, String thread, String text) {
        try {
            JSONObject all = threads(c);
            JSONObject t = all.optJSONObject(thread);
            if (t == null) return;
            JSONArray msgs = t.optJSONArray("msgs");
            if (msgs == null) msgs = new JSONArray();
            msgs.put(new JSONObject().put("who", "").put("text", text).put("at", System.currentTimeMillis()));
            while (msgs.length() > MAX_MESSAGES) msgs.remove(0);
            t.put("msgs", msgs);
            all.put(thread, t);
            saveThreads(c, all);
            show(c, thread, t, true);
        } catch (Exception ignored) { }
    }

    /** Read / opened / swiped away: forget the conversation and take its notification down. */
    static synchronized void clearThread(Context c, String thread, boolean cancel) {
        JSONObject all = threads(c);
        all.remove(thread);
        saveThreads(c, all);
        if (cancel) NotificationManagerCompat.from(c).cancel(idFor(thread));
        summary(c, all);
    }

    static synchronized void clearAll(Context c) {
        JSONObject all = threads(c);
        Iterator<String> it = all.keys();
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        while (it.hasNext()) nm.cancel(idFor(it.next()));
        nm.cancel(SUMMARY_ID);
        saveThreads(c, new JSONObject());
    }

    private static int flags(boolean mutable) {
        int f = PendingIntent.FLAG_UPDATE_CURRENT;
        if (mutable) { if (Build.VERSION.SDK_INT >= 31) f |= PendingIntent.FLAG_MUTABLE; }
        else f |= PendingIntent.FLAG_IMMUTABLE;
        return f;
    }

    static PendingIntent openIntent(Context c, String link, String thread, int req) {
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (link != null && !link.isEmpty()) open.putExtra("link", link.startsWith("http") ? link : BuildConfig.APP_URL + (link.startsWith("/") ? link : "/" + link));
        if (thread != null) open.putExtra("thread", thread);
        return PendingIntent.getActivity(c, req, open, flags(false));
    }

    private static PendingIntent action(Context c, String act, String thread, String link, int req, boolean mutable) {
        Intent i = new Intent(c, NotifyActionReceiver.class);
        i.setAction(act);
        i.putExtra("thread", thread);
        i.putExtra("link", link);
        return PendingIntent.getBroadcast(c, req, i, flags(mutable));
    }

    private static Bitmap appIcon(Context c) {
        try { return BitmapFactory.decodeResource(c.getResources(), R.mipmap.ic_launcher); } catch (Exception e) { return null; }
    }

    private static void show(Context c, String thread, JSONObject t, boolean quiet) {
        int id = idFor(thread);
        boolean chat = t.optBoolean("chat");
        String label = t.optString("label", "APJ CRM"), link = t.optString("link"), sound = t.optString("sound", "default");
        String brand = prefs(c).getString("brand", "APJ CRM");
        JSONArray msgs = t.optJSONArray("msgs");
        if (msgs == null || msgs.length() == 0) return;

        Person me = new Person.Builder().setName("You").setKey("me").build();
        NotificationCompat.MessagingStyle style = new NotificationCompat.MessagingStyle(me);
        // a chat looks like a one-to-one WhatsApp chat; a CRM page like a group, with the alert as the "sender"
        style.setGroupConversation(!chat);
        if (!chat) style.setConversationTitle(label);
        String last = "";
        long lastAt = System.currentTimeMillis();
        int fromOthers = 0;
        for (int i = 0; i < msgs.length(); i++) {
            JSONObject m = msgs.optJSONObject(i);
            if (m == null) continue;
            String who = m.optString("who");
            Person p = who.isEmpty() ? null : new Person.Builder().setName(who).setKey(who).build();
            if (p != null) fromOthers++;
            last = m.optString("text");
            lastAt = m.optLong("at", lastAt);
            style.addMessage(last, lastAt, p);
        }

        NotificationCompat.Builder pub = new NotificationCompat.Builder(c, channelFor(sound))
                .setSmallIcon(R.drawable.ic_stat_notify).setColor(COLOR)
                .setContentTitle(brand).setContentText(fromOthers > 1 ? fromOthers + " new alerts" : "New alert");

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, channelFor(sound))
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(COLOR)
                .setLargeIcon(appIcon(c))
                .setStyle(style)
                .setContentTitle(label)
                .setContentText(last)
                .setWhen(lastAt).setShowWhen(true)
                .setNumber(fromOthers)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setGroup(GROUP)
                .setAutoCancel(true)
                .setOnlyAlertOnce(quiet)
                .setSilent(quiet)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setPublicVersion(pub.build())
                .setContentIntent(openIntent(c, link, thread, id))
                .setDeleteIntent(action(c, NotifyActionReceiver.ACTION_DISMISS, thread, link, id + 3, false));
        if (chat) {
            RemoteInput ri = new RemoteInput.Builder(KEY_REPLY).setLabel("Reply to " + label).build();
            b.addAction(new NotificationCompat.Action.Builder(R.drawable.ic_stat_notify, "Reply", action(c, NotifyActionReceiver.ACTION_REPLY, thread, link, id + 1, true))
                    .addRemoteInput(ri).setAllowGeneratedReplies(true)
                    .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).setShowsUserInterface(false).build());
        }
        b.addAction(new NotificationCompat.Action.Builder(R.drawable.ic_stat_notify, "Mark as read", action(c, NotifyActionReceiver.ACTION_READ, thread, link, id + 2, false))
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_MARK_AS_READ).setShowsUserInterface(false).build());
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O && !quiet) {   // Android 7 and older: no channels
            if ("none".equals(sound)) b.setSilent(true);
            else { b.setSound(soundUri(c, sound)); b.setDefaults(NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS); }
        }
        try { NotificationManagerCompat.from(c).notify(id, b.build()); } catch (SecurityException ignored) { /* notifications not allowed */ }
    }

    /** The bundle header: "APJ CRM · 5 new alerts" with a line per conversation. */
    private static void summary(Context c, JSONObject all) {
        NotificationManagerCompat nm = NotificationManagerCompat.from(c);
        if (all.length() == 0) { nm.cancel(SUMMARY_ID); return; }
        String brand = prefs(c).getString("brand", "APJ CRM");
        NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle();
        int total = 0;
        Iterator<String> it = all.keys();
        while (it.hasNext()) {
            JSONObject t = all.optJSONObject(it.next());
            JSONArray msgs = t == null ? null : t.optJSONArray("msgs");
            if (msgs == null || msgs.length() == 0) continue;
            int n = 0;
            for (int i = 0; i < msgs.length(); i++) if (!msgs.optJSONObject(i).optString("who").isEmpty()) n++;
            total += n;
            JSONObject m = msgs.optJSONObject(msgs.length() - 1);
            inbox.addLine(t.optString("label") + ": " + (m == null ? "" : m.optString("text")));
        }
        String head = total + " new alert" + (total == 1 ? "" : "s") + (all.length() > 1 ? " from " + all.length() + " pages" : "");
        inbox.setBigContentTitle(brand).setSummaryText(head);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_DEFAULT)
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setColor(COLOR)
                .setContentTitle(brand)
                .setContentText(head)
                .setStyle(inbox)
                .setNumber(total)
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
                .setSilent(true)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(openIntent(c, "/alerts/", null, SUMMARY_ID));
        try { nm.notify(SUMMARY_ID, b.build()); } catch (SecurityException ignored) { }
    }
}

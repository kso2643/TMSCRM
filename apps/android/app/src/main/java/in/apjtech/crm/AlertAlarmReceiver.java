package in.apjtech.crm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/**
 * Woken by AlarmManager: checks for new CRM alerts (even when the phone is asleep or Android
 * has closed the app), books the next check, and keeps the background service running.
 * Also delivers the "Send test alert" sample from the Notifications page.
 */
public class AlertAlarmReceiver extends BroadcastReceiver {
    static final String ACTION_POLL = "in.apjtech.crm.ALERT_POLL";
    static final String ACTION_TEST = "in.apjtech.crm.ALERT_TEST";

    @Override public void onReceive(Context c, Intent i) {
        if (ACTION_TEST.equals(i.getAction())) {
            try {
                AlertNotifier.post(c, new JSONObject()
                        .put("id", "test-" + System.currentTimeMillis()).put("type", "TEST_ALERT")
                        .put("title", "Test alert").put("body", "Phone alerts are working — you will get CRM alerts like this one.")
                        .put("link", "/admin/notifications/"));
            } catch (Exception ignored) { }
            return;
        }
        if (!ACTION_POLL.equals(i.getAction()) || !AlertService.hasSession(c)) return;
        if (!AlertService.running) AlertService.start(c);   // Android closed it: bring it back (allowed from an alarm)
        final PendingResult pr = goAsync();
        AlertService.pollInBackground(c, pr::finish);
    }
}

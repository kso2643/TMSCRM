package in.apjtech.crm;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

/**
 * APJ CRM — a secure shell around https://crm.apjtech.in.
 *
 * Security:
 *  - only crm.apjtech.in (and api.apjtech.in) open inside the app, always over HTTPS;
 *    any other link opens in the phone's browser; certificate errors are never ignored
 *  - app lock: fingerprint / face / phone PIN when the app opens and after 2 minutes in the background
 *  - app data (login) is excluded from cloud backup and phone-to-phone transfer
 *  - WebView file / content access is off; the JavaScript bridge (for saving downloads)
 *    only answers the CRM's own pages
 */
public class MainActivity extends AppCompatActivity {

    private static final String APP_URL = BuildConfig.APP_URL;
    private static final String[] ALLOWED_HOSTS = {"crm.apjtech.in", "api.apjtech.in"};
    private static final long LOCK_AFTER_MS = 2 * 60 * 1000L;
    private static final int REQ_FILE = 11, REQ_PERM_GEO = 21, REQ_PERM_MEDIA = 22, REQ_PERM_CAMERA_FILE = 23, REQ_PERM_NOTIFY = 24;
    private volatile boolean inForeground = false;
    /** Read by AlertService: while the app is on screen the page shows alerts itself. */
    static volatile boolean appVisible = false;
    private int notifyId = 1000;

    private WebView web;
    private FrameLayout root;
    private View lockView, offlineView;
    private boolean unlocked = false;
    private long backgroundAt = 0;
    private volatile String currentUrl = "";

    private ValueCallback<Uri[]> fileCallback;
    private WebChromeClient.FileChooserParams pendingFileParams;
    private Uri cameraUri;
    private String geoOrigin;
    private GeolocationPermissions.Callback geoCallback;
    private PermissionRequest mediaRequest;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebView.setWebContentsDebuggingEnabled(false);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setGeolocationEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) s.setSafeBrowsingEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " APJCRM-Android/" + BuildConfig.VERSION_NAME);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "CRMNative");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            // ordinary http(s) downloads (links) — hand them to the browser so the phone's download manager saves them
            if (url.startsWith("blob:") || url.startsWith("data:")) return;
            openExternal(Uri.parse(url));
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (web.canGoBack()) web.goBack();
                else { setEnabled(false); getOnBackPressedDispatcher().onBackPressed(); }
            }
        });

        AlertNotifier.createChannels(this);
        clearThreadFrom(getIntent());
        web.setVisibility(View.INVISIBLE);
        String link = getIntent() != null ? getIntent().getStringExtra("link") : null;
        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(link != null && isAllowed(Uri.parse(link)) ? link : APP_URL + "/dashboard/");
        requireUnlock();
    }

    @Override protected void onSaveInstanceState(@NonNull Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String link = intent.getStringExtra("link");
        if (link != null && isAllowed(Uri.parse(link))) web.loadUrl(link);
        clearThreadFrom(intent);
    }

    /** Opened from an alert notification: that conversation has been read. */
    private void clearThreadFrom(Intent i) {
        String thread = i == null ? null : i.getStringExtra("thread");
        if (thread != null) AlertNotifier.clearThread(this, thread, true);
    }

    @Override protected void onPause() {
        super.onPause();
        inForeground = false;
        appVisible = false;
        backgroundAt = SystemClock.elapsedRealtime();
        CookieManager.getInstance().flush();
    }

    @Override protected void onResume() {
        super.onResume();
        inForeground = true;
        appVisible = true;
        if (unlocked && backgroundAt > 0 && SystemClock.elapsedRealtime() - backgroundAt > LOCK_AFTER_MS) {
            unlocked = false;
            web.setVisibility(View.INVISIBLE);
            requireUnlock();
        }
    }

    // ── app lock ────────────────────────────────────────────────────────
    private void requireUnlock() {
        int types = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) types = BiometricManager.Authenticators.BIOMETRIC_WEAK | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
        int can = BiometricManager.from(this).canAuthenticate(types);
        if (can != BiometricManager.BIOMETRIC_SUCCESS) {
            // the phone has no screen lock — nothing to check against; open, but remind once per start
            if (!unlocked) Toast.makeText(this, "Tip: set a screen lock on this phone to protect the CRM.", Toast.LENGTH_LONG).show();
            onUnlocked();
            return;
        }
        showLockView();
        Executor ex = ContextCompat.getMainExecutor(this);
        BiometricPrompt prompt = new BiometricPrompt(this, ex, new BiometricPrompt.AuthenticationCallback() {
            @Override public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) { onUnlocked(); }
            @Override public void onAuthenticationError(int code, @NonNull CharSequence msg) { /* stay locked — "Unlock" button tries again */ }
        });
        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock APJ CRM")
                .setSubtitle("Use your fingerprint, face or phone PIN")
                .setAllowedAuthenticators(types)
                .build();
        try { prompt.authenticate(info); } catch (Exception e) { onUnlocked(); }
    }

    private void showLockView() {
        if (lockView != null) return;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(android.view.Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#1E3A5F"));
        TextView t = new TextView(this);
        t.setText("🔒  APJ CRM is locked");
        t.setTextColor(Color.WHITE);
        t.setTextSize(20);
        t.setPadding(0, 0, 0, 40);
        Button b = new Button(this);
        b.setText("Unlock");
        b.setOnClickListener(v -> requireUnlock());
        box.addView(t);
        box.addView(b);
        lockView = box;
        root.addView(lockView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void onUnlocked() {
        askNotifyPermission();
        askBatteryExemption();
        unlocked = true;
        backgroundAt = 0;
        if (lockView != null) { root.removeView(lockView); lockView = null; }
        web.setVisibility(View.VISIBLE);
    }

    // ── alert sound + notifications (channels, sounds and the WhatsApp-style notifications: AlertNotifier) ──
    private boolean notifyAsked = false;
    private void askNotifyPermission() {
        if (notifyAsked || Build.VERSION.SDK_INT < 33) return;
        notifyAsked = true;
        if (!has(Manifest.permission.POST_NOTIFICATIONS)) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_PERM_NOTIFY);
    }

    /** Once: ask to let the app run in the background, so alerts arrive like WhatsApp messages. */
    private void askBatteryExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        android.content.SharedPreferences p = AlertNotifier.prefs(this);
        if (!AlertService.hasSession(this)) return;   // only once someone is signed in
        long last = p.getLong("batteryAskedAt", 0);
        if (System.currentTimeMillis() - last < 24L * 3600 * 1000) return;   // at most once a day until allowed
        android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm == null || pm.isIgnoringBatteryOptimizations(getPackageName())) return;
        p.edit().putLong("batteryAskedAt", System.currentTimeMillis()).apply();
        new androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Get alerts instantly")
                .setMessage("To get CRM alerts on time even when the app is closed (like WhatsApp), allow APJ CRM to run in the background. On the next screen choose Allow.")
                .setPositiveButton("Continue", (d, w) -> {
                    try { startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))); }
                    catch (ActivityNotFoundException ignored) { }
                })
                .setNegativeButton("Not now", null)
                .show();
    }

    private long lastSoundAt = 0;
    /** Plays the phone's notification sound + vibration (when the app is open). */
    void playAlertSound(String sound) {
        if ("none".equals(sound)) return;
        boolean urgent = AlertNotifier.strong(sound);
        long now = SystemClock.elapsedRealtime();
        if (now - lastSoundAt < 1500) return;
        lastSoundAt = now;
        try {
            Ringtone r = RingtoneManager.getRingtone(getApplicationContext(), AlertNotifier.soundUri(this, sound));
            if (r != null) r.play();
        } catch (Exception ignored) { }
        try {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                long[] pat = urgent ? new long[]{0, 180, 80, 180, 80, 180} : new long[]{0, 140};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(VibrationEffect.createWaveform(pat, -1)); else v.vibrate(pat, -1);
            }
        } catch (Exception ignored) { }
    }

    /** A real Android notification (with sound) — used when the app is in the background. */
    void postNotification(String title, String body, String link, String sound) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (link != null && !link.isEmpty()) open.putExtra("link", link.startsWith("http") ? link : APP_URL + (link.startsWith("/") ? link : "/" + link));
        int id = ++notifyId;
        PendingIntent pi = PendingIntent.getActivity(this, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, AlertNotifier.channelFor(sound))
                .setSmallIcon(R.drawable.ic_stat_notify)
                .setContentTitle(title == null || title.isEmpty() ? "APJ CRM" : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setDefaults(AlertNotifier.channelFor(sound).equals(AlertNotifier.CHANNEL_DEFAULT) ? NotificationCompat.DEFAULT_ALL : NotificationCompat.DEFAULT_VIBRATE | NotificationCompat.DEFAULT_LIGHTS)
                .setAutoCancel(true)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(pi);
        if (!AlertNotifier.channelFor(sound).equals(AlertNotifier.CHANNEL_DEFAULT)) {   // Android 7 and older: no channels, so the sound goes on the notification
            if ("none".equals(sound)) b.setSilent(true); else b.setSound(AlertNotifier.soundUri(this, sound));
        }
        try { NotificationManagerCompat.from(this).notify(id, b.build()); } catch (SecurityException ignored) { /* notifications not allowed */ }
    }

    // ── navigation ──────────────────────────────────────────────────────
    private static boolean isAllowed(Uri u) {
        if (u == null || !"https".equals(u.getScheme()) || u.getHost() == null) return false;
        for (String h : ALLOWED_HOSTS) if (h.equalsIgnoreCase(u.getHost())) return true;
        return false;
    }

    private void openExternal(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "No app can open this link.", Toast.LENGTH_SHORT).show(); }
    }

    private class Client extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            String sc = u.getScheme() == null ? "" : u.getScheme();
            if (isAllowed(u)) return false;
            if (sc.equals("blob") || sc.equals("data") || sc.equals("about")) return true;   // saved through the bridge instead
            openExternal(u);   // tel:, mailto:, WhatsApp, maps, other websites
            return true;
        }

        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) { currentUrl = url; }

        @Override public void onPageFinished(WebView view, String url) {
            currentUrl = url;
            if (offlineView != null) { root.removeView(offlineView); offlineView = null; }
            if (isAllowed(Uri.parse(url))) view.evaluateJavascript(DOWNLOAD_SHIM, null);
        }

        @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel();   // never continue on a bad certificate
            Toast.makeText(MainActivity.this, "Secure connection failed — check the phone's date / network.", Toast.LENGTH_LONG).show();
        }

        @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (req.isForMainFrame()) showOffline();
        }
    }

    private void showOffline() {
        if (offlineView != null) return;
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(android.view.Gravity.CENTER);
        box.setBackgroundColor(Color.WHITE);
        TextView t = new TextView(this);
        t.setText("No internet connection");
        t.setTextSize(18);
        t.setPadding(0, 0, 0, 30);
        Button b = new Button(this);
        b.setText("Try again");
        b.setOnClickListener(v -> { root.removeView(offlineView); offlineView = null; web.reload(); });
        box.addView(t);
        box.addView(b);
        offlineView = box;
        root.addView(offlineView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    // ── camera / microphone / location / file picker ──────────────────
    private boolean has(String p) { return ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED; }

    private class Chrome extends WebChromeClient {
        @Override public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            if (!isAllowed(Uri.parse(origin))) { callback.invoke(origin, false, false); return; }
            if (has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION)) { callback.invoke(origin, true, false); return; }
            geoOrigin = origin; geoCallback = callback;
            requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, REQ_PERM_GEO);
        }

        @Override public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> {
                if (!isAllowed(request.getOrigin())) { request.deny(); return; }
                List<String> need = new ArrayList<>();
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && !has(Manifest.permission.CAMERA)) need.add(Manifest.permission.CAMERA);
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && !has(Manifest.permission.RECORD_AUDIO)) need.add(Manifest.permission.RECORD_AUDIO);
                }
                if (need.isEmpty()) { grantMedia(request); return; }
                mediaRequest = request;
                requestPermissions(need.toArray(new String[0]), REQ_PERM_MEDIA);
            });
        }

        @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            pendingFileParams = params;
            boolean wantsImage = false;
            for (String a : params.getAcceptTypes()) if (a != null && (a.startsWith("image") || a.isEmpty())) wantsImage = true;
            if (wantsImage && !has(Manifest.permission.CAMERA)) {
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_PERM_CAMERA_FILE);
                return true;
            }
            openFileChooser(params);
            return true;
        }
    }

    private void grantMedia(PermissionRequest request) {
        List<String> ok = new ArrayList<>();
        for (String r : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r) && has(Manifest.permission.CAMERA)) ok.add(r);
            if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r) && has(Manifest.permission.RECORD_AUDIO)) ok.add(r);
        }
        if (ok.isEmpty()) request.deny(); else request.grant(ok.toArray(new String[0]));
    }

    private void openFileChooser(WebChromeClient.FileChooserParams params) {
        Intent pick = params.createIntent();
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        Intent chooser = Intent.createChooser(pick, "Choose a file");
        cameraUri = null;
        if (has(Manifest.permission.CAMERA)) {
            try {
                File dir = new File(getCacheDir(), "camera");
                if (!dir.exists()) dir.mkdirs();
                File photo = new File(dir, "photo_" + System.currentTimeMillis() + ".jpg");
                cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", photo);
                Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                cam.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
                cam.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
            } catch (Exception ignored) { cameraUri = null; }
        }
        try { startActivityForResult(chooser, REQ_FILE); }
        catch (ActivityNotFoundException e) { if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = null; }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            } else if (cameraUri != null) {
                result = new Uri[]{cameraUri};
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_PERM_GEO && geoCallback != null) {
            boolean ok = has(Manifest.permission.ACCESS_FINE_LOCATION) || has(Manifest.permission.ACCESS_COARSE_LOCATION);
            geoCallback.invoke(geoOrigin, ok, false);
            geoCallback = null;
        } else if (requestCode == REQ_PERM_MEDIA && mediaRequest != null) {
            grantMedia(mediaRequest);
            mediaRequest = null;
        } else if (requestCode == REQ_PERM_CAMERA_FILE && pendingFileParams != null) {
            openFileChooser(pendingFileParams);
        }
    }

    // ── downloads made in the page (Excel, PDF, CSV built as blob: links) ──
    private static final String DOWNLOAD_SHIM =
            "(function(){if(window.__crmNative)return;window.__crmNative=1;" +
            "function send(href,name){fetch(href).then(function(r){return r.blob();}).then(function(b){" +
            "var fr=new FileReader();fr.onload=function(){CRMNative.saveFile(String(fr.result),name||'download',b.type||'');};fr.readAsDataURL(b);})" +
            ".catch(function(e){alert('Could not save the file: '+e.message);});}" +
            "document.addEventListener('click',function(e){var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;" +
            "var h=a.getAttribute('href')||'';if(h.indexOf('blob:')===0||h.indexOf('data:')===0){e.preventDefault();e.stopPropagation();send(a.href,a.getAttribute('download')||a.download);}},true);" +
            "var _click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){var h=this.href||'';" +
            "if(h.indexOf('blob:')===0||h.indexOf('data:')===0){send(h,this.getAttribute('download')||this.download);return;}return _click.call(this);};" +
            "var _open=window.open;window.open=function(u){var s=String(u||'');if(s.indexOf('blob:')===0||s.indexOf('data:')===0){send(s,'document');return null;}return _open.apply(window,arguments);};" +
            "})();";

    /** Called from the page: saves a file to Downloads and opens it. Only answers the CRM's own pages. */
    class Bridge {
        /** The page's alert sound → the phone's notification sound (only while the app is on screen). */
        @JavascriptInterface
        public void playSound(String level) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl)) || !inForeground) return;
            runOnUiThread(() -> playAlertSound("urgent".equals(level) ? "urgent" : "default"));
        }

        /** The alert sound chosen for this alert type (chime, urgent, bell, ding, pop, alarm, soft, none, default). */
        @JavascriptInterface
        public void playSoundType(String sound) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl)) || !inForeground) return;
            runOnUiThread(() -> playAlertSound(sound == null ? "default" : sound));
        }

        /** An alert while the app is in the background → Android notification with sound. */
        @JavascriptInterface
        public void showNotification(String title, String body, String link) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl)) || inForeground || AlertService.running) return;
            runOnUiThread(() -> postNotification(title, body, link, "default"));
        }

        /** Same, with the sound chosen for this alert type (its own notification channel). */
        @JavascriptInterface
        public void showNotification2(String title, String body, String link, String sound) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl)) || inForeground || AlertService.running) return;
            runOnUiThread(() -> postNotification(title, body, link, sound == null ? "default" : sound));
        }

        @JavascriptInterface
        public boolean isNative() { return true; }

        /**
         * The signed-in user (from the CRM page): lets AlertService keep alerts coming when the app
         * is closed. settings = {"n": company notification settings, "m": this person's own sounds}.
         */
        @JavascriptInterface
        public void setSession(String token, String userId, String brand, String settings) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl)) || token == null || token.isEmpty()) return;
            android.content.SharedPreferences p = AlertNotifier.prefs(MainActivity.this);
            android.content.SharedPreferences.Editor e = p.edit();
            if (!String.valueOf(userId).equals(p.getString("userId", ""))) {   // another person signed in: start fresh
                e.remove("since").remove("seen");
                AlertNotifier.clearAll(MainActivity.this);
            }
            e.putString("token", token).putString("userId", String.valueOf(userId))
             .putString("brand", brand == null || brand.isEmpty() ? "APJ CRM" : brand)
             .putString("settings", settings == null ? "{}" : settings).apply();
            runOnUiThread(() -> {
                if (!AlertService.running) AlertService.start(MainActivity.this);
                AlertService.schedule(MainActivity.this, AlertService.POLL_MS);
                askBatteryExemption();
            });
        }

        /** Punched in → record the route with the phone's GPS (AlertService), also when the app is closed. */
        @JavascriptInterface
        public void setTracking(boolean on) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl))) return;
            android.content.SharedPreferences p = AlertNotifier.prefs(MainActivity.this);
            boolean was = p.getBoolean("tracking", false);
            p.edit().putBoolean("tracking", on).apply();
            if (was != on || (on && !AlertService.trackingActive)) runOnUiThread(() -> AlertService.start(MainActivity.this));
        }

        /** True while the app itself is sending the location points (the page then doesn't). */
        @JavascriptInterface
        public boolean isTracking() { return AlertService.trackingActive; }

        /** For the "Phone alerts" card on the Notifications page. */
        @JavascriptInterface
        public String alertStatus() {
            try {
                android.content.SharedPreferences p = AlertNotifier.prefs(MainActivity.this);
                android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
                boolean battery = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName()));
                return new org.json.JSONObject()
                        .put("signedIn", AlertService.hasSession(MainActivity.this))
                        .put("service", AlertService.running)
                        .put("notifications", NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled())
                        .put("background", battery)
                        .put("exactAlarms", AlertService.exactAllowed(MainActivity.this))
                        .put("lastCheck", p.getLong("lastPollAt", 0))
                        .put("lastResult", p.getString("lastResult", ""))
                        .put("lastError", p.getString("lastError", ""))
                        .put("tracking", p.getBoolean("tracking", false))
                        .put("trackingActive", AlertService.trackingActive)
                        .put("location", AlertService.canLocate(MainActivity.this))
                        .put("lastPing", p.getLong("lastPingAt", 0))
                        .put("maker", Build.MANUFACTURER)
                        .put("android", Build.VERSION.RELEASE)
                        .put("app", BuildConfig.VERSION_NAME).toString();
            } catch (Exception e) { return "{}"; }
        }

        /** "Send test alert": a sample notification in a few seconds (lock the phone to see it arrive). */
        @JavascriptInterface
        public void testAlert(int seconds) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl))) return;
            AlertService.scheduleTest(MainActivity.this, Math.max(3, Math.min(120, seconds)) * 1000L);
        }

        /** Opens the phone setting that lets the app run in the background / its notification / app settings. */
        @JavascriptInterface
        public void openSettings(String which) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl))) return;
            runOnUiThread(() -> {
                Intent i;
                if ("background".equals(which) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    i = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                } else if ("notifications".equals(which) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    i = new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName());
                } else if ("alarms".equals(which) && Build.VERSION.SDK_INT >= 31) {
                    i = new Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()));
                } else {
                    i = new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                }
                try { startActivity(i); }
                catch (Exception e) {
                    try { startActivity(new Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { }
                }
            });
        }

        /** Signed out: stop background alerts and remove this person's notifications. */
        @JavascriptInterface
        public void clearSession() {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl))) return;
            AlertNotifier.prefs(MainActivity.this).edit().remove("token").remove("userId").remove("since").remove("seen").apply();
            AlertNotifier.clearAll(MainActivity.this);
            runOnUiThread(() -> AlertService.stop(MainActivity.this));
        }

        /**
         * Quotation e-mail (v11.56): opens Gmail / Outlook (any e-mail app the person picks) with To, CC,
         * subject, text and the attachments filled in — the person presses Send there.
         * json = {"to":[..],"cc":[..],"subject":"..","body":"..","files":[{"name":"..","mime":"..","base64":".."}]}
         */
        @JavascriptInterface
        public void composeMail(String json) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl))) return;
            try {
                JSONObject o = new JSONObject(json);
                String[] to = strings(o.optJSONArray("to")), cc = strings(o.optJSONArray("cc"));
                String subject = o.optString("subject", ""), body = o.optString("body", "");
                JSONArray files = o.optJSONArray("files");
                ArrayList<Uri> uris = new ArrayList<>();
                File dir = new File(getCacheDir(), "mail");
                if (dir.exists()) { File[] old = dir.listFiles(); if (old != null) for (File f : old) f.delete(); }
                if (files != null && files.length() > 0) {
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("Storage not available");
                    for (int k = 0; k < files.length(); k++) {
                        JSONObject f = files.getJSONObject(k);
                        String b64 = f.optString("base64", "");
                        if (b64.isEmpty()) continue;
                        String nm = f.optString("name", "file").replaceAll("[\\\\/:*?\"<>|]", "_");
                        File out = new File(dir, nm);
                        try (FileOutputStream os = new FileOutputStream(out)) { os.write(Base64.decode(b64, Base64.DEFAULT)); }
                        uris.add(FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", out));
                    }
                }
                Intent i;
                if (uris.isEmpty()) {
                    i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"));
                } else {
                    i = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
                    i.setType(uris.size() == 1 ? files.getJSONObject(0).optString("mime", "application/pdf") : "*/*");
                    if (uris.size() == 1) i.putExtra(Intent.EXTRA_STREAM, uris.get(0)); else i.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
                    ClipData clip = ClipData.newRawUri("attachment", uris.get(0));
                    for (int k = 1; k < uris.size(); k++) clip.addItem(new ClipData.Item(uris.get(k)));
                    i.setClipData(clip);
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    i.setSelector(new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:"))); // only e-mail apps
                }
                i.putExtra(Intent.EXTRA_EMAIL, to);
                if (cc.length > 0) i.putExtra(Intent.EXTRA_CC, cc);
                i.putExtra(Intent.EXTRA_SUBJECT, subject);
                i.putExtra(Intent.EXTRA_TEXT, body);
                final Intent send = i;
                runOnUiThread(() -> {
                    try { startActivity(Intent.createChooser(send, "Send the mail with")); }
                    catch (ActivityNotFoundException e) { Toast.makeText(MainActivity.this, "No e-mail app found — install Gmail or Outlook.", Toast.LENGTH_LONG).show(); }
                });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not open the mail app: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }

        private String[] strings(JSONArray a) {
            if (a == null) return new String[0];
            String[] r = new String[a.length()];
            for (int k = 0; k < a.length(); k++) r[k] = a.optString(k, "");
            return r;
        }

        @JavascriptInterface
        public void saveFile(String dataUrl, String name, String mime) {
            if (!isAllowed(Uri.parse(currentUrl == null ? "" : currentUrl))) return;
            try {
                int comma = dataUrl.indexOf(',');
                String head = comma > 0 ? dataUrl.substring(0, comma) : "";
                if (mime == null || mime.isEmpty()) mime = head.startsWith("data:") && head.contains(";") ? head.substring(5, head.indexOf(';')) : "application/octet-stream";
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                String safe = (name == null || name.trim().isEmpty()) ? "download" : name.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (!safe.contains(".")) {
                    String ext = android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
                    if (ext != null) safe = safe + "." + ext;
                }
                Uri uri;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    v.put(MediaStore.Downloads.MIME_TYPE, mime);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/APJ CRM");
                    uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new Exception("Storage not available");
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) { if (os == null) throw new Exception("Storage not available"); os.write(bytes); }
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) throw new Exception("Storage not available");
                    File f = new File(dir, safe);
                    try (FileOutputStream os = new FileOutputStream(f)) { os.write(bytes); }
                    uri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", f);
                }
                final Uri open = uri;
                final String type = mime, label = safe;
                runOnUiThread(() -> {
                    Toast.makeText(MainActivity.this, "Saved to Downloads: " + label, Toast.LENGTH_SHORT).show();
                    Intent view = new Intent(Intent.ACTION_VIEW);
                    view.setDataAndType(open, type);
                    view.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    try { startActivity(view); } catch (ActivityNotFoundException ignored) { }
                });
            } catch (Exception e) {
                runOnUiThread(() -> Toast.makeText(MainActivity.this, "Could not save the file: " + e.getMessage(), Toast.LENGTH_LONG).show());
            }
        }
    }
}

package com.clearcall.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.util.DisplayMetrics;
import android.view.View;
import android.view.WindowManager;
import android.webkit.GeolocationPermissions;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "clearcall_shell";
    private static final String KEY_URL = "app_url";
    private static final String KEY_PUSH = "native_push";
    private static final String KEY_WEB_VERSION = "web_version";
    private static final String KEY_APP_VERSION = "installed_version_code";
    private static final long UPDATE_CHECK_INTERVAL_MS = 60_000L;
    private static final int REQ_LOCATION = 41;
    private static final int REQ_NOTIFICATION = 42;

    private WebView webView;
    private FrameLayout root;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;
    private ActivityResultLauncher<String> saveTextLauncher;
    private String pendingSaveText = "";
    private GeolocationPermissions.Callback geoCallback;
    private String geoOrigin;
    private long lastBackAt = 0;
    private boolean urlDialogShowing = false;
    private int insetTop = 0;
    private int insetRight = 0;
    private int insetBottom = 0;
    private int insetLeft = 0;

    private String appBaseUrl = "";
    private String sessionDismissedVersion = "";
    private long lastUpdateCheckAt = 0;
    private boolean updateCheckRunning = false;
    private boolean updateDialogShowing = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        // 安装包更新后重置网页版本记录，避免刚装完就弹“有新版本”
        int lastCode = prefs.getInt(KEY_APP_VERSION, -1);
        if (lastCode != BuildConfig.VERSION_CODE) {
            prefs.edit().putInt(KEY_APP_VERSION, BuildConfig.VERSION_CODE)
                    .remove(KEY_WEB_VERSION).apply();
        }

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().setNavigationBarDividerColor(Color.TRANSPARENT);
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.hide(WindowInsetsCompat.Type.systemBars());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);

        setContentView(R.layout.activity_main);
        root = findViewById(R.id.shell_root);
        webView = findViewById(R.id.webview);
        applySafeInsets();
        configureWebView();
        setupBack();

        fileChooserLauncher = registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    if (filePathCallback == null) return;
                    Uri[] uris = null;
                    Intent data = result.getData();
                    if (result.getResultCode() == Activity.RESULT_OK && data != null) {
                        ClipData clip = data.getClipData();
                        if (clip != null && clip.getItemCount() > 0) {
                            uris = new Uri[clip.getItemCount()];
                            for (int i = 0; i < clip.getItemCount(); i++) {
                                uris[i] = clip.getItemAt(i).getUri();
                            }
                        } else if (data.getData() != null) {
                            uris = new Uri[]{data.getData()};
                        }
                    }
                    filePathCallback.onReceiveValue(uris);
                    filePathCallback = null;
                });

        saveTextLauncher = registerForActivityResult(
                new ActivityResultContracts.CreateDocument("application/json"),
                uri -> {
                    if (uri == null) {
                        pendingSaveText = "";
                        return;
                    }
                    try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                        if (out != null) {
                            out.write(pendingSaveText.getBytes(StandardCharsets.UTF_8));
                            out.flush();
                            Toast.makeText(this, "已保存", Toast.LENGTH_SHORT).show();
                        }
                    } catch (Exception e) {
                        Toast.makeText(this, "保存失败，换个位置再试", Toast.LENGTH_SHORT).show();
                    }
                    pendingSaveText = "";
                });

        NotificationHelper.ensureChannel(this);

        String url = prefs.getString(KEY_URL, null);
        if (url == null || url.trim().isEmpty()) url = BuildConfig.APP_URL;
        if (url == null || url.trim().isEmpty()) {
            showUrlDialog();
        } else {
            loadApp(url);
        }
    }

    private void applySafeInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets cutout = windowInsets.getInsets(WindowInsetsCompat.Type.displayCutout());
            Insets gestures = windowInsets.getInsets(WindowInsetsCompat.Type.systemGestures());
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            insetTop = cutout.top;
            insetRight = cutout.right;
            insetLeft = cutout.left;
            insetBottom = Math.max(cutout.bottom, gestures.bottom);
            // 键盘弹出时只缩 WebView 的底部，其余时间铺到屏幕边缘，避免出现色带
            view.setPadding(0, 0, 0, ime.bottom);
            injectShellInsets();
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(root);
    }

    private void injectShellInsets() {
        if (webView == null) return;
        float density = getResources().getDisplayMetrics().density;
        if (density <= 0) density = 1f;
        int top = Math.round(insetTop / density);
        int right = Math.round(insetRight / density);
        int bottom = Math.round(insetBottom / density);
        int left = Math.round(insetLeft / density);
        String js = "window.__setShellInsets&&window.__setShellInsets({top:" + top
                + ",right:" + right + ",bottom:" + bottom + ",left:" + left + "})";
        webView.evaluateJavascript(js, null);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(false);
        // 锁定当前显示比例，不跟随系统字体/显示大小缩放
        settings.setTextZoom(100);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setUserAgentString(settings.getUserAgentString() + " ClearCallShell/1.0");
        webView.setBackgroundColor(Color.parseColor("#FEFCFD"));
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);

        webView.addJavascriptInterface(new NativeBridge(), "ClearCallNative");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String scheme = uri.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                    appBaseUrl = url;
                }
                injectShellInsets();
                refreshShellStateInWeb();
                checkForUpdates(false);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showUrlDialog();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response != null && response.getStatusCode() >= 400) {
                    showUrlDialog();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false);
                } else {
                    geoCallback = callback;
                    geoOrigin = origin;
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                    }, REQ_LOCATION);
                }
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                    filePathCallback = null;
                }
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                            params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    fileChooserLauncher.launch(intent);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
            }
        });
    }

    private void setupBack() {
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WindowInsetsCompat insets = ViewCompat.getRootWindowInsets(root);
                if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
                    WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(
                            getWindow(), getWindow().getDecorView());
                    controller.hide(WindowInsetsCompat.Type.ime());
                    return;
                }
                webView.evaluateJavascript(
                        "(function(){try{return window.__handleAndroidBack?window.__handleAndroidBack():false}catch(e){return false}})()",
                        value -> {
                            boolean handled = value != null && value.contains("true");
                            if (handled) return;
                            long now = System.currentTimeMillis();
                            if (now - lastBackAt < 2000) {
                                finish();
                            } else {
                                lastBackAt = now;
                                Toast.makeText(MainActivity.this, "再按一次退出", Toast.LENGTH_SHORT).show();
                            }
                        });
            }
        });
    }

    private void showUrlDialog() {
        if (isFinishing() || urlDialogShowing) return;
        urlDialogShowing = true;
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("https://your-site.vercel.app");
        String current = prefs.getString(KEY_URL, null);
        input.setText(current == null ? BuildConfig.APP_URL : current);
        input.setSelectAllOnFocus(true);

        new AlertDialog.Builder(this)
                .setTitle("连接你的小手机")
                .setMessage("填写已部署的站点地址，下次会直接打开。")
                .setView(input)
                .setPositiveButton("打开", (dialog, which) -> {
                    String url = normalizeUrl(input.getText().toString());
                    if (url.isEmpty()) return;
                    prefs.edit().putString(KEY_URL, url).apply();
                    loadApp(url);
                })
                .setNegativeButton("退出", (dialog, which) -> finish())
                .setOnDismissListener(dialog -> urlDialogShowing = false)
                .show();
    }

    private String normalizeUrl(String raw) {
        String url = raw == null ? "" : raw.trim();
        if (url.isEmpty()) return "";
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            url = "https://" + url;
        }
        return url;
    }

    private void loadApp(String url) {
        appBaseUrl = url;
        webView.loadUrl(url);
    }

    // 每次部署网站后，Vercel 的部署 ID 会变；壳在启动/回前台时对比并提示更新
    private void checkForUpdates(boolean fromResume) {
        if (webView == null || appBaseUrl == null || appBaseUrl.isEmpty()) return;
        long now = System.currentTimeMillis();
        if (fromResume && now - lastUpdateCheckAt < UPDATE_CHECK_INTERVAL_MS) return;
        if (updateCheckRunning) return;
        lastUpdateCheckAt = now;
        updateCheckRunning = true;
        final String base = appBaseUrl;
        new Thread(() -> {
            JSONObject info = fetchVersionInfo(base);
            runOnUiThread(() -> {
                updateCheckRunning = false;
                if (isFinishing() || isDestroyed() || webView == null) return;
                if (info != null) handleVersionInfo(info);
            });
        }).start();
    }

    private JSONObject fetchVersionInfo(String base) {
        JSONObject info = fetchJson(buildVersionUrl(base, "/api/version"));
        if (info == null) info = fetchJson(buildVersionUrl(base, "/version.json"));
        return info;
    }

    private String buildVersionUrl(String base, String path) {
        try {
            URL u = new URL(base);
            String p = u.getPath() == null ? "" : u.getPath();
            while (p.endsWith("/")) p = p.substring(0, p.length() - 1);
            return new URL(u.getProtocol(), u.getHost(), u.getPort(),
                    p + path + "?t=" + System.currentTimeMillis()).toString();
        } catch (Exception e) {
            return base + path;
        }
    }

    private JSONObject fetchJson(String address) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(address).openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setUseCaches(false);
            conn.setInstanceFollowRedirects(true);
            conn.setRequestProperty("Cache-Control", "no-cache");
            conn.setRequestProperty("Accept", "application/json");
            if (conn.getResponseCode() != HttpURLConnection.HTTP_OK) return null;
            BufferedReader reader = new BufferedReader(
                    new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                sb.append(line);
                if (sb.length() > 65536) break;
            }
            reader.close();
            return new JSONObject(sb.toString());
        } catch (Exception e) {
            return null;
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void handleVersionInfo(JSONObject info) {
        String webVersion = info.optString("webVersion", "").trim();
        String notes = info.optString("notes", "").trim();
        int latestApkVersion = info.optInt("apkVersion", 0);
        String apkUrl = info.optString("apkUrl", "").trim();
        boolean apkNewer = latestApkVersion > BuildConfig.VERSION_CODE && !apkUrl.isEmpty();

        String stored = prefs.getString(KEY_WEB_VERSION, "");
        boolean firstRun = stored == null || stored.isEmpty();
        if (firstRun && !webVersion.isEmpty()) {
            prefs.edit().putString(KEY_WEB_VERSION, webVersion).apply();
            stored = webVersion;
        }
        boolean webNewer = !webVersion.isEmpty()
                && !"dev".equals(webVersion)
                && !webVersion.equals(stored);
        if (!webNewer && !apkNewer) return;

        String promptKey = apkNewer ? "apk:" + latestApkVersion : webVersion;
        if (promptKey.equals(sessionDismissedVersion)) return;
        if (updateDialogShowing) return;
        showUpdateDialog(webNewer ? webVersion : "", latestApkVersion, apkNewer, apkUrl, notes);
    }

    private void showUpdateDialog(String webVersion, int latestApkVersion, boolean apkNewer,
                                  String apkUrl, String notes) {
        StringBuilder message = new StringBuilder();
        if (apkNewer) {
            message.append("安装包有新版本。\n当前 ")
                    .append(BuildConfig.VERSION_NAME)
                    .append("，最新 ")
                    .append(latestApkVersion)
                    .append("。");
        } else {
            message.append("小手机有新内容。\n版本 ").append(shortVersion(webVersion)).append("。");
        }
        if (!notes.isEmpty()) message.append("\n").append(notes);
        message.append(apkNewer
                ? "\n\n点击更新会打开安装包下载页。"
                : "\n\n点击更新会刷新页面，不会丢失数据。");

        final String promptKey = apkNewer ? "apk:" + latestApkVersion : webVersion;
        updateDialogShowing = true;
        new AlertDialog.Builder(this)
                .setTitle("发现新版本")
                .setMessage(message.toString())
                .setPositiveButton("立即更新", (dialog, which) -> {
                    sessionDismissedVersion = promptKey;
                    if (apkNewer) {
                        openApkUrl(apkUrl);
                    } else {
                        applyWebUpdate(webVersion);
                    }
                })
                .setNegativeButton("稍后再说", (dialog, which) -> sessionDismissedVersion = promptKey)
                .setOnDismissListener(dialog -> updateDialogShowing = false)
                .show();
    }

    private String shortVersion(String version) {
        if (version == null || version.isEmpty()) return "最新";
        return version.length() > 8 ? version.substring(0, 8) : version;
    }

    private void applyWebUpdate(String webVersion) {
        prefs.edit().putString(KEY_WEB_VERSION, webVersion).apply();
        sessionDismissedVersion = webVersion;
        if (webView == null) return;
        webView.clearCache(true);
        webView.reload();
        Toast.makeText(this, "已更新到最新版本", Toast.LENGTH_SHORT).show();
    }

    private void openApkUrl(String apkUrl) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl)));
        } catch (Exception e) {
            Toast.makeText(this, "没能打开下载页，稍后再试", Toast.LENGTH_SHORT).show();
        }
    }

    private void refreshShellStateInWeb() {
        if (webView == null) return;
        webView.evaluateJavascript("window.__refreshShellState && window.__refreshShellState()", null);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) {
            webView.onResume();
            webView.resumeTimers();
        }
        injectShellHidden(false);
        refreshShellStateInWeb();
        checkForUpdates(true);
    }

    @Override
    protected void onPause() {
        super.onPause();
        injectShellHidden(true);
    }

    private void injectShellHidden(boolean hidden) {
        if (webView == null) return;
        webView.evaluateJavascript(
                "window.__setShellHidden&&window.__setShellHidden(" + hidden + ")", null);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_LOCATION && geoCallback != null) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            geoCallback.invoke(geoOrigin, granted, false);
            geoCallback = null;
            geoOrigin = null;
        } else if (requestCode == REQ_NOTIFICATION) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (!granted) prefs.edit().putBoolean(KEY_PUSH, false).apply();
            refreshShellStateInWeb();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("ClearCallNative");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private class NativeBridge {

        @JavascriptInterface
        public String getDeviceInfo() {
            try {
                DisplayMetrics dm = getResources().getDisplayMetrics();
                JSONObject info = new JSONObject();
                info.put("model", Build.MODEL == null ? "" : Build.MODEL);
                info.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
                info.put("width", dm.widthPixels);
                info.put("height", dm.heightPixels);
                info.put("density", dm.density);
                double inches = 0;
                if (dm.xdpi > 0 && dm.ydpi > 0) {
                    double w = dm.widthPixels / (double) dm.xdpi;
                    double h = dm.heightPixels / (double) dm.ydpi;
                    inches = Math.sqrt(w * w + h * h);
                }
                info.put("inches", Math.round(inches * 10) / 10.0);
                info.put("insetTop", insetTop);
                info.put("insetRight", insetRight);
                info.put("insetBottom", insetBottom);
                info.put("insetLeft", insetLeft);
                return info.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @JavascriptInterface
        public String getShellState() {
            try {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                JSONObject state = new JSONObject();
                state.put("native", true);
                state.put("batteryUnrestricted", pm != null && pm.isIgnoringBatteryOptimizations(getPackageName()));
                state.put("pushEnabled", prefs.getBoolean(KEY_PUSH, false));
                boolean granted = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    granted = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS)
                            == PackageManager.PERMISSION_GRANTED;
                }
                state.put("notificationsGranted", granted && NotificationHelper.areEnabled(MainActivity.this));
                return state.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        @SuppressLint("BatteryLife")
        @JavascriptInterface
        public void requestIgnoreBatteryOptimizations() {
            runOnUiThread(() -> {
                PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
                if (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    refreshShellStateInWeb();
                    return;
                }
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                            Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                } catch (Exception e) {
                    openBatteryOptimizationSettings();
                }
            });
        }

        @JavascriptInterface
        public void openBatteryOptimizationSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                } catch (Exception e) {
                    try {
                        startActivity(new Intent(Settings.ACTION_SETTINGS));
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void enableNativePush() {
            runOnUiThread(() -> {
                prefs.edit().putBoolean(KEY_PUSH, true).apply();
                NotificationHelper.ensureChannel(MainActivity.this);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                        && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATION);
                } else {
                    refreshShellStateInWeb();
                }
            });
        }

        @JavascriptInterface
        public void disableNativePush() {
            prefs.edit().putBoolean(KEY_PUSH, false).apply();
            runOnUiThread(MainActivity.this::refreshShellStateInWeb);
        }

        @JavascriptInterface
        public boolean notify(String title, String body) {
            if (!prefs.getBoolean(KEY_PUSH, false)) return false;
            if (Build.VERSION.SDK_INT >= 33
                    && ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) return false;
            PushWorker.enqueue(MainActivity.this, title, body, 0);
            return true;
        }

        @JavascriptInterface
        public void scheduleNotification(String title, String body, long delayMillis) {
            if (!prefs.getBoolean(KEY_PUSH, false)) return;
            PushWorker.enqueue(MainActivity.this, title, body, Math.max(0, delayMillis));
        }

        @JavascriptInterface
        public void saveTextFile(String filename, String content) {
            runOnUiThread(() -> {
                pendingSaveText = content == null ? "" : content;
                saveTextLauncher.launch(
                        filename == null || filename.trim().isEmpty() ? "clearcall.json" : filename);
            });
        }
    }
}

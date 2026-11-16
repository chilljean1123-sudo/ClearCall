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

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {

    private static final String PREFS = "clearcall_shell";
    private static final String KEY_URL = "app_url";
    private static final String KEY_PUSH = "native_push";
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

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

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
            webView.loadUrl(url);
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
                injectShellInsets();
                refreshShellStateInWeb();
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
                    webView.loadUrl(url);
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
        refreshShellStateInWeb();
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
        public void notify(String title, String body) {
            if (!prefs.getBoolean(KEY_PUSH, false)) return;
            PushWorker.enqueue(MainActivity.this, title, body, 0);
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

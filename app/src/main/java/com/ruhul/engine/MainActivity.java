package com.ruhul.engine;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Collections;

public class MainActivity extends Activity {

    private static final String HOME_URL = "file:///android_asset/home.html";

    // Only these hosts may be fetched through the app (the draw-history API).
    private static final String API_HOST_REGEX = "draw\\.ar-lottery0[1-3]\\.com";

    private static final int INK = Color.rgb(0x15, 0x11, 0x1c);

    private WebView web;
    private String script;
    private String userAgent;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window w = getWindow();
        w.setStatusBarColor(INK);
        w.setNavigationBarColor(INK);

        web = new WebView(this);
        web.setBackgroundColor(INK);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        // look like a normal mobile browser, not an embedded WebView
        userAgent = s.getUserAgentString().replace("; wv", "");
        s.setUserAgentString(userAgent);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookie(web, true);

        script = buildScript();
        web.addJavascriptInterface(new Bridge(), "RuhulBridge");

        final boolean docStart = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        if (docStart) {
            // runs in the main page and in every iframe (the game itself sits in an iframe)
            WebViewCompat.addDocumentStartJavaScript(web, script, Collections.singleton("*"));
        }

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme() == null ? "" : u.getScheme();
                String host = u.getHost() == null ? "" : u.getHost();
                boolean isWeb = scheme.equals("http") || scheme.equals("https");
                boolean social = host.endsWith("facebook.com") || host.endsWith("fb.me") || host.endsWith("fb.com");
                if (isWeb && !social) return false;
                if (request.isForMainFrame() || !isWeb) openOutside(u);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!docStart) view.evaluateJavascript(script, null);
            }
        });
        web.setWebChromeClient(new WebChromeClient());

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(HOME_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) web.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private void openOutside(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

    // ---------------------------------------------------------------- script
    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    private String buildScript() {
        return readAsset("bridge.js") + "\n" +
                "(function(){ if (typeof RuhulBridge === 'undefined') return;\n" +
                "var run = function(){\n" + readAsset("ruhul.user.js") + "\n};\n" +
                "if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();\n" +
                "})();";
    }

    // ---------------------------------------------------------------- bridge
    private class Bridge {
        private final SharedPreferences prefs = getSharedPreferences("ruhul", Context.MODE_PRIVATE);

        @JavascriptInterface
        public String getValue(String key) {
            return prefs.getString(key, null);
        }

        @JavascriptInterface
        public void setValue(String key, String value) {
            prefs.edit().putString(key, value).apply();
        }

        /** A real finger tap. x, y are CSS pixels of the top page, cssWidth is its visible width. */
        @JavascriptInterface
        public void tap(final float x, final float y, final float cssWidth) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    int vw = web.getWidth(), vh = web.getHeight();
                    float scale = cssWidth > 0 ? vw / cssWidth : getResources().getDisplayMetrics().density;
                    final float px = x * scale, py = y * scale;
                    if (px < 0 || py < 0 || px > vw || py > vh) return;
                    final long downTime = SystemClock.uptimeMillis();
                    MotionEvent down = MotionEvent.obtain(downTime, downTime, MotionEvent.ACTION_DOWN, px, py, 0);
                    down.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                    web.dispatchTouchEvent(down);
                    down.recycle();
                    web.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            MotionEvent up = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, px, py, 0);
                            up.setSource(InputDevice.SOURCE_TOUCHSCREEN);
                            web.dispatchTouchEvent(up);
                            up.recycle();
                        }
                    }, 70);
                }
            });
        }

        /** Keeps the screen on while auto bet runs (a sleeping phone stops the bot). */
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }

        /** GET for the draw-history API only. Returns "<status>\n<body>" or "ERR:<message>". */
        @JavascriptInterface
        public String httpGet(String url) {
            HttpURLConnection c = null;
            try {
                Uri u = Uri.parse(url);
                String host = u.getHost();
                if (!"https".equals(u.getScheme()) || host == null || !host.matches(API_HOST_REGEX)) {
                    return "ERR:blocked host";
                }
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(6000);
                c.setRequestProperty("Accept", "application/json");
                c.setRequestProperty("User-Agent", userAgent);
                int code = c.getResponseCode();
                InputStream in = code < 400 ? c.getInputStream() : c.getErrorStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                if (in != null) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                    in.close();
                }
                return code + "\n" + new String(out.toByteArray(), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "ERR:" + e.getMessage();
            } finally {
                if (c != null) c.disconnect();
            }
        }

        /** Saves the CSV into the Downloads folder. Returns a short message for the panel. */
        @JavascriptInterface
        public String saveCsv(String name, String csv) {
            try {
                byte[] data = csv.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver r = getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.MIME_TYPE, "text/csv");
                    Uri uri = r.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) return "Could not save the CSV.";
                    try (OutputStream os = r.openOutputStream(uri)) {
                        if (os == null) return "Could not save the CSV.";
                        os.write(data);
                    }
                    return "CSV saved in Downloads.";
                } else {
                    File f = new File(getExternalFilesDir(null), name);
                    try (FileOutputStream os = new FileOutputStream(f)) {
                        os.write(data);
                    }
                    return "CSV saved: " + f.getAbsolutePath();
                }
            } catch (Exception e) {
                return "Could not save the CSV: " + e.getMessage();
            }
        }
    }
}

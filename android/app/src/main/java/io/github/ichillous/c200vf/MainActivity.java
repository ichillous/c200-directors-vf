package io.github.ichillous.c200vf;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {

    /** Two renderer deaths closer than this means reloading is not helping: close instead. */
    private static final long RENDERER_LOOP_MS = 10_000;
    /** elapsedRealtime of the last renderer death in this process (survives recreate()). */
    private static long lastRendererGoneAt = 0;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins must be registered before the bridge is built in super.onCreate.
        registerPlugin(Diagnostics.class);
        super.onCreate(savedInstanceState);
        log('I', "activity_create", "restored", savedInstanceState != null);
        watchRenderer();
        hideSystemBars();
    }

    @Override
    public void onResume() {
        super.onResume();
        log('I', "activity_resume");
    }

    @Override
    public void onPause() {
        super.onPause();
        log('I', "activity_pause");
    }

    @Override
    public void onStop() {
        super.onStop();
        log('I', "activity_stop");
    }

    @Override
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        try {
            long availMem = 0;
            boolean lowMemory = false;
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) {
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                availMem = mi.availMem;
                lowMemory = mi.lowMemory;
            }
            // 10 RUNNING_LOW, 15 RUNNING_CRITICAL and 80 COMPLETE are the worrying levels.
            boolean warn = level == 10 || level == 15 || level >= 80;
            log(warn ? 'W' : 'I', "trim_memory", "level", level, "availMem", availMem, "lowMemory", lowMemory);
        } catch (Throwable ignored) {
            // Logging must never hurt the app.
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void log(char level, String event, Object... pairs) {
        try {
            LogStore.get(this).log(level, event, pairs);
        } catch (Throwable ignored) {
            // Logging must never hurt the app.
        }
    }

    /**
     * If the WebView's renderer process dies (crash, or killed for memory) the page is gone and
     * that WebView cannot be used again. Record it, then rebuild the activity (and with it a new
     * WebView) instead of letting the whole app crash. Diagnostics.startup() reports the record.
     */
    private void watchRenderer() {
        Bridge b = getBridge();
        if (b == null) return; // No WebView on this device: BridgeActivity showed its error screen.
        b.addWebViewListener(
            new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    long now = SystemClock.elapsedRealtime();
                    final boolean loop = lastRendererGoneAt != 0 && now - lastRendererGoneAt < RENDERER_LOOP_MS;
                    lastRendererGoneAt = now;
                    recordRendererGone(detail, loop ? "finish" : "recreate");
                    new Handler(Looper.getMainLooper()).post(() -> {
                        try {
                            if (isFinishing() || isDestroyed()) return;
                            if (loop) {
                                finish();
                            } else {
                                recreate();
                            }
                        } catch (Throwable t) {
                            finish();
                        }
                    });
                    // Handled: the system must not kill the app for it.
                    return true;
                }
            }
        );
    }

    private void recordRendererGone(RenderProcessGoneDetail detail, String action) {
        try {
            long at = System.currentTimeMillis();
            String didCrash = "?";
            String priority = "?";
            if (detail != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                didCrash = String.valueOf(detail.didCrash());
                priority = rendererPriorityName(detail.rendererPriorityAtExit());
            }
            String record =
                LogStore.RECORD_START_RENDERER +
                "at=" +
                at +
                " " +
                LogStore.kv("time", LogStore.timestamp(at)) +
                " " +
                LogStore.kv("didCrash", didCrash) +
                " " +
                LogStore.kv("rendererPriorityAtExit", priority) +
                " " +
                LogStore.kv("action", action) +
                " " +
                LogStore.kv("version", App.versionName() + " (" + App.versionCode() + ")") +
                "\n" +
                LogStore.RECORD_END +
                "\n";
            LogStore store = LogStore.get(this);
            store.writeRecordSync("renderer.txt", record, 500);
            store.appendSync(500);
        } catch (Throwable ignored) {
            // Never make a renderer death worse.
        }
    }

    private static String rendererPriorityName(int p) {
        switch (p) {
            case WebView.RENDERER_PRIORITY_WAIVED:
                return "waived";
            case WebView.RENDERER_PRIORITY_BOUND:
                return "bound";
            case WebView.RENDERER_PRIORITY_IMPORTANT:
                return "important";
            default:
                return String.valueOf(p);
        }
    }

    // Full screen, like a camera. Swipe from an edge to bring the bars back for a moment.
    private void hideSystemBars() {
        // Draw across the whole screen, including beside the front-camera cutout.
        // The app keeps that spot empty: the cutout sits in the gap in the side rail.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.hide(WindowInsetsCompat.Type.systemBars());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}

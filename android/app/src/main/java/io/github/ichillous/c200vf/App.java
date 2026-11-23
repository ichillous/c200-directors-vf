package io.github.ichillous.c200vf;

import android.app.Application;
import android.content.Context;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Process;
import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Installs the crash recorder before anything else runs. When the app crashes on a Java/Kotlin
 * exception, the record goes to logs/crash.txt synchronously, then the system's own handler
 * runs as usual (it reports the crash and ends the process). Diagnostics.startup() turns the
 * record into a crashes.log entry on the next launch.
 */
public class App extends Application {

    /** A stack trace longer than this is cut (a StackOverflowError can run to hundreds of KB). */
    private static final int MAX_STACK_CHARS = 64 * 1024;

    private static String versionName = "?";
    private static long versionCode = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        readVersion(this);
        installCrashHandler();
    }

    static String versionName() {
        return versionName;
    }

    static long versionCode() {
        return versionCode;
    }

    @SuppressWarnings("deprecation")
    private static void readVersion(Context context) {
        try {
            PackageInfo info = context.getPackageManager().getPackageInfo(context.getPackageName(), 0);
            versionName = info.versionName != null ? info.versionName : "?";
            versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode;
        } catch (Throwable ignored) {
            // Keep the defaults.
        }
    }

    private void installCrashHandler() {
        final Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        final Context context = getApplicationContext() != null ? getApplicationContext() : this;
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            try {
                recordCrash(context, thread, error);
            } catch (Throwable ignored) {
                // Never let the recorder hide the real crash.
            }
            if (previous != null) {
                previous.uncaughtException(thread, error);
            } else {
                Process.killProcess(Process.myPid());
                System.exit(10);
            }
        });
    }

    private static void recordCrash(Context context, Thread thread, Throwable error) {
        long now = System.currentTimeMillis();
        LogStore store = LogStore.get(context);
        StringBuilder b = new StringBuilder(4096);
        b.append(LogStore.RECORD_START_CRASH)
            .append("at=").append(now)
            .append(' ').append(LogStore.kv("time", LogStore.timestamp(now)))
            .append(' ').append(LogStore.kv("thread", thread != null ? thread.getName() : "?"))
            .append(' ').append(LogStore.kv("version", versionName + " (" + versionCode + ")"))
            .append('\n');
        String stack;
        try {
            // printStackTrace includes the "Caused by:" chain and suppressed exceptions.
            StringWriter sw = new StringWriter();
            PrintWriter pw = new PrintWriter(sw);
            error.printStackTrace(pw);
            pw.flush();
            stack = sw.toString();
            if (stack.length() > MAX_STACK_CHARS) {
                stack = stack.substring(0, MAX_STACK_CHARS) + "\n... (stack cut at 64 KB)\n";
            }
        } catch (Throwable t) {
            // Out of memory or similar: keep at least the exception's class.
            stack = (error != null ? error.getClass().getName() : "unknown") + "\n";
        }
        b.append(stack);
        if (!stack.endsWith("\n")) b.append('\n');
        b.append(LogStore.RECORD_END).append('\n');
        // Record first (most important), then flush any activity lines still queued.
        store.writeRecordSync("crash.txt", b.toString(), 500);
        store.appendSync(500);
    }
}

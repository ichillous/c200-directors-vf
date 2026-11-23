package io.github.ichillous.c200vf;

import android.Manifest;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import android.webkit.WebView;
import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Crash and activity logs for the web app. See logging-plan "Native <-> JS contract".
 *   info()      device, app and WebView facts for the report header
 *   startup()   turns crash records and Android's exit reasons since last time into log entries
 *   append()    adds activity lines (written on one background thread)
 *   readLogs()  crashes.log and the activity log, oldest first
 *   markSent()  remembers when logs were last sent
 * Every method resolves or rejects; none of them can crash the app on an IO error.
 */
@CapacitorPlugin(name = "Diagnostics")
public class Diagnostics extends Plugin {

    static final String PREFS = "c200vf.diagnostics";
    private static final String KEY_LAST_PROCESSED = "lastProcessedAt";
    private static final String KEY_LAST_SENT = "lastSentAt";
    private static final String KEY_ORPHAN_CRASH = "orphanCrashAt";

    private static final int ANR_TRACE_MAX_BYTES = 32 * 1024;
    /** A Java crash record and Android's exit record for it are matched if this close in time. */
    private static final long MATCH_WINDOW_MS = 30_000;

    /** True once startup() has run in this process; a later call (activity recreated) is warm. */
    private static final AtomicBoolean startedInProcess = new AtomicBoolean(false);
    /** The last exit found by this process's first startup(), returned again on warm calls. */
    private static volatile JSONObject lastExitSeen = null;

    private LogStore store() {
        return LogStore.get(getContext());
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------- info ----------

    @PluginMethod
    public void info(PluginCall call) {
        try {
            Context ctx = getContext();
            JSObject r = new JSObject();
            r.put("versionName", App.versionName());
            r.put("versionCode", App.versionCode());
            r.put("manufacturer", nz(Build.MANUFACTURER));
            r.put("model", nz(Build.MODEL));
            r.put("androidRelease", nz(Build.VERSION.RELEASE));
            r.put("sdk", Build.VERSION.SDK_INT);
            r.put("securityPatch", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? nz(Build.VERSION.SECURITY_PATCH) : "");

            String wvPackage = "";
            String wvVersion = "";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    PackageInfo wv = WebView.getCurrentWebViewPackage();
                    if (wv != null) {
                        wvPackage = nz(wv.packageName);
                        wvVersion = nz(wv.versionName);
                    }
                } catch (Throwable ignored) {
                    // Leave blank.
                }
            }
            r.put("webviewPackage", wvPackage);
            r.put("webviewVersion", wvVersion);

            long memTotal = 0;
            long memAvail = 0;
            boolean lowMemory = false;
            try {
                ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
                if (am != null) {
                    ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                    am.getMemoryInfo(mi);
                    memTotal = mi.totalMem;
                    memAvail = mi.availMem;
                    lowMemory = mi.lowMemory;
                }
            } catch (Throwable ignored) {
                // Leave zeros.
            }
            r.put("memTotal", memTotal);
            r.put("memAvail", memAvail);
            r.put("lowMemory", lowMemory);

            boolean camera = false;
            try {
                camera = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
            } catch (Throwable ignored) {
                // Leave false.
            }
            r.put("cameraGranted", camera);

            long uptime = 0;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                uptime = Math.max(0, SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime());
            }
            r.put("processUptimeMs", uptime);
            r.put("lastSentAt", prefs().getLong(KEY_LAST_SENT, 0));
            call.resolve(r);
        } catch (Throwable t) {
            call.reject("info failed: " + t, "INFO_FAILED");
        }
    }

    // ---------- append / readLogs / markSent ----------

    @PluginMethod
    public void append(PluginCall call) {
        try {
            JSArray arr = call.getArray("lines");
            if (arr == null) {
                call.reject("lines must be an array of strings", "BAD_ARGS");
                return;
            }
            List<String> lines = new ArrayList<>(arr.length());
            for (int i = 0; i < arr.length(); i++) {
                Object o = arr.opt(i);
                if (o instanceof String) lines.add((String) o);
            }
            store().append(lines);
            call.resolve();
        } catch (Throwable t) {
            call.reject("append failed: " + t, "APPEND_FAILED");
        }
    }

    @PluginMethod
    public void readLogs(PluginCall call) {
        try {
            final LogStore s = store();
            // On the log thread, after every queued line has been written.
            s.submit(() -> {
                try {
                    JSObject r = new JSObject();
                    r.put("crashes", s.readCrashes());
                    r.put("activity", s.readActivity());
                    call.resolve(r);
                } catch (Throwable t) {
                    call.reject("readLogs failed: " + t, "READ_FAILED");
                }
            });
        } catch (Throwable t) {
            call.reject("readLogs failed: " + t, "READ_FAILED");
        }
    }

    @PluginMethod
    public void markSent(PluginCall call) {
        try {
            prefs().edit().putLong(KEY_LAST_SENT, System.currentTimeMillis()).apply();
            call.resolve();
        } catch (Throwable t) {
            call.reject("markSent failed: " + t, "MARK_FAILED");
        }
    }

    // ---------- startup ----------

    @PluginMethod
    public void startup(PluginCall call) {
        final boolean cold = startedInProcess.compareAndSet(false, true);
        try {
            final LogStore s = store();
            s.submit(() -> {
                try {
                    call.resolve(processExits(s, cold));
                } catch (Throwable t) {
                    call.reject("startup failed: " + t, "STARTUP_FAILED");
                }
            });
        } catch (Throwable t) {
            call.reject("startup failed: " + t, "STARTUP_FAILED");
        }
    }

    /** Something that ended the app (or its web page) since the last startup(). */
    private static final class Exit {

        long at;
        String reason;
        String description = "";
        /** key=value pairs for the entry's second line and the activity line. */
        final List<String> fields = new ArrayList<>();
        /** Stack trace, ANR trace or record text. */
        String body = "";
        /** First line of a Java stack ("java.lang.Foo: message"). */
        String exception = "";

        boolean isCrash() {
            return isCrashReason(reason);
        }
    }

    /** A record from crash.txt or renderer.txt. */
    private static final class Record {

        long at;
        String header;
        String body;
        boolean used;
    }

    static boolean isCrashReason(String reason) {
        switch (reason) {
            case "crash":
            case "crash_native":
            case "anr":
            case "low_memory":
            case "renderer_gone":
            case "initialization_failure":
                return true;
            default:
                return false;
        }
    }

    /** Runs on the log thread. */
    private JSObject processExits(LogStore s, boolean cold) {
        Context ctx = getContext();
        SharedPreferences prefs = prefs();
        long lastProcessed = prefs.getLong(KEY_LAST_PROCESSED, -1);
        if (lastProcessed < 0) {
            // First run with diagnostics: skip exits from before this version was installed.
            lastProcessed = installTime(ctx);
        }
        long orphanCrashAt = prefs.getLong(KEY_ORPHAN_CRASH, 0);
        long newestSeen = lastProcessed;

        List<Record> crashRecords = parseRecords(s.takeRecords("crash.txt"), LogStore.RECORD_START_CRASH);
        List<Record> rendererRecords = parseRecords(s.takeRecords("renderer.txt"), LogStore.RECORD_START_RENDERER);
        List<Exit> exits = new ArrayList<>();

        // Android's own record of how earlier processes ended (Android 11+).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            List<Exit> system = systemExits(ctx, lastProcessed);
            for (Exit e : system) {
                newestSeen = Math.max(newestSeen, e.at);
                if ("crash".equals(e.reason)) {
                    Record match = closestRecord(crashRecords, e.at);
                    if (match != null) {
                        match.used = true;
                        e.fields.add(match.header);
                        e.body = match.body;
                        e.exception = firstLine(match.body);
                    } else if (orphanCrashAt > 0 && Math.abs(e.at - orphanCrashAt) <= MATCH_WINDOW_MS) {
                        // Already reported from crash.txt on an earlier launch, before Android had
                        // recorded the exit. Do not count it twice.
                        continue;
                    }
                }
                exits.add(e);
            }
        }

        long newOrphan = 0;
        for (Record r : crashRecords) {
            if (r.used || r.at <= lastProcessed) continue;
            Exit e = new Exit();
            e.at = r.at;
            e.reason = "crash";
            e.fields.add(r.header);
            e.body = r.body;
            e.exception = firstLine(r.body);
            e.description = e.exception;
            exits.add(e);
            newestSeen = Math.max(newestSeen, r.at);
            newOrphan = Math.max(newOrphan, r.at);
        }
        for (Record r : rendererRecords) {
            if (r.at <= lastProcessed) continue;
            Exit e = new Exit();
            e.at = r.at;
            e.reason = "renderer_gone";
            e.description = "WebView renderer process ended";
            e.fields.add(r.header);
            e.body = r.body;
            exits.add(e);
            newestSeen = Math.max(newestSeen, r.at);
        }

        Collections.sort(exits, (a, b) -> Long.compare(a.at, b.at));

        List<String> entries = new ArrayList<>();
        List<String> lines = new ArrayList<>();
        JSONArray summaries = new JSONArray();
        int newCrashes = 0;
        for (Exit e : exits) {
            String when = LogStore.timestamp(e.at);
            StringBuilder entry = new StringBuilder();
            entry.append(when).append(' ').append(e.reason).append('\n');
            entry.append(LogStore.kv("description", e.description));
            for (String f : e.fields) {
                if (f != null && !f.isEmpty()) entry.append(' ').append(f);
            }
            entry.append('\n');
            if (e.body != null && !e.body.isEmpty()) entry.append(e.body);

            boolean crash = e.isCrash();
            List<Object> kv = new ArrayList<>();
            kv.add("reason");
            kv.add(e.reason);
            kv.add("at");
            kv.add(when);
            kv.add("desc");
            kv.add(e.description);
            if (!e.exception.isEmpty() && !e.exception.equals(e.description)) {
                kv.add("exc");
                kv.add(e.exception);
            }
            lines.add(LogStore.line(crash ? 'E' : 'I', "prior_exit", kv.toArray()));

            if (crash) {
                entries.add(entry.toString());
                newCrashes++;
                String detail = !e.exception.isEmpty() ? e.exception : e.description;
                String summary = when + " " + e.reason + (detail.isEmpty() ? "" : " " + LogStore.scrub(detail));
                summaries.put(summary.length() > 200 ? summary.substring(0, 200) : summary);
            }
        }

        s.addCrashEntries(entries);
        s.appendSync(2000, lines.toArray(new String[0]));

        SharedPreferences.Editor edit = prefs.edit().putLong(KEY_LAST_PROCESSED, newestSeen);
        if (newOrphan > 0) edit.putLong(KEY_ORPHAN_CRASH, newOrphan);
        edit.commit();

        JSObject r = new JSObject();
        r.put("cold", cold);
        if (!exits.isEmpty()) {
            Exit last = exits.get(exits.size() - 1);
            JSONObject le = new JSONObject();
            try {
                le.put("reason", last.reason);
                le.put("description", LogStore.scrub(last.description));
                le.put("at", last.at);
                lastExitSeen = le;
            } catch (Throwable ignored) {
                // Keep the previous one.
            }
        }
        JSONObject le = lastExitSeen;
        r.put("lastExit", le != null ? le : JSONObject.NULL);
        r.put("newCrashes", newCrashes);
        r.put("crashSummaries", summaries);
        return r;
    }

    @RequiresApi(api = Build.VERSION_CODES.R)
    private static List<Exit> systemExits(Context ctx, long after) {
        List<Exit> out = new ArrayList<>();
        try {
            ActivityManager am = (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return out;
            List<ApplicationExitInfo> infos = am.getHistoricalProcessExitReasons(ctx.getPackageName(), 0, 0);
            if (infos == null) return out;
            for (ApplicationExitInfo info : infos) {
                if (info.getTimestamp() <= after) continue;
                Exit e = new Exit();
                e.at = info.getTimestamp();
                e.reason = reasonName(info.getReason());
                e.description = nz(info.getDescription());
                e.fields.add(LogStore.kv("importance", info.getImportance()));
                e.fields.add(LogStore.kv("status", info.getStatus()));
                e.fields.add(LogStore.kv("pssKb", info.getPss()));
                e.fields.add(LogStore.kv("rssKb", info.getRss()));
                if (info.getReason() == ApplicationExitInfo.REASON_ANR) {
                    e.body = anrTrace(info);
                }
                // Native crashes: no tombstone dump, the reason and description are enough.
                out.add(e);
            }
        } catch (Throwable t) {
            android.util.Log.w(LogStore.TAG, "exit reasons unavailable", t);
        }
        return out;
    }

    @RequiresApi(api = Build.VERSION_CODES.R)
    private static String anrTrace(ApplicationExitInfo info) {
        InputStream in = null;
        try {
            in = info.getTraceInputStream();
            if (in == null) return "";
            return "ANR trace:\n" + LogStore.readCapped(in, ANR_TRACE_MAX_BYTES);
        } catch (Throwable t) {
            return "ANR trace unavailable: " + LogStore.scrub(String.valueOf(t)) + "\n";
        } finally {
            if (in != null) {
                try {
                    in.close();
                } catch (Throwable ignored) {
                    // Nothing to do.
                }
            }
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.R)
    static String reasonName(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_CRASH:
                return "crash";
            case ApplicationExitInfo.REASON_CRASH_NATIVE:
                return "crash_native";
            case ApplicationExitInfo.REASON_ANR:
                return "anr";
            case ApplicationExitInfo.REASON_LOW_MEMORY:
                return "low_memory";
            case ApplicationExitInfo.REASON_USER_REQUESTED:
                return "user_requested";
            case ApplicationExitInfo.REASON_EXIT_SELF:
                return "exit_self";
            case ApplicationExitInfo.REASON_SIGNALED:
                return "signaled";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE:
                return "excessive_resource";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE:
                return "initialization_failure";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE:
                return "permission_change";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED:
                return "dependency_died";
            case ApplicationExitInfo.REASON_UNKNOWN:
                return "unknown";
            default:
                // REASON_OTHER, REASON_USER_STOPPED and reasons added after Android 11.
                return "other";
        }
    }

    /** The crash record written closest to an exit (and not after it by more than a few seconds). */
    private static Record closestRecord(List<Record> records, long exitAt) {
        Record best = null;
        long bestGap = Long.MAX_VALUE;
        for (Record r : records) {
            if (r.used) continue;
            long gap = exitAt - r.at;
            if (gap < -5_000 || gap > MATCH_WINDOW_MS) continue;
            long abs = Math.abs(gap);
            if (abs < bestGap) {
                bestGap = abs;
                best = r;
            }
        }
        return best;
    }

    /**
     * Records look like:
     *   @@crash at=1763924531482 time=... thread=main version="1.0.5 (5)"
     *   ...body lines...
     *   @@end
     * A record cut short by the process dying (no @@end) runs to the next record or the end.
     */
    private static List<Record> parseRecords(String text, String startMarker) {
        List<Record> out = new ArrayList<>();
        if (text == null || text.isEmpty()) return out;
        Record cur = null;
        StringBuilder body = new StringBuilder();
        for (String l : text.split("\n", -1)) {
            if (l.startsWith(startMarker)) {
                if (cur != null) {
                    cur.body = body.toString();
                    out.add(cur);
                }
                cur = new Record();
                body.setLength(0);
                String rest = l.substring(startMarker.length()).trim();
                cur.at = parseAt(rest);
                // Keep the header's fields, without the raw at=ms (the entry shows the time).
                int sp = rest.indexOf(' ');
                cur.header = rest.startsWith("at=") ? (sp >= 0 ? rest.substring(sp + 1) : "") : rest;
            } else if (l.equals(LogStore.RECORD_END)) {
                if (cur != null) {
                    cur.body = body.toString();
                    out.add(cur);
                    cur = null;
                    body.setLength(0);
                }
            } else if (cur != null) {
                body.append(l).append('\n');
            }
        }
        if (cur != null) {
            cur.body = body.toString();
            out.add(cur);
        }
        return out;
    }

    private static long parseAt(String header) {
        try {
            if (!header.startsWith("at=")) return 0;
            int end = header.indexOf(' ');
            return Long.parseLong(end >= 0 ? header.substring(3, end) : header.substring(3));
        } catch (Throwable t) {
            return 0;
        }
    }

    private static String firstLine(String s) {
        if (s == null) return "";
        int nl = s.indexOf('\n');
        return (nl >= 0 ? s.substring(0, nl) : s).trim();
    }

    private static long installTime(Context ctx) {
        try {
            PackageInfo pi = ctx.getPackageManager().getPackageInfo(ctx.getPackageName(), 0);
            return pi.lastUpdateTime;
        } catch (Throwable t) {
            return 0;
        }
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }
}

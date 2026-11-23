package io.github.ichillous.c200vf;

import android.content.Context;
import android.util.Log;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

/**
 * The app's log files, in getNoBackupFilesDir()/logs/:
 *   activity.log, activity.1.log  what happened, one line each, rotated at 256 KB (one backup)
 *   crashes.log                   the last 20 crash entries, separated by ENTRY_DELIMITER lines
 *   crash.txt                     Java crash records written by App's uncaught-exception handler
 *   renderer.txt                  WebView renderer-gone records written by MainActivity
 * crash.txt and renderer.txt are read and cleared by Diagnostics.startup().
 *
 * Normal appends go through one background thread. The crash paths write synchronously.
 * Nothing here throws: IO errors are swallowed (and logged to logcat) so logging can never
 * take the app down.
 */
final class LogStore {

    static final String TAG = "C200vfLog";
    static final Charset UTF8 = Charset.forName("UTF-8");

    static final long ACTIVITY_MAX_BYTES = 256 * 1024;
    static final int MAX_CRASH_ENTRIES = 20;
    static final int MAX_LINE_CHARS = 8 * 1024;
    /** A line on its own between two entries in crashes.log. */
    static final String ENTRY_DELIMITER = "~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~";

    static final String RECORD_START_CRASH = "@@crash ";
    static final String RECORD_START_RENDERER = "@@renderer ";
    static final String RECORD_END = "@@end";

    private static volatile LogStore instance;

    static LogStore get(Context context) {
        LogStore s = instance;
        if (s == null) {
            synchronized (LogStore.class) {
                s = instance;
                if (s == null) {
                    Context app = context.getApplicationContext();
                    s = new LogStore(app != null ? app : context);
                    instance = s;
                }
            }
        }
        return s;
    }

    private final File dir;
    private final ReentrantLock lock = new ReentrantLock();
    private final ConcurrentLinkedQueue<String> pending = new ConcurrentLinkedQueue<>();
    private final ExecutorService executor = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "C200vfLogs");
        t.setDaemon(true);
        return t;
    });

    private LogStore(Context context) {
        File base;
        try {
            base = context.getNoBackupFilesDir();
        } catch (Throwable t) {
            base = context.getFilesDir();
        }
        dir = new File(base, "logs");
    }

    File dir() {
        return dir;
    }

    File file(String name) {
        return new File(dir, name);
    }

    // ---------- line format ----------

    /** 2026-11-23T14:02:11.482-05:00 (local time with its UTC offset). */
    static String timestamp(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS", Locale.US);
        TimeZone tz = TimeZone.getDefault();
        f.setTimeZone(tz);
        int offsetMin = tz.getOffset(ms) / 60000;
        char sign = offsetMin < 0 ? '-' : '+';
        offsetMin = Math.abs(offsetMin);
        return f.format(new Date(ms)) + String.format(Locale.US, "%c%02d:%02d", sign, offsetMin / 60, offsetMin % 60);
    }

    /** Cut at 500 characters, newlines become " | ". Used for error messages and descriptions. */
    static String scrub(String s) {
        if (s == null) return "";
        String one = s.replace("\r\n", " | ").replace('\r', ' ').replace("\n", " | ");
        return one.length() > 500 ? one.substring(0, 500) : one;
    }

    /** k=v, quoted as k="a b" when the value has spaces, quotes or is empty. */
    static String kv(String key, Object value) {
        String v = value == null ? "" : scrub(String.valueOf(value));
        boolean quote = v.isEmpty() || v.indexOf(' ') >= 0 || v.indexOf('"') >= 0 || v.indexOf('=') >= 0;
        if (!quote) return key + "=" + v;
        return key + "=\"" + v.replace("\"", "'") + "\"";
    }

    /** One activity line: time, level (I, W or E), event, then key/value pairs (key, value, key, value...). */
    static String line(char level, String event, Object... pairs) {
        StringBuilder b = new StringBuilder(64);
        b.append(timestamp(System.currentTimeMillis())).append(' ').append(level).append(' ').append(event);
        for (int i = 0; i + 1 < pairs.length; i += 2) {
            b.append(' ').append(kv(String.valueOf(pairs[i]), pairs[i + 1]));
        }
        return b.toString();
    }

    private static String oneLine(String s) {
        if (s == null) return "";
        String one = s.replace("\r\n", " | ").replace('\r', ' ').replace("\n", " | ");
        return one.length() > MAX_LINE_CHARS ? one.substring(0, MAX_LINE_CHARS) : one;
    }

    // ---------- activity log ----------

    /** Queue a native line (see line()) for the background writer. */
    void log(char level, String event, Object... pairs) {
        try {
            append(java.util.Collections.singletonList(line(level, event, pairs)));
        } catch (Throwable t) {
            Log.w(TAG, "log failed", t);
        }
    }

    /** Queue lines for the background writer. Never blocks on disk. */
    void append(List<String> lines) {
        for (String l : lines) {
            if (l != null && !l.isEmpty()) pending.add(oneLine(l));
        }
        try {
            executor.execute(this::drainLocked);
        } catch (Throwable t) {
            Log.w(TAG, "append not scheduled", t);
        }
    }

    /** Run work on the log thread, after every line queued before it has been written. */
    void submit(Runnable work) {
        executor.execute(() -> {
            drainLocked();
            work.run();
        });
    }

    private void drainLocked() {
        lock.lock();
        try {
            drain();
        } finally {
            lock.unlock();
        }
    }

    /** Write queued lines. Caller holds the lock. */
    private void drain() {
        if (pending.isEmpty()) return;
        StringBuilder b = new StringBuilder();
        String l;
        while ((l = pending.poll()) != null) {
            b.append(l).append('\n');
        }
        writeActivity(b.toString());
    }

    /** Append text to activity.log, rotating first if it is full. Caller holds the lock. */
    private void writeActivity(String text) {
        try {
            ensureDir();
            File cur = file("activity.log");
            if (cur.length() >= ACTIVITY_MAX_BYTES) {
                File backup = file("activity.1.log");
                if (backup.exists() && !backup.delete()) Log.w(TAG, "could not delete activity.1.log");
                if (!cur.renameTo(backup)) Log.w(TAG, "could not rotate activity.log");
            }
            appendFile(cur, text);
        } catch (Throwable t) {
            Log.w(TAG, "activity write failed", t);
        }
    }

    /**
     * Write lines now, on the calling thread (crash and renderer-gone paths). Waits at most
     * waitMs for the background writer; if it cannot get the lock it gives up quietly.
     */
    boolean appendSync(long waitMs, String... lines) {
        for (String l : lines) {
            if (l != null) pending.add(oneLine(l));
        }
        boolean locked = false;
        try {
            locked = lock.tryLock(waitMs, TimeUnit.MILLISECONDS);
            if (!locked) return false;
            drain();
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "sync append failed", t);
            return false;
        } finally {
            if (locked) lock.unlock();
        }
    }

    // ---------- crash records (synchronous) ----------

    /** Append a pending record to crash.txt or renderer.txt. Synchronous, never throws. */
    boolean writeRecordSync(String fileName, String record, long waitMs) {
        boolean locked = false;
        try {
            locked = lock.tryLock(waitMs, TimeUnit.MILLISECONDS);
            // Write even without the lock: a lost record is worse than a rare interleaving.
            ensureDir();
            appendFile(file(fileName), record);
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "record write failed", t);
            return false;
        } finally {
            if (locked) lock.unlock();
        }
    }

    // ---------- crashes.log ----------

    /** Add entries (oldest first) to crashes.log, keeping the last 20. Call on the log thread. */
    void addCrashEntries(List<String> entries) {
        if (entries.isEmpty()) return;
        lock.lock();
        try {
            ensureDir();
            File f = file("crashes.log");
            List<String> all = splitEntries(readText(f));
            for (String e : entries) all.add(trimNewlines(e));
            int from = Math.max(0, all.size() - MAX_CRASH_ENTRIES);
            StringBuilder b = new StringBuilder();
            for (int i = from; i < all.size(); i++) {
                if (i > from) b.append(ENTRY_DELIMITER).append('\n');
                b.append(all.get(i)).append('\n');
            }
            File tmp = file("crashes.log.tmp");
            writeFile(tmp, b.toString());
            if (!tmp.renameTo(f)) {
                writeFile(f, b.toString());
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            }
        } catch (Throwable t) {
            Log.w(TAG, "crashes.log write failed", t);
        } finally {
            lock.unlock();
        }
    }

    static List<String> splitEntries(String text) {
        List<String> out = new ArrayList<>();
        if (text == null || text.trim().isEmpty()) return out;
        StringBuilder cur = new StringBuilder();
        for (String l : text.split("\n", -1)) {
            if (l.equals(ENTRY_DELIMITER)) {
                String e = trimNewlines(cur.toString());
                if (!e.isEmpty()) out.add(e);
                cur.setLength(0);
            } else {
                cur.append(l).append('\n');
            }
        }
        String e = trimNewlines(cur.toString());
        if (!e.isEmpty()) out.add(e);
        return out;
    }

    private static String trimNewlines(String s) {
        int start = 0;
        int end = s.length();
        while (start < end && s.charAt(start) == '\n') start++;
        while (end > start && (s.charAt(end - 1) == '\n' || s.charAt(end - 1) == '\r')) end--;
        return s.substring(start, end);
    }

    // ---------- reading ----------

    /** crashes.log as text. Call on the log thread. */
    String readCrashes() {
        lock.lock();
        try {
            return readText(file("crashes.log"));
        } finally {
            lock.unlock();
        }
    }

    /** activity.1.log then activity.log, oldest first. Call on the log thread. */
    String readActivity() {
        lock.lock();
        try {
            drain();
            return readText(file("activity.1.log")) + readText(file("activity.log"));
        } finally {
            lock.unlock();
        }
    }

    /** Read a pending-record file and delete it. Call on the log thread. */
    String takeRecords(String fileName) {
        lock.lock();
        try {
            File f = file(fileName);
            if (!f.exists()) return "";
            String text = readText(f);
            if (!f.delete()) {
                // Could not delete: empty it instead so records are not reported twice.
                try {
                    writeFile(f, "");
                } catch (Throwable t) {
                    Log.w(TAG, "could not clear " + fileName, t);
                }
            }
            return text;
        } finally {
            lock.unlock();
        }
    }

    // ---------- file helpers ----------

    private void ensureDir() {
        if (!dir.isDirectory() && !dir.mkdirs() && !dir.isDirectory()) {
            Log.w(TAG, "could not create " + dir);
        }
    }

    private static void appendFile(File f, String text) throws IOException {
        OutputStream out = new FileOutputStream(f, true);
        try {
            out.write(text.getBytes(UTF8));
            out.flush();
        } finally {
            out.close();
        }
    }

    private static void writeFile(File f, String text) throws IOException {
        OutputStream out = new FileOutputStream(f, false);
        try {
            out.write(text.getBytes(UTF8));
            out.flush();
        } finally {
            out.close();
        }
    }

    /** Whole file as UTF-8, or "" if it is missing or unreadable. */
    static String readText(File f) {
        if (f == null || !f.exists()) return "";
        try {
            InputStream in = new FileInputStream(f);
            try {
                return readCapped(in, Integer.MAX_VALUE);
            } finally {
                in.close();
            }
        } catch (Throwable t) {
            Log.w(TAG, "read failed: " + f.getName(), t);
            return "";
        }
    }

    /** Read at most maxBytes from a stream; adds a note if it was cut. Does not close the stream. */
    static String readCapped(InputStream in, int maxBytes) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        boolean cut = false;
        int n;
        while ((n = in.read(chunk)) != -1) {
            int room = maxBytes - buf.size();
            if (n > room) {
                buf.write(chunk, 0, Math.max(0, room));
                cut = true;
                break;
            }
            buf.write(chunk, 0, n);
        }
        String s = new String(buf.toByteArray(), UTF8);
        if (cut) s += "\n... (cut at " + (maxBytes / 1024) + " KB)\n";
        return s;
    }
}

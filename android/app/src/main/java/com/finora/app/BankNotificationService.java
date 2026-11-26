package com.finora.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Listens ONLY to notifications from the bank apps the user selected in FINORA.
 * Everything else is ignored immediately. OTP / PIN / password messages are discarded
 * before anything is stored. Eligible text stays on the device (queue) until the app
 * parses it; only structured transaction fields are synced to the cloud by the app.
 */
public class BankNotificationService extends NotificationListenerService {
    static final String PREFS = "finora_native";
    static final String KEY_PACKAGES = "allowed_packages";
    static final String KEY_QUEUE = "queue";
    static final String TEST_PREFIX = "FINORA TEST";

    private static final Pattern SENSITIVE = Pattern.compile(
        "(?i)\\b(otp|one[- ]?time|verification code|passcode|password|cvv|mpin|m-pin|upi pin|do not share|never share)\\b");
    private static final Pattern MONEY = Pattern.compile(
        "(?i)(rs\\.?|inr|\\u20B9)\\s*[0-9]|\\b(debited|credited|withdrawn|deposited)\\b");

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            Context ctx = getApplicationContext();
            String pkg = sbn.getPackageName();
            Notification n = sbn.getNotification();
            if (n == null || n.extras == null) return;
            Bundle ex = n.extras;
            CharSequence t = ex.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence tx = ex.getCharSequence(Notification.EXTRA_BIG_TEXT);
            if (tx == null) tx = ex.getCharSequence(Notification.EXTRA_TEXT);
            String title = t == null ? "" : t.toString();
            String text = tx == null ? "" : tx.toString();

            boolean test = pkg.equals(ctx.getPackageName());
            if (test) {
                if (!(title + text).startsWith(TEST_PREFIX)) return; // never read our own other notifications
            } else {
                Set<String> allowed = getPrefs(ctx).getStringSet(KEY_PACKAGES, new HashSet<String>());
                if (!allowed.contains(pkg)) return; // not a selected bank app -> ignore
                if (SENSITIVE.matcher(title + " " + text).find()) return; // discard OTP/PIN etc.
                if (!MONEY.matcher(title + " " + text).find()) return; // not a transaction
            }

            JSONObject o = new JSONObject();
            o.put("id", pkg + ":" + sbn.getPostTime() + ":" + Math.abs((title + text).hashCode()));
            o.put("pkg", pkg);
            o.put("title", title);
            o.put("text", text);
            o.put("ts", sbn.getPostTime());
            o.put("test", test);
            push(ctx, o);
            if (!test) handlePayment(ctx, title + " " + text, o.optString("id"));
            FinoraNativePlugin.pingJs();
        } catch (Exception ignored) {
        }
    }

    private static final Pattern AMOUNT = Pattern.compile("(?i)(?:rs\\.?|inr|\\u20B9)\\s*([0-9,]+(?:\\.[0-9]{1,2})?)");
    private static final Pattern AMOUNT2 = Pattern.compile("(?i)\\b(?:debited|debit)\\s+(?:by|with|for|of)?\\s*(?:rs\\.?|inr|\\u20B9)?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)");
    private static final Pattern IS_DEBIT = Pattern.compile("(?i)\\b(debited|debit|spent|withdrawn|paid|sent|purchase|transferred to)\\b");
    private static final Pattern IS_CREDIT = Pattern.compile("(?i)\\b(credited|credit|received|deposited|refund)\\b");

    /** For debits: ask the user what the payment was for, and keep the Spending Guard's "spent today" current even if the app is closed. */
    private void handlePayment(Context ctx, String all, String pid) {
        try {
            boolean debit = IS_DEBIT.matcher(all).find() && !(IS_CREDIT.matcher(all).find() && all.toLowerCase(Locale.ROOT).indexOf("credit") < all.toLowerCase(Locale.ROOT).indexOf("debit"));
            if (!debit) return;
            Matcher m = AMOUNT2.matcher(all);
            if (!m.find()) { m = AMOUNT.matcher(all); if (!m.find()) return; }
            double amt = Double.parseDouble(m.group(1).replace(",", ""));
            if (amt <= 0) return;
            SharedPreferences p = getPrefs(ctx);
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
            float spent = today.equals(p.getString("guard_date", "")) ? p.getFloat("guard_spent", 0f) : 0f;
            p.edit().putString("guard_date", today).putFloat("guard_spent", spent + (float) amt).apply();
            if (FinoraNativePlugin.visible) return; // app is open: the in-app popup asks instead
            int nid = Math.abs(pid.hashCode());
            askPurpose(ctx, amt, nid);
            if (android.provider.Settings.canDrawOverlays(ctx)) { // permission lets a popup appear over other apps
                Intent i = new Intent(ctx, PurposeActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                i.putExtra("pid", pid).putExtra("nid", nid).putExtra("amount", Math.round(amt));
                ctx.startActivity(i);
            }
        } catch (Exception ignored) {
        }
    }

    private void askPurpose(Context c, double amt, int nid) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26)
            nm.createNotificationChannel(new NotificationChannel("finora_payments", "Payment questions", NotificationManager.IMPORTANCE_HIGH));
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        if (open == null) return;
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, 7, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(c, "finora_payments")
            .setSmallIcon(android.R.drawable.stat_notify_more)
            .setContentTitle("Payment detected")
            .setContentText("\u20B9" + Math.round(amt) + " paid. Tap to tell FINORA what it was for.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build();
        nm.notify(nid, n);
    }

    static SharedPreferences getPrefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized void push(Context c, JSONObject o) throws Exception {
        SharedPreferences p = getPrefs(c);
        JSONArray a = new JSONArray(p.getString(KEY_QUEUE, "[]"));
        for (int i = 0; i < a.length(); i++)
            if (a.getJSONObject(i).optString("id").equals(o.optString("id"))) return;
        a.put(o);
        JSONArray cut = new JSONArray();
        for (int i = Math.max(0, a.length() - 200); i < a.length(); i++) cut.put(a.get(i));
        p.edit().putString(KEY_QUEUE, cut.toString()).apply();
    }

    static synchronized JSONArray drainAnswers(Context c) throws Exception {
        SharedPreferences p = getPrefs(c);
        JSONArray a = new JSONArray(p.getString("answers", "[]"));
        p.edit().putString("answers", "[]").apply();
        return a;
    }

    static synchronized JSONArray drain(Context c) throws Exception {
        SharedPreferences p = getPrefs(c);
        JSONArray a = new JSONArray(p.getString(KEY_QUEUE, "[]"));
        p.edit().putString(KEY_QUEUE, "[]").apply();
        return a;
    }
}

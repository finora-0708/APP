package com.finora.app;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.content.SharedPreferences;
import android.view.accessibility.AccessibilityEvent;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * FINORA Spending Guard (user-enabled, optional).
 * Reads ONLY the package name of the app that comes to the foreground. It never reads screen content,
 * typed text or passwords (canRetrieveWindowContent=false). When the daily limit is reached and the
 * foreground app is one the user selected, it shows a FINORA warning screen.
 */
public class SpendGuardService extends AccessibilityService {
    private String last = "";
    private long lastShown = 0;

    static boolean limitReached(SharedPreferences p) {
        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        if (!today.equals(p.getString("guard_date", ""))) return false; // new day -> limit resets
        float limit = p.getFloat("guard_limit", 0f), spent = p.getFloat("guard_spent", 0f);
        return limit > 0 && spent >= limit;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        try {
            if (e == null || e.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;
            CharSequence pc = e.getPackageName();
            if (pc == null) return;
            String pkg = pc.toString();
            if (pkg.equals(getPackageName())) return;
            SharedPreferences p = BankNotificationService.getPrefs(this);
            String mode = p.getString("guard_mode", "off");
            if ("off".equals(mode)) return;
            Set<String> pk = p.getStringSet("guard_pkgs", new HashSet<String>());
            if (!pk.contains(pkg)) return;
            if (!limitReached(p)) return;
            long now = System.currentTimeMillis();
            if (p.getLong("guard_allow_" + pkg, 0L) > now) return; // "Continue anyway" grace (warning mode only)
            if (pkg.equals(last) && now - lastShown < 3000) return;
            last = pkg;
            lastShown = now;
            Intent i = new Intent(this, GuardActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            i.putExtra("pkg", pkg);
            startActivity(i);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onInterrupt() {
    }
}

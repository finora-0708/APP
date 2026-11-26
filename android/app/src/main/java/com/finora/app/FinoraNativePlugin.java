package com.finora.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import android.net.Uri;
import android.os.PowerManager;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import android.text.TextUtils;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@CapacitorPlugin(name = "FinoraNative")
public class FinoraNativePlugin extends Plugin {
    private static FinoraNativePlugin instance;
    static volatile boolean visible = false; // true while FINORA is on screen

    @Override
    protected void handleOnResume() { visible = true; }

    @Override
    protected void handleOnPause() { visible = false; }


    @Override
    public void load() {
        instance = this;
    }

    static void pingJs() {
        if (instance != null) instance.notifyListeners("bankNotification", new JSObject());
    }

    private Toast activeToast;

    @PluginMethod
    public void showToast(PluginCall call) {
        String message = call.getString("message", "").trim();
        if (message.isEmpty()) {
            call.resolve();
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (activeToast != null) activeToast.cancel();
            activeToast = Toast.makeText(getContext().getApplicationContext(), message, Toast.LENGTH_SHORT);
            activeToast.show();
            call.resolve();
        });
    }

    @PluginMethod
    public void isNotificationAccessEnabled(PluginCall call) {
        Context c = getContext();
        boolean on = NotificationManagerCompat.getEnabledListenerPackages(c).contains(c.getPackageName());
        JSObject r = new JSObject();
        r.put("enabled", on);
        call.resolve(r);
    }

    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Only these packages are ever read by the notification listener. */
    @PluginMethod
    public void setAllowedPackages(PluginCall call) {
        JSArray arr = call.getArray("packages");
        Set<String> set = new HashSet<>();
        try {
            if (arr != null) for (int i = 0; i < arr.length(); i++) set.add(arr.getString(i));
        } catch (Exception ignored) {
        }
        BankNotificationService.getPrefs(getContext()).edit()
            .putStringSet(BankNotificationService.KEY_PACKAGES, set).apply();
        call.resolve();
    }

    /**
     * banks: [{id, packages:[...], keywords:[...]}]
     * Returns ONLY installed apps that match a supported bank (known package or label keyword).
     * The rest of the installed-app list is never read out or stored.
     */
    @PluginMethod
    public void getInstalledBankApps(PluginCall call) {
        JSArray banks = call.getArray("banks");
        JSArray out = new JSArray();
        PackageManager pm = getContext().getPackageManager();
        Set<String> seen = new HashSet<>();
        try {
            Intent main = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> launchers = pm.queryIntentActivities(main, 0);
            for (int b = 0; banks != null && b < banks.length(); b++) {
                JSONObject bank = banks.getJSONObject(b);
                String id = bank.getString("id");
                JSONArray pk = bank.optJSONArray("packages");
                JSONArray kw = bank.optJSONArray("keywords");
                for (int i = 0; pk != null && i < pk.length(); i++) {
                    String p = pk.getString(i);
                    try {
                        pm.getPackageInfo(p, 0);
                        if (seen.add(id + p)) out.put(entry(id, p, pm.getApplicationLabel(pm.getApplicationInfo(p, 0)).toString()));
                    } catch (PackageManager.NameNotFoundException ignored) {
                    }
                }
                for (ResolveInfo ri : launchers) {
                    String label = ri.loadLabel(pm).toString();
                    String p = ri.activityInfo.packageName;
                    for (int k = 0; kw != null && k < kw.length(); k++) {
                        if (label.toLowerCase(Locale.ROOT).contains(kw.getString(k).toLowerCase(Locale.ROOT))) {
                            if (seen.add(id + p)) out.put(entry(id, p, label));
                            break;
                        }
                    }
                }
            }
        } catch (Exception e) {
            call.reject(e.getMessage());
            return;
        }
        JSObject r = new JSObject();
        r.put("apps", out);
        call.resolve(r);
    }

    private JSObject entry(String bankId, String pkg, String label) {
        JSObject o = new JSObject();
        o.put("bankId", bankId);
        o.put("pkg", pkg);
        o.put("label", label);
        return o;
    }

    /** Returns queued, already-filtered notifications and clears the queue. */
    @PluginMethod
    public void drainQueue(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("items", new JSArray(BankNotificationService.drain(getContext()).toString()));
            call.resolve(r);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void clearQueue(PluginCall call) {
        BankNotificationService.getPrefs(getContext()).edit().putString(BankNotificationService.KEY_QUEUE, "[]").apply();
        call.resolve();
    }

    // ---------- Spending Guard (optional accessibility service) ----------
    @PluginMethod
    public void isGuardEnabled(PluginCall call) {
        Context c = getContext();
        String id = c.getPackageName() + "/" + SpendGuardService.class.getName();
        String s = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        boolean on = false;
        if (!TextUtils.isEmpty(s)) for (String x : s.split(":")) if (x.equalsIgnoreCase(id) || x.endsWith(SpendGuardService.class.getName())) on = true;
        JSObject r = new JSObject();
        r.put("enabled", on);
        call.resolve(r);
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** mode: off | warn | block. date: yyyy-MM-dd (device local). */
    @PluginMethod
    public void setGuard(PluginCall call) {
        Set<String> set = new HashSet<>();
        try {
            JSArray arr = call.getArray("packages");
            if (arr != null) for (int i = 0; i < arr.length(); i++) set.add(arr.getString(i));
        } catch (Exception ignored) {
        }
        Double limit = call.getDouble("limit", 0.0), spent = call.getDouble("spent", 0.0);
        BankNotificationService.getPrefs(getContext()).edit()
            .putString("guard_mode", call.getString("mode", "off"))
            .putStringSet("guard_pkgs", set)
            .putFloat("guard_limit", limit == null ? 0f : limit.floatValue())
            .putFloat("guard_spent", spent == null ? 0f : spent.floatValue())
            .putString("guard_date", call.getString("date", ""))
            .apply();
        call.resolve();
    }

    /** Returns which of the given packages are installed (with app labels). */
    @PluginMethod
    public void filterInstalled(PluginCall call) {
        JSArray arr = call.getArray("packages"), out = new JSArray();
        PackageManager pm = getContext().getPackageManager();
        try {
            for (int i = 0; arr != null && i < arr.length(); i++) {
                String p = arr.getString(i);
                try {
                    JSObject o = new JSObject();
                    o.put("pkg", p);
                    o.put("label", pm.getApplicationLabel(pm.getApplicationInfo(p, 0)).toString());
                    out.put(o);
                } catch (PackageManager.NameNotFoundException ignored) {
                }
            }
        } catch (Exception ignored) {
        }
        JSObject r = new JSObject();
        r.put("apps", out);
        call.resolve(r);
    }

    @PluginMethod
    public void permStatus(PluginCall call) {
        Context c = getContext();
        JSObject r = new JSObject();
        r.put("overlay", Settings.canDrawOverlays(c));
        PowerManager pm = (PowerManager) c.getSystemService(Context.POWER_SERVICE);
        r.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(c.getPackageName()));
        call.resolve(r);
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void drainAnswers(PluginCall call) {
        try {
            JSObject r = new JSObject();
            r.put("items", new JSArray(BankNotificationService.drainAnswers(getContext()).toString()));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("answers failed");
        }
    }
}

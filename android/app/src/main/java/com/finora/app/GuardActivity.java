package com.finora.app;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public class GuardActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setFinishOnTouchOutside(false);
        final String pkg = getIntent().getStringExtra("pkg") == null ? "" : getIntent().getStringExtra("pkg");
        final SharedPreferences p = BankNotificationService.getPrefs(this);
        final boolean block = "block".equals(p.getString("guard_mode", "warn"));
        String label = pkg;
        try {
            PackageManager pm = getPackageManager();
            label = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception ignored) {
        }
        int pad = (int) (22 * getResources().getDisplayMetrics().density);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        TextView t = new TextView(this);
        t.setText("Daily spending limit reached");
        t.setTextSize(20);
        t.setTextColor(Color.parseColor("#086658"));
        t.setGravity(Gravity.START);
        TextView m = new TextView(this);
        m.setTextSize(15);
        m.setPadding(0, pad / 2, 0, pad);
        m.setText("You have spent " + Math.round(p.getFloat("guard_spent", 0f)) + " of your " + Math.round(p.getFloat("guard_limit", 0f))
            + " limit today.\n" + (block ? "FINORA is blocking " + label + " until tomorrow because you turned on Spending Guard."
            : "Think before you pay with " + label + "."));
        root.addView(t);
        root.addView(m);
        Button close = new Button(this);
        close.setText("Close " + label);
        close.setOnClickListener(v -> { goHome(); finish(); });
        root.addView(close, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        Button open = new Button(this);
        open.setText("Open FINORA");
        open.setOnClickListener(v -> {
            Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (i != null) startActivity(i);
            finish();
        });
        root.addView(open, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        if (!block) { // warning mode: the user may continue, for 10 minutes
            Button go = new Button(this);
            go.setText("Continue anyway (10 min)");
            go.setOnClickListener(v -> {
                p.edit().putLong("guard_allow_" + pkg, System.currentTimeMillis() + 10 * 60000L).apply();
                finish();
            });
            root.addView(go, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        }
        setContentView(root);
    }

    private void goHome() {
        Intent h = new Intent(Intent.ACTION_MAIN);
        h.addCategory(Intent.CATEGORY_HOME);
        h.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(h);
    }

    @Override
    public void onBackPressed() {
        goHome();
        finish();
    }
}

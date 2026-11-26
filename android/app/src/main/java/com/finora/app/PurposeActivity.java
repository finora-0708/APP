package com.finora.app;

import android.app.Activity;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;

/** Small popup shown over whatever app is open right after a payment is detected: "What was this payment for?" */
public class PurposeActivity extends Activity {
    private String category = "";
    private static final String[] CATS = {"Food", "Travel", "Shopping", "Bills", "Entertainment", "Education", "Health", "Others"};

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setFinishOnTouchOutside(false);
        final String pid = getIntent().getStringExtra("pid") == null ? "" : getIntent().getStringExtra("pid");
        final int nid = getIntent().getIntExtra("nid", 0);
        final long amt = getIntent().getLongExtra("amount", 0L);
        float d = getResources().getDisplayMetrics().density;
        int pad = (int) (20 * d);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(pad, pad, pad, pad);
        TextView t = new TextView(this);
        t.setText("\u20B9" + amt + " paid");
        t.setTextSize(22);
        t.setTextColor(Color.parseColor("#086658"));
        TextView q = new TextView(this);
        q.setText("What was this payment for?");
        q.setTextSize(15);
        q.setPadding(0, pad / 3, 0, pad / 2);
        root.addView(t);
        root.addView(q);
        final Button[] btns = new Button[CATS.length];
        for (int r = 0; r < 2; r++) {
            LinearLayout row = new LinearLayout(this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            for (int c = 0; c < 4; c++) {
                final int idx = r * 4 + c;
                Button bt = new Button(this);
                bt.setText(CATS[idx]);
                bt.setTextSize(11);
                bt.setAllCaps(false);
                bt.setPadding(0, 0, 0, 0);
                bt.setOnClickListener(v -> {
                    category = CATS[idx];
                    for (int k = 0; k < btns.length; k++) btns[k].setAlpha(k == idx ? 1f : 0.5f);
                });
                btns[idx] = bt;
                row.addView(bt, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
            }
            root.addView(row);
        }
        final EditText et = new EditText(this);
        et.setHint("e.g. lunch with friends");
        et.setSingleLine(true);
        root.addView(et, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        LinearLayout acts = new LinearLayout(this);
        acts.setOrientation(LinearLayout.HORIZONTAL);
        Button skip = new Button(this);
        skip.setText("Skip");
        skip.setOnClickListener(v -> { save(pid, "", "", true); done(nid); });
        Button save = new Button(this);
        save.setText("Save");
        save.setOnClickListener(v -> {
            String why = et.getText().toString().trim();
            if (why.isEmpty() && category.isEmpty()) { Toast.makeText(this, "Pick a category or write a reason", Toast.LENGTH_SHORT).show(); return; }
            save(pid, why.isEmpty() ? category : why, category, false);
            done(nid);
        });
        acts.addView(skip, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        acts.addView(save, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        root.addView(acts);
        setContentView(root);
    }

    private void done(int nid) {
        try { ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).cancel(nid); } catch (Exception ignored) { }
        finish();
    }

    private void save(String pid, String purpose, String cat, boolean skip) {
        try {
            SharedPreferences p = BankNotificationService.getPrefs(this);
            JSONArray a = new JSONArray(p.getString("answers", "[]"));
            JSONObject o = new JSONObject();
            o.put("pid", pid);
            o.put("purpose", purpose);
            o.put("category", cat);
            o.put("skip", skip);
            a.put(o);
            p.edit().putString("answers", a.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onBackPressed() { /* must answer or skip */ }
}

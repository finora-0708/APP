import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { useApp, I, Btn, Title, Badge, Empty, Field } from "./ui";
import { BANKS, SelectedBank, bankById } from "./banks";
import { native, isNative } from "./native";
import { ingest, ingestRemote, confirmReview, bankName, applyAnswers } from "./engine";
import { auth, pullInbox, clearInbox } from "./firebase";
import { backend } from "./services";
import { cats, uid } from "./model";

/** Drain native queue -> parse -> ledger. Safe to call anywhere. */
export function useSync() {
  const { set, toast } = useApp();
  return async (quiet = false) => {
    const raws = await native.drain();
    const answers = await native.answers();
    // WhatsApp bot items (structured only). Import first, delete from the server only after they are in state.
    let inbox: Awaited<ReturnType<typeof pullInbox>> = [];
    const u = auth.currentUser?.uid;
    if (u) { try { inbox = await pullInbox(u); } catch {} }
    const gotBal = inbox.some((i) => i.kind === "balance");
    if (gotBal) setTimeout(() => toast("Bank statement balance updated"), 0);
    if (!raws.length && !inbox.length && !answers.length) { if (!quiet) toast("No new bank notifications."); return; }
    set((p) => {
      let st = p, saved = 0, rv = 0;
      if (raws.length) { const r = ingest(st, raws); st = r.state; saved += r.saved; rv += r.review; }
      if (inbox.length) { const r = ingestRemote(st, inbox); st = r.state; saved += r.saved; rv += r.review; }
      st = applyAnswers(st, answers);
      if (!quiet || saved || rv) setTimeout(() => toast(saved + " saved · " + rv + " need review"), 0);
      return st;
    });
    if (u && inbox.length) { try { await clearInbox(u, inbox.map((i) => i.id)); } catch {} }
  };
}

const logo = (id: string) => {
  const b = bankById(id)!;
  return (
    <span className="tile" style={{ background: b.color + "22", color: b.color, fontWeight: 700, fontSize: 12 }}>
      {b.short.slice(0, 4)}
    </span>
  );
};

export function BankSelect({ onChange }: { onChange?: () => void }) {
  const { s, set } = useApp(), [q, Q] = useState(""), [busy, B] = useState(false);
  const sel = (id: string) => s.banks.find((b) => b.id === id);
  async function refreshDetect(ids: string[]) {
    B(true);
    const apps = await native.detect(ids);
    set((p) => {
      const banks = p.banks.map((b) => {
        const found = apps.filter((a) => a.bankId === b.id).map((a) => ({ pkg: a.pkg, label: a.label }));
        // keep packages the user already confirmed, drop ones no longer installed
        return { ...b, detected: found, packages: b.packages.filter((x) => found.some((f) => f.pkg === x)) };
      });
      native.setPackages(banks);
      return { ...p, banks };
    });
    B(false);
  }
  function toggle(id: string) {
    const next: SelectedBank[] = sel(id)
      ? s.banks.filter((b) => b.id !== id)
      : [...s.banks, { id, primary: !s.banks.length, packages: [], detected: [], account: "" }];
    if (next.length && !next.some((b) => b.primary)) next[0] = { ...next[0], primary: true };
    set((p) => ({ ...p, banks: next, bankDone: true }));
    native.setPackages(next);
    refreshDetect(next.map((b) => b.id));
    onChange?.();
  }
  const list = BANKS.filter((b) => (b.name + b.short).toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <section className="panel">
        <p>Choose your bank to configure FINORA’s supported transaction tracking and financial notification features.</p>
        <p><small>Selecting a bank does not connect your account. Balances shown in FINORA are calculated from your records.</small></p>
        <input aria-label="Search banks" placeholder="Search bank names…" value={q} onChange={(e) => Q(e.target.value)} />
        {list.map((b) => {
          const x = sel(b.id);
          return (
            <div className="rulerow" key={b.id}>
              {logo(b.id)}
              <button className="rowdesc plain" onClick={() => toggle(b.id)}>
                <strong>{b.name} {x?.primary && <Badge>Primary</Badge>}</strong>
                <small>
                  {x ? "Selected" : "Not selected"} · {x ? (x.detected.length ? "App detected" : isNative() ? "App not detected" : "Detection needs the Android app") : b.methods[0]}
                  {x ? " · Account authorization: not configured" : ""}
                </small>
              </button>
              {x && !x.primary && (
                <Btn kind="ghost" onClick={() => set((p) => ({ ...p, banks: p.banks.map((y) => ({ ...y, primary: y.id === b.id })) }))}>Make primary</Btn>
              )}
              <Btn kind={x ? "" : "ghost"} icon={x ? "Check" : "Plus"} onClick={() => toggle(b.id)}>{x ? "Selected" : "Select"}</Btn>
            </div>
          );
        })}
        {!list.length && <Empty>No bank matches your search.</Empty>}
        {busy && <small>Checking installed bank apps…</small>}
      </section>
      {!!s.banks.length && <DetectedApps />}
    </>
  );
}

export function DetectedApps() {
  const { s, set } = useApp();
  const pick = (bankId: string, pkg: string) =>
    set((p) => {
      const banks = p.banks.map((b) => b.id !== bankId ? b : { ...b, packages: b.packages.includes(pkg) ? b.packages.filter((x) => x !== pkg) : [...b.packages, pkg] });
      native.setPackages(banks);
      return { ...p, banks };
    });
  return (
    <section className="panel">
      <h2>Banking apps detected</h2>
      <p><small>FINORA reads notifications only from the bank apps you tick here.</small></p>
      {s.banks.map((b) => (
        <div key={b.id}>
          <strong>{bankName(b.id)}</strong>
          {b.detected.length ? b.detected.map((d) => (
            <label className="listline" key={d.pkg}>
              <span>{d.label} <small>({d.pkg})</small></span>
              <input type="checkbox" checked={b.packages.includes(d.pkg)} onChange={() => pick(b.id, d.pkg)} />
            </label>
          )) : <p><small>{isNative() ? "No installed app found for this bank." : "Available in the Android app."}</small></p>}
        </div>
      ))}
    </section>
  );
}

// Guided flow for banks with an official WhatsApp banking number (e.g. SBI): the USER chats with the bank,
// then forwards the statement reply to the FINORA bot. FINORA never messages the bank on your behalf.
export function BankSources() {
  return (
    <>
      <WhatsAppLinkRow />
      <BankChat />
      <NotificationAccess embedded />
    </>
  );
}

export function BankChat() {
  const { s, toast, go } = useApp();
  const sync = useSync();
  const [selected, setSelected] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [reminderTime, setReminderTime] = useState(() => localStorage.getItem("finora:statement-reminder:" + s.uid) || "");
  const [bot, setBot] = useState(""), [ask, setAsk] = useState(false), [busy, B] = useState(false);
  useEffect(() => { backend<{ botNumber: string }>("/wa/info", {}).then((r) => setBot(r.botNumber)).catch(() => {}); }, []);
  const banks = BANKS.filter((bank) => bank.whatsapp && s.banks.some((item) => item.id === bank.id));
  const bank = banks.find((item) => item.id === selected) || banks[0];
  const whatsapp = bank?.whatsapp;
  if (!whatsapp) return (
    <section className="panel">
      <h2>WhatsApp statements</h2>
      <p>Select SBI, Bank of Maharashtra or Bank of India to open their official WhatsApp chat and import a mini statement.</p>
      <Btn kind="ghost" onClick={() => go("/banks")}>Choose banks</Btn>
    </section>
  );
  async function importStatement(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const text = String(new FormData(form).get("statement") || "").trim();
    if (!text || importing) return;
    setImporting(true);
    setImportMessage("");
    try {
      const result = await backend<{ lines: number; queued: number }>("/wa/statement", { bank: bank.id, text });
      form.reset();
      setImportMessage(result.queued ? `${result.lines} transaction rows read. Open Review to check the import.` : "These rows are already queued for review.");
      await sync(true).catch(() => setImportMessage("Statement queued. Open Finora again to sync for review."));
    } catch (error) {
      setImportMessage(error instanceof Error ? error.message : "Could not import this statement.");
    } finally {
      setImporting(false);
    }
  }
  async function saveReminder(time: string) {
    try {
      if (!await native.scheduleStatementReminder(time)) {
        toast("Daily reminders need notification permission in the Finora mobile app.");
        return;
      }
      localStorage.setItem("finora:statement-reminder:" + s.uid, time);
      setReminderTime(time);
      toast(time ? "Daily statement reminder saved" : "Statement reminder turned off");
    } catch {
      toast("Could not update the statement reminder");
    }
  }
  async function sendParent() {
    B(true);
    try {
      const result = await backend<{ sent?: boolean }>("/parent/send-now", {});
      if (!result.sent) throw new Error("Save a parent WhatsApp number first.");
      toast("Report accepted by WhatsApp");
    }
    catch (e: any) { toast("Could not send: " + (e?.message || "server error")); }
    B(false); setAsk(false);
  }
  return (
    <section className="panel bank-statement">
      <div className="sectionhead"><span className="tile mint"><I n="MessageCircle" /></span></div>
      <h2>WhatsApp statements</h2>
      <p>Get a mini statement from your bank and bring its transactions into Finora for review.</p>
      <div className="statement-banks" role="group" aria-label="Statement bank">
        {banks.map((item) => (
          <button key={item.id} type="button" aria-pressed={item.id === bank.id} disabled={importing} onClick={() => {
            setSelected(item.id);
            setImportMessage("");
          }}>{logo(item.id)}<span>{item.name}</span></button>
        ))}
      </div>
      <div className="statement-guide">
        <div className="statement-guide-head">
          <div><h3>{bank.name}</h3><a href={whatsapp.source} target="_blank" rel="noreferrer">{whatsapp.display} · Official bank source</a></div>
          <a className="btn" href={"https://wa.me/" + whatsapp.number + "?text=Hi"} target="_blank" rel="noreferrer"><I n="MessageCircle" /> Open WhatsApp</a>
        </div>
        <ol>
          <li>Send <b>Hi</b> from your bank-registered WhatsApp number.</li>
          <li>Choose <b>{whatsapp.statement}</b> in the bank chat.</li>
          <li>Copy the reply and paste it below, or forward a reply that includes the bank name to the Finora bot.</li>
        </ol>
        {bot && <a href={"https://wa.me/" + bot.replace(/\D/g, "")} target="_blank" rel="noreferrer">Open Finora bot</a>}
      </div>
      <form className="statement-import" key={bank.id} onSubmit={importStatement}>
        <Field label={"Paste " + bank.short + " statement text"}>
          <textarea name="statement" rows={4} maxLength={3000} placeholder="Paste the dated debit and credit rows here" required />
        </Field>
        <div className="statement-actions">
          <Btn type="submit" disabled={importing}>{importing ? "Importing…" : "Import for review"}</Btn>
          <Btn kind="ghost" onClick={() => go("/review")}>Open review</Btn>
        </div>
        {importMessage && <p role="status">{importMessage}</p>}
      </form>
      {isNative() && (
        <form onSubmit={(e) => {
          e.preventDefault();
          void saveReminder(String(new FormData(e.currentTarget).get("time") || ""));
        }}>
          <Field label="Daily reminder to fetch a statement">
            <input name="time" type="time" defaultValue={reminderTime} required />
          </Field>
          <p><small>Finora reminds you to open the bank chat and forward the statement. Bank notification access is optional.</small></p>
          <Btn type="submit">Set reminder</Btn>{" "}
          {reminderTime && <Btn kind="ghost" onClick={() => void saveReminder("")}>Turn off reminder</Btn>}
        </form>
      )}
      {s.parentPhone ? (
        !ask ? <Btn icon="MessageCircle" onClick={() => setAsk(true)}>Send statement to {s.parentName || "parent"}</Btn> : (
          <div className="listline">
            <span>Send today&apos;s statement{s.banks.find((b) => b.lastBalance) ? " with bank balance" : ""} to {s.parentName || "your parent"} ({s.parentPhone})?</span>
            <span><Btn disabled={busy} onClick={sendParent}>{busy ? "Sending…" : "Yes, send"}</Btn> <Btn kind="ghost" onClick={() => setAsk(false)}>Cancel</Btn></span>
          </div>
        )
      ) : <p><small>Add a parent in Parent Connect to send the statement.</small></p>}
    </section>
  );
}

export function WhatsAppLinkRow() {
  const { go } = useApp();
  return (
    <button className="settingbtn link-settings-row" onClick={() => go("/profile/whatsapp")}>
      <strong><I n="MessageCircle" /> WhatsApp linking</strong>
      <span>Manage <I n="ChevronRight" size={16} /></span>
    </button>
  );
}

export function WhatsAppLinkScreen() {
  const { go } = useApp();
  const [link, setLink] = useState<{ url: string; image: string; expiresAt: number }>();
  const [linked, setLinked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const result = await backend<{ linkedNumber: string | null }>("/wa/info", {});
        if (active) setLinked(result.linkedNumber);
      } catch {}
    }
    function onResume() {
      if (document.visibilityState === "visible") void refresh();
    }
    void refresh();
    const timer = link ? setInterval(onResume, 5000) : undefined;
    document.addEventListener("visibilitychange", onResume);
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onResume);
    };
  }, [link]);

  useEffect(() => {
    if (!link) return;
    if (linked) {
      setLink(undefined);
      return;
    }
    const timer = setTimeout(() => {
      setLink(undefined);
      setError("This QR code expired. Generate a new one.");
    }, Math.max(0, link.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [link, linked]);

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const result = await backend<{ code: string; botNumber: string; expiresAt: number }>("/wa/link-code", {});
      if (!/^\d{6}$/.test(result.code) || !/^[1-9]\d{9,14}$/.test(result.botNumber) || !(result.expiresAt > Date.now())) {
        throw new Error("Finora could not get a valid WhatsApp link. Try again.");
      }
      const url = "https://wa.me/" + result.botNumber + "?text=" + encodeURIComponent("LINK " + result.code);
      const image = await QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 4, scale: 8 });
      setLink({ url, image, expiresAt: result.expiresAt });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate a QR code.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="link-screen">
      <Btn kind="ghost" icon="ArrowLeft" onClick={() => go("/profile")}>Profile</Btn>
      <Title title="WhatsApp linking" />
      <div className="link-sheet">
        <span className="tile mint"><I n="MessageCircle" size={24} /></span>
        <h2>{linked ? "WhatsApp connected" : "Connect your WhatsApp"}</h2>
        {linked ? (
          <p role="status">Linked number {linked}</p>
        ) : (
          <>
            <p>Use the WhatsApp number registered with your bank.</p>
            {link ? (
              <>
                <img className="link-qr" src={link.image} alt="QR code to open the Finora bot in WhatsApp" />
                <p>Scan on another device or tap below. Send the prefilled message to finish linking.</p>
                <a className="btn" href={link.url} target="_blank" rel="noreferrer">Open WhatsApp</a>
                <small>One-time code. Valid for 15 minutes.</small>
              </>
            ) : (
              <Btn icon="Link2" disabled={busy} onClick={generate}>{busy ? "Generating…" : "Generate QR code"}</Btn>
            )}
          </>
        )}
        {error && <p className="parent-delivery" role="status">{error}</p>}
      </div>
    </section>
  );
}

export function NotificationAccess({ embedded = false }: { embedded?: boolean }) {
  const { s, set, toast, go } = useApp(), sync = useSync(), [on, O] = useState(false);
  const check = async () => O(await native.accessEnabled());
  useEffect(() => {
    check();
    const v = () => document.visibilityState === "visible" && (check(), sync(true));
    document.addEventListener("visibilitychange", v);
    const off = native.onNew(() => sync(true));
    return () => { document.removeEventListener("visibilitychange", v); off(); };
  }, []);
  const last = s.nlog.find((n) => n.result === "saved" || n.result === "review");
  const chosen = s.banks.flatMap((b) => b.packages).length;
  return (
    <>
      {!embedded && <Title title="Bank notification access" sub="Automatically maintain records from eligible bank transaction notifications." />}
      <section className="panel">
        <div className="sectionhead">
          <span className="tile mint"><I n="Bell" /></span>
          <Badge>{!isNative() ? "Android app only" : on ? "Access enabled" : "Access off"}</Badge>
        </div>
        <p>FINORA can identify eligible banking transaction notifications to help you automatically maintain your expense records. It does not need to read your personal conversations or unrelated app notifications.</p>
        <ul>
          <li>Only the bank apps you select are read. Everything else is ignored.</li>
          <li>OTP, PIN and password messages are discarded.</li>
          <li>Raw notification text is not uploaded – only the transaction fields you keep.</li>
          <li>You can switch this off in Android settings any time.</li>
        </ul>
        <div className="actions wrap">
          <Btn icon="ShieldCheck" disabled={!isNative()} onClick={async () => { await native.openSettings(); toast("Turn on FINORA, then come back to the app."); }}>
            Enable Bank Notification Access
          </Btn>
          <Btn kind="ghost" icon="RefreshCw" onClick={async () => { await check(); await sync(); }}>Check now</Btn>
          <Btn kind="ghost" icon="Bell" disabled={!isNative()} onClick={async () => toast((await native.sendTest()) ? "Test notification sent…" : "Allow notifications first.")}>Send test</Btn>
        </div>
        {isNative() && !on && <p><small>Android 13+ can block this for apps installed from an APK. If FINORA is greyed out in the list: Settings → Apps → FINORA → ⋮ (top right) → <b>Allow restricted settings</b>, then enable access again.</small></p>}
        <div className="listline"><span>Selected bank apps</span><b>{chosen}</b></div>
        <div className="listline"><span>Last detected transaction</span><b>{last ? last.summary : "—"}</b></div>
        {on && !chosen && <p role="alert"><small>Select at least one detected bank app below, otherwise nothing is read.</small></p>}
      </section>
      {!embedded && <DetectedApps />}
      {!embedded && <WhatsAppLinkRow />}
      {!embedded && <BankChat />}
      {!embedded && (
        <section className="panel">
          <div className="sectionhead">
            <h2>Processing history</h2>
            {!!s.review.length && <Btn onClick={() => go("/review")}>Review {s.review.length}</Btn>}
          </div>
          {s.nlog.map((n) => (
            <div className="listline" key={n.id}>
              <span>{new Date(n.ts).toLocaleString()} · {n.result}</span>
              <b>{n.summary}</b>
            </div>
          ))}
          {!s.nlog.length && <Empty>No notifications processed yet.</Empty>}
          <div className="actions wrap">
            <Btn kind="ghost" icon="Trash2" onClick={() => { set((p) => ({ ...p, tx: p.tx.filter((t) => t.source !== "notification" && t.source !== "whatsapp"), review: [], nlog: [] })); toast("Imported records deleted"); }}>Delete imported records</Btn>
          </div>
        </section>
      )}
    </>
  );
}

export function Reconcile() {
  const { s, set, f, toast } = useApp();
  return (
    <>
      <Title title="Review payments" sub="FINORA was not sure about these. Nothing is saved until you confirm." />
      <section className="panel">
        {s.review.map((r) => (
          <div key={r.id} className="panelinner">
            <div className="listline"><span>{bankName(r.bankId)} {r.account || ""}</span><b>{r.type === "credit" ? "+" : "−"}{f(r.amount, 2)}</b></div>
            <small>{new Date(r.ts).toLocaleString()} · {r.reason}</small>
            <div className="filters">
              <Field label="Description"><input defaultValue={r.title} onChange={(e) => (r.title = e.target.value)} /></Field>
              {r.type === "debit" && (
                <Field label="Category">
                  <select defaultValue={r.category || "Others"} onChange={(e) => (r.category = e.target.value)}>
                    {cats.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
              )}
            </div>
            <div className="actions wrap">
              <Btn onClick={() => { set((p) => confirmReview(p, r.id, { title: r.title, category: r.type === "credit" ? "Income" : r.category || "Others" })); toast("Saved"); }}>Confirm and save</Btn>
              <Btn kind="ghost" onClick={() => set((p) => ({ ...p, review: p.review.filter((x) => x.id !== r.id) }))}>Ignore</Btn>
            </div>
          </div>
        ))}
        {!s.review.length && <Empty>Nothing needs review.</Empty>}
      </section>
    </>
  );
}

export function Goals() {
  const { s, set, f } = useApp(), [name, N] = useState(""), [target, T] = useState("");
  return (
    <>
      <Title title="Savings goals" sub="Set a target and track what you have saved." />
      <section className="panel">
        {s.goals.map((g) => {
          const pct = Math.min(100, Math.round((g.saved / g.target) * 100));
          return (
            <div key={g.id} className="panelinner">
              <div className="listline"><b>{g.name}</b><span>{f(g.saved)} / {f(g.target)}</span></div>
              <div className="meter"><i style={{ width: pct + "%" }} /></div>
              <div className="actions wrap">
                {[100, 500, 1000].map((a) => (
                  <Btn key={a} kind="ghost" onClick={() => set((p) => ({ ...p, goals: p.goals.map((x) => (x.id === g.id ? { ...x, saved: x.saved + a } : x)) }))}>+{a}</Btn>
                ))}
                <Btn kind="ghost" icon="Trash2" onClick={() => set((p) => ({ ...p, goals: p.goals.filter((x) => x.id !== g.id) }))}>Delete</Btn>
              </div>
            </div>
          );
        })}
        {!s.goals.length && <Empty>No goals yet. Add your first one below.</Empty>}
      </section>
      <form className="panel formgrid" onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !(Number(target) > 0)) return; set((p) => ({ ...p, goals: [...p.goals, { id: uid(), name: name.trim(), target: Number(target), saved: 0 }] })); N(""); T(""); }}>
        <Field label="Goal name"><input required value={name} onChange={(e) => N(e.target.value)} placeholder="New phone" /></Field>
        <Field label="Target amount"><input required type="number" min="1" value={target} onChange={(e) => T(e.target.value)} /></Field>
        <div className="formend"><Btn type="submit" icon="Plus">Add goal</Btn></div>
      </form>
    </>
  );
}

// First-run checklist: asks for everything FINORA needs, right after the app is opened. Each item is optional and explained.
export function PermissionSetup() {
  const { s, set } = useApp();
  const [st, S] = useState({ notif: false, overlay: false, battery: false, access: false, guard: false });
  const refresh = async () => {
    const [p, access, guard] = await Promise.all([native.permStatus(), native.accessEnabled(), native.guardEnabled()]);
    S({ notif: p.notif, overlay: p.overlay, battery: p.battery, access, guard });
  };
  useEffect(() => {
    refresh();
    const v = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, []);
  if (!isNative() || !s.ready || s.permsDone) return null;
  const rows: [string, string, boolean, () => void][] = [
    ["Notifications", "Reminders and the \"what was this payment for?\" alert.", st.notif, async () => { await native.askNotifyPermission(); refresh(); }],
    ["Bank notification access", "Lets FINORA notice bank payment notifications from the bank apps you select. Nothing else is read.", st.access, () => native.openSettings()],
    ["Display over other apps", "Shows the quick \"what was this for?\" popup on top of any app right after a payment.", st.overlay, () => native.openOverlaySettings()],
    ["Run in background", "Choose \"Unrestricted / Don't optimise\" so Android does not stop FINORA from seeing payments.", st.battery, () => native.openBatterySettings()],
    ["Spending Guard (optional)", "Warns or blocks payment apps after your daily limit. Only notices which app opens. Set the apps later in Spending Control.", st.guard, () => native.openGuardSettings()],
  ];
  const finish = () => set((p) => ({ ...p, permsDone: true }));
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true" style={{ maxHeight: "90vh", overflowY: "auto" }}>
        <h2>Allow what FINORA needs</h2>
        <p><small>Each permission is optional and can be changed later. If a screen says &quot;restricted setting&quot; on Android 13+, open Settings → Apps → FINORA → ⋮ → Allow restricted settings and try again.</small></p>
        {rows.map(([t, d, ok, go]) => (
          <div key={t} className="listline">
            <span><b>{t}</b><br /><small>{d}</small></span>
            {ok ? <Badge>On</Badge> : <Btn onClick={go}>Allow</Btn>}
          </div>
        ))}
        <div className="formend"><Btn onClick={finish}>{rows.slice(0, 4).every((r) => r[2]) ? "Done" : "Continue"}</Btn></div>
      </div>
    </div>
  );
}

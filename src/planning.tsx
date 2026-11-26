import { useEffect, useState } from "react";
import { useApp, I, Title, Btn, Field, IconBtn, Empty, Badge } from "./ui";
import { native } from "./native";
import { rule, Rule, dateKey, summary, uid, cats } from "./model";
import { backend, services, BACKEND_URL } from "./services";
import { bankById } from "./banks";
export function Rules({
  bills = false,
  embedded = false,
}: {
  bills?: boolean;
  embedded?: boolean;
}) {
  const { s, set, f, toast } = useApp(),
    key = bills ? "bills" : "rules",
    items = s[key],
    [edit, E] = useState<Rule | null>(null),
    [confirm, Q] = useState<Rule | null>(null),
    [actual, A] = useState(""),
    [cat, K] = useState(""),
    [del, D] = useState(""),
    month = dateKey().slice(0, 7),
    paid = (id: string) => s.billHistory.includes(month + id);
  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit || !edit.title.trim()) return;
    set((p) => ({
      ...p,
      [key]: [
        ...p[key].filter((x) => x.id !== edit.id),
        { ...edit, title: edit.title.trim() },
      ],
    }));
    E(null);
    toast("Saved");
  }
  function post(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm) return;
    const r = confirm,
      today = dateKey(),
      receipt = bills ? month + r.id : today + r.id;
    if (bills ? paid(r.id) : s.handled.includes("posted" + receipt)) {
      toast("Already recorded");
      Q(null);
      return;
    }
    set((p) => ({
      ...p,
      tx: [
        ...p.tx,
        {
          id: uid(),
          title: r.title,
          amount: Number(actual),
          category: cat,
          date: today,
          time: new Date().toTimeString().slice(0, 5),
          type: "debit",
          method: "UPI",
          notes: bills ? "Recurring bill" : "Confirmed reminder",
          fixed: bills,
        },
      ],
      billHistory: bills ? [...p.billHistory, receipt] : p.billHistory,
      handled: [...p.handled, "posted" + receipt],
    }));
    Q(null);
    toast("Payment recorded");
  }
  return (
    <>
      {!embedded && (
        <Title
          title={bills ? "Monthly bills" : "Expense reminders"}
          sub={
            bills
              ? "Manage recurring bills separately from your daily limit."
              : "Confirm routine purchases before adding them to your ledger."
          }
        />
      )}
      <section className="panel">
        <div className="sectionhead">
          <div>
            <h2>{bills ? "Recurring expenses" : "Daily routines"}</h2>
            <small>
              {bills
                ? f(summary(s).fixed) + " scheduled monthly"
                : items.filter((x) => x.enabled).length + " active reminders"}
            </small>
          </div>
          <Btn
            icon="Plus"
            onClick={() =>
              E(rule("", 0, "13:00", 1, bills ? "Monthly" : "Daily"))
            }
          >
            {bills ? "Add bill" : "Add reminder"}
          </Btn>
        </div>
        {items.map((r) => (
          <div className="rulerow" key={r.id}>
            <span className={"tile " + (bills ? "lilac" : "mint")}>
              <I n={bills ? "CalendarDays" : "Clock3"} />
            </span>
            <div className="rowdesc">
              <strong>{r.title}</strong>
              <small>
                {f(r.amount)} · {bills ? "Due day " + r.day : r.time} ·{" "}
                {r.frequency} ·{" "}
                {r.enabled
                  ? bills
                    ? paid(r.id)
                      ? "Paid"
                      : "Pending"
                    : "Active"
                  : "Paused"}
              </small>
            </div>
            <div className="actions">
              <button
                className="link"
                disabled={!r.enabled || (bills && paid(r.id))}
                onClick={() => {
                  Q(r);
                  A(String(r.amount));
                  K(bills ? "Bills" : "");
                }}
              >
                {bills ? "Mark paid" : "Check in"}
              </button>
              <IconBtn
                n={r.enabled ? "Pause" : "Play"}
                label={r.enabled ? "Pause" : "Enable"}
                click={() =>
                  set((p) => ({
                    ...p,
                    [key]: p[key].map((x) =>
                      x.id === r.id ? { ...x, enabled: !x.enabled } : x,
                    ),
                  }))
                }
              />
              <IconBtn n="Pencil" label="Edit" click={() => E({ ...r })} />
              <IconBtn n="Trash2" label="Delete" click={() => D(r.id)} />
            </div>
          </div>
        ))}
        {!items.length && (
          <Empty>Add your first {bills ? "bill" : "reminder"}.</Empty>
        )}
      </section>
      {edit && (
        <div className="overlay">
          <form className="dialog" onSubmit={save}>
            <h2>{bills ? "Monthly bill" : "Expense reminder"}</h2>
            <Field label="Expense name">
              <input
                required
                autoFocus
                value={edit.title}
                onChange={(e) => E({ ...edit, title: e.target.value })}
              />
            </Field>
            <Field label="Expected amount">
              <input
                type="number"
                required
                min=".01"
                step=".01"
                value={edit.amount || ""}
                onChange={(e) => E({ ...edit, amount: +e.target.value })}
              />
            </Field>
            {bills ? (
              <Field label="Day of month">
                <input
                  type="number"
                  min="1"
                  max="31"
                  required
                  value={edit.day}
                  onChange={(e) => E({ ...edit, day: +e.target.value })}
                />
              </Field>
            ) : (
              <Field label="Allowed amount variation">
                <input
                  type="number"
                  required
                  min="0"
                  value={edit.variation}
                  onChange={(e) => E({ ...edit, variation: +e.target.value })}
                />
              </Field>
            )}
            <Field label="Recurrence">
              <select
                value={edit.frequency}
                onChange={(e) => E({ ...edit, frequency: e.target.value })}
              >
                {(bills ? ["Monthly"] : ["Daily", "Weekdays", "Weekends"]).map(
                  (v) => (
                    <option key={v}>{v}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label="Reminder time">
              <input
                type="time"
                required
                value={edit.time}
                onChange={(e) => E({ ...edit, time: e.target.value })}
              />
            </Field>
            <label>
              <input
                type="checkbox"
                checked={edit.remind}
                onChange={(e) => E({ ...edit, remind: e.target.checked })}
              />{" "}
              Enable reminder
            </label>
            <div className="formend">
              <Btn kind="ghost" onClick={() => E(null)}>
                Cancel
              </Btn>
              <Btn type="submit">Save</Btn>
            </div>
          </form>
        </div>
      )}
      {confirm && (
        <div className="overlay">
          <form className="dialog" onSubmit={post}>
            <h2>Did you spend money on {confirm.title}?</h2>
            <Field label="Actual amount">
              <input
                required
                type="number"
                min=".01"
                step=".01"
                value={actual}
                onChange={(e) => A(e.target.value)}
              />
            </Field>
            {Math.abs(Number(actual) - confirm.amount) <= confirm.variation && (
              <p>
                Did you spend {f(Number(actual))} on {confirm.title}?
              </p>
            )}
            {!bills &&
              Math.abs(Number(actual) - confirm.amount) <= confirm.variation &&
              /^(breakfast|lunch|dinner|tea \/ coffee|snacks|transportation)$/i.test(
                confirm.title,
              ) && (
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    K(confirm.title === "Transportation" ? "Travel" : "Food")
                  }
                >
                  Use suggested category ·{" "}
                  {confirm.title === "Transportation" ? "Travel" : "Food"}
                </button>
              )}
            <Field label="Confirm category">
              <select required value={cat} onChange={(e) => K(e.target.value)}>
                <option value="">Select a category</option>
                {cats.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <div className="formend">
              <Btn kind="ghost" onClick={() => Q(null)}>
                Skip
              </Btn>
              <Btn type="submit">Confirm</Btn>
            </div>
          </form>
        </div>
      )}
      {del && (
        <Confirm
          text="Delete this recurring item?"
          cancel={() => D("")}
          accept={() => {
            set((p) => ({ ...p, [key]: p[key].filter((x) => x.id !== del) }));
            D("");
          }}
        />
      )}
    </>
  );
}
export function Confirm({
  text,
  cancel,
  accept,
}: {
  text: string;
  cancel: () => void;
  accept: () => void;
}) {
  return (
    <div className="overlay">
      <div className="dialog" role="dialog" aria-modal="true">
        <h2>{text}</h2>
        <div className="formend">
          <Btn kind="ghost" onClick={cancel}>
            Cancel
          </Btn>
          <Btn onClick={accept}>Confirm</Btn>
        </div>
      </div>
    </div>
  );
}
export function Integrations({ waOnly = false }: { waOnly?: boolean }) {
  const { s, set, f, toast, go } = useApp(),
    m = summary(s),
    ready = BACKEND_URL !== "",
    [saving, setSaving] = useState(false),
    [delivery, setDelivery] = useState("");
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const d = new FormData(e.currentTarget),
      v = (k: string) => String(d.get(k) || "").trim(),
      inputPhone = v("phone").replace(/[\s-]/g, "");
    if (inputPhone && !/^\+?[1-9][0-9]{9,14}$/.test(inputPhone)) {
      toast("Enter a valid phone number with country code, e.g. +919876543210");
      return;
    }
    const phone = inputPhone ? "+" + inputPhone.replace(/^\+/, "") : "";
    const name = v("name");
    const reportOn = !!phone && d.get("on") === "on";
    const reportTime = v("time") || "21:00";
    setSaving(true);
    setDelivery("");
    try {
      const result = await backend<{ activation: "none" | "already_submitted" | "pending" | "submitted" | "failed"; activationError?: string }>("/parent/save", { name, phone, reportOn, reportTime });
      if (!result.activation) throw new Error("Parent activation is unavailable");
      set((p) => ({ ...p, parentName: name, parentPhone: phone, reportOn, reportTime }));
      if (result.activation === "submitted" || result.activation === "already_submitted") {
        setDelivery("Welcome message accepted by WhatsApp.");
      } else if (result.activation === "pending") {
        setDelivery("WhatsApp submission is in progress.");
      } else if (result.activation === "failed") {
        setDelivery(result.activationError || "The welcome message failed. Tap Save to try again.");
      }
      toast("Parent Connect saved");
    } catch (error) {
      setDelivery(error instanceof Error ? error.message : "Could not save Parent Connect. Try again.");
    } finally {
      setSaving(false);
    }
  }
  const primary = s.banks.find((b) => b.primary);
  return (
    <>
      {!waOnly && <Title title="Parent Connect" sub="Optionally send a daily spending summary to a parent or guardian on WhatsApp." />}
      <div className={waOnly ? "" : "twocol"}>
        <section className="panel">
          <div className="sectionhead">
            <span className="tile mint">
              <I n="MessageCircle" />
            </span>
            <Badge>{!s.parentPhone ? "Not set up" : ready && s.reportOn ? "Report scheduled" : "Parent saved"}</Badge>
          </div>
          <h2>WhatsApp daily report</h2>
          <p>Saving a WhatsApp number sends a welcome message. Turn on daily reports to share spending summaries with this number.</p>
          <form className="formgrid" onSubmit={save}>
            <Field label="Parent / guardian name">
              <input name="name" defaultValue={s.parentName} maxLength={60} />
            </Field>
            <Field label="WhatsApp number (with country code)">
              <input name="phone" inputMode="tel" placeholder="+919876543210" defaultValue={s.parentPhone} />
            </Field>
            <Field label="Send time">
              <input name="time" type="time" defaultValue={s.reportTime} />
            </Field>
            <label>
              <input name="on" type="checkbox" defaultChecked={s.reportOn} /> Send a daily report
            </label>
            {!ready && <small>Report delivery starts once the automation backend is connected. Your settings are saved to your account.</small>}
            {delivery && <p className="parent-delivery" role="status">{delivery}</p>}
            <div className="formend">
              <Btn type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</Btn>
            </div>
          </form>
        </section>
        {!waOnly && (
          <section className="panel">
            <div className="sectionhead">
              <span className="tile mint">
                <I n="Landmark" />
              </span>
              <Badge>{s.banks.length ? s.banks.length + " selected" : "None selected"}</Badge>
            </div>
            <h2>Bank accounts</h2>
            <p>{primary ? "Primary bank: " + (bankById(primary.id)?.name || primary.id) + "." : "No bank selected yet."}</p>
            <p>
              Balance from your records: <b>{f(m.balance, 2)}</b>
              {primary?.lastBalance && (
                <>
                  <br />
                  <small>Last balance seen in a bank notification: {f(primary.lastBalance.amount, 2)} · {new Date(primary.lastBalance.ts).toLocaleString()}</small>
                </>
              )}
            </p>
            <p><small>Bank balance synchronization requires authorized bank integration.</small></p>
            <Btn onClick={() => go("/banks")}>Manage banks & notifications</Btn>
          </section>
        )}
      </div>
    </>
  );
}
function GuardPanel() {
  const { s, set, toast } = useApp(),
    [on, O] = useState(false),
    [apps, A] = useState<{ pkg: string; label: string }[]>([]);
  const refresh = () => { native.guardEnabled().then(O); native.paymentApps().then(A); };
  useEffect(() => {
    refresh();
    const v = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", v);
    return () => document.removeEventListener("visibilitychange", v);
  }, []);
  const sel = s.guardApps || [];
  return (
    <section className="panel">
      <div className="sectionhead"><span className="tile mint"><I n="ShieldCheck" /></span><Badge>{on ? "Enabled" : "Not enabled"}</Badge></div>
      <h2>Spending Guard (real app blocking)</h2>
      <p><small>Optional. When your daily limit is reached, FINORA shows a warning (Warning mode) or blocks (User-confirmed restriction mode) the payment apps you choose below, until the next day. To do this Android needs the Accessibility permission. FINORA only notices <b>which app is opened</b>. It does not read your screen, typing, OTPs or passwords. Phone, emergency and Settings are never affected. You can turn it off any time in Accessibility settings.</small></p>
      {!on && <Btn icon="ShieldCheck" onClick={() => native.openGuardSettings()}>Enable in Accessibility settings</Btn>}
      {!on && <p><small>Open Accessibility → Installed apps → FINORA Spending Guard → turn on. On Android 13+ you may first need Settings → Apps → FINORA → ⋮ → Allow restricted settings.</small></p>}
      {apps.length === 0 ? <p><small>No supported payment apps found on this phone.</small></p> : apps.map((a) => (
        <div key={a.pkg} className="listline">
          <label>
            <input type="checkbox" checked={sel.includes(a.pkg)} onChange={(e) => set((p) => ({ ...p, guardApps: e.target.checked ? [...(p.guardApps || []), a.pkg] : (p.guardApps || []).filter((x) => x !== a.pkg) }))} /> {a.label}
          </label>
        </div>
      ))}
      {s.control !== "Warning" && s.control !== "User-confirmed restriction" && <p><small>Set Control mode below to Warning or User-confirmed restriction to activate.</small></p>}
    </section>
  );
}
export function Control() {
  const { s, set, f, go } = useApp(),
    m = summary(s),
    [mock, M] = useState(""),
    [ask, A] = useState(false),
    active = services.restrictions.applies(s, mock).data;
  return (
    <>
      <Title
        title="Spending control"
        sub="Daily limit warnings and optional blocking of payment apps."
      />
      <div className="stats">
        {[
          ["Daily limit", f(s.daily)],
          ["Spent today", f(m.spent)],
          ["Remaining", f(Math.max(0, s.daily - m.spent))],
        ].map(([k, v]) => (
          <div className="panel" key={k}>
            <small>{k}</small>
            <h2>{v}</h2>
          </div>
        ))}
      </div>
      <GuardPanel />
      <section className="panel">
        <h2>
          {m.spent >= s.daily
            ? "Your daily spending limit has been reached."
            : "Your daily spending is within budget."}
        </h2>
        <Field label="Control mode">
          <select
            value={s.control}
            onChange={(e) =>
              e.target.value === "User-confirmed restriction"
                ? A(true)
                : set((p) => ({ ...p, control: e.target.value }))
            }
          >
            {[
              "Disabled",
              "Reminder",
              "Warning",
              "User-confirmed restriction",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </Field>
        <p>
          Only selected demo apps participate. Phone, emergency, settings and
          accessibility functions stay available.
        </p>
        {["Amazon", "Swiggy", "Zomato", "Flipkart"].map((app) => (
          <div key={app} className="listline">
            <label>
              <input
                type="checkbox"
                checked={s.apps.includes(app)}
                onChange={(e) =>
                  set((p) => ({
                    ...p,
                    apps: e.target.checked
                      ? [...p.apps, app]
                      : p.apps.filter((x) => x !== app),
                  }))
                }
              />{" "}
              {app}
            </label>
            <button className="link" onClick={() => M(app)}>
              Simulate opening
            </button>
          </div>
        ))}
        <div className="formend">
          <Btn
            kind="ghost"
            onClick={() => {
              set((p) => ({ ...p, control: "Disabled" }));
              M("");
            }}
          >
            Disable control
          </Btn>
          <Btn onClick={() => go("/")}>Return to dashboard</Btn>
        </div>
      </section>
      {ask && (
        <Confirm
          text="Enable reversible demo restrictions for selected apps?"
          cancel={() => A(false)}
          accept={() => {
            set((p) => ({ ...p, control: "User-confirmed restriction" }));
            A(false);
          }}
        />
      )}
      {mock && (
        <div className="overlay">
          <div className="dialog">
            <Badge>App simulation</Badge>
            <h2>{mock}</h2>
            <p>
              {active
                ? s.control + " · Your daily spending limit has been reached."
                : "This demo app opens normally."}
            </p>
            <p>
              {f(m.spent)} spent of {f(s.daily)} today.
            </p>
            <Btn onClick={() => M("")}>
              {active ? "Emergency override / continue" : "Close"}
            </Btn>
          </div>
        </div>
      )}
    </>
  );
}

import type { SelectedBank } from "./banks";
export const cats = [
  "Food",
  "Travel",
  "Shopping",
  "Bills",
  "Entertainment",
  "Education",
  "Health",
  "Others",
];
export const dateKey = (d = new Date()) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
export const offset = (n: number, base = new Date()) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};
export const parse = (s: string) => new Date(s + "T12:00:00");
export type Tx = {
  id: string;
  title: string;
  amount: number;
  category: string;
  date: string;
  time: string;
  type: "credit" | "debit";
  method: string;
  notes: string;
  fixed?: boolean;
  source?: "manual" | "notification" | "bank" | "reminder" | "whatsapp";
  bankId?: string;
  account?: string;
  ref?: string;
  confidence?: number;
  recon?: "confirmed" | "auto" | "user-confirmed";
  purpose?: string; // what the user said the payment was for
  purposeSkip?: boolean; // user chose not to answer
};
// Payments detected automatically that still need the "what was it for?" answer.
export const needsPurpose = (t: Tx) => t.type === "debit" && (t.source === "notification" || t.source === "whatsapp") && t.purpose === undefined && !t.purposeSkip;
export type ReviewItem = {
  id: string;
  bankId: string;
  amount: number;
  type: "credit" | "debit";
  title: string;
  account?: string;
  ref?: string;
  ts: number;
  confidence: number;
  reason: string;
  category: string;
};
export type NLog = { id: string; ts: number; bankId: string; result: "saved" | "review" | "ignored" | "duplicate" | "test"; summary: string };
export type Goal = { id: string; name: string; target: number; saved: number };
export type Rule = {
  id: string;
  title: string;
  amount: number;
  enabled: boolean;
  time: string;
  day: number;
  frequency: string;
  variation: number;
  remind: boolean;
};
export type Notice = {
  id: string;
  title: string;
  body: string;
  to: string;
  read: boolean;
  date: string;
};
export type State = {
  name: string;
  email: string;
  country: string;
  currency: string;
  income: number;
  daily: number;
  monthly: number;
  opening: number;
  tx: Tx[];
  bills: Rule[];
  rules: Rule[];
  notes: Notice[];
  dark: boolean;
  ready: boolean;
  bank: boolean;
  wa: boolean;
  sync: string;
  permission: string;
  alerts: boolean;
  control: string;
  apps: string[];
  guardApps?: string[]; // Android package names blocked/warned when the daily limit is reached
  importState: string;
  handled: string[];
  billHistory: string[];
  uid: string;
  photo: string;
  banks: SelectedBank[];
  review: ReviewItem[];
  nlog: NLog[];
  seen: string[];
  goals: Goal[];
  parentName: string;
  parentPhone: string;
  reportOn: boolean;
  reportTime: string;
  bankDone: boolean;
};
export const uid = () => crypto.randomUUID();
export const total = (xs: Tx[]) =>
  Math.round(xs.reduce((v, t) => v + t.amount, 0) * 100) / 100;
export const money = (n: number, c = "INR", digits = 0) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: c,
    minimumFractionDigits: digits,
    maximumFractionDigits: Math.max(digits, Number.isInteger(n) ? 0 : 2),
  }).format(n);
export const rule = (
  title: string,
  amount: number,
  time = "13:00",
  day = 1,
  frequency = "Daily",
): Rule => ({
  id: uid(),
  title,
  amount,
  enabled: true,
  time,
  day,
  frequency,
  variation: 20,
  remind: true,
});
// Balance shown on the dashboard.
// 1) If the primary bank's notification contained an "Avl Bal", start from that figure and apply only
//    transactions recorded AFTER that notification (source: "bank").
// 2) Otherwise: opening balance (user-entered) + credits - debits from the records (source: "records").
function liveBalance(s: State, debits: Tx[]) {
  const p = s.banks.find((b) => b.primary) || s.banks[0];
  if (p?.lastBalance) {
    const at = (t: Tx) => new Date(t.date + "T" + (t.time || "00:00")).getTime();
    const later = s.tx.filter((t) => at(t) > p.lastBalance!.ts && (!t.bankId || t.bankId === p.id));
    return {
      balance: p.lastBalance.amount + total(later.filter((t) => t.type === "credit")) - total(later.filter((t) => t.type === "debit")),
      balanceSource: "bank" as const,
      balanceTs: p.lastBalance.ts,
    };
  }
  return { balance: s.opening + total(s.tx.filter((x) => x.type === "credit")) - total(debits), balanceSource: "records" as const, balanceTs: 0 };
}
export function summary(s: State) {
  const today = dateKey(),
    debits = s.tx.filter((x) => x.type === "debit"),
    month = debits.filter((x) => x.date.startsWith(today.slice(0, 7))),
    spent = total(debits.filter((x) => x.date === today && !x.fixed));
  return {
    debits,
    month,
    spent,
    monthly: total(month),
    ...liveBalance(s, debits),
    fixed: s.bills.filter((x) => x.enabled).reduce((a, b) => a + b.amount, 0),
  };
}

export function emptyState(u: { uid: string; name: string; email: string; photo: string }): State {
  return {
    name: u.name || "there",
    email: u.email,
    country: "India",
    currency: "INR",
    income: 0,
    daily: 500,
    monthly: 15000,
    opening: 0,
    tx: [],
    bills: [],
    rules: [],
    notes: [],
    dark: false,
    ready: false,
    bank: false,
    wa: false,
    sync: new Date().toISOString(),
    permission: "Not requested",
    alerts: true,
    control: "Disabled",
    apps: [],
    importState: "ignored",
    handled: [],
    billHistory: [],
    uid: u.uid,
    photo: u.photo,
    banks: [],
    review: [],
    nlog: [],
    seen: [],
    goals: [],
    parentName: "",
    parentPhone: "",
    reportOn: false,
    reportTime: "21:00",
    bankDone: false,
  };
}
/** Fill fields that older saved/cloud documents may not have. */
export const normalize = (s: State, u: { uid: string; photo: string }): State => ({
  ...emptyState({ uid: u.uid, name: s.name, email: s.email, photo: u.photo }),
  ...s,
  uid: u.uid,
  photo: s.photo || u.photo,
  tx: s.tx || [],
});

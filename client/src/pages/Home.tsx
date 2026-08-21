import { FlowInsights, FlowInsightSettings, defaultFlowInsightPreferences, type FlowInsightPreferences } from "@/components/FlowInsights";
import { InvoiceIntake } from "@/components/InvoiceIntake";
import { LedgerArchivePanel } from "@/components/LedgerArchivePanel";
import { LedgerBrowser } from "@/components/LedgerBrowser";
import { acknowledgeLedgerMutation, cacheEntries, getDeviceId, loadCachedEntries, pendingLedgerMutations, pendingMutationCount, queueLedgerMutation } from "@/lib/offline";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { fixedHandlerForUser, isMajorAllowed, MAJOR_META, MAJORS_BY_DIRECTION, normaliseTags, totalByTag, totalOutflowByMajor, type LedgerDirection, type LedgerEntry, type LedgerMajor } from "@shared/ledger";
import { ArrowDownLeft, ArrowUpRight, BarChart3, BookOpenText, Camera, FilePlus2, Loader2, LogOut, Menu, Plus, Settings2, Tag, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type View = "流向" | "添一頁新帳" | "憑據入冊" | "帳頁翻閱" | "設定";
type Member = { user_id: string; display_name: string; role: "keeper" | "companion" };
type InvoiceItem = { id: string; title: string; amount: number; major: LedgerMajor | null; tags: string[]; handled_by: string | null; classification_confirmed: boolean };
type Invoice = { id: string; seller_name: string; invoice_date: string | null; total_amount: number; state: string; invoice_items: InvoiceItem[] };
type LedgerForm = { direction: LedgerDirection; major: LedgerMajor; title: string; amount: string; occurred_on: string; tags: string; note: string };
const VIEW_LABELS: Record<View, string> = { "流向": "出入流轉", "添一頁新帳": "開卷添潤", "憑據入冊": "憑據入冊", "帳頁翻閱": "帳頁翻閱", "設定": "簿冊規制" };

const money = new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
const fmt = (value: number) => money.format(value || 0);
const isoToday = () => new Date().toISOString().slice(0, 10);
const FLOW_INSIGHT_STORAGE_KEY = "vellum-tides:flow-insight-preferences";
const ACTIVE_VIEW_STORAGE_KEY = "vellum-tides:active-view";
const fieldClass = "w-full rounded-xl border border-vellum-200 bg-vellum-50 px-3.5 py-2.5 text-sm text-ink-700 outline-none transition placeholder:text-ink-500/55 focus:border-moss-500 focus:ring-2 focus:ring-moss-100";
const dateFieldClass = fieldClass;
const emptyForm = (): LedgerForm => ({ direction: "outflow", major: "food", title: "", amount: "", occurred_on: isoToday(), tags: "", note: "" });

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block text-sm font-semibold text-ink-700"><span className="mb-1.5 block">{label}</span>{children}</label>;
}

function StatusMark({ online, pending }: { online: boolean; pending: number }) {
  const text = !online ? "離線暫存中" : pending ? `補登中 · ${pending}` : "已同步";
  const hue = !online ? "bg-ochre-500" : pending ? "animate-pulse bg-moss-500" : "bg-moss-500";
  return <span className="inline-flex items-center gap-2 rounded-full border border-vellum-200 bg-vellum-50 px-3 py-1.5 text-xs text-ink-500"><i className={`h-2 w-2 rounded-full ${hue}`} />{text}</span>;
}

function AuthGate({ onReady }: { onReady: (user: { id: string; email?: string | null }) => void }) {
  const [mode, setMode] = useState<"signin" | "recover" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setMode("reset");
      if (session?.user) onReady(session.user);
    });
    return () => data.subscription.unsubscribe();
  }, [onReady]);
  const submit = async () => {
    if (!supabase) return;
    setBusy(true);
    try {
      if (mode === "recover") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        toast.success("復原信箋已寄出。");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        toast.success("新密語已收妥。");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "此刻無法續寫，請稍後再試。");
    } finally { setBusy(false); }
  };
  const action = mode === "recover" ? "寄出復原信箋" : mode === "reset" ? "收下新密語" : "翻開帳頁";
  return <main className="paper-grain flex min-h-screen items-center justify-center p-5"><section className="w-full max-w-md rounded-[2rem] border border-vellum-200 bg-vellum-50/95 p-7 shadow-[0_24px_70px_oklch(0.31_0.055_248_/_0.16)] sm:p-10"><div className="mb-9 text-center"><div className="mx-auto mb-5 h-20 w-20 overflow-hidden rounded-[1.65rem] border border-ochre-300/70 bg-vellum-100 shadow-[0_8px_22px_oklch(0.31_0.055_248_/_0.18)]"><img src="/vellum-tides-icon.svg" alt="歲時錄圖標" className="h-full w-full object-cover" /></div><p className="mb-2 text-xs font-bold tracking-[.24em] text-ochre-700">VELLUM TIDES</p><h1 aria-label="歲時錄 · Vellum Tides" className="font-vellum text-3xl font-black tracking-wide text-ink-700"><span>歲時錄</span><span className="ml-2 text-base tracking-[.12em]">· Vellum Tides</span></h1><div className="tide-rule mx-auto mt-4 w-28" /><p className="mt-3 text-sm leading-6 text-ink-500">琴瑟和鳴，共譜歲月。</p></div><div className="space-y-4"><Field label="雲箋信札"><input value={email} onChange={event => setEmail(event.target.value)} type="email" className={`mt-1.5 ${fieldClass}`} /></Field>{mode !== "recover" && <Field label="私言密語"><input value={password} onChange={event => setPassword(event.target.value)} type="password" className={`mt-1.5 ${fieldClass}`} /></Field>}<button onClick={submit} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-ink-700 px-4 py-3 font-semibold text-vellum-50 shadow-[0_7px_18px_oklch(0.31_0.055_248_/_0.2)] transition hover:bg-ink-900 disabled:opacity-60">{busy && <Loader2 size={16} className="animate-spin" />}{action}</button><p className="rounded-xl border border-ochre-300/60 bg-ochre-100/55 px-4 py-3 text-xs leading-5 text-ink-500">此乃私密雙人簿冊，僅限預定之雙影啟閱。</p></div><div className="mt-6 flex justify-center gap-4 text-xs text-ink-500">{mode !== "signin" && <button className="transition hover:text-ink-700" onClick={() => setMode("signin")}>回到啟閱</button>}{mode === "signin" && <button className="transition hover:text-ink-700" onClick={() => setMode("recover")}>尋回密語</button>}</div></section></main>;
}

export default function Home() {
  const [user, setUser] = useState<{ id: string; email?: string | null } | null>(null);
  const [householdId, setHouseholdId] = useState("");
  const [title, setTitle] = useState("歲時錄 · Vellum Tides");
  const [entries, setEntries] = useState<LedgerEntry[]>([]); // 保留本年度洞察所需資料；完整帳頁由 LedgerBrowser 分段讀取。
  const [members, setMembers] = useState<Member[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [view, setView] = useState<View>(() => {
    const stored = typeof window === "undefined" ? null : window.sessionStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
    return stored === "添一頁新帳" || stored === "憑據入冊" || stored === "帳頁翻閱" || stored === "設定" || stored === "流向" ? stored : "流向";
  });
  const [form, setForm] = useState<LedgerForm>(emptyForm());
  const [editing, setEditing] = useState<string | null>(null);
  const [ledgerRevision, setLedgerRevision] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => { window.sessionStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, view); }, [view]);
  const [filters, setFilters] = useState({ from: "", to: "", direction: "all", major: "all", tag: "all", handler: "all" });
  const [flowInsightPreferences, setFlowInsightPreferences] = useState<FlowInsightPreferences>(() => {
    try { const stored = window.localStorage.getItem(FLOW_INSIGHT_STORAGE_KEY); return stored ? { ...defaultFlowInsightPreferences, ...JSON.parse(stored) } : defaultFlowInsightPreferences; } catch { return defaultFlowInsightPreferences; }
  });
  const initialisedUserRef = useRef<string | null>(null);
  const currentHandler = fixedHandlerForUser(user?.id);
  const insightRangeStart = () => `${new Date().getFullYear()}-01-01`;

  const reload = async (id = householdId) => {
    if (!supabase || !id) return;
    const [entryRes, memberRes, invoiceRes, homeRes] = await Promise.all([
      supabase.from("ledger_entries").select("*").eq("household_id", id).is("deleted_at", null).gte("occurred_on", insightRangeStart()).order("occurred_on", { ascending: false }).order("updated_at_ms", { ascending: false }),
      supabase.from("household_members").select("user_id,display_name,role").eq("household_id", id),
      supabase.from("invoices").select("id,seller_name,invoice_date,total_amount,state,invoice_items(id,title,amount,major,tags,handled_by,classification_confirmed)").eq("household_id", id).eq("state", "awaiting_confirmation").order("created_at", { ascending: false }),
      supabase.from("households").select("title").eq("id", id).single(),
    ]);
    if (entryRes.error) toast.error(`帳頁讀取失敗：${entryRes.error.message}`);
    else { const rows = (entryRes.data ?? []).map(row => ({ ...row, amount: Number(row.amount), tags: row.tags ?? [] })) as LedgerEntry[]; setEntries(rows); await cacheEntries(rows); }
    if (memberRes.error) toast.error(`成員讀取失敗：${memberRes.error.message}`); else setMembers((memberRes.data ?? []) as Member[]);
    if (invoiceRes.error) toast.error(`憑據讀取失敗：${invoiceRes.error.message}`); else setInvoices((invoiceRes.data ?? []).map(row => ({ ...row, total_amount: Number(row.total_amount), invoice_items: (row.invoice_items ?? []).map(item => ({ ...item, amount: Number(item.amount), tags: item.tags ?? [] })) })) as Invoice[]);
    if (homeRes.data?.title) setTitle(homeRes.data.title);
  };
  const flush = async () => {
    if (!supabase || !navigator.onLine) return;
    for (const mutation of await pendingLedgerMutations()) { const { error } = await supabase.rpc("apply_ledger_mutation", { p_payload: mutation.payload }); if (!error) await acknowledgeLedgerMutation(mutation.id); }
    setPending(await pendingMutationCount());
    if (householdId) await reload(householdId);
  };
  const initialise = async (nextUser: { id: string; email?: string | null }) => {
    if (!supabase || initialisedUserRef.current === nextUser.id) return;
    initialisedUserRef.current = nextUser.id;
    setUser(nextUser); setLoading(true);
    try { const { data, error } = await supabase.rpc("ensure_personal_household", { p_title: "歲時錄 · Vellum Tides" }); if (error) throw error; const nextId = data as string; setHouseholdId(nextId); await reload(nextId); await flush(); }
    catch (error) { setEntries(await loadCachedEntries(householdId)); toast.error(error instanceof Error ? `帳頁尚未展開：${error.message}` : "帳頁尚未展開。"); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (!supabase) return; void supabase.auth.getSession().then(({ data }) => { if (data.session?.user) void initialise(data.session.user); }); }, []);
  useEffect(() => { if (!supabase) return; const { data } = supabase.auth.onAuthStateChange((_event, session) => { if (!session) { initialisedUserRef.current = null; setUser(null); setHouseholdId(""); setEntries([]); setMembers([]); setInvoices([]); } }); return () => data.subscription.unsubscribe(); }, []);
  useEffect(() => { const updateConnection = () => { setOnline(navigator.onLine); if (navigator.onLine) void flush(); }; window.addEventListener("online", updateConnection); window.addEventListener("offline", updateConnection); return () => { window.removeEventListener("online", updateConnection); window.removeEventListener("offline", updateConnection); }; }, [householdId]);
  useEffect(() => { void pendingMutationCount().then(setPending); }, [entries]);
  useEffect(() => { window.localStorage.setItem(FLOW_INSIGHT_STORAGE_KEY, JSON.stringify(flowInsightPreferences)); }, [flowInsightPreferences]);

  const allTags = useMemo(() => Array.from(new Set(entries.flatMap(entry => entry.tags))).sort((a, b) => a.localeCompare(b, "zh-Hant-TW")), [entries]);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentYear = currentMonth.slice(0, 4);
  const monthly = useMemo(() => entries.filter(entry => entry.occurred_on.startsWith(currentMonth)), [entries, currentMonth]);
  const inflow = monthly.filter(entry => entry.direction === "inflow").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const outflow = monthly.filter(entry => entry.direction === "outflow").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const yearly = useMemo(() => entries.filter(entry => entry.occurred_on.startsWith(currentYear)), [entries, currentYear]);
  const yearlyInflow = yearly.filter(entry => entry.direction === "inflow").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const yearlyOutflow = yearly.filter(entry => entry.direction === "outflow").reduce((sum, entry) => sum + Number(entry.amount), 0);
  const majorTotals = useMemo(() => totalOutflowByMajor(monthly), [monthly]);
  const resetForm = () => { setForm(emptyForm()); setEditing(null); };
  const changeDirection = (direction: LedgerDirection) => setForm(current => ({ ...current, direction, major: direction === "outflow" ? "food" : "salary" }));
  const addExistingTag = (tag: string) => setForm(current => ({ ...current, tags: normaliseTags(`${current.tags} ${tag}`).join(" ") }));
  const saveEntry = async () => {
    if (!user || !householdId) return;
    if (!form.amount || Number(form.amount) <= 0 || !form.title.trim()) return toast.error("請填妥名目與金額。", { description: "名目是具體的交易名稱，例如土壤、魚或掃把。" });
    if (!isMajorAllowed(form.direction, form.major)) return toast.error("流向與大目不相符。", { description: "散逸與入納各有固定大目；請重新選擇。" });
    const isEditing = Boolean(editing); const now = Date.now(); const id = editing ?? crypto.randomUUID(); const previous = entries.find(entry => entry.id === id);
    const payload: LedgerEntry = { id, household_id: householdId, direction: form.direction, major: form.major, title: form.title.trim(), amount: Math.round(Number(form.amount)), occurred_on: form.occurred_on, tags: normaliseTags(form.tags), note: form.note.trim(), handled_by: currentHandler?.user_id ?? user.id, created_by: previous?.created_by ?? user.id, updated_by: user.id, updated_at_ms: now, device_id: await getDeviceId(), deleted_at: null };
    const next = isEditing ? entries.map(entry => entry.id === id ? payload : entry) : [payload, ...entries]; setEntries(next); await cacheEntries(next); await queueLedgerMutation(payload); setPending(await pendingMutationCount()); resetForm();
    if (navigator.onLine) { await flush(); toast.success(isEditing ? "帳頁已覆寫。" : "新帳已添入歲時錄。"); } else toast.success("已先收進離線書籤，重連後會自動補登。");
    setLedgerRevision(current => current + 1);
    if (isEditing) setView("帳頁翻閱");
  };
  const editEntry = (entry: LedgerEntry) => { setEntries(current => current.some(item => item.id === entry.id) ? current : [entry, ...current]); setEditing(entry.id); setForm({ direction: entry.direction, major: entry.major, title: entry.title, amount: String(entry.amount), occurred_on: entry.occurred_on, tags: entry.tags.join(" "), note: entry.note }); setView("添一頁新帳"); };
  const removeEntry = async (entry: LedgerEntry) => { if (!user) return; const payload = { ...entry, updated_by: user.id, updated_at_ms: Date.now(), device_id: await getDeviceId(), deleted_at: new Date().toISOString() }; setEntries(current => current.filter(item => item.id !== entry.id)); await queueLedgerMutation(payload); setPending(await pendingMutationCount()); if (navigator.onLine) await flush(); setLedgerRevision(current => current + 1); };
  const signOut = async () => { if (supabase) await supabase.auth.signOut(); setUser(null); toast.success("帳頁已闔上。"); };
  const updateInvoiceItem = async (invoiceId: string, item: InvoiceItem, patch: Partial<InvoiceItem>) => { if (!supabase) return; const next = { ...item, ...patch }; setInvoices(current => current.map(invoice => invoice.id !== invoiceId ? invoice : { ...invoice, invoice_items: invoice.invoice_items.map(row => row.id === item.id ? next : row) })); const { error } = await supabase.from("invoice_items").update({ title: next.title.trim(), major: next.major, tags: normaliseTags(next.tags), handled_by: next.handled_by, classification_confirmed: Boolean(next.major && next.title.trim()) }).eq("id", item.id); if (error) { toast.error(error.message); await reload(); } };
  const postInvoice = async (id: string) => { if (!supabase) return; const { error } = await supabase.rpc("post_invoice", { p_invoice_id: id }); if (error) toast.error(error.message); else { toast.success("憑據已逐項歸入帳本。" ); await reload(); } };
  if (!isSupabaseConfigured) return <main className="grid min-h-screen place-items-center p-6 text-center"><div><BookOpenText className="mx-auto mb-4 text-[#263f59]" /><h1 className="font-vellum text-3xl font-black text-[#263f59]">尚未繫上資料庫</h1><p className="mt-3 text-sm text-[#657080]">請在專案設定中提供 Supabase 網址與 Publishable Key。</p></div></main>;
  if (!user) return <AuthGate onReady={initialise} />;
  const nav: Array<{ view: View; label: string; icon: typeof BarChart3 }> = [{ view: "流向", label: VIEW_LABELS["流向"], icon: BarChart3 }, { view: "添一頁新帳", label: VIEW_LABELS["添一頁新帳"], icon: FilePlus2 }, { view: "憑據入冊", label: "憑據入冊", icon: Camera }, { view: "帳頁翻閱", label: "帳頁翻閱", icon: BookOpenText }, { view: "設定", label: VIEW_LABELS["設定"], icon: Settings2 }];
  return <main className="paper-grain min-h-screen bg-vellum-100 text-ink-700"><aside className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-vellum-200 bg-vellum-50 p-5 shadow-[8px_0_30px_oklch(0.31_0.055_248_/_0.06)] transition-transform md:translate-x-0 ${mobileNav ? "translate-x-0" : "-translate-x-full"}`}><button className="absolute right-4 top-4 text-ink-700 md:hidden" onClick={() => setMobileNav(false)} aria-label="關閉選單"><X /></button><div className="mb-9 flex items-center gap-3"><div className="h-11 w-11 overflow-hidden rounded-2xl bg-ink-700"><img src="/vellum-tides-icon.svg" alt="歲時錄圖標" className="h-full w-full object-cover" /></div><div><p className="font-vellum text-xl font-black text-ink-700">歲時錄</p><p className="text-[10px] font-bold tracking-[.18em] text-ochre-700">VELLUM TIDES</p></div></div><div className="ink-rule mb-4" /><nav className="space-y-1">{nav.map(item => { const Icon = item.icon; return <button key={item.view} onClick={() => { setView(item.view); setMobileNav(false); }} className={`flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold transition ${view === item.view ? "bg-ink-700 text-vellum-50 shadow" : "text-ink-500 hover:bg-vellum-200"}`}><Icon size={17} />{item.label}</button>; })}</nav><div className="mt-auto border-t border-vellum-200 pt-5"><button onClick={signOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-ochre-700 transition hover:bg-ochre-100"><LogOut size={17} />闔上帳頁</button></div></aside><section className="min-h-screen md:pl-72"><header className="sticky top-0 z-20 flex items-center justify-between border-b border-vellum-200 bg-vellum-50/90 px-5 py-4 backdrop-blur md:px-10"><div className="flex items-center gap-3"><button className="text-ink-700 md:hidden" onClick={() => setMobileNav(true)} aria-label="開啟選單"><Menu /></button><div><p className="text-xs font-bold tracking-[.16em] text-ochre-700">{title}</p><h1 className="font-vellum text-2xl font-black text-ink-700">{VIEW_LABELS[view]}</h1></div></div><StatusMark online={online} pending={pending} /></header><div className="mx-auto max-w-7xl p-5 md:p-10">{loading ? <div className="grid min-h-[45vh] place-items-center"><Loader2 className="animate-spin text-moss-500" /></div> : <>
    {view === "流向" && <section className="space-y-7"><div className="grid gap-5 xl:grid-cols-2"><PeriodLedgerSummary label="當月" period={`${Number(currentMonth.slice(0, 4))} 年 ${Number(currentMonth.slice(5, 7))} 月`} inflow={inflow} outflow={outflow} fmt={fmt} /><PeriodLedgerSummary label="今歲" period={`${Number(currentYear)} 年累計`} inflow={yearlyInflow} outflow={yearlyOutflow} fmt={fmt} /></div><div className="grid gap-6 lg:grid-cols-[1.3fr_.7fr]"><article className="rounded-[1.6rem] border border-vellum-200 bg-vellum-50 p-6 shadow-sm shadow-ink-700/5"><div className="mb-5 flex items-center gap-2"><ArrowDownLeft size={18} className="text-ochre-700" /><h2 className="font-vellum text-xl font-black text-ink-700">散逸大目</h2></div>{majorTotals.length ? <div className="space-y-4">{majorTotals.map(item => <div key={item.major}><div className="mb-1.5 flex justify-between text-sm"><span className="font-semibold">{MAJOR_META[item.major].label}<span className="ml-2 text-xs font-normal text-ink-500">{MAJOR_META[item.major].description}</span></span><span>{fmt(item.amount)}</span></div><div className="h-2 overflow-hidden rounded-full bg-vellum-200"><div className="h-full rounded-full" style={{ width: `${Math.max(4, item.amount / Math.max(outflow, 1) * 100)}%`, background: MAJOR_META[item.major].tone }} /></div></div>)}</div> : <EmptyText>本月尚無散逸帳頁。</EmptyText>}</article><article className="rounded-[1.6rem] border border-vellum-200 bg-vellum-50 p-6 shadow-sm shadow-ink-700/5"><div className="mb-5 flex items-center gap-2"><Tag size={18} className="text-moss-700" /><h2 className="font-vellum text-xl font-black text-ink-700">本月符契</h2></div>{totalByTag(monthly).slice(0, 6).length ? <div className="space-y-3">{totalByTag(monthly).slice(0, 6).map(item => <div key={item.tag} className="flex items-center justify-between rounded-xl border border-moss-300/60 bg-moss-100/55 px-3 py-2"><span className="font-semibold text-moss-700">{item.tag}</span><span className="text-sm text-ink-700">{fmt(item.amount)}</span></div>)}</div> : <EmptyText>為帳頁添上符契後，可跨大目追蹤計畫與興趣。</EmptyText>}</article></div><FlowInsights entries={entries} preferences={flowInsightPreferences} fmt={fmt} /></section>}
    {view === "添一頁新帳" && <section className="mx-auto max-w-3xl rounded-[1.8rem] border border-vellum-200 bg-vellum-50 p-6 shadow-sm md:p-9"><div className="mb-8 flex items-start justify-between"><div><p className="text-xs font-bold tracking-[.18em] text-ochre-700">一葉新帳</p><h2 className="mt-2 font-vellum text-3xl font-black text-ink-700">{editing ? "覆寫此頁" : "開卷添潤"}</h2><p className="mt-2 text-sm text-ink-500">先辨別流向，再寫下大目、名目、歲時、掌簿與符契。</p></div>{editing && <button onClick={() => { resetForm(); setView("帳頁翻閱"); }} className="rounded-lg px-3 py-2 text-sm text-ink-500 transition hover:bg-vellum-200">收回覆寫</button>}</div><div className="grid gap-5 sm:grid-cols-2"><Field label="流向"><div className="grid grid-cols-2 rounded-xl bg-vellum-200 p-1"><button onClick={() => changeDirection("outflow")} className={`rounded-lg py-2 text-sm font-bold ${form.direction === "outflow" ? "bg-ochre-700 text-vellum-50" : "text-ink-500"}`}><ArrowDownLeft className="mr-1 inline" size={15} />散逸</button><button onClick={() => changeDirection("inflow")} className={`rounded-lg py-2 text-sm font-bold ${form.direction === "inflow" ? "bg-moss-700 text-vellum-50" : "text-ink-500"}`}><ArrowUpRight className="mr-1 inline" size={15} />入納</button></div></Field><Field label="大目"><select className={fieldClass} value={form.major} onChange={event => setForm(current => ({ ...current, major: event.target.value as LedgerMajor }))}>{MAJORS_BY_DIRECTION[form.direction].map(major => <option key={major} value={major}>{MAJOR_META[major].label}｜{MAJOR_META[major].description}</option>)}</select></Field><Field label="名目"><input className={fieldClass} value={form.title} onChange={event => setForm(current => ({ ...current, title: event.target.value }))} placeholder="例如：土壤、魚、掃把" /></Field><Field label="金額"><input className={fieldClass} inputMode="numeric" type="number" min="1" value={form.amount} onChange={event => setForm(current => ({ ...current, amount: event.target.value }))} placeholder="0" /></Field><Field label="歲時"><input className={dateFieldClass} type="date" value={form.occurred_on} onChange={event => setForm(current => ({ ...current, occurred_on: event.target.value }))} /></Field><Field label="掌簿"><div className="rounded-xl border border-vellum-200 bg-vellum-100 px-3.5 py-2.5 text-sm font-bold text-ink-700">{currentHandler?.display_name ?? "未識別的登入帳號"}</div></Field></div><div className="mt-5 grid gap-5"><Field label="符契"><input className={fieldClass} value={form.tags} onChange={event => setForm(current => ({ ...current, tags: event.target.value }))} placeholder="#園藝 #水族；以空白或逗號隔開" />{allTags.length > 0 && <div className="mt-3 rounded-xl border border-moss-300/60 bg-moss-100/55 p-3"><p className="mb-2 text-xs font-bold tracking-[.12em] text-moss-700">曾寫過的符契</p><div className="flex flex-wrap gap-2">{allTags.map(tag => <button type="button" key={tag} onClick={() => addExistingTag(tag)} className="rounded-full border border-moss-300 bg-vellum-50 px-3 py-1 text-xs font-semibold text-moss-700 transition hover:bg-moss-100">{tag}</button>)}</div></div>}<p className="mt-2 text-xs text-ink-500">符契可跨大目追蹤同一個計畫、興趣或生活主題。</p></Field><Field label="附記（可留白）"><textarea className={`${fieldClass} min-h-24 resize-y`} value={form.note} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} placeholder="記下這筆流向的來處或心情。" /></Field></div><div className="mt-8 flex justify-end"><button onClick={() => void saveEntry()} className="flex items-center gap-2 rounded-xl bg-ink-700 px-5 py-3 font-bold text-vellum-50 shadow transition hover:bg-ink-900"><Plus size={18} />{editing ? "覆寫帳頁" : "收進帳本"}</button></div></section>}
    {view === "憑據入冊" && <InvoiceIntake householdId={householdId} userId={user.id} members={members} knownTags={allTags} awaitingInvoices={invoices} formatMoney={fmt} onSaved={() => reload()} onUpdateInvoiceItem={updateInvoiceItem} onPostInvoice={postInvoice} />}
    {view === "帳頁翻閱" && <LedgerBrowser householdId={householdId} members={members} revision={ledgerRevision} onEdit={editEntry} onRemove={removeEntry} fmt={fmt} />}
    {view === "設定" && <section className="mx-auto max-w-3xl space-y-5"><article className="rounded-[1.5rem] border border-vellum-200 bg-vellum-50 p-6"><h2 className="font-vellum text-2xl font-black text-ink-700">這一冊的約定</h2><dl className="mt-5 grid gap-3 sm:grid-cols-2">{[["共用帳頁", "玉瑟與石琴登入後，閱讀與書寫同一冊資料。"], ["流向", "散逸為資產支出；入納為資產收入。"], ["大目", "散逸五大目、入納三大目，固定而清楚。"], ["名目", "一筆具體交易的名稱，例如土壤、魚或掃把。"], ["歲時", "交易發生的年月日。"], ["掌簿", "依登入帳號自動記下玉瑟或石琴。"], ["符契", "跨大目追蹤的計畫或興趣標籤。"], ["憑據入冊", "觀圖析字、鏡觀條印與手動品項都會先等待確認。"]].map(([term, text]) => <div key={term} className="rounded-xl bg-vellum-100 p-3"><dt className="font-bold text-ink-700">{term}</dt><dd className="mt-1 text-sm text-ink-500">{text}</dd></div>)}</dl></article><FlowInsightSettings preferences={flowInsightPreferences} onChange={setFlowInsightPreferences} /><LedgerArchivePanel householdId={householdId} online={online} pending={pending} onRestored={async () => { await reload(); setLedgerRevision(current => current + 1); }} /></section>}
  </>}</div></section></main>;
}

function PeriodLedgerSummary({ label, period, inflow, outflow, fmt }: { label: string; period: string; inflow: number; outflow: number; fmt: (value: number) => string }) {
  return <article className="overflow-hidden rounded-[1.6rem] border border-vellum-200 bg-vellum-50 shadow-sm"><div className="flex items-end justify-between gap-3 border-b border-vellum-200 bg-vellum-100 px-5 py-4"><div><p className="text-xs font-bold tracking-[.18em] text-ochre-700">{label}</p><h2 className="mt-1 font-vellum text-xl font-black text-ink-700">{period}</h2></div><p className="text-xs text-ink-500">出入總覽</p></div><div className="grid grid-cols-3 divide-x divide-vellum-200"><div className="min-w-0 px-4 py-4"><p className="text-xs font-bold tracking-[.1em] text-moss-700">入納</p><p className="mt-2 truncate font-vellum text-xl font-black text-moss-700">{fmt(inflow)}</p></div><div className="min-w-0 px-4 py-4"><p className="text-xs font-bold tracking-[.1em] text-ochre-700">散逸</p><p className="mt-2 truncate font-vellum text-xl font-black text-ochre-700">{fmt(outflow)}</p></div><div className="min-w-0 px-4 py-4"><p className="text-xs font-bold tracking-[.1em] text-moss-700">留存</p><p className="mt-2 truncate font-vellum text-xl font-black text-moss-700">{fmt(inflow - outflow)}</p></div></div></article>;
}

function EmptyText({ children }: { children: ReactNode }) { return <p className="rounded-[1.5rem] border border-dashed border-vellum-200 bg-vellum-100 p-10 text-center text-sm text-ink-500">{children}</p>; }

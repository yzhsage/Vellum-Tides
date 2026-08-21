import { supabase } from "@/lib/supabase";
import { MAJOR_META, type LedgerDirection, type LedgerEntry, type LedgerMajor } from "@shared/ledger";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, Download, Filter, Loader2, Tag } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Member = { user_id: string; display_name: string; role: "keeper" | "companion" };
type BrowserFilters = { from: string; to: string; direction: "all" | LedgerDirection; major: "all" | LedgerMajor; tag: string; handler: string };
type BrowserSummary = { total_count: number; outflow_total: number; inflow_total: number };
type LedgerDayGroup = { date: string; entries: LedgerEntry[]; inflow: number; outflow: number };
type LedgerMonthGroup = { month: string; days: LedgerDayGroup[]; count: number; inflow: number; outflow: number };

const PAGE_SIZE = 45;
const initialFilters: BrowserFilters = { from: "", to: "", direction: "all", major: "all", tag: "all", handler: "all" };
const fieldClass = "w-full rounded-xl border border-vellum-200 bg-vellum-50 px-3.5 py-2.5 text-sm text-ink-700 outline-none transition focus:border-moss-500 focus:ring-2 focus:ring-moss-100";
const dateFieldClass = "h-10 min-h-0 w-full max-w-[12.25rem] min-w-0 rounded-xl border border-vellum-200 bg-vellum-50 px-3.5 py-1 text-sm leading-5 text-ink-700 outline-none transition focus:border-moss-500 focus:ring-2 focus:ring-moss-100";

function localDate(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "long", day: "numeric", weekday: "short" }).format(new Date(`${value}T12:00:00`));
}

function normaliseRow(row: Record<string, unknown>): LedgerEntry {
  return { ...row, amount: Number(row.amount), tags: Array.isArray(row.tags) ? row.tags : [] } as LedgerEntry;
}

function LedgerLeaf({ entry, members, onEdit, onRemove, fmt }: { entry: LedgerEntry; members: Member[]; onEdit: (entry: LedgerEntry) => void; onRemove: (entry: LedgerEntry) => Promise<void>; fmt: (value: number) => string }) {
  const [removing, setRemoving] = useState(false);
  const remove = async () => {
    if (!confirm(`確定要收起「${entry.title}」這一頁嗎？`)) return;
    setRemoving(true);
    try { await onRemove(entry); }
    finally { setRemoving(false); }
  };
  const handler = members.find(member => member.user_id === entry.handled_by)?.display_name ?? "未署名";
  return <article className="flex items-start gap-3 px-4 py-3 first:pt-0 last:pb-0"><div className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${entry.direction === "outflow" ? "bg-ochre-100 text-ochre-700" : "bg-moss-100 text-moss-700"}`}>{entry.direction === "outflow" ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}</div><div className="min-w-0 flex-1"><h3 title={entry.title} aria-label={`名目：${entry.title}`} className="truncate font-vellum text-lg font-black leading-tight text-ink-700">{entry.title}</h3><div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5"><span className="shrink-0 rounded-full bg-vellum-200 px-2 py-0.5 text-xs font-bold text-ink-500">{MAJOR_META[entry.major].label}</span>{entry.tags.slice(0, 2).map(tag => <span key={tag} title={tag} className="max-w-24 shrink-0 truncate rounded-full bg-moss-100 px-2 py-0.5 text-xs font-semibold text-moss-700">{tag}</span>)}{entry.tags.length > 2 && <span className="shrink-0 text-xs font-semibold text-ink-500">+{entry.tags.length - 2}</span>}<span title={`掌簿：${handler}`} className="shrink-0 rounded-full bg-ink-700/8 px-2 py-0.5 text-xs font-semibold text-ink-500">掌簿：{handler}</span></div>{entry.note && <p title={entry.note} className="mt-2 break-words rounded-lg border border-vellum-200 bg-vellum-100 px-2.5 py-1.5 text-sm leading-5 text-ink-500"><span className="mr-1.5 text-xs font-bold text-ochre-700">附記</span>{entry.note}</p>}</div><div className="flex shrink-0 flex-col items-end text-right"><strong className={`whitespace-nowrap font-vellum text-xl leading-tight ${entry.direction === "outflow" ? "text-ochre-700" : "text-moss-700"}`}>{entry.direction === "outflow" ? "−" : "+"}{fmt(entry.amount)}</strong><div className="mt-2 flex justify-end gap-2 text-xs"><button type="button" onClick={() => onEdit(entry)} className="text-moss-700">覆寫</button><button type="button" disabled={removing} onClick={() => void remove()} className="text-ochre-700 disabled:opacity-50">{removing ? "收起中" : "收起"}</button></div></div></article>;
}

function groupLedgerEntries(entries: LedgerEntry[]): LedgerMonthGroup[] {
  const months = new Map<string, Map<string, LedgerEntry[]>>();
  entries.forEach(entry => {
    const month = entry.occurred_on.slice(0, 7);
    const days = months.get(month) ?? new Map<string, LedgerEntry[]>();
    days.set(entry.occurred_on, [...(days.get(entry.occurred_on) ?? []), entry]);
    months.set(month, days);
  });
  return Array.from(months.entries()).map(([month, days]) => {
    const groupedDays = Array.from(days.entries()).map(([date, dayEntries]) => ({ date, entries: dayEntries, inflow: dayEntries.filter(entry => entry.direction === "inflow").reduce((sum, entry) => sum + entry.amount, 0), outflow: dayEntries.filter(entry => entry.direction === "outflow").reduce((sum, entry) => sum + entry.amount, 0) }));
    const allEntries = groupedDays.flatMap(day => day.entries);
    return { month, days: groupedDays, count: allEntries.length, inflow: allEntries.filter(entry => entry.direction === "inflow").reduce((sum, entry) => sum + entry.amount, 0), outflow: allEntries.filter(entry => entry.direction === "outflow").reduce((sum, entry) => sum + entry.amount, 0) };
  });
}

function MonthVolume({ volume, index, members, onEdit, onRemove, fmt }: { volume: LedgerMonthGroup; index: number; members: Member[]; onEdit: (entry: LedgerEntry) => void; onRemove: (entry: LedgerEntry) => Promise<void>; fmt: (value: number) => string }) {
  return <details open={index === 0} className="group overflow-hidden rounded-[1.5rem] border border-vellum-200 bg-vellum-50 shadow-[0_10px_24px_oklch(0.25_0.022_253_/_0.06)]"><summary className="flex cursor-pointer list-none flex-col gap-2.5 bg-vellum-100 px-5 py-3.5 marker:hidden sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex min-w-0 items-start gap-3"><ChevronDown className="mt-0.5 shrink-0 text-ochre-700 transition group-open:rotate-180" size={18} /><div className="min-w-0"><p className="text-[11px] font-bold tracking-[.16em] text-ochre-700">月冊卷次</p><h2 className="mt-0.5 font-vellum text-xl font-black leading-tight text-ink-700 sm:text-2xl">{Number(volume.month.slice(0, 4))} 年 {Number(volume.month.slice(5, 7))} 月</h2><p className="mt-0.5 text-xs text-ink-500">本批 {volume.count} 頁</p></div></div><div className="flex flex-wrap gap-x-3 gap-y-1 pl-8 text-xs sm:pl-0 sm:text-sm"><span className="text-ochre-700">散逸 <strong>{fmt(volume.outflow)}</strong></span><span className="text-moss-700">入納 <strong>{fmt(volume.inflow)}</strong></span></div></summary><div className="space-y-4 border-t border-vellum-200 p-4 sm:p-5">{volume.days.map(day => <section key={day.date} className="overflow-hidden rounded-[1.15rem] border border-vellum-200 bg-vellum-50"><header className="flex flex-col gap-1.5 border-b border-vellum-200 bg-vellum-100 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"><h3 className="font-vellum text-base font-black text-ink-700 sm:text-lg">{localDate(day.date)}</h3><div className="flex gap-3 text-[11px] font-semibold sm:text-xs"><span className="text-ochre-700">散逸 {fmt(day.outflow)}</span><span className="text-moss-700">入納 {fmt(day.inflow)}</span></div></header><div className="divide-y divide-vellum-200 px-1 pb-3 pt-1">{day.entries.map(entry => <LedgerLeaf key={entry.id} entry={entry} members={members} onEdit={onEdit} onRemove={onRemove} fmt={fmt} />)}</div></section>)}</div></details>;
}

export function LedgerBrowser({ householdId, members, revision, onEdit, onRemove, fmt }: { householdId: string; members: Member[]; revision: number; onEdit: (entry: LedgerEntry) => void; onRemove: (entry: LedgerEntry) => Promise<void>; fmt: (value: number) => string }) {
  const [filters, setFilters] = useState<BrowserFilters>(initialFilters);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [summary, setSummary] = useState<BrowserSummary | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestId = useRef(0);

  const params = useMemo(() => ({
    p_household_id: householdId,
    p_from: filters.from || null,
    p_to: filters.to || null,
    p_direction: filters.direction === "all" ? null : filters.direction,
    p_major: filters.major === "all" ? null : filters.major,
    p_tag: filters.tag === "all" ? null : filters.tag,
    p_handler: filters.handler === "all" ? null : filters.handler,
  }), [filters, householdId]);

  const loadPage = useCallback(async (nextPage: number, append: boolean) => {
    if (!supabase || !householdId) return;
    const nextRequest = ++requestId.current;
    append ? setLoadingMore(true) : setLoading(true);
    try {
      const tasks: [PromiseLike<{ data: unknown; error: { message: string } | null }>, PromiseLike<{ data: unknown; error: { message: string } | null }>] = [
        supabase.rpc("ledger_browse_page", { ...params, p_page: nextPage, p_page_size: PAGE_SIZE }),
        supabase.rpc("ledger_browse_summary", params),
      ];
      const [pageResult, summaryResult] = await Promise.all(tasks);
      if (nextRequest !== requestId.current) return;
      if (pageResult.error || summaryResult.error) throw new Error(pageResult.error?.message ?? summaryResult.error?.message ?? "無法翻閱帳頁。");
      const nextEntries = ((pageResult.data as Record<string, unknown>[] | null) ?? []).map(normaliseRow);
      const nextSummary = ((summaryResult.data as BrowserSummary[] | null) ?? [])[0] ?? { total_count: 0, outflow_total: 0, inflow_total: 0 };
      setEntries(current => append ? [...current, ...nextEntries.filter(entry => !current.some(existing => existing.id === entry.id))] : nextEntries);
      setSummary({ total_count: Number(nextSummary.total_count), outflow_total: Number(nextSummary.outflow_total), inflow_total: Number(nextSummary.inflow_total) });
      setPage(nextPage);
      setHasMore((nextPage + 1) * PAGE_SIZE < Number(nextSummary.total_count));
    } catch (error) {
      if (nextRequest === requestId.current) toast.error(error instanceof Error ? `帳頁讀取失敗：${error.message}` : "帳頁讀取失敗。", { description: "若剛更新程式，請先執行「歲時錄-v2-帳頁分段與備份.sql」。" });
    } finally {
      if (nextRequest === requestId.current) { setLoading(false); setLoadingMore(false); }
    }
  }, [householdId, params]);

  useEffect(() => { void loadPage(0, false); }, [loadPage, revision]);
  useEffect(() => {
    if (!supabase || !householdId) return;
    void supabase.rpc("ledger_tag_index", { p_household_id: householdId }).then(result => {
      if (!result.error) setKnownTags(((result.data as Array<{ tag: string }> | null) ?? []).map(item => item.tag));
    });
  }, [householdId]);

  const ledgerVolumes = useMemo(() => groupLedgerEntries(entries), [entries]);
  const csv = () => {
    const header = ["歲時", "流向", "大目", "名目", "金額", "符契", "掌簿", "附記"];
    const rows = entries.map(entry => [entry.occurred_on, entry.direction === "outflow" ? "散逸" : "入納", MAJOR_META[entry.major].label, entry.title, entry.amount, entry.tags.join(" "), members.find(member => member.user_id === entry.handled_by)?.display_name ?? "", entry.note]);
    const value = [header, ...rows].map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + value], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `歲時錄-已展開帳頁-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const clearFilters = () => setFilters(initialFilters);
  const remove = async (entry: LedgerEntry) => {
    await onRemove(entry);
    setEntries(current => current.filter(currentEntry => currentEntry.id !== entry.id));
    setSummary(current => current ? { ...current, total_count: Math.max(0, current.total_count - 1), outflow_total: entry.direction === "outflow" ? Math.max(0, current.outflow_total - entry.amount) : current.outflow_total, inflow_total: entry.direction === "inflow" ? Math.max(0, current.inflow_total - entry.amount) : current.inflow_total } : current);
  };

  return <section className="space-y-5"><article className="rounded-[1.55rem] border border-vellum-200 bg-vellum-50 p-5"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="text-xs font-bold tracking-[.16em] text-ochre-700">帳頁卷覽</p><h2 className="mt-1 font-vellum text-2xl font-black text-ink-700">帳頁翻閱</h2><p className="mt-1 text-sm text-ink-500">每批 {PAGE_SIZE} 頁，月份可收闔。</p></div><button type="button" onClick={csv} disabled={!entries.length} className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg px-2 py-2 text-sm font-bold text-moss-700 hover:bg-moss-100 disabled:opacity-45"><Download size={16} />匯出已展開 CSV</button></div><div className="mt-4 grid gap-2 rounded-[1.1rem] bg-vellum-100 p-3 sm:grid-cols-3 sm:gap-3 sm:p-4"><p className="text-sm text-ink-500">符合條件 <strong className="text-ink-700">{summary?.total_count ?? "—"}</strong> 頁</p><p className="text-sm text-ochre-700">散逸 <strong>{summary ? fmt(summary.outflow_total) : "—"}</strong></p><p className="text-sm text-moss-700">入納 <strong>{summary ? fmt(summary.inflow_total) : "—"}</strong></p></div><details className="group mt-4 border-t border-vellum-200 pt-4"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-moss-700 marker:hidden"><Filter size={16} /><span>翻閱條件</span><ChevronDown className="ml-auto transition group-open:rotate-180" size={16} /></summary><div className="mt-4 grid gap-x-5 gap-y-3 md:grid-cols-2 xl:grid-cols-3"><label className="min-w-0 text-xs font-bold text-ink-500">起始歲時<input aria-label="起始歲時" className={`mt-1.5 ${dateFieldClass}`} type="date" value={filters.from} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} /></label><label className="min-w-0 text-xs font-bold text-ink-500">終止歲時<input aria-label="終止歲時" className={`mt-1.5 ${dateFieldClass}`} type="date" value={filters.to} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} /></label><label className="min-w-0 text-xs font-bold text-ink-500">流向<select aria-label="流向" className={`mt-1.5 ${fieldClass}`} value={filters.direction} onChange={event => setFilters(current => ({ ...current, direction: event.target.value as BrowserFilters["direction"] }))}><option value="all">所有流向</option><option value="outflow">散逸</option><option value="inflow">入納</option></select></label><label className="min-w-0 text-xs font-bold text-ink-500">大目<select aria-label="大目" className={`mt-1.5 ${fieldClass}`} value={filters.major} onChange={event => setFilters(current => ({ ...current, major: event.target.value as BrowserFilters["major"] }))}><option value="all">所有大目</option>{Object.entries(MAJOR_META).map(([major, meta]) => <option key={major} value={major}>{meta.label}</option>)}</select></label><label className="min-w-0 text-xs font-bold text-ink-500">符契<select aria-label="符契" className={`mt-1.5 ${fieldClass}`} value={filters.tag} onChange={event => setFilters(current => ({ ...current, tag: event.target.value }))}><option value="all">所有符契</option>{knownTags.map(tag => <option key={tag} value={tag}>{tag}</option>)}</select></label><label className="min-w-0 text-xs font-bold text-ink-500">掌簿<select aria-label="掌簿" className={`mt-1.5 ${fieldClass}`} value={filters.handler} onChange={event => setFilters(current => ({ ...current, handler: event.target.value }))}><option value="all">所有掌簿</option>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}</select></label></div><div className="mt-3 flex justify-end"><button type="button" onClick={clearFilters} className="text-xs font-bold text-ink-500 hover:text-ink-700">清除條件</button></div></details></article>{filters.tag !== "all" && <article className="rounded-[1.35rem] border border-moss-300/60 bg-moss-100/55 px-5 py-4"><div className="flex items-center gap-2"><Tag size={16} className="text-moss-700" /><p className="text-xs font-bold tracking-[.14em] text-moss-700">符契篩選</p></div><div className="mt-2 flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-vellum text-xl font-black text-ink-700">{filters.tag} 的流向</h2><p className="text-sm text-ink-500">散逸 {fmt(summary?.outflow_total ?? 0)}；入納 {fmt(summary?.inflow_total ?? 0)}</p></div></article>}<div className="space-y-4">{loading ? <div className="grid min-h-48 place-items-center rounded-[1.5rem] border border-dashed border-vellum-200 bg-vellum-50"><Loader2 className="animate-spin text-moss-500" /></div> : ledgerVolumes.length ? ledgerVolumes.map((volume, index) => <MonthVolume key={volume.month} volume={volume} index={index} members={members} onEdit={onEdit} onRemove={remove} fmt={fmt} />) : <p className="rounded-[1.5rem] border border-dashed border-vellum-200 bg-vellum-50 p-10 text-center text-sm text-ink-500">此條件下尚無帳頁。</p>}</div>{hasMore && <div className="flex justify-center pt-1"><button type="button" disabled={loadingMore} onClick={() => void loadPage(page + 1, true)} className="inline-flex min-w-44 items-center justify-center gap-2 rounded-xl border border-moss-300 bg-moss-100 px-5 py-3 text-sm font-bold text-moss-700 transition hover:bg-moss-300/60 disabled:opacity-55">{loadingMore && <Loader2 size={16} className="animate-spin" />}續閱下一批</button></div>}</section>;
}

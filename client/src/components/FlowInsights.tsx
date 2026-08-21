import { MAJOR_META, totalByTag, totalOutflowByMajor, type LedgerEntry } from "@shared/ledger";
import { BarChart3, CircleGauge } from "lucide-react";
import { useMemo } from "react";

export type FlowInsightPreferences = {
  monthlyRhythm: boolean;
  spendingCompass: boolean;
};

export const defaultFlowInsightPreferences: FlowInsightPreferences = {
  monthlyRhythm: true,
  spendingCompass: true,
};

type FlowInsightsProps = {
  entries: LedgerEntry[];
  preferences: FlowInsightPreferences;
  fmt: (value: number) => string;
};

const MONTHS_TO_COMPARE = 6;

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date) {
  return `${date.getMonth() + 1}月`;
}

export function FlowInsights({ entries, preferences, fmt }: FlowInsightsProps) {
  const monthlySeries = useMemo(() => {
    const today = new Date();
    return Array.from({ length: MONTHS_TO_COMPARE }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth() - (MONTHS_TO_COMPARE - 1 - index), 1);
      const key = monthKey(date);
      const monthlyEntries = entries.filter(entry => entry.occurred_on.startsWith(key));
      return {
        key,
        label: monthLabel(date),
        inflow: monthlyEntries.filter(entry => entry.direction === "inflow").reduce((sum, entry) => sum + Number(entry.amount), 0),
        outflow: monthlyEntries.filter(entry => entry.direction === "outflow").reduce((sum, entry) => sum + Number(entry.amount), 0),
      };
    });
  }, [entries]);

  const current = monthlySeries[monthlySeries.length - 1];
  const spendingMajor = useMemo(() => totalOutflowByMajor(entries.filter(entry => entry.occurred_on.startsWith(current.key))), [current.key, entries]);
  const scale = Math.max(1, ...monthlySeries.flatMap(point => [point.inflow, point.outflow]));
  const totalSpending = spendingMajor.reduce((sum, item) => sum + item.amount, 0);
  const ring = useMemo(() => {
    if (!totalSpending) return "conic-gradient(var(--vellum-200) 0deg 360deg)";
    let cursor = 0;
    return `conic-gradient(${spendingMajor.map(item => {
      const next = cursor + item.amount / totalSpending * 360;
      const segment = `${MAJOR_META[item.major].tone} ${cursor}deg ${next}deg`;
      cursor = next;
      return segment;
    }).join(", ")})`;
  }, [spendingMajor, totalSpending]);

  if (!preferences.monthlyRhythm && !preferences.spendingCompass) return null;

  return <section className="grid gap-6 lg:grid-cols-2">
    {preferences.monthlyRhythm && <article className="rounded-[1.6rem] border border-vellum-200 bg-vellum-50 p-6 shadow-sm shadow-ink-700/5">
      <div className="flex items-start justify-between gap-4"><div><div className="flex items-center gap-2"><BarChart3 size={18} className="text-moss-700" /><p className="text-xs font-bold tracking-[.16em] text-moss-700">近六月度</p></div><h2 className="mt-2 font-vellum text-2xl font-black text-ink-900">月痕對照</h2><p className="mt-1 text-sm text-ink-500">近六個月的入納與散逸，讓日常的起伏留下一條可讀的脈絡。</p></div><span className="rounded-full bg-moss-100 px-3 py-1 text-xs font-bold text-moss-700">本月留存 {fmt(current.inflow - current.outflow)}</span></div>
      <div className="mt-7 flex h-48 items-end justify-between gap-3 border-b border-vellum-200 px-2 pb-1">{monthlySeries.map(point => <div key={point.key} className="flex h-full min-w-0 flex-1 flex-col justify-end"><div className="flex h-full items-end justify-center gap-1.5"><i title={`${point.label} 入納 ${fmt(point.inflow)}`} className="w-3 rounded-t-md bg-moss-500" style={{ height: point.inflow ? `${Math.max(4, point.inflow / scale * 100)}%` : "0%" }} /><i title={`${point.label} 散逸 ${fmt(point.outflow)}`} className="w-3 rounded-t-md bg-ochre-500" style={{ height: point.outflow ? `${Math.max(4, point.outflow / scale * 100)}%` : "0%" }} /></div><span className="mt-2 text-center text-xs font-semibold text-ink-500">{point.label}</span></div>)}</div>
      <div className="mt-4 flex gap-5 text-xs text-ink-500"><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-moss-500" />入納</span><span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-ochre-500" />散逸</span></div>
    </article>}
    {preferences.spendingCompass && <article className="rounded-[1.6rem] border border-vellum-200 bg-vellum-50 p-6 shadow-sm shadow-ink-700/5">
      <div className="flex items-center gap-2"><CircleGauge size={18} className="text-ochre-700" /><div><p className="text-xs font-bold tracking-[.16em] text-ochre-700">當月散逸</p><h2 className="mt-1 font-vellum text-2xl font-black text-ink-900">散逸羅盤</h2></div></div>
      {totalSpending ? <div className="mt-5 grid gap-5 sm:grid-cols-[9.5rem_1fr] sm:items-center"><div className="relative mx-auto grid h-36 w-36 place-items-center rounded-full" style={{ background: ring }}><div className="grid h-24 w-24 place-items-center rounded-full bg-vellum-50 text-center"><strong className="font-vellum text-lg text-ink-900">{fmt(totalSpending)}</strong><span className="text-[10px] font-bold tracking-[.12em] text-ochre-700">本月散逸</span></div></div><div className="space-y-2.5">{spendingMajor.map(item => <div key={item.major} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 font-semibold text-ink-700"><i className="h-2.5 w-2.5 rounded-full" style={{ background: MAJOR_META[item.major].tone }} />{MAJOR_META[item.major].label}</span><span className="text-ink-500">{Math.round(item.amount / totalSpending * 100)}%</span></div>)}</div></div> : <p className="py-12 text-center text-sm text-ink-500">本月尚無散逸帳頁，羅盤正靜候第一筆記錄。</p>}
    </article>}
  </section>;
}

export function FlowInsightSettings({ preferences, onChange }: { preferences: FlowInsightPreferences; onChange: (next: FlowInsightPreferences) => void }) {
  const choices: Array<{ key: keyof FlowInsightPreferences; title: string; description: string }> = [
    { key: "monthlyRhythm", title: "月痕對照", description: "近六個月入納與散逸的雙柱比較。" },
    { key: "spendingCompass", title: "散逸羅盤", description: "以圓環呈現當月散逸大目的構成。" },
  ];
  return <article className="rounded-[1.5rem] border border-moss-300/60 bg-moss-100/55 p-6"><p className="text-xs font-bold tracking-[.16em] text-moss-700">流轉觀測</p><h2 className="mt-2 font-vellum text-2xl font-black text-ink-900">出入觀測</h2><p className="mt-2 text-sm leading-6 text-moss-700/80">選擇「出入流轉」頁要展開哪些月度比較。設定只儲存在這台裝置，不會改動共同帳本資料。</p><div className="mt-5 divide-y divide-moss-300/55">{choices.map(choice => <label key={choice.key} className="flex cursor-pointer items-center justify-between gap-4 py-4"><span><strong className="block text-sm text-moss-700">{choice.title}</strong><span className="mt-1 block text-xs leading-5 text-ink-500">{choice.description}</span></span><input aria-label={`顯示${choice.title}`} type="checkbox" checked={preferences[choice.key]} onChange={() => onChange({ ...preferences, [choice.key]: !preferences[choice.key] })} className="h-5 w-5 accent-moss-500" /></label>)}</div></article>;
}

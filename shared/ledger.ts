export type LedgerDirection = "inflow" | "outflow";
export type LedgerMajor = "food" | "home" | "transport" | "culture" | "misc" | "salary" | "gain" | "windfall";

export const MAJOR_META: Record<LedgerMajor, { label: string; direction: LedgerDirection; description: string; tone: string }> = {
  food: { label: "饁膳", direction: "outflow", description: "吃喝、食材與餐食", tone: "var(--ochre-500)" },
  home: { label: "居業", direction: "outflow", description: "房貸、水電、網路與日用", tone: "var(--moss-500)" },
  transport: { label: "輿隸", direction: "outflow", description: "油錢、保養與交通", tone: "var(--ink-500)" },
  culture: { label: "雅趣", direction: "outflow", description: "學費、玩具、旅遊與興趣", tone: "var(--ochre-700)" },
  misc: { label: "雜事", direction: "outflow", description: "紅包、醫療、手續費與其他", tone: "var(--ochre-300)" },
  salary: { label: "俸祿", direction: "inflow", description: "本業薪資與固定收入", tone: "var(--moss-700)" },
  gain: { label: "贏餘", direction: "inflow", description: "投資獲利、接案與外快", tone: "var(--moss-500)" },
  windfall: { label: "奇資", direction: "inflow", description: "補助、禮金與其他收入", tone: "var(--ochre-500)" },
};

export const MAJORS_BY_DIRECTION: Record<LedgerDirection, LedgerMajor[]> = {
  outflow: ["food", "home", "transport", "culture", "misc"],
  inflow: ["salary", "gain", "windfall"],
};

export const FIXED_HANDLERS = [
  { user_id: "f4eadea9-c5d4-476a-9996-cc9591a6d43e", display_name: "玉瑟" },
  { user_id: "9108138a-e103-435b-a0c0-643e3af400ec", display_name: "石琴" },
] as const;

export function fixedHandlerForUser(userId: string | null | undefined) {
  return FIXED_HANDLERS.find(handler => handler.user_id === userId) ?? null;
}

export function isMajorAllowed(direction: LedgerDirection, major: LedgerMajor) {
  return MAJOR_META[major].direction === direction;
}

export type LedgerEntry = {
  id: string;
  household_id: string;
  direction: LedgerDirection;
  major: LedgerMajor;
  title: string;
  amount: number;
  occurred_on: string;
  tags: string[];
  note: string;
  handled_by: string | null;
  created_by: string;
  updated_by: string;
  updated_at_ms: number;
  device_id: string;
  deleted_at: string | null;
  source_invoice_item_id?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type InvoiceLine = {
  title: string;
  quantity: number;
  unit_price: number;
  amount: number;
  major?: LedgerMajor | null;
  tags?: string[];
  handled_by?: string | null;
  classification_confirmed?: boolean;
};

export type ExtractedInvoice = {
  seller_name: string;
  invoice_number: string;
  invoice_date: string;
  random_code: string;
  total_amount: number;
  confidence: number;
  items: InvoiceLine[];
};

export type KeywordRule = {
  id: string;
  keyword: string;
  major: LedgerMajor;
  suggested_tags: string[];
  priority: number;
  active: boolean;
};

export function normaliseTags(input: string | string[]) {
  const raw = Array.isArray(input) ? input : input.split(/[，,\s]+/);
  return Array.from(new Set(raw.map(value => value.trim().replace(/^#+/, "")).filter(Boolean).map(value => `#${value.toLocaleLowerCase("zh-Hant-TW")}`))).slice(0, 12);
}

export function lwwWins(
  candidate: Pick<LedgerEntry, "updated_at_ms" | "device_id">,
  incumbent: Pick<LedgerEntry, "updated_at_ms" | "device_id">
) {
  if (candidate.updated_at_ms !== incumbent.updated_at_ms) return candidate.updated_at_ms > incumbent.updated_at_ms;
  return candidate.device_id.localeCompare(incumbent.device_id) > 0;
}

export function suggestMajor(itemTitle: string, rules: KeywordRule[]) {
  const normalized = itemTitle.trim().toLocaleLowerCase("zh-Hant-TW");
  return rules
    .filter(rule => rule.active && normalized.includes(rule.keyword.trim().toLocaleLowerCase("zh-Hant-TW")))
    .sort((a, b) => b.priority - a.priority || b.keyword.length - a.keyword.length)[0] ?? null;
}

export function validateExtractedInvoice(value: unknown): ExtractedInvoice | null {
  if (!value || typeof value !== "object") return null;
  const invoice = value as Record<string, unknown>;
  if (!Array.isArray(invoice.items)) return null;
  const items = invoice.items
    .filter(item => item && typeof item === "object")
    .map(item => {
      const line = item as Record<string, unknown>;
      const rawMajor = typeof line.major === "string" && line.major in MAJOR_META ? line.major as LedgerMajor : undefined;
      return {
        title: typeof line.title === "string" ? line.title.trim() : typeof line.name === "string" ? line.name.trim() : "",
        quantity: Number(line.quantity) || 1,
        unit_price: Math.round(Number(line.unit_price) || 0),
        amount: Math.max(0, Math.round(Number(line.amount) || 0)),
        major: rawMajor,
        tags: normaliseTags(Array.isArray(line.tags) ? line.tags.filter((tag): tag is string => typeof tag === "string") : []),
      };
    })
    .filter(item => item.title || item.amount > 0);
  return {
    seller_name: typeof invoice.seller_name === "string" ? invoice.seller_name.trim() : "",
    invoice_number: typeof invoice.invoice_number === "string" ? invoice.invoice_number.trim().toUpperCase() : "",
    invoice_date: typeof invoice.invoice_date === "string" ? invoice.invoice_date : "",
    random_code: typeof invoice.random_code === "string" ? invoice.random_code.trim() : "",
    total_amount: Math.max(0, Math.round(Number(invoice.total_amount) || 0)),
    confidence: Math.max(0, Math.min(1, Number(invoice.confidence) || 0)),
    items,
  };
}

export function parseInvoiceCsvRows(rows: Record<string, unknown>[]): InvoiceLine[] {
  return rows
    .map(row => ({
      title: String(row["名目"] ?? row["品項名稱"] ?? row.title ?? row.name ?? row.item ?? "").trim(),
      quantity: Number(row["數量"] ?? row.quantity ?? 1) || 1,
      unit_price: Math.round(Number(row["單價"] ?? row.unit_price ?? 0) || 0),
      amount: Math.round(Number(row["金額"] ?? row.amount ?? 0) || 0),
      tags: normaliseTags(String(row["符契"] ?? row.tags ?? "")),
    }))
    .filter(line => line.title || line.amount > 0);
}

export function totalByTag(entries: LedgerEntry[]) {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    if (entry.direction !== "outflow") continue;
    for (const tag of entry.tags) totals.set(tag, (totals.get(tag) ?? 0) + Number(entry.amount));
  }
  return Array.from(totals.entries()).map(([tag, amount]) => ({ tag, amount })).sort((a, b) => b.amount - a.amount || a.tag.localeCompare(b.tag, "zh-Hant-TW"));
}

export type LedgerBrowseFilters = {
  from?: string;
  to?: string;
  direction?: string;
  major?: string;
  tag?: string;
  handler?: string;
};

export function filterLedgerEntries(entries: LedgerEntry[], filters: LedgerBrowseFilters) {
  return entries.filter(entry =>
    entry.deleted_at === null &&
    (!filters.from || entry.occurred_on >= filters.from) &&
    (!filters.to || entry.occurred_on <= filters.to) &&
    (!filters.direction || filters.direction === "all" || entry.direction === filters.direction) &&
    (!filters.major || filters.major === "all" || entry.major === filters.major) &&
    (!filters.tag || filters.tag === "all" || entry.tags.includes(filters.tag)) &&
    (!filters.handler || filters.handler === "all" || entry.handled_by === filters.handler)
  );
}

export function totalOutflowByMajor(entries: LedgerEntry[]) {
  return MAJORS_BY_DIRECTION.outflow
    .map(major => ({ major, amount: entries.filter(entry => entry.direction === "outflow" && entry.major === major && entry.deleted_at === null).reduce((sum, entry) => sum + Number(entry.amount), 0) }))
    .filter(item => item.amount > 0)
    .sort((a, b) => b.amount - a.amount || a.major.localeCompare(b.major));
}

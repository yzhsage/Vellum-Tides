import { isMajorAllowed, type LedgerDirection, type LedgerMajor } from "./ledger";

export const LEDGER_BACKUP_FORMAT = "vellum-tides/ledger-backup" as const;
export const LEDGER_BACKUP_VERSION = 1 as const;
export const FIXED_HOUSEHOLD_TITLE = "歲時錄 · Vellum Tides";

export type LedgerBackupEntry = {
  id: string;
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
  source_invoice_item_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LedgerBackupInvoice = {
  id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  random_code: string | null;
  seller_name: string;
  total_amount: number;
  source: "official_api" | "qr_barcode" | "photo_ocr" | "manual" | "csv";
  raw_payload: Record<string, unknown>;
  image_storage_key: string | null;
  state: "draft" | "awaiting_confirmation" | "posted" | "archived";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type LedgerBackupInvoiceItem = {
  id: string;
  invoice_id: string;
  title: string;
  quantity: number;
  unit_price: number;
  amount: number;
  major: LedgerMajor | null;
  tags: string[];
  handled_by: string | null;
  classification_confirmed: boolean;
  created_at: string;
};

export type LedgerBackupKeywordRule = {
  id: string;
  keyword: string;
  major: LedgerMajor;
  suggested_tags: string[];
  priority: number;
  active: boolean;
  created_at: string;
};

export type LedgerBackup = {
  format: typeof LEDGER_BACKUP_FORMAT;
  version: typeof LEDGER_BACKUP_VERSION;
  exported_at: string;
  household: { title: typeof FIXED_HOUSEHOLD_TITLE };
  members: Array<{ user_id: string; display_name: string }>;
  ledger_entries: LedgerBackupEntry[];
  invoices: LedgerBackupInvoice[];
  invoice_items: LedgerBackupInvoiceItem[];
  keyword_rules: LedgerBackupKeywordRule[];
};

export type LedgerBackupPreview = {
  exportedAt: string;
  ledgerEntryCount: number;
  activeLedgerEntryCount: number;
  invoiceCount: number;
  awaitingInvoiceCount: number;
  invoiceItemCount: number;
  keywordRuleCount: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every(item => typeof item === "string");
}

function isLedgerEntry(value: unknown): value is LedgerBackupEntry {
  if (!isRecord(value)) return false;
  const direction = value.direction;
  const major = value.major;
  return typeof value.id === "string" && uuidPattern.test(value.id)
    && (direction === "outflow" || direction === "inflow")
    && typeof major === "string" && isMajorAllowed(direction, major as LedgerMajor)
    && typeof value.title === "string" && value.title.trim().length > 0 && value.title.length <= 120
    && typeof value.amount === "number" && Number.isFinite(value.amount) && value.amount > 0
    && typeof value.occurred_on === "string" && isoDatePattern.test(value.occurred_on)
    && isStringArray(value.tags) && value.tags.length <= 12
    && typeof value.note === "string"
    && (typeof value.handled_by === "string" || value.handled_by === null)
    && typeof value.created_by === "string" && typeof value.updated_by === "string"
    && typeof value.updated_at_ms === "number" && Number.isFinite(value.updated_at_ms)
    && typeof value.device_id === "string"
    && (typeof value.deleted_at === "string" || value.deleted_at === null)
    && (typeof value.source_invoice_item_id === "string" || value.source_invoice_item_id === null)
    && typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isInvoice(value: unknown): value is LedgerBackupInvoice {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && uuidPattern.test(value.id)
    && (typeof value.invoice_number === "string" || value.invoice_number === null)
    && (typeof value.invoice_date === "string" || value.invoice_date === null)
    && (typeof value.random_code === "string" || value.random_code === null)
    && typeof value.seller_name === "string"
    && typeof value.total_amount === "number" && Number.isFinite(value.total_amount) && value.total_amount >= 0
    && ["official_api", "qr_barcode", "photo_ocr", "manual", "csv"].includes(String(value.source))
    && isRecord(value.raw_payload)
    && (typeof value.image_storage_key === "string" || value.image_storage_key === null)
    && ["draft", "awaiting_confirmation", "posted", "archived"].includes(String(value.state))
    && typeof value.created_by === "string" && typeof value.created_at === "string" && typeof value.updated_at === "string";
}

function isInvoiceItem(value: unknown): value is LedgerBackupInvoiceItem {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && uuidPattern.test(value.id)
    && typeof value.invoice_id === "string" && uuidPattern.test(value.invoice_id)
    && typeof value.title === "string" && value.title.length <= 120
    && typeof value.quantity === "number" && Number.isFinite(value.quantity)
    && typeof value.unit_price === "number" && Number.isFinite(value.unit_price)
    && typeof value.amount === "number" && Number.isFinite(value.amount)
    && (value.major === null || (typeof value.major === "string" && isMajorAllowed("outflow", value.major as LedgerMajor)))
    && isStringArray(value.tags) && value.tags.length <= 12
    && (typeof value.handled_by === "string" || value.handled_by === null)
    && typeof value.classification_confirmed === "boolean" && typeof value.created_at === "string";
}

function isKeywordRule(value: unknown): value is LedgerBackupKeywordRule {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && uuidPattern.test(value.id)
    && typeof value.keyword === "string" && value.keyword.trim().length > 0 && value.keyword.length <= 48
    && typeof value.major === "string" && isMajorAllowed("outflow", value.major as LedgerMajor)
    && isStringArray(value.suggested_tags) && value.suggested_tags.length <= 12
    && typeof value.priority === "number" && Number.isInteger(value.priority)
    && typeof value.active === "boolean" && typeof value.created_at === "string";
}

export function inspectLedgerBackup(input: unknown): { backup: LedgerBackup; preview: LedgerBackupPreview } | { error: string } {
  if (!isRecord(input)) return { error: "備份檔不是可讀取的帳本資料。" };
  if (input.format !== LEDGER_BACKUP_FORMAT) return { error: "這不是歲時錄的備份檔。" };
  if (input.version !== LEDGER_BACKUP_VERSION) return { error: "此備份檔版本尚不支援。" };
  if (!isRecord(input.household) || input.household.title !== FIXED_HOUSEHOLD_TITLE) return { error: "備份帳本名稱與目前固定共用帳本不符。" };
  if (typeof input.exported_at !== "string" || Number.isNaN(Date.parse(input.exported_at))) return { error: "備份檔缺少可辨識的匯出時間。" };
  if (!Array.isArray(input.members) || !input.members.every(member => isRecord(member) && typeof member.user_id === "string" && typeof member.display_name === "string")) return { error: "備份檔的掌簿資料無法辨識。" };
  if (!Array.isArray(input.ledger_entries) || !input.ledger_entries.every(isLedgerEntry)) return { error: "帳頁資料格式不完整或不符合目前版本。" };
  if (!Array.isArray(input.invoices) || !input.invoices.every(isInvoice)) return { error: "憑據資料格式不完整或不符合目前版本。" };
  if (!Array.isArray(input.invoice_items) || !input.invoice_items.every(isInvoiceItem)) return { error: "憑據品項格式不完整或不符合目前版本。" };
  if (!Array.isArray(input.keyword_rules) || !input.keyword_rules.every(isKeywordRule)) return { error: "分類規則格式不完整或不符合目前版本。" };

  const backup = input as LedgerBackup;
  return {
    backup,
    preview: {
      exportedAt: backup.exported_at,
      ledgerEntryCount: backup.ledger_entries.length,
      activeLedgerEntryCount: backup.ledger_entries.filter(entry => !entry.deleted_at).length,
      invoiceCount: backup.invoices.length,
      awaitingInvoiceCount: backup.invoices.filter(invoice => invoice.state === "awaiting_confirmation").length,
      invoiceItemCount: backup.invoice_items.length,
      keywordRuleCount: backup.keyword_rules.length,
    },
  };
}

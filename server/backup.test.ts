import { describe, expect, it } from "vitest";
import { FIXED_HOUSEHOLD_TITLE, inspectLedgerBackup, LEDGER_BACKUP_FORMAT, LEDGER_BACKUP_VERSION, type LedgerBackup } from "../shared/backup";

const jadeId = "f4eadea9-c5d4-476a-9996-cc9591a6d43e";
const entryId = "123e4567-e89b-42d3-a456-426614174000";
const archivedEntryId = "123e4567-e89b-42d3-a456-426614174001";
const invoiceId = "223e4567-e89b-42d3-a456-426614174000";
const itemId = "323e4567-e89b-42d3-a456-426614174000";
const ruleId = "423e4567-e89b-42d3-a456-426614174000";

function validBackup(): LedgerBackup {
  return {
    format: LEDGER_BACKUP_FORMAT,
    version: LEDGER_BACKUP_VERSION,
    exported_at: "2026-08-20T12:00:00.000Z",
    household: { title: FIXED_HOUSEHOLD_TITLE },
    members: [{ user_id: jadeId, display_name: "玉瑟" }],
    ledger_entries: [{ id: entryId, direction: "outflow", major: "food", title: "香草盆栽", amount: 320, occurred_on: "2026-08-20", tags: ["#園藝"], note: "備份測試", handled_by: jadeId, created_by: jadeId, updated_by: jadeId, updated_at_ms: 1_787_184_000_000, device_id: "test-device", deleted_at: null, source_invoice_item_id: null, created_at: "2026-08-20T12:00:00.000Z", updated_at: "2026-08-20T12:00:00.000Z" }],
    invoices: [{ id: invoiceId, invoice_number: "AB12345678", invoice_date: "2026-08-20", random_code: "1234", seller_name: "園藝行", total_amount: 320, source: "manual", raw_payload: {}, image_storage_key: null, state: "posted", created_by: jadeId, created_at: "2026-08-20T12:00:00.000Z", updated_at: "2026-08-20T12:00:00.000Z" }],
    invoice_items: [{ id: itemId, invoice_id: invoiceId, title: "香草盆栽", quantity: 1, unit_price: 320, amount: 320, major: "food", tags: ["#園藝"], handled_by: jadeId, classification_confirmed: true, created_at: "2026-08-20T12:00:00.000Z" }],
    keyword_rules: [{ id: ruleId, keyword: "香草", major: "food", suggested_tags: ["#園藝"], priority: 3, active: true, created_at: "2026-08-20T12:00:00.000Z" }],
  };
}

describe("歲時錄完整備份契約", () => {
  it("接受固定共用帳本匯出的完整備份，並算出可供使用者核對的摘要", () => {
    const result = inspectLedgerBackup(validBackup());
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.preview).toMatchObject({ ledgerEntryCount: 1, activeLedgerEntryCount: 1, invoiceCount: 1, awaitingInvoiceCount: 0, invoiceItemCount: 1, keywordRuleCount: 1 });
  });

  it("收起帳頁會保留在備份總數中，但不計入有效帳頁數", () => {
    const backup = validBackup();
    backup.ledger_entries.push({
      ...backup.ledger_entries[0],
      id: archivedEntryId,
      title: "已收起的舊帳",
      deleted_at: "2026-08-20T13:00:00.000Z",
    });
    const result = inspectLedgerBackup(backup);
    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.preview).toMatchObject({ ledgerEntryCount: 2, activeLedgerEntryCount: 1 });
  });

  it("拒絕其他帳本名稱，避免備份被補入錯誤的共用帳本", () => {
    const backup = validBackup();
    (backup.household as { title: string }).title = "別冊";
    expect(inspectLedgerBackup(backup)).toEqual({ error: "備份帳本名稱與目前固定共用帳本不符。" });
  });

  it("拒絕流向與大目不相容的帳頁，避免還原後出現無法顯示的資料", () => {
    const backup = validBackup();
    (backup.ledger_entries[0] as { direction: string; major: string }).direction = "inflow";
    expect(inspectLedgerBackup(backup)).toEqual({ error: "帳頁資料格式不完整或不符合目前版本。" });
  });

  it("拒絕非歲時錄格式與不支援版本", () => {
    expect(inspectLedgerBackup({ format: "elsewhere", version: 1 })).toEqual({ error: "這不是歲時錄的備份檔。" });
    expect(inspectLedgerBackup({ ...validBackup(), version: 2 })).toEqual({ error: "此備份檔版本尚不支援。" });
  });
});

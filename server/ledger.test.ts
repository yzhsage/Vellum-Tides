import { describe, expect, it } from "vitest";
import { FIXED_HANDLERS, filterLedgerEntries, fixedHandlerForUser, isMajorAllowed, lwwWins, normaliseTags, parseInvoiceCsvRows, suggestMajor, totalByTag, totalOutflowByMajor, validateExtractedInvoice, type LedgerEntry } from "../shared/ledger";

describe("歲時錄帳頁核心規則", () => {
  it("以較晚時間戳記決定 LWW 勝者，同秒以裝置識別字穩定排序", () => {
    expect(lwwWins({ updated_at_ms: 12, device_id: "a" }, { updated_at_ms: 11, device_id: "z" })).toBe(true);
    expect(lwwWins({ updated_at_ms: 12, device_id: "b" }, { updated_at_ms: 12, device_id: "a" })).toBe(true);
    expect(lwwWins({ updated_at_ms: 12, device_id: "a" }, { updated_at_ms: 12, device_id: "b" })).toBe(false);
  });

  it("依最高優先序關鍵字提出大目建議", () => {
    const rule = suggestMajor("有機小白菜", [
      { id: "a", keyword: "菜", major: "home", suggested_tags: [], priority: 1, active: true },
      { id: "b", keyword: "白菜", major: "food", suggested_tags: ["#料理"], priority: 5, active: true },
    ]);
    expect(rule?.major).toBe("food");
    expect(rule?.suggested_tags).toEqual(["#料理"]);
  });

  it("只保留可用的 CSV 品項列並轉為整數金額", () => {
    expect(parseInvoiceCsvRows([{ "品項名稱": "培養土", "數量": "2", "單價": "120.4", "金額": "240.8" }, {}])).toEqual([
      { title: "培養土", quantity: 2, unit_price: 120, amount: 241, tags: [] },
    ]);
  });

  it("驗證影像 OCR 的結構化結果", () => {
    const result = validateExtractedInvoice({ seller_name: "大賣場", invoice_number: "AB12345678", invoice_date: "2026-08-18", random_code: "1234", total_amount: 340, confidence: 0.9, items: [{ name: "香草", quantity: 1, unit_price: 80, amount: 80 }] });
    expect(result?.items[0]?.title).toBe("香草");
    expect(result?.total_amount).toBe(340);
  });

  it("正規化符契、排除重複並移除手動井號差異", () => {
    expect(normaliseTags("#園藝, 水族 #園藝")).toEqual(["#園藝", "#水族"]);
  });

  it("流向只接受相符的大目，避免將饁膳寫入入納或將俸祿寫入散逸", () => {
    expect(isMajorAllowed("outflow", "food")).toBe(true);
    expect(isMajorAllowed("inflow", "salary")).toBe(true);
    expect(isMajorAllowed("inflow", "food")).toBe(false);
    expect(isMajorAllowed("outflow", "salary")).toBe(false);
  });

  it("符契分析只加總散逸，能跨大目追蹤花費", () => {
    const entries: LedgerEntry[] = [
      { id: "1", household_id: "h", direction: "outflow", major: "food", title: "魚飼料", amount: 300, occurred_on: "2026-08-01", tags: ["#水族"], note: "", handled_by: null, created_by: "u", updated_by: "u", updated_at_ms: 1, device_id: "a", deleted_at: null },
      { id: "2", household_id: "h", direction: "outflow", major: "home", title: "魚缸", amount: 700, occurred_on: "2026-08-02", tags: ["#水族", "#居家"], note: "", handled_by: null, created_by: "u", updated_by: "u", updated_at_ms: 2, device_id: "a", deleted_at: null },
      { id: "3", household_id: "h", direction: "inflow", major: "salary", title: "薪資", amount: 10000, occurred_on: "2026-08-03", tags: ["#水族"], note: "", handled_by: null, created_by: "u", updated_by: "u", updated_at_ms: 3, device_id: "a", deleted_at: null },
    ];
    expect(totalByTag(entries)).toEqual([{ tag: "#水族", amount: 1000 }, { tag: "#居家", amount: 700 }]);
  });

  it("離線補登帳頁會保留名目、歲時、掌簿與多個符契 payload", () => {
    const mutation: LedgerEntry = {
      id: "offline-entry", household_id: "h", direction: "outflow", major: "culture", title: "水族展門票", amount: 480,
      occurred_on: "2026-08-19", tags: normaliseTags("#水族 #雅趣"), note: "離線建立", handled_by: "u2", created_by: "u1", updated_by: "u1", updated_at_ms: 42, device_id: "device-a", deleted_at: null,
    };
    expect(mutation).toMatchObject({ direction: "outflow", major: "culture", title: "水族展門票", occurred_on: "2026-08-19", handled_by: "u2", tags: ["#水族", "#雅趣"] });
  });

  it("帳頁翻閱可同時套用歲時、流向、大目、符契與掌簿，空篩選結果不會誤帶入已刪帳頁", () => {
    const entries: LedgerEntry[] = [
      { id: "food", household_id: "h", direction: "outflow", major: "food", title: "魚飼料", amount: 300, occurred_on: "2026-08-03", tags: ["#水族"], note: "", handled_by: "u1", created_by: "u1", updated_by: "u1", updated_at_ms: 1, device_id: "a", deleted_at: null },
      { id: "garden", household_id: "h", direction: "outflow", major: "home", title: "土壤", amount: 500, occurred_on: "2026-08-03", tags: ["#園藝"], note: "", handled_by: "u2", created_by: "u1", updated_by: "u1", updated_at_ms: 2, device_id: "a", deleted_at: null },
      { id: "deleted", household_id: "h", direction: "outflow", major: "food", title: "舊帳", amount: 900, occurred_on: "2026-08-03", tags: ["#水族"], note: "", handled_by: "u1", created_by: "u1", updated_by: "u1", updated_at_ms: 3, device_id: "a", deleted_at: "2026-08-04T00:00:00Z" },
    ];
    expect(filterLedgerEntries(entries, { from: "2026-08-03", to: "2026-08-03", direction: "outflow", major: "food", tag: "#水族", handler: "u1" }).map(entry => entry.id)).toEqual(["food"]);
    expect(filterLedgerEntries(entries, { tag: "#不存在" })).toEqual([]);
  });

  it("大目比較只計散逸且忽略已刪帳頁，能供符契篩選後的比較畫面使用", () => {
    const entries: LedgerEntry[] = [
      { id: "food", household_id: "h", direction: "outflow", major: "food", title: "餐食", amount: 400, occurred_on: "2026-08-03", tags: ["#料理"], note: "", handled_by: null, created_by: "u", updated_by: "u", updated_at_ms: 1, device_id: "a", deleted_at: null },
      { id: "home", household_id: "h", direction: "outflow", major: "home", title: "水電", amount: 800, occurred_on: "2026-08-03", tags: ["#居家"], note: "", handled_by: null, created_by: "u", updated_by: "u", updated_at_ms: 2, device_id: "a", deleted_at: null },
      { id: "salary", household_id: "h", direction: "inflow", major: "salary", title: "薪資", amount: 30000, occurred_on: "2026-08-03", tags: ["#居家"], note: "", handled_by: null, created_by: "u", updated_by: "u", updated_at_ms: 3, device_id: "a", deleted_at: null },
    ];
    expect(totalOutflowByMajor(entries)).toEqual([{ major: "home", amount: 800 }, { major: "food", amount: 400 }]);
  });

  it("掌簿只承認固定兩位，並依登入 UID 自動對應玉瑟或石琴", () => {
    expect(FIXED_HANDLERS.map(handler => handler.display_name)).toEqual(["玉瑟", "石琴"]);
    expect(fixedHandlerForUser("f4eadea9-c5d4-476a-9996-cc9591a6d43e")?.display_name).toBe("玉瑟");
    expect(fixedHandlerForUser("9108138a-e103-435b-a0c0-643e3af400ec")?.display_name).toBe("石琴");
    expect(fixedHandlerForUser("other-user")).toBeNull();
  });
});

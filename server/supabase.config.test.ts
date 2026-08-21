import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Supabase 公開連線設定", () => {
  it("可使用 Project URL 與 Publishable key 讀取身份服務設定", async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    expect(url).toMatch(/^https:\/\/[a-z0-9-]+\.supabase\.co$/);
    expect(key).toMatch(/^sb_publishable_/);

    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: key! },
      signal: AbortSignal.timeout(10_000),
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("application/json");
  }, 15_000);

  it("登入頁僅保留固定帳號密語登入與密語復原，不提供公開註冊或 Google OAuth", async () => {
    const source = await readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");

    expect(source).toContain('useState<"signin" | "recover" | "reset">');
    expect(source).toContain("signInWithPassword");
    expect(source).toContain("resetPasswordForEmail");
    expect(source).toContain('aria-label="歲時錄 · Vellum Tides"');
    expect(source).toContain('<span>歲時錄</span><span className="ml-2 text-base tracking-[.12em]">· Vellum Tides</span>');
    expect(source).toContain('Field label="雲箋信札"');
    expect(source).toContain('Field label="私言密語"');
    expect(source).toContain("琴瑟和鳴，共譜歲月。");
    expect(source).toContain("此乃私密雙人簿冊，僅限預定之雙影啟閱。");
    expect(source).not.toContain("signUp(");
    expect(source).not.toContain("signInWithOAuth");
    expect(source).not.toContain("以 Google 帳號翻開");
    expect(source).not.toContain("初次立帳");
  });

  it("未設定分析端點時不會把 HTML 回應誤當成登入頁腳本解析", async () => {
    const documentSource = await readFile(new URL("../client/index.html", import.meta.url), "utf8");
    const mainSource = await readFile(new URL("../client/src/main.tsx", import.meta.url), "utf8");

    expect(documentSource).not.toContain("%VITE_ANALYTICS_ENDPOINT%/umami");
    expect(mainSource).toContain("VITE_ANALYTICS_ENDPOINT");
    expect(mainSource).toContain('analyticsEndpoint !== "undefined"');
    expect(mainSource).toContain("document.head.appendChild(analyticsScript)");
  });

  it("Vercel 設定會提供 Vite 靜態帳頁與既有 tRPC 觀圖析字端點", async () => {
    const [vercel, api, ocr, documentSource, readme] = await Promise.all([
      readFile(new URL("../vercel.json", import.meta.url), "utf8"),
      readFile(new URL("../api/trpc.ts", import.meta.url), "utf8"),
      readFile(new URL("../server/invoiceOcr.ts", import.meta.url), "utf8"),
      readFile(new URL("../client/index.html", import.meta.url), "utf8"),
      readFile(new URL("../README.md", import.meta.url), "utf8"),
    ]);

    expect(vercel).toContain('"framework": "vite"');
    expect(vercel).toContain('"outputDirectory": "dist/public"');
    expect(vercel).toContain('"source": "/((?!api/).*)"');
    expect(api).toContain("createExpressMiddleware");
    expect(api).toContain("appRouter");
    expect(api).toContain("createContext");
    expect(ocr).toContain("process.env.GEMINI_API_KEY");
    expect(ocr).toContain("generativelanguage.googleapis.com");
    expect(documentSource).toContain('href="/vellum-tides-icon.svg"');
    expect(readme).toContain("## Vercel 部署");
    expect(readme).toContain("VITE_SUPABASE_PUBLISHABLE_KEY");
  });

  it("登出後會清除本機帳本狀態，避免停留在已失效的帳頁", async () => {
    const source = await readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");

    expect(source).toContain("supabase.auth.onAuthStateChange");
    expect(source).toContain("setUser(null)");
    expect(source).toContain("setHouseholdId(\"\")");
    expect(source).toContain("setEntries([])");
  });

  it("固定共用帳本不會以舊版樣式隱藏日常導覽，且待確認已整合為憑據入冊的第二步", async () => {
    const pageSource = await readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");
    const styleSource = await readFile(new URL("../client/src/index.css", import.meta.url), "utf8");

    expect(pageSource).not.toContain("玉瑟與石琴，共讀這一冊。");
    expect(pageSource).toContain('label: "憑據入冊"');
    expect(pageSource).not.toContain('label: "待確認"');
    expect(pageSource).toContain("awaitingInvoices={invoices}");
    expect(pageSource).toContain('p_title: "歲時錄 · Vellum Tides"');
    expect(styleSource).not.toContain("aside nav button:nth-child");
  });

  it("登入後左側欄的歲時錄識別會使用指定 SVG，而非內建葉子符號", async () => {
    const pageSource = await readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");

    expect(pageSource).toContain('src="/vellum-tides-icon.svg"');
    expect(pageSource).toContain('alt="歲時錄圖標"');
    expect(pageSource).toContain('className="h-11 w-11 overflow-hidden rounded-2xl bg-ink-700"');
    expect(pageSource).not.toContain("<Leaf size={20} />");
  });

  it("已連線的 Supabase REST 結構會以 RLS 拒絕匿名讀取，且帳務 RPC 已可被辨識", async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const headers = { apikey: key! };
    const tables = await Promise.all(["households", "ledger_entries", "invoices", "invoice_items"].map(table =>
      fetch(`${url}/rest/v1/${table}?select=*&limit=0`, { headers }),
    ));

    // 歲時錄是封閉式雙人帳本，匿名請求必須被 RLS 擋下；若公開讀取反而是安全性回歸。
    expect(tables.every(response => [401, 403].includes(response.status))).toBe(true);

    const rpcResponses = await Promise.all([
      fetch(`${url}/rest/v1/rpc/post_invoice`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ p_invoice_id: "00000000-0000-0000-0000-000000000000" }),
      }),
      fetch(`${url}/rest/v1/rpc/apply_ledger_mutation`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ p_payload: {} }),
      }),
    ]);

    // 使用匿名請求只會被函式權限拒絕，且測試資料不會觸發任何寫入；若函式不存在則會回傳 404。
    expect(rpcResponses.every(response => response.status !== 404)).toBe(true);
  });

  it("V2 主頁會以共用規則阻擋流向與大目不相容的帳頁，並在分段帳頁呈現符契篩選", async () => {
    const [source, browserSource] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/LedgerBrowser.tsx", import.meta.url), "utf8"),
    ]);

    expect(source).toContain("isMajorAllowed(form.direction, form.major)");
    expect(source).toContain("流向與大目不相符");
    expect(browserSource).toContain("所有符契");
    expect(browserSource).toContain("符契篩選");
  });

  it("V2 重設與唯讀核對涵蓋帳頁、發票品項、符契索引觸發器、RLS 與帳務 RPC", async () => {
    const [resetSql, verifySql] = await Promise.all([
      readFile(new URL("../supabase/歲時錄-v2-乾淨重設.sql", import.meta.url), "utf8"),
      readFile(new URL("../supabase/歲時錄-v2-核對.sql", import.meta.url), "utf8"),
    ]);

    for (const token of [
      "create table public.ledger_entries", "create table public.invoice_items", "tags text[]",
      "ledger_entries_tags_gin", "invoice_items_tags_gin", "normalise_ledger_entry_tags",
      "成員可管理帳頁", "public.apply_ledger_mutation(p_payload jsonb)", "public.post_invoice(p_invoice_id uuid)",
    ]) expect(resetSql).toContain(token);
    for (const token of ["pg_indexes", "pg_trigger", "pg_policies", "to_regprocedure('public.apply_ledger_mutation(jsonb)')", "to_regprocedure('public.post_invoice(uuid)')"]) expect(verifySql).toContain(token);
    expect(verifySql).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
  });

  it("V2 表單會送出名目、歲時、掌簿與符契；完整帳頁則交由獨立分段元件處理", async () => {
    const [pageSource, browserSource] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/LedgerBrowser.tsx", import.meta.url), "utf8"),
    ]);
    for (const token of ["title: form.title.trim()", "occurred_on: form.occurred_on", "handled_by: currentHandler?.user_id ?? user.id", "tags: normaliseTags(form.tags)", "totalOutflowByMajor(monthly)", '<LedgerBrowser householdId={householdId}', '{currentHandler?.display_name ?? "未識別的登入帳號"}']) expect(pageSource).toContain(token);
    for (const token of ["ledger_browse_page", "ledger_browse_summary", "filters.tag !== \"all\"", "此條件下尚無帳頁"]) expect(browserSource).toContain(token);
    expect(pageSource + browserSource).not.toContain("固定掌簿：玉瑟、石琴");
  });

  it("帳頁翻閱以伺服器分段載入，並將已展開資料按月份成冊、按歲時框組", async () => {
    const [pageSource, browserSource, ledgerSource, sql] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/LedgerBrowser.tsx", import.meta.url), "utf8"),
      readFile(new URL("../shared/ledger.ts", import.meta.url), "utf8"),
      readFile(new URL("../supabase/歲時錄-v2-帳頁分段與備份.sql", import.meta.url), "utf8"),
    ]);

    expect(pageSource).toContain("<LedgerBrowser householdId={householdId}");
    for (const token of ["const PAGE_SIZE = 45", "groupLedgerEntries", "ledger_browse_page", "ledger_browse_summary", "月冊卷次", "volume.days.map(day", "localDate(day.date)", "<LedgerLeaf key={entry.id}", "續閱下一批"]) expect(browserSource).toContain(token);
    expect(browserSource).toContain("帳頁卷覽");
    expect(browserSource).not.toContain("LEDGER READING ROOM");
    expect(browserSource).not.toMatch(/#[0-9a-f]{3,8}/i);
    for (const tone of ["var(--ochre-500)", "var(--moss-500)", "var(--ink-500)", "var(--ochre-700)", "var(--moss-700)"]) expect(ledgerSource).toContain(tone);
    for (const token of ["create or replace function public.ledger_browse_page", "create or replace function public.ledger_browse_summary", "safe_page_size", "limit safe_page_size"]) expect(sql).toContain(token);
    expect(browserSource).not.toContain("visibleEntries.length ? visibleEntries.map(entry");
  });

  it("歲時欄位與帳頁卡片維持緊湊、可收縮的響應式版面", async () => {
    const [pageSource, browserSource, intakeSource] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/LedgerBrowser.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/InvoiceIntake.tsx", import.meta.url), "utf8"),
    ]);

    expect(pageSource).toContain("const dateFieldClass = fieldClass");
    expect(intakeSource).toContain('const metaFieldClass = "w-full sm:w-[15rem]"');
    expect(browserSource).toContain("max-w-[12.25rem]");
    for (const token of ["title={entry.title}", "aria-label={`名目：${entry.title}`}", "truncate font-vellum", "flex items-start gap-3", "flex shrink-0 flex-col items-end", "<label className=\"min-w-0 text-xs font-bold", "每批 {PAGE_SIZE} 頁，月份可收闔。", "本批 {volume.count} 頁"]) expect(browserSource).toContain(token);
    expect(intakeSource).toContain('className={`mt-1.5 ${fieldClass}`} type="date"');
    expect(pageSource).toContain('<input className={dateFieldClass} type="date"');
  });

  it("新帳頁的欄位外框會維持穩定元件識別，避免 iOS 與 Android 輸入時重新掛載而失焦", async () => {
    const source = await readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8");

    expect(source).toContain("function Field({ label, children }");
    expect(source).toContain('<Field label="金額">');
    expect(source).not.toContain("const FormInput = ({ label, children }");
  });

  it("流向頁提供可設定的月度洞察、既有符契快速選用，且只會為每位登入者初始化一次帳本", async () => {
    const [pageSource, insightSource] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/FlowInsights.tsx", import.meta.url), "utf8"),
    ]);

    for (const token of ["FlowInsights", "FlowInsightSettings", "月痕對照", "散逸羅盤", "曾寫過的符契", "addExistingTag", "initialisedUserRef"]) {
      expect(pageSource + insightSource).toContain(token);
    }
    expect(insightSource).not.toContain("tagThreads");
    expect(pageSource).toContain("本月符契");
    expect(pageSource).not.toContain("符契脈絡");
    expect((pageSource.match(/<StatusMark online=\{online\} pending=\{pending\} \/>/g) ?? []).length).toBe(1);
    expect(pageSource).toContain("initialisedUserRef.current === nextUser.id");
    expect(pageSource).toContain("window.localStorage.setItem(FLOW_INSIGHT_STORAGE_KEY");
  });

  it("掌簿會由登入 UID 自動決定，且資料庫不接受前端任意指定其他經手人", async () => {
    const [pageSource, sharedSource, resetSql] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../shared/ledger.ts", import.meta.url), "utf8"),
      readFile(new URL("../supabase/歲時錄-v2-乾淨重設.sql", import.meta.url), "utf8"),
    ]);

    expect(sharedSource).toContain("export const FIXED_HANDLERS");
    expect(sharedSource).toContain("fixedHandlerForUser");
    expect(pageSource).toContain("const currentHandler = fixedHandlerForUser(user?.id)");
    expect(pageSource).toContain("handled_by: currentHandler?.user_id ?? user.id");
    expect(resetSql).toContain("handled_by = auth.uid()");
    expect(resetSql).toContain("auth.uid(), auth.uid(), auth.uid()");
  });

  it("固定共用帳本修復會將兩位固定帳號解析至同一冊，且遇到另一冊已有資料時不會自動搬移", async () => {
    const source = await readFile(new URL("../supabase/歲時錄-v2-固定共用帳本.sql", import.meta.url), "utf8");

    for (const token of ["歲時錄 · Vellum Tides", "count(distinct hm.user_id) = 2", "other_has_data", "不會自動搬移或刪除", "create or replace function public.ensure_personal_household", "此帳頁僅限玉瑟與石琴登入", "grant insert on table public.invoices to authenticated", "grant insert, update on table public.invoice_items to authenticated"]) expect(source).toContain(token);
    expect(source).not.toMatch(/\bdelete\s+from\s+public\.(ledger_entries|invoices|invoice_items)\b/i);
  });

  it("網站直接使用固定共用帳本，並以憑據入冊連續工作流提供觀圖析字、鏡觀條印與待確認逐項歸類", async () => {
    const [appSource, pageSource, intakeSource, routerSource] = await Promise.all([
      readFile(new URL("../client/src/App.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/InvoiceIntake.tsx", import.meta.url), "utf8"),
      readFile(new URL("../server/routers.ts", import.meta.url), "utf8"),
    ]);

    expect(appSource).not.toContain('path={"/共同帳本"}');
    for (const token of ["憑據入冊", "post_invoice", "InvoiceIntake", "觀圖析字", "鏡觀條印"]) expect(pageSource + intakeSource).toContain(token);
    for (const token of ["trpc.invoice.ocr", "imageDataUrl", "awaiting_confirmation", "invoice_items", "photo_ocr", "憑據入冊 · 初卷", "憑據入冊 · 次卷", "待確認與歸帳", "待續編"]) expect(intakeSource).toContain(token);
    expect(pageSource).not.toContain('label: "待確認"');
    expect(routerSource).toContain("invoice: router");
  });

  it("憑據入冊第二步可直接續編既有待確認憑據，並逐項更新後確認歸帳", async () => {
    const intakeSource = await readFile(new URL("../client/src/components/InvoiceIntake.tsx", import.meta.url), "utf8");

    for (const token of [
      "awaitingInvoices.map(pendingInvoice",
      "pendingInvoice.invoice_items.map(item",
      "onUpdateInvoiceItem(pendingInvoice.id, item, { title: event.target.value })",
      "onUpdateInvoiceItem(pendingInvoice.id, item, { major:",
      "onUpdateInvoiceItem(pendingInvoice.id, item, { handled_by:",
      "onUpdateInvoiceItem(pendingInvoice.id, item, { tags:",
      "await onPostInvoice(invoiceId)",
      "確認歸入帳本",
      "完成第一步的暫存後，會直接在此處等待你的最後校對",
    ]) expect(intakeSource).toContain(token);
  });

  it("憑據照片可直接開啟後鏡頭，並將 OCR 回傳的逐項大目與符契預填至校對列", async () => {
    const [intakeSource, ocrSource, ledgerSource] = await Promise.all([
      readFile(new URL("../client/src/components/InvoiceIntake.tsx", import.meta.url), "utf8"),
      readFile(new URL("../server/invoiceOcr.ts", import.meta.url), "utf8"),
      readFile(new URL("../shared/ledger.ts", import.meta.url), "utf8"),
    ]);

    for (const token of [
      'capture="environment"',
      "cameraRef",
      "fileRef",
      "開啟相機拍攝",
      "選擇既有照片",
      "result.items.map(item => ({",
      "major: item.major ?? \"\"",
      "tags: (item.tags ?? []).join(\" \")",
      "已預填逐項歸類。",
    ]) expect(intakeSource).toContain(token);
    for (const token of ["major: { type: \"string\"", "tags: { type: \"array\"", "每一項必須依品名選一個大目", "符契建議"]) expect(ocrSource).toContain(token);
    for (const token of ["line.major in MAJOR_META", "major: rawMajor", "tags: normaliseTags(Array.isArray(line.tags)"]) expect(ledgerSource).toContain(token);
  });

  it("憑據鏡觀條印可用後鏡頭掃讀並保留手動文字入口，眉批欄位維持一致寬度", async () => {
    const intakeSource = await readFile(new URL("../client/src/components/InvoiceIntake.tsx", import.meta.url), "utf8");

    for (const token of ["BrowserMultiFormatReader", "decodeFromConstraints", 'facingMode: { ideal: "environment" }', "qrSessionRef", "qrVideoRef", "鏡觀條印", "直紋條契", "方陣圖印", "開啟鏡觀", "止住取景", "條印文字", "const metaFieldClass = \"w-full sm:w-[15rem]\""]) expect(intakeSource).toContain(token);
    for (const forbidden of ["QR／Barcode", "QR Code", "二維碼", "照片識讀", "掃碼辨讀", "掃讀文字"]) expect(intakeSource).not.toContain(forbidden);
  });

  it("出入流轉的摘要與洞察卡片共用羊皮紙底面，以苔綠與赭金作局部強調", async () => {
    const [pageSource, insightSource] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/FlowInsights.tsx", import.meta.url), "utf8"),
    ]);

    const displayInsightSource = insightSource.split("export function FlowInsightSettings")[0];
    for (const token of ["border-vellum-200 bg-vellum-50 p-6 shadow-sm shadow-ink-700/5", "border border-dashed border-vellum-200 bg-vellum-100", "bg-moss-100/55", "bg-ochre-500"]) expect(pageSource + displayInsightSource).toContain(token);
    expect(displayInsightSource).not.toContain("border-moss-300/60 bg-moss-100/55 p-6");
    expect(pageSource).not.toContain("border-moss-300/60 bg-moss-100/55 p-6");
  });

  it("典藏提供安全補入、備份快照還原與已收起帳頁永久清除，且完整備份不含已刪帳頁", async () => {
    const [archiveSource, backupSource, snapshotSql, archiveSql] = await Promise.all([
      readFile(new URL("../client/src/components/LedgerArchivePanel.tsx", import.meta.url), "utf8"),
      readFile(new URL("../shared/backup.ts", import.meta.url), "utf8"),
      readFile(new URL("../supabase/歲時錄-v2-典藏快照與永久刪除.sql", import.meta.url), "utf8"),
      readFile(new URL("../supabase/歲時錄-v2-帳頁分段與備份.sql", import.meta.url), "utf8"),
    ]);

    for (const token of ["restore_ledger_backup_safe", "revived_entries", "restore_ledger_backup_snapshot", "purge_deleted_ledger_entries", "還原至備份快照", "永久清除已收起帳頁", "永久刪除", "useState<RestoreMode>(null)", "必須明確選擇安全補入或快照還原", "請先選擇還原方式", "快照模式：已對齊帳頁", "復原已收起帳頁"]) expect(archiveSource).toContain(token);
    expect(backupSource).toContain("activeLedgerEntryCount");
    for (const token of ["where le.household_id = p_household_id and le.deleted_at is null", "create or replace function public.purge_deleted_ledger_entries", "create or replace function public.restore_ledger_backup_safe", "create or replace function public.restore_ledger_backup_snapshot", "and current_entry.deleted_at is not null", "and not exists", "on conflict (id) do update"]) expect(snapshotSql).toContain(token);
    for (const token of ["create or replace function public.restore_ledger_backup_safe", "and current_entry.deleted_at is not null", "and nullif(value->>'deleted_at', '') is null", "'revived_entries', revived_entries"]) expect(archiveSql).toContain(token);
  });

  it("頁面重新掛載後保留目前頁籤，且帳頁掌簿排列於大目與符契之後", async () => {
    const [pageSource, browserSource] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/LedgerBrowser.tsx", import.meta.url), "utf8"),
    ]);

    for (const token of ["ACTIVE_VIEW_STORAGE_KEY", "window.sessionStorage.getItem(ACTIVE_VIEW_STORAGE_KEY)", "window.sessionStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, view)"]) expect(pageSource).toContain(token);
    expect(pageSource).toContain("await reload(); setLedgerRevision(current => current + 1);");
    expect(browserSource.indexOf("MAJOR_META[entry.major].label")).toBeLessThan(browserSource.indexOf("掌簿：{handler}"));
  });

  it("新帳保留開卷添潤、覆寫後立即刷新帳頁，收起只保留一次確認", async () => {
    const [pageSource, browserSource] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/LedgerBrowser.tsx", import.meta.url), "utf8"),
    ]);

    for (const token of ["const isEditing = Boolean(editing)", "setLedgerRevision(current => current + 1)", "if (isEditing) setView(\"帳頁翻閱\")", "revision={ledgerRevision}", "setView(\"帳頁翻閱\"); }}"])
      expect(pageSource).toContain(token);
    expect((pageSource.match(/confirm\(/g) ?? []).length).toBe(0);
    expect((browserSource.match(/confirm\(/g) ?? []).length).toBe(1);
    for (const token of ["revision: number", "[loadPage, revision]", "附記", "break-words", "px-1 pb-3 pt-1"]) expect(browserSource).toContain(token);
  });

  it("出入流轉以當月與今歲各自並排呈現入納、散逸與留存，並套用新導覽詞彙", async () => {
    const [pageSource, insightSource] = await Promise.all([
      readFile(new URL("../client/src/pages/Home.tsx", import.meta.url), "utf8"),
      readFile(new URL("../client/src/components/FlowInsights.tsx", import.meta.url), "utf8"),
    ]);

    for (const token of ["currentYear", "yearlyInflow", "yearlyOutflow", "<PeriodLedgerSummary label=\"當月\"", "<PeriodLedgerSummary label=\"今歲\"", "VIEW_LABELS", "出入流轉", "開卷添潤", "簿冊規制", "grid grid-cols-3 divide-x"]) expect(pageSource).toContain(token);
    expect(insightSource).toContain("選擇「出入流轉」頁");
    expect(insightSource).toContain("出入觀測");
  });

});

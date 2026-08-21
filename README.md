# 歲時錄 · Vellum Tides

> 玉瑟與石琴共讀的一冊生活帳頁。以羊皮紙、墨藍、苔綠與赭金描繪日常的入納與散逸。

## 現行功能

| 範圍 | 內容 |
| --- | --- |
| 封閉登入 | 僅限已由管理者建立的玉瑟、石琴帳號，以電子郵件與密語登入；提供密語重設，不提供公開註冊或 Google 登入。 |
| 固定共用帳本 | 兩位使用者讀寫同一冊 **歲時錄 · Vellum Tides**；掌簿依登入 UID 自動帶入且不可在介面改寫。 |
| 帳頁 | 散逸／入納、固定八種大目、名目、歲時、掌簿、符契與備註；支援離線暫存及 Timestamp LWW 補登。 |
| 憑據入冊 | 觀圖析字、鏡觀條印（方陣圖印／直紋條契）與手動文字帶入，接續於同一工作流完成逐項校對及歸帳。 |
| 流向 | 月痕對照、散逸羅盤與本月符契，可由設定決定要呈現的洞察。 |
| 帳頁翻閱 | 伺服器端篩選、45 筆分段載入、月份收闔與日期框組；不再一次渲染整冊歷史帳頁。 |
| 帳本典藏 | 有效帳頁 JSON 匯出、匯入前預覽、安全僅追加、還原至備份快照，以及已收起帳頁的雙重確認永久清除。 |

## 本機啟動

請使用 Node.js 22 與 pnpm。

```bash
pnpm install
pnpm dev
```

正式檢查請依序執行：

```bash
pnpm check
pnpm test
pnpm build
```

前端需要下列 Supabase 公開設定；請透過專案的受管理環境設定加入，**不要**將值提交至 Git。

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## Supabase 設定與 SQL 順序

現行 SQL 均位於 [`supabase/`](./supabase/README.md)。請自行在 Supabase SQL Editor 貼上並執行，無須提供帳號或交出瀏覽器控制權。

| 情境 | 依序執行 |
| --- | --- |
| 已有帳本第一次新增分段翻閱與典藏 | `歲時錄-v2-帳頁分段與備份.sql` |
| 已套用分段與典藏、現要啟用快照還原／永久清除 | `歲時錄-v2-典藏快照與永久刪除.sql` |
| 新空白 Supabase 專案建立 V2 | `歲時錄-v2-乾淨重設.sql` → `歲時錄-v2-固定共用帳本.sql` → `歲時錄-v2-帳頁分段與備份.sql` → `歲時錄-v2-典藏快照與永久刪除.sql` → `歲時錄-v2-核對.sql` |

`歲時錄-v2-乾淨重設.sql` 會刪除歲時錄相關資料表及資料，**只限確定不需保留帳務資料的新空白專案使用**。日常更新不可執行此檔。

## 帳本典藏：匯出、還原與永久清除

在「簿冊規制」的 **帳本典藏** 區塊可下載完整 JSON 備份。備份包含當下有效的帳頁、憑據、憑據品項、關鍵字規則與必要的版本／帳本識別；不包含已收起帳頁、登入密語或任何 Supabase 金鑰。

匯入時，系統會先在瀏覽器核對格式版本、帳本名稱、固定掌簿 UID、筆數及金額，再顯示預覽。確認後可選擇兩種還原方式：

1. 離線或仍有待補登帳頁時不得匯入，避免覆蓋本機尚未同步的內容。
2. 僅允許玉瑟與石琴對固定共用帳本操作。
3. **安全補入** 僅建立目前不存在的資料；相同帳頁、憑據、品項或規則 ID 會略過，既有資料不會被更新或刪除。
4. **還原至備份快照** 會覆寫備份中同識別碼資料，並永久移除目前存在、但不在該備份內的帳頁、憑據、品項與規則；介面必須重新勾選確認後才可執行。
5. **永久清除已收起帳頁** 只處理軟刪除帳頁，並需要瀏覽器確認與輸入「永久刪除」兩次確認。此操作不可逆，應在兩台裝置都已同步且另存最新備份後才使用。

建議在快照還原或永久清除前，先下載一次當下的完整備份；還原完成後，再匯出一次核對筆數。備份檔的有效帳頁筆數應與還原後帳本一致。

## 資料流程與離線同步

新增、覆寫與收起帳頁會先寫入 IndexedDB 佇列。網路恢復後，程式以 `updated_at_ms` 為主、`device_id` 為次進行 Last-Write-Wins 判斷，再送至 `apply_ledger_mutation`。頁首同步指示會呈現目前連線或待補登狀態。

憑據流程分為「帶入內容」與「待確認、歸帳」兩步；可由觀圖析字或方陣圖印／直紋條契帶入內容，品項校對完成後以 `post_invoice` 產生對應散逸帳頁。

## 專案結構

```text
client/src/
  components/
    FlowInsights.tsx         # 月度洞察與顯示設定
    InvoiceIntake.tsx        # 憑據入冊兩步式流程
    LedgerBrowser.tsx        # 分段帳頁翻閱與月份／日期框組
    LedgerArchivePanel.tsx   # JSON 匯出、預覽與安全匯入
  pages/Home.tsx             # 登入與主要帳本介面
shared/
  ledger.ts                  # 固定八大目、玉瑟／石琴掌簿契約
  backup.ts                  # 版本化備份格式及前端預覽驗證
supabase/
  歲時錄-v2-乾淨重設.sql
  歲時錄-v2-固定共用帳本.sql
  歲時錄-v2-帳頁分段與備份.sql
  歲時錄-v2-典藏快照與永久刪除.sql
  歲時錄-v2-核對.sql
server/
  *.test.ts                  # 帳務、備份及前端契約回歸測試
```

## 測試與維護原則

Vitest 涵蓋固定掌簿、流向／大目相容性、LWW、憑據歸帳、備份格式、固定帳本核對及分段讀取等契約。每次修改帳務資料格式或 Supabase SQL 時，請同步更新相對應測試並執行完整三項檢查。

## Vercel 部署

正式架構為 **GitHub 保存原始碼、Vercel 發布網站與 `/api/trpc` 伺服器端點、Supabase 保存帳務資料與登入帳號**。Vercel 會由 GitHub 的 `main` 分支自動建置；每次推送至該分支都會產生新的部署版本。[Vercel 的 Vite 設定][1] 會提供靜態前端，而本專案的 `api/trpc.ts` 則將既有的 tRPC 觀圖析字端點包裝為 Vercel Function。[Vercel Express 文件][2]

在 Vercel 建立專案時，請保留倉庫根目錄為 Root Directory，Framework Preset 選擇 **Vite**。倉庫已附 `vercel.json`，其中固定使用 `pnpm install --frozen-lockfile`、`pnpm build` 與 `dist/public` 作為前端輸出，並將非 `/api/` 的深層網址導回單頁入口。[Vercel Rewrites 文件][3]

請於 **Vercel → Project → Settings → Environment Variables** 在 Production、Preview 與 Development 三個環境加入：

| 變數名稱 | 值 | 必要性 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` | 必要；前端與 API 均須使用。 |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase 的 Publishable key | 必要；前端登入與伺服器端憑證核對均須使用。 |
| `GEMINI_API_KEY` | Google AI Studio 產生的 Gemini API Key | 僅觀圖析字需要；未設定時帳頁、離線補登、鏡觀條印與手動憑據仍可使用。 |

完成首次部署後，請至 **Supabase → Authentication → URL Configuration**，將 Vercel 的正式網址設為 Site URL，並在 Redirect URLs 加入同一正式網址與 `https://*.vercel.app/**`。這是密語重設信箋回到正確網站網址所需的設定。

## GitHub 封裝

此倉庫已排除 `node_modules/`、`dist/`、環境檔與日誌；提交前只需再次執行三項檢查，然後初始化並推送 Git 倉庫即可。

```bash
pnpm check && pnpm test && pnpm build
git init
git add .
git commit -m "feat: 初始化歲時錄"
```

若要建立可上傳的壓縮檔，請排除安裝依賴、建置輸出、Git 資料與本機環境檔：

```bash
zip -r vellum-tides-github.zip . \
  -x "node_modules/*" "dist/*" ".git/*" ".env*" ".manus-logs/*"
```

## 參考資料

[1]: https://vercel.com/docs/frameworks/frontend/vite "Vite on Vercel"
[2]: https://vercel.com/docs/frameworks/backend/express "Express on Vercel"
[3]: https://vercel.com/docs/routing/rewrites "Vercel Rewrites"

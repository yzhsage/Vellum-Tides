# 歲時錄 · Vellum Tides

**歲時錄 · Vellum Tides** 是供玉瑟與石琴共讀的雙人帳頁 Web App。前端以 React、Vite 與 Tailwind CSS 建置；帳頁、登入與同步以 Supabase 處理；照片憑據的觀圖析字由 Vercel 原生函式 `api/ocr.ts` 直接呼叫 Gemini。

> 本專案不再使用 Express、tRPC、Drizzle 或 Manus 平台伺服器。帳頁資料由瀏覽器直接連至 Supabase，只有觀圖析字使用 Vercel Serverless Function。

## 必要環境

請以 Node.js 22 與 pnpm 10 安裝依賴：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

本機開發可執行 `pnpm dev`。Vercel 建置使用 `pnpm build`，前端產物為 `dist/public`。

| 環境變數 | 用途 | 放置位置 |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Supabase 專案網址與登入憑證核對 | Vercel Production、Preview 與本機 `.env.local` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | 瀏覽器 Supabase 公開金鑰與觀圖函式的使用者驗證 | Vercel Production、Preview 與本機 `.env.local` |
| `GEMINI_API_KEY` | Vercel 的觀圖析字呼叫 | 僅 Vercel Production、Preview 與本機伺服器環境 |

切勿提交 `.env`、`.env.local` 或任何私密金鑰。

## 部署至 Vercel

請將本壓縮檔的內容**完整覆蓋至 GitHub 倉庫根目錄**，確定 GitHub 檔案樹同時出現 `api/ocr.ts` 與 `client/src/components/InvoiceIntake.tsx`，再提交至 `main`。Vercel 偵測到 `main` 新提交後會自動建置；`vercel.json` 只會把非 `/api/` 路徑導向單頁前端，因此 `POST /api/ocr` 會保留給原生 Serverless Function。

部署顯示 **Ready** 後，直接開啟：

```text
https://vellum-tides.vercel.app/api/ocr
```

畫面或回應應顯示 `只接受 POST 請求。`，代表觀圖函式已經存在。若出現 Vercel 404，代表 GitHub 並未將根目錄的 `api/ocr.ts` 一併提交，請重新完整覆蓋壓縮檔內容後再提交。

## 觀圖析字流程

手機拍攝或選擇照片後，前端會在記憶體中縮放並轉成 JPEG，再以目前登入者的 Supabase Access Token 向 `POST /api/ocr` 送出。函式先向 Supabase 核對登入憑證，再呼叫 Gemini，最後僅回傳商店、歲時、金額與逐項品名／大目／符契建議。圖片不寫入 Supabase，也不會保存到 Vercel。

## 離線補登與衝突處理

一般帳頁會先寫入 IndexedDB 佇列。恢復連線時，系統以 `updated_at` 時戳套用 Last-Write-Wins 規則；同步狀態會顯示於介面。照片觀圖析字必須連線，失敗時可切換為手動憑據，不會影響既有帳頁。

## 目錄說明

| 目錄／檔案 | 用途 |
| --- | --- |
| `client/` | React 介面、PWA manifest 與圖標 |
| `shared/` | 帳頁分類、驗證、備份與離線同步共用規則 |
| `supabase/` | 建立或維護歲時錄資料表、RLS 與函式的 SQL |
| `api/ocr.ts` | 唯一的 Vercel Serverless Function，提供觀圖析字 |
| `server/*.test.ts` | 帳頁、備份、部署與觀圖函式的 Vitest 回歸測試 |
| `vercel.json` | Vite 產物與單頁重寫設定 |

已排除舊 tRPC／Express 伺服器、Manus 預覽偵錯資產、內部研究文件、建置產物、快取與機密檔案。

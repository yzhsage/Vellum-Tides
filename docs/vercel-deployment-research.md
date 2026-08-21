# Vercel 部署研究筆記

研究日期：2026-08-21

## 官方文件要點

- Vercel 可將以預設匯出的 Express `app` 作為單一 Vercel Function 執行；Express 路由可保留，但 `express.static()` 不會在 Vercel 上提供靜態檔案。
- 因此前端產物應由 Vercel 的靜態輸出／CDN 提供，API 則由 Express Function 回應。
- Vite 單頁應用程式若需要直接開啟深層路徑，需使用 `vercel.json` 的 rewrite 將非 API 路徑導向 `index.html`。
- Vercel 在建置期提供環境變數；要供 Vite 前端使用的變數需以 `VITE_` 為前綴。

## 來源

1. [Vercel Express on Vercel](https://vercel.com/docs/frameworks/backend/express)，2026-07-06。
2. [Vercel Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)，2026-07-01。
3. [Vercel Rewrites](https://vercel.com/docs/routing/rewrites)，2026-07-01。

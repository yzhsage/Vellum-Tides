# Gemini 觀圖析字部署研究

本專案在 Vercel Serverless Function 中使用 Gemini REST API，避免依賴本平台專屬模型執行環境。

## 已確認的官方要點

- Gemini 的圖片理解介面支援以 Base64 內嵌圖片資料傳送；小型圖片可使用 `data` 與 `mime_type` 欄位。請求總量限制為 20 MB。[圖片理解文件](https://ai.google.dev/gemini-api/docs/image-understanding)
- Gemini 支援在回應請求中指定 JSON Schema，以取得可預期的結構化擷取結果；適用於將非結構化內容轉為固定欄位。[結構化輸出文件](https://ai.google.dev/gemini-api/docs/structured-output)
- `models.generateContent` REST API 支援 `contents`、`systemInstruction` 與 `generationConfig`；以 `x-goog-api-key` 夾帶 `GEMINI_API_KEY`。[generateContent API 參考](https://ai.google.dev/api/generate-content)

## 專案採用方式

`server/invoiceOcr.ts` 從 Data URL 拆出 MIME 類型與 Base64 圖片，傳遞至 `gemini-2.5-flash`，並要求 JSON 格式的臺灣發票欄位。正式 Vercel 專案需設 `GEMINI_API_KEY`；未設定時觀圖析字會顯示明確提示，鏡觀條印與手動品項流程仍可使用。

import { invokeLLM } from "./_core/llm";
import { validateExtractedInvoice } from "../shared/ledger";

const SYSTEM_INSTRUCTION = "你是臺灣發票影像轉寫與初步歸類助手。僅讀取可見文字，不可杜撰不存在的品項、金額或發票欄位。逐項保留可辨識的品名與金額；辨識不清處請以空字串或 0 表示。每一項必須依品名選一個大目：food=吃喝食材、home=日用品水電網路、transport=交通油資、culture=園藝水族玩具旅遊興趣、misc=醫療手續費與其他。tags 僅在品名明確顯示專案／興趣時建議 0 至 2 個 #開頭的繁體中文符契，否則輸出空陣列。金額只輸出整數新臺幣；日期以 YYYY-MM-DD 輸出；結果必須符合 JSON schema。";
const USER_PROMPT = "請擷取這張發票的商店、發票號碼、日期、隨機碼、總額與所有可辨識品項；每個品項都要輸出名目、數量、單價、金額、固定大目建議與符契建議，讓使用者能直接校對歸帳。";

const invoiceSchema = {
  type: "object",
  properties: {
    seller_name: { type: "string" },
    invoice_number: { type: "string" },
    invoice_date: { type: "string" },
    random_code: { type: "string" },
    total_amount: { type: "number" },
    confidence: { type: "number" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          amount: { type: "number" },
          major: { type: "string", enum: ["food", "home", "transport", "culture", "misc"] },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["name", "quantity", "unit_price", "amount", "major", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["seller_name", "invoice_number", "invoice_date", "random_code", "total_amount", "confidence", "items"],
  additionalProperties: false,
} as const;

export async function extractInvoiceFromImage(imageDataUrl: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("觀圖析字尚未設定 GEMINI_API_KEY，請改用鏡觀條印或手動品項輸入。");
  }

  const [header, imageData] = imageDataUrl.split(",", 2);
  const mimeType = header?.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/)?.[1];
  if (!mimeType || !imageData) {
    throw new Error("影像資料格式無法辨識，請重新選取照片。");
  }

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents: [{
        role: "user",
        parts: [
          { text: USER_PROMPT },
          { inline_data: { mime_type: mimeType, data: imageData } },
        ],
      }],
      generationConfig: {
        maxOutputTokens: 2600,
        responseMimeType: "application/json",
        responseJsonSchema: invoiceSchema,
      },
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    throw new Error(`觀圖析字服務暫時無法回應（${response.status}），請改用手動品項輸入。`);
  }

  const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const raw = result.candidates?.[0]?.content?.parts?.find(part => typeof part.text === "string")?.text;
  const parsed = typeof raw === "string" ? validateExtractedInvoice(JSON.parse(raw)) : null;
  if (!parsed) throw new Error("影像辨識結果格式不完整，請改用手動品項輸入。");
  return parsed;
}

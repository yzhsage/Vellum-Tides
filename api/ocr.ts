type RequestLike = { method?: string; body?: unknown };
type ResponseLike = { status: (statusCode: number) => ResponseLike; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };

export const config = { maxDuration: 30 };

type OcrErrorCode =
  | "METHOD_NOT_ALLOWED"
  | "INVALID_INPUT"
  | "SUPABASE_CONFIG"
  | "AUTH_EXPIRED"
  | "GEMINI_CONFIG"
  | "GEMINI_MODEL_UNAVAILABLE"
  | "GEMINI_AUTH"
  | "GEMINI_QUOTA"
  | "GEMINI_UPSTREAM_UNAVAILABLE"
  | "GEMINI_REQUEST_REJECTED"
  | "OCR_RESULT_INVALID"
  | "OCR_INTERNAL_ERROR";

const majors = new Set(["food", "home", "transport", "culture", "misc", "salary", "gain", "windfall"]);
const geminiModels = ["gemini-2.5-flash", "gemini-2.0-flash"] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRequestBody(value: unknown) {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((tag): tag is string => typeof tag === "string").map(tag => tag.trim().replace(/^#+/, "")).filter(Boolean).map(tag => `#${tag.toLowerCase()}`))).slice(0, 12);
}

function validateResult(value: unknown) {
  const invoice = asRecord(value);
  if (!invoice || !Array.isArray(invoice.items)) return null;
  return {
    seller_name: typeof invoice.seller_name === "string" ? invoice.seller_name.trim() : "",
    invoice_number: typeof invoice.invoice_number === "string" ? invoice.invoice_number.trim().toUpperCase() : "",
    invoice_date: typeof invoice.invoice_date === "string" ? invoice.invoice_date : "",
    random_code: typeof invoice.random_code === "string" ? invoice.random_code.trim() : "",
    total_amount: Math.max(0, Math.round(Number(invoice.total_amount) || 0)),
    confidence: Math.max(0, Math.min(1, Number(invoice.confidence) || 0)),
    items: invoice.items
      .map(asRecord)
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map(item => ({
        title: typeof item.title === "string" ? item.title.trim() : typeof item.name === "string" ? item.name.trim() : "",
        quantity: Number(item.quantity) || 1,
        unit_price: Math.round(Number(item.unit_price) || 0),
        amount: Math.max(0, Math.round(Number(item.amount) || 0)),
        major: typeof item.major === "string" && majors.has(item.major) ? item.major : null,
        tags: cleanTags(item.tags),
      }))
      .filter(item => item.title || item.amount > 0),
  };
}

function modelJson(text: string) {
  if (!text) return null;
  const stripped = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const objectText = stripped.match(/\{[\s\S]*\}/)?.[0] ?? stripped;
  try {
    return JSON.parse(objectText);
  } catch {
    return null;
  }
}

function send(res: ResponseLike, status: number, body: unknown) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function sendError(res: ResponseLike, status: number, code: OcrErrorCode, message: string) {
  return send(res, status, { code, message });
}

function geminiFailure(res: ResponseLike, status: number) {
  if (status === 404) return sendError(res, 502, "GEMINI_MODEL_UNAVAILABLE", "觀圖析字暫無可用模型。請確認 GEMINI_API_KEY 已啟用 Generative Language API 與可用模型權限。");
  if (status === 401 || status === 403) return sendError(res, 502, "GEMINI_AUTH", "觀圖析字金鑰無法取得模型使用權限，請檢查 Vercel 的 GEMINI_API_KEY 設定。");
  if (status === 429) return sendError(res, 502, "GEMINI_QUOTA", "觀圖析字服務目前額度已滿，請稍後再試或改用手動憑據。");
  if (status >= 500 || status === 0) return sendError(res, 502, "GEMINI_UPSTREAM_UNAVAILABLE", "觀圖析字服務暫時無法回應，請稍後再試或改用手動憑據。");
  return sendError(res, 502, "GEMINI_REQUEST_REJECTED", `觀圖析字服務拒絕此次請求（${status}），請換一張清晰且完整的憑據照片再試。`);
}

export default async function handler(req: RequestLike, res: ResponseLike) {
  if (req.method !== "POST") return sendError(res, 405, "METHOD_NOT_ALLOWED", "只接受 POST 請求。");

  try {
    const body = parseRequestBody(req.body);
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken : "";
    const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
    
    // 強化 Base64 解析容錯率，避免空格或換行字元干擾
    const imageMatch = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
    if (accessToken.length < 20 || !imageMatch) {
      return sendError(res, 400, "INVALID_INPUT", "影像或登入憑證格式無法辨識，請重新登入後再試。");
    }

    const mimeType = imageMatch[1];
    const base64Data = imageMatch[2].trim().replace(/\s/g, "");

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return sendError(res, 500, "SUPABASE_CONFIG", "觀圖析字服務尚未完成資料庫連線設定。");

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) return sendError(res, 401, "AUTH_EXPIRED", "登入憑證已失效，請重新登入後再試。");

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return sendError(res, 500, "GEMINI_CONFIG", "觀圖析字服務尚未設定辨讀金鑰。");

    const requestBody = JSON.stringify({
      contents: [{ parts: [
        { text: "簡短辨讀這張台灣發票，只回覆極簡 JSON，不要思考過程，不要 markdown。欄位：seller_name、invoice_number、invoice_date（YYYY-MM-DD）、random_code、total_amount、confidence（0 到 1）、items。items 每項包含 title、quantity、unit_price、amount、major（僅 food、home、transport、culture、misc、salary、gain、windfall 之一或 null）、tags（字串陣列）。看不清的欄位使用空字串、0 或 null。" },
        { inline_data: { mime_type: mimeType, data: base64Data } },
      ] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
    });

    let responseText = "";
    let responseStatus = 0;
    let responseOk = false;
    for (const model of geminiModels) {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiKey)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      });
      responseStatus = response.status;
      responseText = await response.text();
      responseOk = response.ok;
      if (response.ok || response.status !== 404) break;
    }
    if (!responseOk) return geminiFailure(res, responseStatus);

    const payload = modelJson(responseText) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null;
    const raw = payload?.candidates?.[0]?.content?.parts?.find(part => typeof part.text === "string")?.text;
    const result = typeof raw === "string" ? validateResult(modelJson(raw)) : null;

    if (!result) return sendError(res, 502, "OCR_RESULT_INVALID", "觀圖析字結果格式不完整，請改用手動憑據。");
    return send(res, 200, result);
  } catch (error) {
    console.error("[ocr]", error);
    return sendError(res, 500, "OCR_INTERNAL_ERROR", "觀圖析字服務暫時無法完成，請稍後重試或改用手動憑據。");
  }
}
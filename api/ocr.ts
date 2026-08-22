type RequestLike = { method?: string; body?: unknown };
type ResponseLike = { status: (statusCode: number) => ResponseLike; json: (body: unknown) => void; setHeader: (name: string, value: string) => void };

const majors = new Set(["food", "home", "transport", "culture", "misc", "salary", "gain", "windfall"]);
const imageDataUrlPattern = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

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

export default async function handler(req: RequestLike, res: ResponseLike) {
  if (req.method !== "POST") return send(res, 405, { message: "只接受 POST 請求。" });

  try {
    const body = parseRequestBody(req.body);
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken : "";
    const imageDataUrl = typeof body?.imageDataUrl === "string" ? body.imageDataUrl : "";
    const imageMatch = imageDataUrl.match(imageDataUrlPattern);
    if (accessToken.length < 20 || !imageMatch) return send(res, 400, { message: "影像或登入憑證格式無法辨識，請重新登入後再試。" });

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return send(res, 500, { message: "觀圖析字服務尚未完成資料庫連線設定。" });

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabaseKey, authorization: `Bearer ${accessToken}` },
    });
    if (!userResponse.ok) return send(res, 401, { message: "登入憑證已失效，請重新登入後再試。" });

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return send(res, 500, { message: "觀圖析字服務尚未設定辨讀金鑰。" });

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [
          { text: "請辨讀這張台灣消費憑據，只回覆 JSON，不要 markdown。欄位：seller_name、invoice_number、invoice_date（YYYY-MM-DD）、random_code、total_amount、confidence（0 到 1）、items。items 每項包含 title、quantity、unit_price、amount、major（僅 food、home、transport、culture、misc、salary、gain、windfall 之一或 null）、tags（字串陣列）。看不清的欄位使用空字串、0 或 null。" },
          { inline_data: { mime_type: imageMatch[1], data: imageMatch[2] } },
        ] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
      }),
    });
    const responseText = await response.text();
    if (!response.ok) return send(res, 502, { message: `觀圖析字服務暫時無法回應（${response.status}）。`, detail: responseText.replace(/\s+/g, " ").slice(0, 180) });

    const payload = modelJson(responseText) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> } | null;
    const raw = payload?.candidates?.[0]?.content?.parts?.find(part => typeof part.text === "string")?.text;
    const result = typeof raw === "string" ? validateResult(modelJson(raw)) : null;
    if (!result) return send(res, 502, { message: "觀圖析字結果格式不完整，請改用手動憑據。" });
    return send(res, 200, result);
  } catch (error) {
    console.error("[ocr]", error);
    return send(res, 500, { message: "觀圖析字服務暫時無法完成，請稍後重試或改用手動憑據。" });
  }
}

import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "../api/ocr";

function createResponse() {
  let statusCode = 0;
  let body: unknown;
  const headers = new Map<string, string>();
  const response = {
    status(code: number) {
      statusCode = code;
      return response;
    },
    json(value: unknown) {
      body = value;
    },
    setHeader(name: string, value: string) {
      headers.set(name, value);
    },
  };
  return { response, result: () => ({ statusCode, body, headers }) };
}

describe("原生觀圖析字 Vercel 函式", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("拒絕非 POST 請求時仍回傳 JSON 格式的可讀錯誤", async () => {
    const capture = createResponse();

    await handler({ method: "GET" }, capture.response);

    expect(capture.result().statusCode).toBe(405);
    expect(capture.result().body).toEqual({ code: "METHOD_NOT_ALLOWED", message: "只接受 POST 請求。" });
    expect(capture.result().headers.get("Cache-Control")).toBe("no-store");
  });

  it("影像或憑證缺漏時不會進入外部服務，且一律回傳 JSON", async () => {
    const capture = createResponse();

    await handler({ method: "POST", body: {} }, capture.response);

    expect(capture.result().statusCode).toBe(400);
    expect(capture.result().body).toEqual({ code: "INVALID_INPUT", message: "影像或登入憑證格式無法辨識，請重新登入後再試。" });
  });

  it("照片承載超過行動端安全上限時，在進入外部服務前回傳可讀的 413 JSON", async () => {
    const capture = createResponse();

    await handler({ method: "POST", body: { accessToken: "a".repeat(24), imageDataUrl: `data:image/jpeg;base64,${"a".repeat(1_800_001)}` } }, capture.response);

    expect(capture.result().statusCode).toBe(413);
    expect(capture.result().body).toMatchObject({ code: "OCR_PAYLOAD_TOO_LARGE" });
  });

  it("第一個 Gemini 模型回傳 404 時會改用相容模型，不把上游 404 誤認為網站端點不存在", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":{"message":"model not found"}}', { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({
          seller_name: "書店",
          invoice_number: "AB12345678",
          invoice_date: "2026-08-22",
          random_code: "1234",
          total_amount: 120,
          confidence: 0.88,
          items: [{ title: "筆記本", quantity: 1, unit_price: 120, amount: 120, major: "culture", tags: ["#文具"] }],
        }) }] } }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const capture = createResponse();

    await handler({
      method: "POST",
      body: { accessToken: "a".repeat(24), imageDataUrl: "data:image/jpeg;base64,aGVsbG8=" },
    }, capture.response);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("gemini-2.5-flash");
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("gemini-2.0-flash");
    expect(capture.result().statusCode).toBe(200);
  });

  it("兩個 Gemini 模型都找不到時回傳可供手機端分類的模型錯誤代碼", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":{"message":"model not found"}}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{"error":{"message":"model not found"}}', { status: 404 })));
    const capture = createResponse();

    await handler({ method: "POST", body: { accessToken: "a".repeat(24), imageDataUrl: "data:image/jpeg;base64,aGVsbG8=" } }, capture.response);

    expect(capture.result().statusCode).toBe(502);
    expect(capture.result().body).toMatchObject({ code: "GEMINI_MODEL_UNAVAILABLE" });
  });

  it("Gemini 額度用盡時回傳獨立代碼而不混同為網站端點 404", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response('{"error":{"message":"quota exhausted"}}', { status: 429 })));
    const capture = createResponse();

    await handler({ method: "POST", body: { accessToken: "a".repeat(24), imageDataUrl: "data:image/jpeg;base64,aGVsbG8=" } }, capture.response);

    expect(capture.result().statusCode).toBe(502);
    expect(capture.result().body).toMatchObject({ code: "GEMINI_QUOTA" });
  });

  it("Gemini 連線在函式內逾時或中斷時回傳結構化上游錯誤，而不讓用戶端只得到 Load failed", async () => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("GEMINI_API_KEY", "gemini-test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockRejectedValueOnce(new TypeError("upstream connection reset")));
    const capture = createResponse();

    await handler({ method: "POST", body: { accessToken: "a".repeat(24), imageDataUrl: "data:image/jpeg;base64,aGVsbG8=" } }, capture.response);

    expect(capture.result().statusCode).toBe(502);
    expect(capture.result().body).toMatchObject({ code: "GEMINI_UPSTREAM_UNAVAILABLE" });
  });
});

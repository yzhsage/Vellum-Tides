import { describe, expect, it } from "vitest";
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
  it("拒絕非 POST 請求時仍回傳 JSON 格式的可讀錯誤", async () => {
    const capture = createResponse();

    await handler({ method: "GET" }, capture.response);

    expect(capture.result().statusCode).toBe(405);
    expect(capture.result().body).toEqual({ message: "只接受 POST 請求。" });
    expect(capture.result().headers.get("Cache-Control")).toBe("no-store");
  });

  it("影像或憑證缺漏時不會進入外部服務，且一律回傳 JSON", async () => {
    const capture = createResponse();

    await handler({ method: "POST", body: {} }, capture.response);

    expect(capture.result().statusCode).toBe(400);
    expect(capture.result().body).toEqual({ message: "影像或登入憑證格式無法辨識，請重新登入後再試。" });
  });
});

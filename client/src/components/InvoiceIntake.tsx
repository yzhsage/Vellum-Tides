import { MAJOR_META, MAJORS_BY_DIRECTION, normaliseTags, type LedgerMajor } from "@shared/ledger";
import { Camera, CheckCircle2, FilePenLine, Loader2, Plus, QrCode, Sparkles, Trash2 } from "lucide-react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

type IntakeSource = "photo_ocr" | "qr_barcode" | "manual";
type Member = { user_id: string; display_name: string };
type DraftItem = { key: string; title: string; quantity: string; unit_price: string; amount: string; major: LedgerMajor | ""; tags: string; handled_by: string };
type DraftInvoice = { seller_name: string; invoice_number: string; invoice_date: string; random_code: string; total_amount: string; barcode_text: string; confidence: number | null };
type PendingItem = { id: string; title: string; amount: number; major: LedgerMajor | null; tags: string[]; handled_by: string | null; classification_confirmed: boolean };
type PendingInvoice = { id: string; seller_name: string; invoice_date: string | null; total_amount: number; invoice_items: PendingItem[] };
type OcrResult = { seller_name: string; invoice_number: string; invoice_date: string; random_code: string; total_amount: number; confidence: number; items: Array<{ title: string; quantity: number; unit_price: number; amount: number; major: LedgerMajor | null; tags: string[] }> };
type OcrErrorBody = { message?: string; code?: string };

class OcrRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "OcrRequestError";
  }
}

const emptyInvoice = (): DraftInvoice => ({ seller_name: "", invoice_number: "", invoice_date: new Date().toISOString().slice(0, 10), random_code: "", total_amount: "", barcode_text: "", confidence: null });
const emptyItem = (handlerId: string): DraftItem => ({ key: crypto.randomUUID(), title: "", quantity: "1", unit_price: "", amount: "", major: "", tags: "", handled_by: handlerId });
const fieldClass = "w-full rounded-xl border border-vellum-200 bg-vellum-50 px-3.5 py-2.5 text-sm text-ink-700 outline-none transition placeholder:text-ink-500/55 focus:border-moss-500 focus:ring-2 focus:ring-moss-100";
const metaFieldClass = "w-full sm:w-[15rem]";
const MAX_OCR_SOURCE_BYTES = 12_000_000;
// Vercel Functions 的 request body 上限為 4.5 MB；保留足夠餘裕給 JSON 與行動網路傳輸。
const MAX_OCR_DATA_URL_LENGTH = 1_800_000;

function loadReceiptImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("這張照片無法轉為可辨讀的影像。請以 JPG、PNG 或 WebP 重新拍攝。"));
    };
    image.src = objectUrl;
  });
}

async function prepareOcrImage(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("請選擇圖片檔案。");
  if (file.size > MAX_OCR_SOURCE_BYTES) throw new Error("照片檔案過大，請拍攝完整憑據後再試，或先裁去周遭背景。");

  const image = await loadReceiptImage(file);
  for (const maximumEdge of [1600, 1440, 1280]) {
    const scale = Math.min(1, maximumEdge / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("此裝置無法整理照片，請改選較小的 JPG 圖片。");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    for (const quality of [0.78, 0.65, 0.52]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= MAX_OCR_DATA_URL_LENGTH) return dataUrl;
    }
  }
  throw new Error("照片整理後仍過大，請靠近憑據重拍或裁去周遭背景後再試。");
}

function displayOcrError(error: unknown) {
  const message = error instanceof Error ? error.message : "照片辨識暫時無法完成。";
  const code = error instanceof OcrRequestError ? error.code : undefined;
  const guidance: Record<string, string> = {
    INVALID_INPUT: "照片或登入資料格式不符，請重新登入，並改選一張清晰的 JPG、PNG 或 WebP 憑據。",
    AUTH_EXPIRED: "登入憑證已失效，請先重新登入後再試。",
    SUPABASE_CONFIG: "觀圖析字的帳本連線尚未就緒，請稍後再試。",
    GEMINI_CONFIG: "觀圖析字尚未設定辨讀金鑰，請檢查正式部署的服務設定。",
    GEMINI_MODEL_UNAVAILABLE: "觀圖析字服務目前沒有可用模型，請確認辨讀服務的 API 已啟用並允許使用模型。",
    GEMINI_MODEL_CATALOG_UNAVAILABLE: "觀圖析字服務無法讀取可用模型清單，請確認辨讀金鑰允許使用 Gemini API。",
    GEMINI_AUTH: "觀圖析字金鑰沒有模型使用權限，請檢查正式部署的金鑰設定。",
    GEMINI_QUOTA: "觀圖析字服務目前額度已滿，請稍後重試，或先改用手動憑據。",
    GEMINI_UPSTREAM_UNAVAILABLE: "觀圖析字服務暫時無法回應，請稍後重試。",
    GEMINI_REQUEST_REJECTED: "此照片未被辨讀服務接受，請改拍完整、清晰且光線充足的憑據。",
    OCR_RESULT_INVALID: "照片已有回應但內容不完整，請換一張較清晰的憑據或改用手動憑據。",
    OCR_PAYLOAD_TOO_LARGE: "照片整理後仍超過可安全傳送的大小，請靠近憑據重拍或裁去周遭背景後再試。",
    OCR_NETWORK_UNAVAILABLE: "手機與觀圖析字服務的連線暫時中斷，已自動重試一次仍未成功；請確認網路後再試。",
  };
  if (code && guidance[code]) return guidance[code];
  if (/Unexpected token|not valid JSON|page could not be found|expected pattern/i.test(message)) {
    return "觀圖析字服務的連線暫時未完成，請稍後重試；仍可切換手動憑據繼續建立品項。";
  }
  return message;
}

async function requestOcr(accessToken: string, imageDataUrl: string): Promise<OcrResult> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken, imageDataUrl }),
        cache: "no-store",
      });
      const responseText = await response.text();
      let body: OcrErrorBody | OcrResult;
      try {
        body = JSON.parse(responseText) as { message?: string } | OcrResult;
      } catch {
        throw new Error("觀圖析字服務回傳了無法辨讀的內容，請稍後重試。", { cause: responseText.slice(0, 180) });
      }
      if (!response.ok) {
        const errorBody = body as OcrErrorBody;
        throw new OcrRequestError(errorBody.message || "觀圖析字服務暫時無法完成。", errorBody.code);
      }
      return body as OcrResult;
    } catch (error) {
      const isNetworkFailure = error instanceof TypeError && /load failed|failed to fetch|networkerror/i.test(error.message);
      if (!isNetworkFailure) throw error;
      if (attempt === 0) {
        await new Promise(resolve => window.setTimeout(resolve, 700));
        continue;
      }
      throw new OcrRequestError("觀圖析字連線在重試後仍未完成。", "OCR_NETWORK_UNAVAILABLE");
    }
  }
  throw new OcrRequestError("觀圖析字連線暫時無法完成。", "OCR_NETWORK_UNAVAILABLE");
}

export function InvoiceIntake({
  householdId,
  userId,
  members,
  knownTags,
  awaitingInvoices,
  formatMoney,
  onSaved,
  onUpdateInvoiceItem,
  onPostInvoice,
}: {
  householdId: string;
  userId: string;
  members: Member[];
  knownTags: string[];
  awaitingInvoices: PendingInvoice[];
  formatMoney: (amount: number) => string;
  onSaved: () => Promise<void> | void;
  onUpdateInvoiceItem: (invoiceId: string, item: PendingItem, patch: Partial<PendingItem>) => Promise<void> | void;
  onPostInvoice: (invoiceId: string) => Promise<void> | void;
}) {
  const [source, setSource] = useState<IntakeSource>("photo_ocr");
  const [invoice, setInvoice] = useState<DraftInvoice>(emptyInvoice());
  const [items, setItems] = useState<DraftItem[]>(() => [emptyItem(userId)]);
  const [saving, setSaving] = useState(false);
  const [postingId, setPostingId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const qrVideoRef = useRef<HTMLVideoElement>(null);
  const qrControlsRef = useRef<{ stop: () => void } | null>(null);
  const qrSessionRef = useRef(0);
  const [scanningQr, setScanningQr] = useState(false);
  const [ocrPending, setOcrPending] = useState(false);

  const stopQrScanner = () => {
    qrSessionRef.current += 1;
    qrControlsRef.current?.stop();
    qrControlsRef.current = null;
    setScanningQr(false);
  };

  useEffect(() => () => { qrControlsRef.current?.stop(); }, []);

  const updateItem = (key: string, patch: Partial<DraftItem>) => setItems(current => current.map(item => item.key === key ? { ...item, ...patch } : item));
  const appendTag = (key: string, tag: string) => setItems(current => current.map(item => item.key === key ? { ...item, tags: normaliseTags(`${item.tags} ${tag}`).join(" ") } : item));

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!supabase) return;
    setOcrPending(true);
    try {
      const [{ data: sessionResult }, imageDataUrl] = await Promise.all([supabase.auth.getSession(), prepareOcrImage(file)]);
      const accessToken = sessionResult.session?.access_token;
      if (!accessToken) throw new Error("登入憑證已失效，請重新登入後再試。");
      const result = await requestOcr(accessToken, imageDataUrl);
      setInvoice({
        seller_name: result.seller_name,
        invoice_number: result.invoice_number,
        invoice_date: result.invoice_date || new Date().toISOString().slice(0, 10),
        random_code: result.random_code,
        total_amount: result.total_amount ? String(result.total_amount) : "",
        barcode_text: "",
        confidence: result.confidence,
      });
      setItems(result.items.length ? result.items.map(item => ({
        key: crypto.randomUUID(), title: item.title, quantity: String(item.quantity || 1), unit_price: item.unit_price ? String(item.unit_price) : "", amount: item.amount ? String(item.amount) : "", major: item.major ?? "", tags: (item.tags ?? []).join(" "), handled_by: userId,
      })) : [emptyItem(userId)]);
      toast.success("已預填逐項歸類。", { description: `已帶入 ${result.items.length} 項名目、金額與大目建議；請校對後暫存至第二步。` });
    } catch (error) {
      toast.error("觀圖析字未完成。", { description: `${displayOcrError(error)} 可切換到手動憑據，繼續建立品項。` });
    } finally {
      setOcrPending(false);
    }
  };

  const startQrScanner = async () => {
    if (!qrVideoRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) return toast.error("此瀏覽器無法開啟相機。", { description: "請改用手動貼入條印文字。" });
    stopQrScanner();
    const sessionId = ++qrSessionRef.current;
    setScanningQr(true);
    try {
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }, qrVideoRef.current, (result, _error, activeControls) => {
        if (sessionId !== qrSessionRef.current) {
          activeControls.stop();
          return;
        }
        if (!result) return;
        setInvoice(current => ({ ...current, barcode_text: result.getText() }));
        activeControls.stop();
        qrControlsRef.current = null;
        qrSessionRef.current += 1;
        setScanningQr(false);
        toast.success("已讀取條印文字。", { description: "已辨讀直紋條契或方陣圖印，文字已帶入下方欄位；仍可補寫品項後暫存。" });
      });
      if (sessionId !== qrSessionRef.current) {
        controls.stop();
        return;
      }
      qrControlsRef.current = controls;
    } catch (error) {
      setScanningQr(false);
      toast.error(error instanceof Error ? `無法開啟鏡觀：${error.message}` : "無法開啟鏡觀。", { description: "請允許相機權限，或改用手動貼入文字。" });
    }
  };

  const persist = async () => {
    if (!supabase || !householdId) return;
    const completedItems = items.filter(item => item.title.trim() || Number(item.amount) > 0);
    if (!completedItems.length) return toast.error("請至少寫下一項品項。");
    if (completedItems.some(item => !item.title.trim() || Number(item.amount) <= 0 || !item.major)) return toast.error("每個品項都須有名目、正數金額與大目。", { description: "觀圖析字後請逐項確認歸類。" });
    setSaving(true);
    try {
      const sourceText = source === "photo_ocr" ? "觀圖析字" : source === "qr_barcode" ? "鏡觀條印" : "手動憑據";
      const computedTotal = completedItems.reduce((sum, item) => sum + Math.round(Number(item.amount) || 0), 0);
      const { data: created, error: invoiceError } = await supabase.from("invoices").insert({
        household_id: householdId,
        invoice_number: invoice.invoice_number.trim() || null,
        invoice_date: invoice.invoice_date || null,
        random_code: invoice.random_code.trim() || null,
        seller_name: invoice.seller_name.trim(),
        total_amount: Math.round(Number(invoice.total_amount) || computedTotal),
        source,
        raw_payload: { source_label: sourceText, barcode_text: invoice.barcode_text.trim(), ocr_confidence: invoice.confidence, captured_at: new Date().toISOString() },
        state: "awaiting_confirmation",
        created_by: userId,
      }).select("id").single();
      if (invoiceError || !created) throw new Error(invoiceError?.message ?? "無法暫存憑據。");
      const { error: itemError } = await supabase.from("invoice_items").insert(completedItems.map(item => ({
        invoice_id: created.id,
        title: item.title.trim(),
        quantity: Number(item.quantity) || 1,
        unit_price: Math.round(Number(item.unit_price) || 0),
        amount: Math.round(Number(item.amount) || 0),
        major: item.major as LedgerMajor,
        tags: normaliseTags(item.tags),
        handled_by: item.handled_by || userId,
        classification_confirmed: true,
      })));
      if (itemError) throw new Error(itemError.message);
      setInvoice(emptyInvoice());
      setItems([emptyItem(userId)]);
      await onSaved();
      toast.success("憑據已暫存。", { description: "請直接往下進入第二步，逐項確認後歸入帳本。" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "憑據尚未存入。");
    } finally {
      setSaving(false);
    }
  };

  const post = async (invoiceId: string) => {
    setPostingId(invoiceId);
    try {
      await onPostInvoice(invoiceId);
    } finally {
      setPostingId(null);
    }
  };

  return <section className="mx-auto max-w-5xl space-y-6">
    <article className="rounded-[1.8rem] border border-moss-300/60 bg-moss-100/45 p-6 shadow-sm md:p-8">
      <p className="text-xs font-bold tracking-[.18em] text-moss-700">憑據入冊 · 初卷</p>
      <h2 className="mt-2 font-vellum text-3xl font-black text-ink-700">憑據入冊</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-moss-700">觀圖析字會先摘錄品項，再預填逐項名目、金額、大目與可辨識的符契；只需校對有疑義的地方，暫存後即可在本頁第二步歸帳。</p>
      <div className="mt-6 grid gap-2 sm:grid-cols-3">{([ ["photo_ocr", Camera, "觀圖析字"], ["qr_barcode", QrCode, "鏡觀條印"], ["manual", Plus, "手動憑據"] ] as const).map(([value, Icon, label]) => <button key={value} type="button" onClick={() => { if (value !== "qr_barcode") stopQrScanner(); setSource(value); }} className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold transition ${source === value ? "border-moss-700 bg-moss-700 text-vellum-50" : "border-moss-300 bg-vellum-50/75 text-moss-700 hover:bg-moss-100"}`}><Icon size={17} />{label}</button>)}</div>
      {source === "photo_ocr" && <div className="mt-5 rounded-2xl border border-dashed border-moss-300 bg-vellum-50/65 p-5"><input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={event => void handlePhoto(event)} /><input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={event => void handlePhoto(event)} /><div className="grid gap-3 sm:grid-cols-2"><button type="button" disabled={ocrPending} onClick={() => cameraRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-ink-700 px-4 py-3 font-bold text-vellum-50 disabled:opacity-60">{ocrPending ? <Loader2 className="animate-spin" size={18} /> : <Camera size={18} />}{ocrPending ? "正在摘錄憑據…" : "開啟相機拍攝"}</button><button type="button" disabled={ocrPending} onClick={() => fileRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl border border-moss-300 bg-moss-100/55 px-4 py-3 font-bold text-moss-700 disabled:opacity-60"><FilePenLine size={18} />選擇既有照片</button></div><p className="mt-3 text-center text-xs leading-5 text-moss-700">在手機上，「開啟相機拍攝」會優先交由後鏡頭取景；桌面則自然改為選檔。影像只供本次析字、不會保存。送出前會自動縮放並轉為相容格式，以兼顧 iPhone、Android 與服務端的傳送限制；析字後會預填逐項名目、金額、大目與符契建議。</p></div>}
      {source === "qr_barcode" && <div className="mt-5 space-y-4 rounded-2xl border border-dashed border-moss-300 bg-vellum-50/65 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-moss-700">鏡觀條印</h3><p className="mt-1 text-xs leading-5 text-moss-700">請允許相機權限，並讓直紋條契或方陣圖印保持在取景框內。觀得的文字會帶入下方欄位。</p></div>{scanningQr ? <button type="button" onClick={stopQrScanner} className="rounded-xl border border-ochre-300 bg-ochre-100/55 px-4 py-2.5 text-sm font-bold text-ochre-700">止住取景</button> : <button type="button" onClick={() => void startQrScanner()} className="inline-flex items-center gap-2 rounded-xl bg-ink-700 px-4 py-2.5 text-sm font-bold text-vellum-50"><Camera size={17} />開啟鏡觀</button>}</div><div className="overflow-hidden rounded-xl border border-moss-300 bg-ink-700"><video ref={qrVideoRef} muted playsInline className="aspect-video w-full object-cover" /></div><label className="block text-sm font-semibold text-ink-700"><span className="mb-1.5 block">條印文字</span><textarea value={invoice.barcode_text} onChange={event => setInvoice(current => ({ ...current, barcode_text: event.target.value }))} className={`${fieldClass} min-h-24 resize-y`} placeholder="也可手動貼上鏡觀所得的文字；尚未串接官方明細服務時，仍可在下方補寫品項。" /></label></div>}
    </article>

    <article className="rounded-[1.8rem] border border-vellum-300 bg-vellum-50 p-6 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-vellum text-2xl font-black text-ink-700">憑據眉批</h3><p className="mt-1 text-sm text-ink-600">觀圖析字後會自動帶入可讀取的內容；仍可在此自由更正。</p></div>{invoice.confidence !== null && <span className="rounded-full bg-moss-100 px-3 py-1.5 text-xs font-bold text-moss-700">析字信心 {Math.round(invoice.confidence * 100)}%</span>}</div>
      <div className="mt-5 flex flex-wrap gap-4"><label className={`${metaFieldClass} text-sm font-semibold text-ink-700`}>商店<input className={`mt-1.5 ${fieldClass}`} value={invoice.seller_name} onChange={event => setInvoice(current => ({ ...current, seller_name: event.target.value }))} placeholder="例如：大賣場" /></label><label className={`${metaFieldClass} text-sm font-semibold text-ink-700`}>發票號碼<input className={`mt-1.5 ${fieldClass}`} value={invoice.invoice_number} onChange={event => setInvoice(current => ({ ...current, invoice_number: event.target.value }))} placeholder="AB12345678" /></label><label className={`${metaFieldClass} text-sm font-semibold text-ink-700`}>歲時<input className={`mt-1.5 ${fieldClass}`} type="date" value={invoice.invoice_date} onChange={event => setInvoice(current => ({ ...current, invoice_date: event.target.value }))} /></label><label className={`${metaFieldClass} text-sm font-semibold text-ink-700`}>隨機碼<input className={`mt-1.5 ${fieldClass}`} value={invoice.random_code} onChange={event => setInvoice(current => ({ ...current, random_code: event.target.value }))} placeholder="選填" /></label><label className={`${metaFieldClass} text-sm font-semibold text-ink-700`}>憑據總額<input className={`mt-1.5 ${fieldClass}`} inputMode="numeric" type="number" min="0" value={invoice.total_amount} onChange={event => setInvoice(current => ({ ...current, total_amount: event.target.value }))} placeholder="若留白，將由品項加總" /></label></div>
    </article>

    <article className="rounded-[1.8rem] border border-vellum-300 bg-vellum-50 p-6 md:p-8"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-vellum text-2xl font-black text-ink-700">逐項歸類</h3><p className="mt-1 text-sm text-ink-600">同一張憑據可分別歸入饁膳、居業或其他大目，暫存後可在第二步作最後校對。</p></div><button type="button" onClick={() => setItems(current => [...current, emptyItem(userId)])} className="inline-flex items-center gap-2 rounded-xl border border-moss-300 bg-moss-100/60 px-3.5 py-2 text-sm font-bold text-moss-700"><Plus size={16} />添一項</button></div><div className="mt-5 space-y-4">{items.map((item, index) => <div key={item.key} className="rounded-2xl border border-vellum-300 bg-vellum-100/35 p-4"><div className="mb-3 flex items-center justify-between"><p className="text-sm font-bold text-ink-700">品項 {index + 1}</p>{items.length > 1 && <button type="button" onClick={() => setItems(current => current.filter(row => row.key !== item.key))} className="inline-flex items-center gap-1 text-xs font-bold text-ochre-700"><Trash2 size={14} />移除</button>}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><input className={fieldClass} value={item.title} onChange={event => updateItem(item.key, { title: event.target.value })} placeholder="名目，例如：土壤" /><input className={fieldClass} inputMode="decimal" type="number" min="0" value={item.quantity} onChange={event => updateItem(item.key, { quantity: event.target.value })} placeholder="數量" /><input className={fieldClass} inputMode="numeric" type="number" min="0" value={item.unit_price} onChange={event => updateItem(item.key, { unit_price: event.target.value })} placeholder="單價" /><input className={fieldClass} inputMode="numeric" type="number" min="0" value={item.amount} onChange={event => updateItem(item.key, { amount: event.target.value })} placeholder="金額" /><select className={fieldClass} value={item.major} onChange={event => updateItem(item.key, { major: event.target.value as LedgerMajor | "" })}><option value="">選擇大目</option>{MAJORS_BY_DIRECTION.outflow.map(major => <option key={major} value={major}>{MAJOR_META[major].label}｜{MAJOR_META[major].description}</option>)}</select><select className={fieldClass} value={item.handled_by} onChange={event => updateItem(item.key, { handled_by: event.target.value })}>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name}掌簿</option>)}</select><div className="sm:col-span-2"><input list={`invoice-tags-${item.key}`} className={fieldClass} value={item.tags} onChange={event => updateItem(item.key, { tags: event.target.value })} placeholder="符契，例如：#園藝 #水族" /><datalist id={`invoice-tags-${item.key}`}>{knownTags.map(tag => <option key={tag} value={tag} />)}</datalist>{knownTags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{knownTags.slice(0, 5).map(tag => <button key={tag} type="button" onClick={() => appendTag(item.key, tag)} className="rounded-full border border-moss-300 bg-moss-100/60 px-2 py-0.5 text-[11px] font-bold text-moss-700">{tag}</button>)}</div>}</div></div></div>)}</div><div className="mt-7 flex justify-end"><button type="button" disabled={saving} onClick={() => void persist()} className="inline-flex items-center gap-2 rounded-xl bg-ink-700 px-5 py-3 font-bold text-vellum-50 disabled:opacity-60">{saving && <Loader2 className="animate-spin" size={17} />}{saving ? "正在暫存…" : "暫存並前往第二步"}</button></div></article>

    <article className="scroll-mt-24 rounded-[1.8rem] border border-moss-300/65 bg-moss-100/45 p-6 shadow-sm md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold tracking-[.18em] text-moss-700">憑據入冊 · 次卷</p><h2 className="mt-2 font-vellum text-3xl font-black text-ink-700">待確認與歸帳</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-moss-700">這裡會保留所有尚未歸帳的憑據，可回來逐項改寫名目、大目、掌簿與符契；確認無誤後才會化為正式帳頁。</p></div><span className="inline-flex items-center gap-2 rounded-full border border-moss-300 bg-vellum-50/75 px-3 py-1.5 text-xs font-bold text-moss-700"><FilePenLine size={14} />待續編 {awaitingInvoices.length} 張</span></div>
      <div className="mt-6 space-y-4">{awaitingInvoices.length ? awaitingInvoices.map(pendingInvoice => <article key={pendingInvoice.id} className="rounded-2xl border border-moss-300 bg-vellum-50/85 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-vellum text-xl font-black text-ink-700">{pendingInvoice.seller_name || "未署名憑據"}</h3><p className="text-sm text-ink-600">{pendingInvoice.invoice_date ?? "未載歲時"} · {formatMoney(pendingInvoice.total_amount)}</p></div><button type="button" onClick={() => void post(pendingInvoice.id)} disabled={postingId === pendingInvoice.id || pendingInvoice.invoice_items.some(item => !item.major || !item.title.trim())} className="inline-flex items-center gap-2 rounded-xl bg-moss-700 px-4 py-2.5 text-sm font-bold text-vellum-50 disabled:cursor-not-allowed disabled:opacity-50">{postingId === pendingInvoice.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}{postingId === pendingInvoice.id ? "正在歸帳…" : "確認歸入帳本"}</button></div><div className="mt-5 space-y-3">{pendingInvoice.invoice_items.map(item => <div key={item.id} className="grid gap-3 rounded-xl border border-vellum-300 bg-vellum-100/35 p-3 sm:grid-cols-2 lg:grid-cols-5"><input className={fieldClass} value={item.title} onChange={event => void onUpdateInvoiceItem(pendingInvoice.id, item, { title: event.target.value })} placeholder="名目" /><p className="rounded-xl bg-vellum-200/65 px-3 py-2.5 text-sm font-bold text-ink-600">{formatMoney(item.amount)}</p><select className={fieldClass} value={item.major ?? ""} onChange={event => void onUpdateInvoiceItem(pendingInvoice.id, item, { major: event.target.value as LedgerMajor | null })}><option value="">選擇大目</option>{MAJORS_BY_DIRECTION.outflow.map(major => <option key={major} value={major}>{MAJOR_META[major].label}</option>)}</select><select className={fieldClass} value={item.handled_by ?? userId} onChange={event => void onUpdateInvoiceItem(pendingInvoice.id, item, { handled_by: event.target.value })}>{members.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name}掌簿</option>)}</select><div><input list={`pending-tags-${item.id}`} className={fieldClass} value={item.tags.join(" ")} onChange={event => void onUpdateInvoiceItem(pendingInvoice.id, item, { tags: normaliseTags(event.target.value) })} placeholder="符契" /><datalist id={`pending-tags-${item.id}`}>{knownTags.map(tag => <option key={tag} value={tag} />)}</datalist></div></div>)}</div></article>) : <div className="rounded-2xl border border-dashed border-moss-300 bg-vellum-50/60 px-5 py-8 text-center text-sm leading-6 text-moss-700">尚無待確認憑據。完成第一步的暫存後，會直接在此處等待你的最後校對。</div>}</div>
    </article>
  </section>;
}

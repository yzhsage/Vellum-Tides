import { supabase } from "@/lib/supabase";
import { inspectLedgerBackup, type LedgerBackup, type LedgerBackupPreview } from "@shared/backup";
import { ArchiveRestore, CheckCircle2, Download, Loader2, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type RestoreResult = {
  accepted?: boolean;
  restored_invoices?: number;
  restored_items?: number;
  restored_entries?: number;
  revived_entries?: number;
  restored_rules?: number;
  removed_invoices?: number;
  removed_items?: number;
  removed_entries?: number;
  removed_rules?: number;
  purged_entries?: number;
};

type RestoreMode = "append" | "snapshot" | null;

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function downloadJson(backup: LedgerBackup) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `歲時錄-完整備份-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function LedgerArchivePanel({ householdId, online, pending, onRestored }: { householdId: string; online: boolean; pending: number; onRestored: () => Promise<void> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [reading, setReading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [purging, setPurging] = useState(false);
  const [backup, setBackup] = useState<LedgerBackup | null>(null);
  const [preview, setPreview] = useState<LedgerBackupPreview | null>(null);
  const [restoreMode, setRestoreMode] = useState<RestoreMode>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const restoreBlocked = !online || pending > 0;

  const resetRestore = () => {
    setBackup(null);
    setPreview(null);
    setRestoreMode(null);
    setAcknowledged(false);
  };

  const exportBackup = async () => {
    if (!supabase || !householdId) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc("export_ledger_backup", { p_household_id: householdId });
      if (error) throw new Error(error.message);
      const inspected = inspectLedgerBackup(data);
      if ("error" in inspected) throw new Error(inspected.error);
      downloadJson(inspected.backup);
      toast.success("完整備份已下載。", { description: `收錄 ${inspected.preview.ledgerEntryCount} 頁帳頁與 ${inspected.preview.invoiceCount} 筆憑據。` });
    } catch (error) {
      toast.error(error instanceof Error ? `備份未完成：${error.message}` : "備份未完成。", { description: "若剛更新程式，請先執行「歲時錄-v2-帳頁分段與備份.sql」。" });
    } finally {
      setExporting(false);
    }
  };

  const readBackup = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 12_000_000) {
      toast.error("備份檔過大。", { description: "請確認您選擇的是歲時錄產生的簿冊備份檔。" });
      return;
    }
    setReading(true);
    resetRestore();
    try {
      const inspected = inspectLedgerBackup(JSON.parse(await file.text()));
      if ("error" in inspected) throw new Error(inspected.error);
      setBackup(inspected.backup);
      setPreview(inspected.preview);
      toast.success("備份檔已通過格式核對。", { description: "請明確選擇安全補入或還原至快照；預設不會執行任一模式。" });
    } catch (error) {
      toast.error(error instanceof Error ? `無法讀取備份：${error.message}` : "無法讀取備份檔。");
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const restore = async () => {
    if (!supabase || !backup || !preview || restoreBlocked) return;
    if (!restoreMode) {
      toast.error("請先選擇還原方式。", { description: "若要回到備份時點，請選擇紅色的「還原至備份快照」。" });
      return;
    }
    if (!acknowledged) {
      toast.error("請先勾選您已理解還原方式。");
      return;
    }
    const isSnapshot = restoreMode === "snapshot";
    setRestoring(true);
    try {
      const { data, error } = await supabase.rpc(isSnapshot ? "restore_ledger_backup_snapshot" : "restore_ledger_backup_safe", { p_payload: backup });
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as RestoreResult;
      if (!result.accepted) throw new Error("帳本未接受此備份檔。");
      await onRestored();
      resetRestore();
      const restoredEntries = Number(result.restored_entries ?? 0);
      const removedEntries = Number(result.removed_entries ?? 0);
      if (isSnapshot) {
        toast.success("帳本已還原至備份快照。", {
          description: `快照模式：已對齊帳頁 ${restoredEntries}、憑據 ${Number(result.restored_invoices ?? 0)}、品項 ${Number(result.restored_items ?? 0)}；已移除快照外帳頁 ${removedEntries}、憑據 ${Number(result.removed_invoices ?? 0)}、品項 ${Number(result.removed_items ?? 0)}。`,
        });
      } else {
        toast.success("備份已安全補入帳本。", {
          description: `安全補入模式：新增帳頁 ${restoredEntries}、復原已收起帳頁 ${Number(result.revived_entries ?? 0)}、憑據 ${Number(result.restored_invoices ?? 0)}、品項 ${Number(result.restored_items ?? 0)}、規則 ${Number(result.restored_rules ?? 0)}；仍有效的既有資料不會被覆寫。`,
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? `還原未完成：${error.message}` : "還原未完成。");
    } finally {
      setRestoring(false);
    }
  };

  const purgeDeletedEntries = async () => {
    if (!supabase || restoreBlocked) return;
    if (!confirm("此操作只會清除已收起的帳頁，但清除後無法再由舊備份救回。建議兩台裝置皆已同步並已另存最新備份。確定繼續嗎？")) return;
    if (window.prompt("請輸入「永久刪除」以確認清除已收起帳頁。") !== "永久刪除") {
      toast.error("未輸入確認文字，未執行永久刪除。");
      return;
    }
    setPurging(true);
    try {
      const { data, error } = await supabase.rpc("purge_deleted_ledger_entries");
      if (error) throw new Error(error.message);
      const result = (data ?? {}) as RestoreResult;
      await onRestored();
      toast.success("已永久清除已收起帳頁。", { description: `共清除 ${Number(result.purged_entries ?? 0)} 頁。之後匯出的完整備份將不再包含這些帳頁。` });
    } catch (error) {
      toast.error(error instanceof Error ? `永久刪除未完成：${error.message}` : "永久刪除未完成。");
    } finally {
      setPurging(false);
    }
  };

  const selectMode = (mode: Exclude<RestoreMode, null>) => {
    setRestoreMode(mode);
    setAcknowledged(false);
  };

  const modeDescription = restoreMode === "snapshot"
    ? "我明白還原快照會覆寫現在資料，並永久移除不在這份備份內的帳頁、憑據、品項與規則。"
    : restoreMode === "append"
      ? "我明白此操作只會補入目前帳本不存在的資料；相同識別碼會略過，既有資料不會遭到刪除或覆寫。"
      : "請先在上方明確選擇「安全補入」或「還原至備份快照」。";

  return <article className="rounded-[1.5rem] border border-moss-300/65 bg-moss-100/45 p-6">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2"><ArchiveRestore size={18} className="text-moss-700" /><p className="text-xs font-bold tracking-[.16em] text-moss-700">簿冊典藏 · 守卷</p></div>
        <h2 className="mt-2 font-vellum text-2xl font-black text-ink-700">帳本典藏</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-moss-700">匯出會收錄目前有效的帳頁、憑據、品項與分類規則。讀入備份後，必須明確選擇安全補入或快照還原，才可繼續。</p>
      </div>
      <button type="button" onClick={() => void exportBackup()} disabled={exporting || !online} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-ink-700 px-4 py-2.5 text-sm font-bold text-vellum-50 shadow-sm transition hover:bg-ink-800 disabled:opacity-55">
        {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}匯出完整備份
      </button>
    </div>
    <div className="mt-5 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-moss-300 bg-vellum-50/75 p-3"><ShieldCheck size={17} className="text-moss-700" /><strong className="mt-2 block text-sm text-ink-700">安全補入</strong><p className="mt-1 text-xs leading-5 text-ink-500">相同識別碼略過，不會覆寫目前資料。</p></div>
      <div className="rounded-xl border border-moss-300 bg-vellum-50/75 p-3"><ArchiveRestore size={17} className="text-moss-700" /><strong className="mt-2 block text-sm text-ink-700">還原快照</strong><p className="mt-1 text-xs leading-5 text-ink-500">經確認後，令帳本內容與該備份一致。</p></div>
      <div className="rounded-xl border border-moss-300 bg-vellum-50/75 p-3"><CheckCircle2 size={17} className="text-moss-700" /><strong className="mt-2 block text-sm text-ink-700">保持同步</strong><p className="mt-1 text-xs leading-5 text-ink-500">離線或有待補登帳頁時，匯入會暫時鎖定。</p></div>
    </div>
    <div className="mt-5 rounded-[1.2rem] border border-dashed border-moss-300 bg-vellum-50/65 p-4">
      <input ref={fileInput} className="sr-only" type="file" accept="application/json,.json" onChange={event => void readBackup(event.target.files?.[0])} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-ink-700">選擇帳本備份</p><p className="mt-1 text-xs leading-5 text-ink-500">只接受本系統匯出的簿冊備份格式。憑據照片本身不會複製，但其儲存索引會隨備份保留。</p></div><button type="button" disabled={reading} onClick={() => fileInput.current?.click()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-moss-300 bg-vellum-50 px-4 py-2.5 text-sm font-bold text-moss-700 transition hover:bg-moss-100 disabled:opacity-55">{reading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}選擇備份檔</button></div>
    </div>
    {restoreBlocked && <p className="mt-3 rounded-xl border border-ochre-300 bg-ochre-100/50 px-4 py-3 text-xs leading-5 text-ochre-700">{!online ? "目前離線；請重連並確認同步狀態為「已同步」後再進行典藏操作。" : `尚有 ${pending} 頁待補登；為避免兩種資料來源交錯，請待同步完成後再進行典藏操作。`}</p>}
    {preview && <div className="mt-5 rounded-[1.2rem] border border-moss-300 bg-moss-100/45 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-bold tracking-[.14em] text-moss-700">還原前覽 · 核對</p><h3 className="mt-1 font-vellum text-xl font-black text-ink-700">備份快照摘要</h3><p className="mt-1 text-xs text-moss-700">匯出於 {formatDate(preview.exportedAt)}</p></div><span className="self-start rounded-full bg-moss-100 px-3 py-1 text-xs font-bold text-moss-700">格式已核對</span></div>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2"><div className="rounded-lg bg-vellum-50/80 px-3 py-2"><dt className="text-xs text-ink-500">帳頁</dt><dd className="mt-0.5 font-bold text-moss-700">{preview.ledgerEntryCount} 頁</dd></div><div className="rounded-lg bg-vellum-50/80 px-3 py-2"><dt className="text-xs text-ink-500">憑據與品項</dt><dd className="mt-0.5 font-bold text-moss-700">{preview.invoiceCount} 筆／{preview.invoiceItemCount} 項</dd></div><div className="rounded-lg bg-vellum-50/80 px-3 py-2"><dt className="text-xs text-ink-500">待確認憑據</dt><dd className="mt-0.5 font-bold text-moss-700">{preview.awaitingInvoiceCount} 筆</dd></div><div className="rounded-lg bg-vellum-50/80 px-3 py-2"><dt className="text-xs text-ink-500">分類規則</dt><dd className="mt-0.5 font-bold text-moss-700">{preview.keywordRuleCount} 條</dd></div></dl>
      <div className="mt-4 grid gap-2 sm:grid-cols-2"><button type="button" onClick={() => selectMode("append")} className={`rounded-xl border p-3 text-left text-xs leading-5 ${restoreMode === "append" ? "border-moss-700 bg-moss-100 text-moss-700" : "border-moss-300 bg-vellum-50/70 text-moss-700"}`}><strong className="block text-sm">安全補入</strong>補回目前不存在的資料；相同識別碼一律略過，既有資料維持不動。</button><button type="button" onClick={() => selectMode("snapshot")} className={`rounded-xl border p-3 text-left text-xs leading-5 ${restoreMode === "snapshot" ? "border-ochre-700 bg-ochre-100 text-ochre-700" : "border-moss-300 bg-vellum-50/70 text-moss-700"}`}><strong className="block text-sm">還原至備份快照</strong>覆寫備份中同識別碼資料，並刪除備份外的帳頁、憑據、品項與規則。</button></div>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg bg-moss-100/55 px-3 py-3 text-xs leading-5 text-moss-700"><input type="checkbox" checked={acknowledged} disabled={!restoreMode} onChange={event => setAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-moss-700 disabled:opacity-50" /><span>{modeDescription}</span></label>
      <div className="mt-4 flex justify-end"><button type="button" disabled={restoring || restoreBlocked || !acknowledged || !restoreMode} onClick={() => void restore()} className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-vellum-50 disabled:opacity-50 ${restoreMode === "snapshot" ? "bg-ochre-700" : "bg-ink-700"}`}>{restoring && <Loader2 size={16} className="animate-spin" />}{restoreMode === "snapshot" ? "確認還原至此快照" : restoreMode === "append" ? "確認補入帳本" : "請先選擇還原方式"}</button></div>
    </div>}
    <div className="mt-5 rounded-[1.2rem] border border-ochre-300 bg-ochre-100/45 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold text-ochre-700">永久清除已收起帳頁</p><p className="mt-1 max-w-2xl text-xs leading-5 text-ochre-700">只清除先前在帳頁翻閱中「收起」的頁面。此操作不可逆；完成後，未來完整備份也不會再包含它們。</p></div><button type="button" disabled={purging || restoreBlocked} onClick={() => void purgeDeletedEntries()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-ochre-500 bg-vellum-50 px-4 py-2.5 text-sm font-bold text-ochre-700 disabled:opacity-50">{purging ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}{purging ? "正在清除…" : "永久清除已收起帳頁"}</button></div></div>
  </article>;
}

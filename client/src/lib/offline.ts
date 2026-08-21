import { openDB } from "idb";
import type { LedgerEntry } from "@shared/ledger";

export type QueuedMutation = {
  id: string;
  entity: "ledger_entry";
  payload: LedgerEntry;
  queued_at: number;
};

const DB_NAME = "vellum-tides-cache";
const DEVICE_KEY = "vellum-tides-device-id";

const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains("entries")) {
      db.createObjectStore("entries", { keyPath: "id" });
    }
    if (!db.objectStoreNames.contains("mutations")) {
      db.createObjectStore("mutations", { keyPath: "id" });
    }
  },
});

export function getDeviceId() {
  const current = localStorage.getItem(DEVICE_KEY);
  if (current) return current;
  const next = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, next);
  return next;
}

export async function cacheEntries(entries: LedgerEntry[]) {
  const db = await dbPromise;
  const tx = db.transaction("entries", "readwrite");
  await Promise.all(entries.map(entry => tx.store.put(entry)));
  await tx.done;
}

export async function loadCachedEntries(householdId: string) {
  const db = await dbPromise;
  const all = (await db.getAll("entries")) as LedgerEntry[];
  return all.filter(entry => entry.household_id === householdId);
}

export async function queueLedgerMutation(payload: LedgerEntry) {
  const db = await dbPromise;
  const mutation: QueuedMutation = {
    id: `${payload.id}:${payload.updated_at_ms}:${payload.device_id}`,
    entity: "ledger_entry",
    payload,
    queued_at: Date.now(),
  };
  await Promise.all([db.put("entries", payload), db.put("mutations", mutation)]);
}

export async function pendingLedgerMutations() {
  const db = await dbPromise;
  return (await db.getAll("mutations")) as QueuedMutation[];
}

export async function acknowledgeLedgerMutation(id: string) {
  const db = await dbPromise;
  await db.delete("mutations", id);
}

export async function pendingMutationCount() {
  const db = await dbPromise;
  return db.count("mutations");
}

type OfflineActionType =
  | "createGhostBooking"
  | "createBookingByQueueEntry"
  | "createBookingByDestination"
  | "printTalon"
  | "printBookingTicket";

export type OfflineAction = {
  id: string;
  type: OfflineActionType;
  createdAt: number;
  attempts: number;
  payload: any;
};

const DB_NAME = "wasla_offline";
const STORE = "actions";
const MAX_ATTEMPTS = 10;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store) as IDBRequest<T> | void;
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export async function enqueueOfflineAction(action: Omit<OfflineAction, "attempts" | "createdAt">) {
  const full: OfflineAction = {
    ...action,
    createdAt: Date.now(),
    attempts: 0,
  };
  await withStore("readwrite", (s) => s.put(full));
  return full;
}

export async function listOfflineActions(): Promise<OfflineAction[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as OfflineAction[]).sort((a, b) => a.createdAt - b.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function removeOfflineAction(id: string) {
  await withStore("readwrite", (s) => s.delete(id));
}

export async function bumpAttempt(id: string) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const cur = getReq.result as OfflineAction | undefined;
      if (!cur) return resolve();
      cur.attempts += 1;
      store.put(cur);
      resolve();
    };
    getReq.onerror = () => reject(getReq.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function isOnline(): boolean {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

export function newActionId(prefix: string) {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
}

export async function processOfflineQueue(processor: (action: OfflineAction) => Promise<void>) {
  if (!isOnline()) return;
  const actions = await listOfflineActions();
  for (const a of actions) {
    if (a.attempts >= MAX_ATTEMPTS) {
      // Drop poison pill; operator can still investigate via logs if needed.
      await removeOfflineAction(a.id);
      continue;
    }
    try {
      await processor(a);
      await removeOfflineAction(a.id);
    } catch {
      await bumpAttempt(a.id);
      // back off by stopping after first failure; we'll retry next tick
      break;
    }
  }
}


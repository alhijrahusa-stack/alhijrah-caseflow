/** Minimal IndexedDB store so a recording survives a tab crash or browser closure. */
const DB = "murailex";
const STORE = "recordings";

export type StoredRecording = {
  id: string;
  mime: string;
  chunks: Blob[];
  startedAt: number;
  finished: boolean;
  title?: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const recordingsStore = {
  put: (r: StoredRecording) => tx("readwrite", (s) => s.put(r)),
  get: (id: string) => tx<StoredRecording | undefined>("readonly", (s) => s.get(id) as IDBRequest<StoredRecording | undefined>),
  all: () => tx<StoredRecording[]>("readonly", (s) => s.getAll() as IDBRequest<StoredRecording[]>),
  remove: (id: string) => tx("readwrite", (s) => s.delete(id)),
};

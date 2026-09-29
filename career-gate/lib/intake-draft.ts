"use client";

const DB_NAME = "career-gate-intake";
const DB_VERSION = 2;
const STATE_STORE = "drafts";
const FILE_STORE = "files";
const CURRENT_ID = "current";
const SCHEMA_VERSION = 2;
const STALE_MS = 14 * 24 * 60 * 60 * 1000;

export class DraftCollisionError extends Error {
  constructor() {
    super("This draft was changed in another tab. Reload to use the newest saved draft.");
    this.name = "DraftCollisionError";
  }
}

export class DraftStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftStorageError";
  }
}

type DraftRow = {
  id: typeof CURRENT_ID;
  schemaVersion: number;
  revision: number;
  updatedAt: number;
  data: unknown;
};

export type DraftFile = {
  id: string;
  doc_type: string;
  file: File;
  updatedAt: number;
};

export type LoadedDraft<T> = {
  data: T;
  files: DraftFile[];
  revision: number;
  updatedAt: number;
};

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DraftStorageError("IndexedDB request failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DraftStorageError("IndexedDB transaction was aborted"));
    tx.onerror = () => reject(tx.error ?? new DraftStorageError("IndexedDB transaction failed"));
  });
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new DraftStorageError("Local draft storage is unavailable in this browser"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DraftStorageError("Could not open local draft storage"));
    request.onblocked = () => reject(new DraftStorageError("Local draft storage upgrade is blocked by another tab"));
  });
}

async function clearStores(db: IDBDatabase) {
  const tx = db.transaction([STATE_STORE, FILE_STORE], "readwrite");
  tx.objectStore(STATE_STORE).clear();
  tx.objectStore(FILE_STORE).clear();
  await transactionDone(tx);
}

function validRow(row: unknown): row is DraftRow {
  if (!row || typeof row !== "object") return false;
  const value = row as Partial<DraftRow>;
  return value.id === CURRENT_ID
    && value.schemaVersion === SCHEMA_VERSION
    && typeof value.revision === "number"
    && Number.isInteger(value.revision)
    && value.revision >= 0
    && typeof value.updatedAt === "number"
    && value.data !== undefined;
}

export async function loadIntakeDraft<T>(): Promise<LoadedDraft<T> | null> {
  const db = await openDb();
  try {
    const tx = db.transaction([STATE_STORE, FILE_STORE], "readonly");
    const row = await requestResult(tx.objectStore(STATE_STORE).get(CURRENT_ID));
    const fileRows = await requestResult(tx.objectStore(FILE_STORE).getAll()) as Array<{
      id?: unknown;
      doc_type?: unknown;
      file?: unknown;
      updatedAt?: unknown;
    }>;
    await transactionDone(tx);

    if (row == null) return null;
    if (!validRow(row) || Date.now() - row.updatedAt > STALE_MS) {
      await clearStores(db);
      return null;
    }

    const files: DraftFile[] = [];
    for (const item of fileRows) {
      if (typeof item.id !== "string" || typeof item.doc_type !== "string" || !(item.file instanceof File)) {
        await clearStores(db);
        return null;
      }
      files.push({
        id: item.id,
        doc_type: item.doc_type,
        file: item.file,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : row.updatedAt,
      });
    }
    return { data: row.data as T, files, revision: row.revision, updatedAt: row.updatedAt };
  } catch (error) {
    if (error instanceof DraftStorageError || error instanceof DraftCollisionError) throw error;
    throw new DraftStorageError(error instanceof Error ? error.message : "Could not restore the local draft");
  } finally {
    db.close();
  }
}

export async function saveIntakeDraft<T>(data: T, expectedRevision: number | null): Promise<number> {
  const db = await openDb();
  try {
    const tx = db.transaction(STATE_STORE, "readwrite");
    const store = tx.objectStore(STATE_STORE);
    const existing = await requestResult(store.get(CURRENT_ID));
    if (existing != null) {
      if (!validRow(existing)) {
        tx.abort();
        throw new DraftStorageError("The local draft is corrupted and must be restored before writing");
      }
      if (expectedRevision == null || existing.revision !== expectedRevision) {
        tx.abort();
        throw new DraftCollisionError();
      }
    } else if (expectedRevision != null && expectedRevision !== 0) {
      tx.abort();
      throw new DraftCollisionError();
    }

    const revision = existing && validRow(existing) ? existing.revision + 1 : 1;
    store.put({ id: CURRENT_ID, schemaVersion: SCHEMA_VERSION, revision, updatedAt: Date.now(), data } satisfies DraftRow);
    await transactionDone(tx);
    return revision;
  } catch (error) {
    if (error instanceof DraftCollisionError || error instanceof DraftStorageError) throw error;
    const name = error instanceof DOMException ? error.name : "";
    if (name === "QuotaExceededError") throw new DraftStorageError("Local draft storage is full. Remove unused browser data and try again.");
    throw new DraftStorageError(error instanceof Error ? error.message : "Could not save the local draft");
  } finally {
    db.close();
  }
}

export async function putIntakeDraftFile(id: string, docType: string, file: File): Promise<void> {
  if (!/^[\w-]{16,200}$/.test(id)) throw new DraftStorageError("Invalid local document id");
  const db = await openDb();
  try {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).put({ id, doc_type: docType, file, updatedAt: Date.now() });
    await transactionDone(tx);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : "";
    if (name === "QuotaExceededError") throw new DraftStorageError("The selected file could not be saved locally because browser storage is full.");
    throw new DraftStorageError(error instanceof Error ? error.message : "Could not save the selected file locally");
  } finally {
    db.close();
  }
}

export async function deleteIntakeDraftFile(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(FILE_STORE, "readwrite");
    tx.objectStore(FILE_STORE).delete(id);
    await transactionDone(tx);
  } finally {
    db.close();
  }
}

export async function clearIntakeDraft(): Promise<void> {
  const db = await openDb();
  try {
    await clearStores(db);
  } finally {
    db.close();
  }
}

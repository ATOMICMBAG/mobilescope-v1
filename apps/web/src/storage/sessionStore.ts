import type { Session, SessionMeta, SessionSummary } from "@mobilescope/core";
import { summarize } from "@mobilescope/core";

/**
 * Lokale Speicherung (IndexedDB). Im Android-WebView bleibt sie über App-Neustarts erhalten.
 * Zwei Stores, damit die Liste ohne das Laden aller Signaldaten auskommt.
 */
const DB_NAME = "mobilescope";
const DB_VERSION = 1;
const META = "meta";
const DATA = "data";

export interface SessionListItem {
  meta: SessionMeta;
  summary: SessionSummary;
}

type StoredData = { id: string; entities: Session["entities"]; events: Session["events"]; schema: number };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "meta.id" });
      if (!db.objectStoreNames.contains(DATA)) db.createObjectStore(DATA, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB nicht verfügbar"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Speichern fehlgeschlagen"));
    tx.onabort = () => reject(tx.error ?? new Error("Speichern abgebrochen"));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(session: Session): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([META, DATA], "readwrite");
    tx.objectStore(META).put({ meta: session.meta, summary: summarize(session) } satisfies SessionListItem);
    tx.objectStore(DATA).put({
      id: session.meta.id,
      schema: session.schema,
      entities: session.entities,
      events: session.events,
    } satisfies StoredData);
    await done(tx);
  } finally {
    db.close();
  }
}

export async function listSessions(): Promise<SessionListItem[]> {
  const db = await open();
  try {
    const all = await request(db.transaction(META).objectStore(META).getAll() as IDBRequest<SessionListItem[]>);
    return all.sort((a, b) => b.meta.startedAt.localeCompare(a.meta.startedAt));
  } finally {
    db.close();
  }
}

export async function loadSession(id: string): Promise<Session | undefined> {
  const db = await open();
  try {
    const tx = db.transaction([META, DATA]);
    const item = await request(tx.objectStore(META).get(id) as IDBRequest<SessionListItem | undefined>);
    const data = await request(tx.objectStore(DATA).get(id) as IDBRequest<StoredData | undefined>);
    if (!item || !data) return undefined;
    return { schema: data.schema, meta: item.meta, entities: data.entities, events: data.events };
  } finally {
    db.close();
  }
}

export async function renameSession(id: string, name: string): Promise<void> {
  const s = await loadSession(id);
  if (!s) return;
  await saveSession({ ...s, meta: { ...s.meta, name: name.trim() || s.meta.name } });
}

export async function deleteSession(id: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([META, DATA], "readwrite");
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
    await done(tx);
  } finally {
    db.close();
  }
}

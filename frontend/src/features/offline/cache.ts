import { openDB } from "idb";

const DB = "gia-chuan-cache";
let lastWrite = Promise.resolve();

async function database() {
  return openDB(DB, 1, { upgrade(db) {
    if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots");
  } });
}

export async function cacheSnapshot<T>(key: string, data: T) {
  const operation = lastWrite.then(async () => {
    const db = await database();
    try {
      await db.put("snapshots", { data, syncedAt: new Date().toISOString() }, key);
    } finally {
      db.close();
    }
  });
  lastWrite = operation.catch(() => undefined);
  return operation;
}

export async function readSnapshot<T>(key: string) {
  const db = await database();
  try {
    return await db.get("snapshots", key) as { data: T; syncedAt: string } | undefined;
  } finally {
    db.close();
  }
}

export async function clearSnapshotCache() {
  const operation = lastWrite.then(async () => {
    const db = await database();
    try {
      await db.clear("snapshots");
    } finally {
      db.close();
    }
  });
  lastWrite = operation.catch(() => undefined);
  return operation;
}

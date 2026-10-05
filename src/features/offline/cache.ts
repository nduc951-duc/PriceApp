import { openDB } from "idb";
const DB="gia-chuan-cache";
export async function cacheSnapshot<T>(key:string,data:T){const db=await openDB(DB,1,{upgrade(d){d.createObjectStore("snapshots");}});await db.put("snapshots",{data,syncedAt:new Date().toISOString()},key);}
export async function readSnapshot<T>(key:string){const db=await openDB(DB,1,{upgrade(d){if(!d.objectStoreNames.contains("snapshots"))d.createObjectStore("snapshots");}});return db.get("snapshots",key) as Promise<{data:T;syncedAt:string}|undefined>;}
export async function clearSnapshotCache(){const db=await openDB(DB,1,{upgrade(d){if(!d.objectStoreNames.contains("snapshots"))d.createObjectStore("snapshots");}});await db.clear("snapshots");db.close();}

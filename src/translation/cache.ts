import type { Settings, Translation, CacheInfo } from "../shared/types";
import { normalizeText } from "../shared/text";
export const CACHE_MAX_ENTRIES = 100000,
  CACHE_MAX_BYTES = 512 * 1024 * 1024;
export function cacheIdentity(s: Settings, text: string) {
  return JSON.stringify([
    s.provider,
    s.endpoint.trim(),
    s.model.trim(),
    s.source.trim().toLowerCase(),
    s.target.trim().toLowerCase(),
    s.domain,
    s.explainTerms,
    s.mode,
    normalizeText(text),
  ]);
}
export async function cacheKey(identity: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(identity),
  );
  return Array.from(new Uint8Array(bytes), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
interface Entry {
  key: string;
  value: Translation;
  size: number;
  used: number;
}
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const completed = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("缓存事务失败"));
    tx.onerror = () => reject(tx.error);
  });
export class TranslationCache {
  private db: Promise<IDBDatabase>;
  private tail = Promise.resolve();
  private clock = 0;
  constructor(
    private maxEntries = CACHE_MAX_ENTRIES,
    private maxBytes = CACHE_MAX_BYTES,
  ) {
    this.db = new Promise((resolve, reject) => {
      const r = indexedDB.open("chrome-ai-translator-cache", 1);
      r.onupgradeneeded = () => {
        const entries = r.result.createObjectStore("entries", {
          keyPath: "key",
        });
        entries.createIndex("used", "used");
        r.result.createObjectStore("meta");
      };
      r.onsuccess = () => {
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
    });
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.tail.then(fn);
    this.tail = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private blank(): CacheInfo {
    return {
      entries: 0,
      bytes: 0,
      hits: 0,
      misses: 0,
      maxEntries: this.maxEntries,
      maxBytes: this.maxBytes,
    };
  }
  private currentInfo(stored?: CacheInfo): CacheInfo {
    return { ...(stored || this.blank()), maxEntries: this.maxEntries, maxBytes: this.maxBytes };
  }
  private tick() {
    return (this.clock = Math.max(Date.now(), this.clock + 1));
  }
  async get(key: string) {
    return (await this.getMany([key]))[0];
  }
  async getMany(keys: string[]) {
    if (!keys.length) return [];
    return this.serial(async () => {
      const db = await this.db;
      return new Promise<(Translation | undefined)[]>((resolve, reject) => {
        const tx = db.transaction(["entries", "meta"], "readwrite"),
          store = tx.objectStore("entries"),
          meta = tx.objectStore("meta");
        const values: (Translation | undefined)[] = [];
        tx.oncomplete = () => resolve(values);
        tx.onabort = tx.onerror = () => reject(tx.error);
        const stats = meta.get("info"),
          records = keys.map((key) => store.get(key));
        let remaining = records.length + 1;
        const update = () => {
          if (--remaining) return;
          const info = this.currentInfo(stats.result as CacheInfo | undefined);
          for (const record of records) {
            const entry = record.result as Entry | undefined;
            values.push(entry?.value);
            if (entry) {
              info.hits++;
              entry.used = this.tick();
              store.put(entry);
            } else info.misses++;
          }
          meta.put(info, "info");
        };
        stats.onsuccess = update;
        for (const record of records) record.onsuccess = update;
      });
    });
  }
  async put(key: string, value: Translation) {
    return this.serial(async () => {
      const size =
        new TextEncoder().encode(JSON.stringify(value)).byteLength +
        key.length +
        64;
      if (size > this.maxBytes) return;
      const db = await this.db;
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["entries", "meta"], "readwrite"),
          store = tx.objectStore("entries"),
          meta = tx.objectStore("meta");
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
        const stats = meta.get("info"),
          record = store.get(key);
        let ready = 0;
        const update = () => {
          if (++ready !== 2) return;
          const info = this.currentInfo(stats.result as CacheInfo | undefined),
            old = record.result as Entry | undefined;
          info.bytes += size - (old?.size || 0);
          if (!old) info.entries++;
          store.put({ key, value, size, used: this.tick() } satisfies Entry);
          if (info.entries <= this.maxEntries && info.bytes <= this.maxBytes) {
            meta.put(info, "info");
            return;
          }
          const cursorRequest = store.index("used").openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (
              !cursor ||
              (info.entries <= this.maxEntries && info.bytes <= this.maxBytes)
            ) {
              meta.put(info, "info");
              return;
            }
            const entry = cursor.value as Entry;
            info.bytes -= entry.size;
            info.entries--;
            cursor.delete();
            cursor.continue();
          };
        };
        stats.onsuccess = record.onsuccess = update;
      });
    });
  }
  async info() {
    return this.serial(async () => {
      const db = await this.db,
        tx = db.transaction("meta", "readonly"),
        done = completed(tx);
      const value = (await request(tx.objectStore("meta").get("info"))) as
        CacheInfo | undefined;
      await done;
      return this.currentInfo(value);
    });
  }
  async clear() {
    return this.serial(async () => {
      const db = await this.db,
        tx = db.transaction(["entries", "meta"], "readwrite"),
        done = completed(tx);
      tx.objectStore("entries").clear();
      tx.objectStore("meta").clear();
      await done;
    });
  }
  async close() {
    await this.tail;
    (await this.db).close();
  }
  async migrate(legacy: Record<string, Translation>) {
    for (const [identity, value] of Object.entries(legacy)) {
      let parts: unknown;
      try {
        parts = JSON.parse(identity);
      } catch {
        continue;
      }
      if (
        !Array.isArray(parts) ||
        parts.length !== 9 ||
        ![0, 1, 2, 3, 4, 5, 7, 8].every((i) => typeof parts[i] === "string") ||
        typeof value?.text !== "string" ||
        typeof value?.detectedLanguage !== "string"
      )
        continue;
      parts[1] = parts[1].trim();
      parts[2] = parts[2].trim();
      parts[3] = parts[3].trim().toLowerCase();
      parts[4] = parts[4].trim().toLowerCase();
      parts[8] = normalizeText(parts[8]);
      // Only remove legacy storage after every valid entry has been written successfully.
      await this.put(await cacheKey(JSON.stringify(parts)), value);
    }
  }
}

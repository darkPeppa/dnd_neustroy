import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import worker, { type Env } from "../../server/index";
import { sqliteD1 } from "./d1";
const migrations = import.meta.glob("../../migrations/*.sql", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("neustroy-offline", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("state");
      r.result.createObjectStore("files");
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function get(store: string, key: string) {
  const db = await database();
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction(store),
      r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    tx.oncomplete = () => db.close();
  });
}
async function put(store: string, key: string, value: any) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    if (value === undefined) tx.objectStore(store).delete(key);
    else tx.objectStore(store).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}
let engine: Promise<{ env: Env; persist: () => Promise<void> }> | undefined;
async function init() {
  const SQL = await initSqlJs({
    locateFile: () => wasmUrl,
    useOldExtensionFunctions: false,
  });
  const old = await get("state", "sqlite");
  const db = old ? new SQL.Database(new Uint8Array(old)) : new SQL.Database();
  db.run("CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)");
  for (const [name, sql] of Object.entries(migrations).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (
      !db.exec(`SELECT 1 FROM local_migrations WHERE name='${name}'`).length
    ) {
      db.run(sql);
      db.run("INSERT INTO local_migrations(name) VALUES(?)", [name]);
    }
  }
  const env = {
    DB: sqliteD1(db),
    LOCAL_DEV: "true",
    BUCKET: {
      async put(key: string, value: ArrayBuffer) {
        await put("files", key, new Blob([value]));
      },
      async get(key: string) {
        const blob = (await get("files", key)) as Blob | undefined;
        return blob ? { body: blob.stream() } : null;
      },
      async delete(key: string) {
        await put("files", key, undefined);
      },
    },
  } as unknown as Env;
  return { env, persist: () => put("state", "sqlite", db.export()) };
}
let serial = Promise.resolve();
export function localFetch(path: string, init: RequestInit = {}) {
  let done: (r: Response) => void, failed: (e: unknown) => void;
  const response = new Promise<Response>((resolve, reject) => {
    done = resolve;
    failed = reject;
  });
  const work = async () => {
    try {
      const run = async () => {
        const { env, persist } = await (engine ||= initEngine());
        const headers = new Headers(init.headers);
        headers.set("x-dev-user", "offline-owner");
        headers.set("x-dev-name", "Local player");
        headers.set("oai-authenticated-user-id", "offline-owner");
        headers.set(
          "oai-authenticated-user-full-name",
          encodeURIComponent("Локальный игрок"),
        );
        headers.set(
          "oai-authenticated-user-full-name-encoding",
          "percent-encoded-utf-8",
        );
        headers.delete("origin");
        headers.delete("authorization");
        const waits: Promise<unknown>[] = [];
        const result = await worker.fetch(
          new Request("http://localhost/api/" + path, { ...init, headers }),
          env,
          {
            waitUntil: (p: Promise<unknown>) => waits.push(p),
          } as unknown as ExecutionContext,
        );
        await Promise.allSettled(waits);
        await persist();
        done(result);
      };
      if (navigator.locks)
        await navigator.locks.request("neustroy-offline-db", async () => {
          engine = undefined;
          await run();
        });
      else await run();
    } catch (e) {
      failed(e);
    }
  };
  serial = serial.then(work, work);
  return response;
}
const initEngine = () => init();

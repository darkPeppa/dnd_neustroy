import { readFile, readdir } from "node:fs/promises";
import {
  Miniflare,
  convertV4MiniflareOptions,
  type V4FetchHandler,
} from "miniflare";
export async function migrate(db: { exec: (sql: string) => Promise<unknown> }) {
  for (const file of (await readdir("migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(
      (await readFile("migrations/" + file, "utf8")).replace(/\n/g, " "),
    );
}
export async function fixture(
  bindings: Record<string, string> = { LOCAL_DEV: "true" },
  outboundService?: V4FetchHandler,
) {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "dist/server/index.js",
      compatibilityDate: "2025-04-01",
      d1Databases: ["DB"],
      r2Buckets: ["BUCKET"],
      bindings,
      ...(outboundService ? { outboundService } : {}),
    }),
  );
  const db = await mf.getD1Database("DB");
  await migrate(db);
  async function call(
    user: string,
    path: string,
    method = "GET",
    data?: unknown,
    extra: Record<string, string> = {},
  ) {
    const response = await mf.dispatchFetch("http://localhost/api/" + path, {
      method,
      headers: {
        "x-dev-user": user,
        "x-dev-name": user,
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        ...extra,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return {
      status: response.status,
      body: (await response.json()) as any,
      headers: response.headers,
    };
  }
  return { mf, db, call, close: () => mf.dispose() };
}

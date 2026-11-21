import { z } from "zod";
import { digest } from "./crypto";
import type { Env } from "./index";
import { HttpError, readJson } from "./http";
import { encryptSecret, decryptSecret } from "./secrets";
type User = { id: string; name: string };
const json = (v: unknown) =>
  Response.json(v, { headers: { "Cache-Control": "no-store" } });
const first = <T>(e: Env, sql: string, ...params: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...params)
    .first<T>();
const run = (e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .run();
const encode64 = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const random = () => encode64(crypto.getRandomValues(new Uint8Array(32)));
const configured = (e: Env) =>
  !!e.CONFIG_ENCRYPTION_KEY && e.CONFIG_ENCRYPTION_KEY.length >= 32;
export async function assistantEnabled(e: Env, u: User) {
  return (
    (
      await first<{ enabled: number }>(
        e,
        "SELECT enabled FROM assistant_preferences WHERE user_id=?",
        u.id,
      )
    )?.enabled !== 0
  );
}
export async function storedAgentKey(e: Env, u: User, provider: string) {
  const row = await first<{ encrypted_key: string }>(
    e,
    "SELECT encrypted_key FROM assistant_connections WHERE user_id=? AND provider=?",
    u.id,
    provider,
  );
  return row ? decryptSecret(e, row.encrypted_key) : "";
}
export async function agentConnections(
  r: Request,
  e: Env,
  u: User,
  p: string[],
) {
  if (p[0] === "agent-preferences") {
    if (r.method === "GET")
      return json({ enabled: await assistantEnabled(e, u) });
    if (r.method === "PUT") {
      const { enabled } = z
        .object({ enabled: z.boolean() })
        .parse(await readJson(r, 2000));
      await run(
        e,
        "INSERT INTO assistant_preferences(user_id,enabled) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled",
        u.id,
        Number(enabled),
      );
      return json({ enabled });
    }
  }
  if (p[0] !== "agent-connection" || u.id.startsWith("guest:"))
    throw new HttpError(403, "Подключение доступно в постоянном аккаунте");
  if (!p[1] && r.method === "GET") {
    const row = await first<{ provider: string }>(
      e,
      "SELECT provider FROM assistant_connections WHERE user_id=?",
      u.id,
    );
    return json({
      provider: row?.provider || "",
      storage: configured(e),
      serverModel: e.ASSISTANT_BASE_URL ? e.ASSISTANT_MODEL || "qwen3:4b" : "",
    });
  }
  if (!p[1] && r.method === "DELETE") {
    await e.DB.batch([
      e.DB.prepare("DELETE FROM assistant_connections WHERE user_id=?").bind(
        u.id,
      ),
      e.DB.prepare("DELETE FROM assistant_oauth WHERE user_id=?").bind(u.id),
    ]);
    return json({ ok: true });
  }
  if (!configured(e))
    throw new HttpError(
      503,
      "Серверу нужен ключ шифрования для сохранения подключения",
    );
  if (!p[1] && r.method === "PUT") {
    const b = z
      .object({
        provider: z.enum(["openai", "openrouter", "groq", "deepseek"]),
        apiKey: z
          .string()
          .trim()
          .min(8)
          .max(1000)
          .regex(/^[\x21-\x7e]+$/),
      })
      .parse(await readJson(r, 4000));
    await saveAgentKey(e, u, b.provider, b.apiKey);
    return json({ provider: b.provider });
  }
  if (p[1] === "start" && r.method === "POST") {
    const base = new URL(e.PUBLIC_APP_URL || r.url);
    if (
      base.protocol !== "https:" &&
      !["127.0.0.1", "localhost"].includes(base.hostname)
    )
      throw new HttpError(
        400,
        "Для входа OpenRouter нужен HTTPS-адрес сервера или браузер на компьютере сервера",
      );
    const verifier = random(),
      token = random(),
      id = await digest(token);
    const challenge = encode64(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
    );
    await e.DB.batch([
      e.DB.prepare(
        "DELETE FROM assistant_oauth WHERE user_id=? OR expires<=?",
      ).bind(u.id, new Date().toISOString()),
      e.DB.prepare(
        "INSERT INTO assistant_oauth(id,user_id,verifier,expires) VALUES(?,?,?,?)",
      ).bind(
        id,
        u.id,
        verifier,
        new Date(Date.now() + 10 * 60000).toISOString(),
      ),
    ]);
    const callback = new URL("/", base);
    callback.searchParams.set("agent_state", token);
    const url = new URL("https://openrouter.ai/auth");
    url.searchParams.set("callback_url", callback.href);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return json({ url: url.href });
  }
  if (p[1] === "finish" && r.method === "POST") {
    const b = z
      .object({
        state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        code: z.string().min(8).max(1000),
      })
      .parse(await readJson(r, 4000));
    const id = await digest(b.state);
    const flow = await first<{ verifier: string }>(
      e,
      "UPDATE assistant_oauth SET state='exchanging' WHERE id=? AND user_id=? AND expires>? AND state='pending' RETURNING verifier",
      id,
      u.id,
      new Date().toISOString(),
    );
    if (!flow)
      throw new HttpError(
        400,
        "Ссылка истекла или создана другим аккаунтом. Запустите подключение заново",
      );
    const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: b.code,
        code_verifier: flow.verifier,
        code_challenge_method: "S256",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new HttpError(
        502,
        "OpenRouter не подтвердил подключение. Начните заново",
      );
    const result = z
      .object({ key: z.string().min(8).max(1000) })
      .parse(await response.json());
    const encrypted = await encryptSecret(e, result.key);
    const committed = await e.DB.batch([
      e.DB.prepare(
        `INSERT INTO assistant_connections(user_id,provider,encrypted_key)
        SELECT user_id,'openrouter',? FROM assistant_oauth WHERE id=? AND user_id=? AND state='exchanging'
        ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,encrypted_key=excluded.encrypted_key`,
      ).bind(encrypted, id, u.id),
      e.DB.prepare("DELETE FROM assistant_oauth WHERE id=? AND user_id=?").bind(
        id,
        u.id,
      ),
    ]);
    if (!committed[0].meta.changes)
      throw new HttpError(409, "Подключение отменено");
    return json({ provider: "openrouter" });
  }
  throw new HttpError(405, "Метод не поддерживается");
}
async function saveAgentKey(e: Env, u: User, provider: string, key: string) {
  const encrypted = await encryptSecret(e, key);
  await e.DB.batch([
    e.DB.prepare("DELETE FROM assistant_oauth WHERE user_id=?").bind(u.id),
    e.DB.prepare(
      "INSERT INTO assistant_connections(user_id,provider,encrypted_key) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET provider=excluded.provider,encrypted_key=excluded.encrypted_key",
    ).bind(u.id, provider, encrypted),
  ]);
}

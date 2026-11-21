import { z } from "zod";
import type { Env } from "./index";
import { HttpError } from "./http";
const fields = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "PUBLIC_APP_URL",
  "ASSISTANT_BASE_URL",
  "ASSISTANT_API_KEY",
  "ASSISTANT_MODEL",
  "PUSH_GATEWAY_URL",
  "PUSH_GATEWAY_SECRET",
  "INTEGRATION_URL",
  "INTEGRATION_SECRET",
  "TELEGRAM_CHAT_ID",
] as const;
async function key(e: Env) {
  if (!e.CONFIG_ENCRYPTION_KEY || e.CONFIG_ENCRYPTION_KEY.length < 32)
    throw new HttpError(
      503,
      "Администратор должен настроить ключ шифрования конфигурации сервера",
    );
  const raw = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(e.CONFIG_ENCRYPTION_KEY),
  );
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const encode = (v: Uint8Array) =>
  btoa(Array.from(v, (b) => String.fromCharCode(b)).join(""));
const decode = (v: string) => Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
export async function encryptSecret(e: Env, text: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const value = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(e),
    new TextEncoder().encode(text),
  );
  return JSON.stringify({
    v: 1,
    iv: encode(iv),
    data: encode(new Uint8Array(value)),
  });
}
export async function decryptSecret(e: Env, value: string) {
  const v = JSON.parse(value);
  if (v.v !== 1) throw new HttpError(503, "Неизвестная версия конфигурации");
  const result = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(v.iv) },
    await key(e),
    decode(v.data),
  );
  return new TextDecoder().decode(result);
}
export async function configuredEnv(e: Env): Promise<Env> {
  const rows = (
    await e.DB.prepare(
      "SELECT id,value FROM site_config WHERE id LIKE 'integration:%'",
    ).all<{ id: string; value: string }>()
  ).results;
  const result = { ...e };
  for (const row of rows) {
    const name = row.id.slice("integration:".length);
    if ((fields as readonly string[]).includes(name))
      result[name as (typeof fields)[number]] = await decryptSecret(
        e,
        row.value,
      );
  }
  return result;
}
export async function integrationSettings(
  r: Request,
  e: Env,
  u: { id: string; name: string },
  admin: boolean,
  body: () => Promise<unknown>,
) {
  if (!admin)
    throw new HttpError(403, "Подключения сервиса настраивает администратор");
  if (r.method === "GET")
    return Response.json(
      {
        telegram: !!e.TELEGRAM_BOT_TOKEN,
        botUsername: e.TELEGRAM_BOT_USERNAME || "",
        email: !!(e.RESEND_API_KEY && e.MAIL_FROM && e.PUBLIC_APP_URL),
        assistant: !!e.ASSISTANT_BASE_URL,
        encryptedStorage: !!e.CONFIG_ENCRYPTION_KEY,
        publicUrl: e.PUBLIC_APP_URL || "",
        mailFrom: e.MAIL_FROM || "",
        assistantUrl: e.ASSISTANT_BASE_URL || "",
        assistantModel: e.ASSISTANT_MODEL || "",
        google: !!(e.INTEGRATION_URL && e.INTEGRATION_SECRET),
        push: !!(e.PUSH_GATEWAY_URL && e.PUSH_GATEWAY_SECRET),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  if (r.method !== "PUT") throw new HttpError(405, "Метод не поддерживается");
  const b = z
    .partialRecord(z.enum(fields), z.string().max(2000))
    .parse(await body());
  for (const name of [
    "PUBLIC_APP_URL",
    "ASSISTANT_BASE_URL",
    "PUSH_GATEWAY_URL",
    "INTEGRATION_URL",
  ] as const)
    if (b[name]) {
      const url = new URL(b[name]);
      if (
        url.username ||
        url.password ||
        url.hash ||
        !["http:", "https:"].includes(url.protocol)
      )
        throw new HttpError(400, "Некорректный адрес подключения");
      if (url.protocol !== "https:" && e.LOCAL_SERVER !== "true")
        throw new HttpError(400, "Для облачного сервиса нужен HTTPS");
    }
  if (b.TELEGRAM_BOT_TOKEN) {
    if (!/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(b.TELEGRAM_BOT_TOKEN))
      throw new HttpError(400, "Проверьте токен BotFather");
    const response = await fetch(
      `https://api.telegram.org/bot${b.TELEGRAM_BOT_TOKEN}/getMe`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok) throw new HttpError(400, "Telegram не принял токен");
    const bot = (await response.json()) as {
      ok: boolean;
      result?: { username: string };
    };
    if (!bot.ok || !bot.result)
      throw new HttpError(400, "Telegram не принял токен");
    b.TELEGRAM_BOT_USERNAME = bot.result.username;
    if (!e.TELEGRAM_WEBHOOK_SECRET)
      b.TELEGRAM_WEBHOOK_SECRET = crypto.randomUUID() + crypto.randomUUID();
  }
  const statements = [];
  for (const [name, value] of Object.entries(b)) {
    if (!value) continue;
    const encrypted = await encryptSecret(e, value);
    statements.push(
      e.DB.prepare(
        "INSERT INTO site_config(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      ).bind("integration:" + name, encrypted),
    );
  }
  if (statements.length) await e.DB.batch(statements);
  return Response.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}

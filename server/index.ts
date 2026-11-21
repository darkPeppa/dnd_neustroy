import { HttpError, readBytes, readJson } from "./http";
import { z } from "zod";
import {
  bookingSchema,
  characterSchema,
  rulePackSchema,
  defaultPricing,
  price,
} from "../src/domain";
import assets from "./assets.generated";
import { accountIdentity, authRoute } from "./auth";
import { mcp } from "./mcp";
import {
  AccessError,
  campaignRoutes,
  getCampaign,
  materialVisible,
  validFolder,
} from "./campaigns";
import { assistant } from "./assistant";
import { gameTools } from "./game-tools";
import { configuredEnv, integrationSettings } from "./secrets";
import { telegramAccount, telegramWebhook } from "./telegram";
import { campaignUtilities, guestJoin, restoreCampaign } from "./utilities";
export { configuredEnv } from "./secrets";
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  LOCAL_DEV?: string;
  LOCAL_SERVER?: string;
  AUTH_ENABLED?: string;
  ADMIN_SETUP_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  INTEGRATION_URL?: string;
  INTEGRATION_SECRET?: string;
  PUSH_GATEWAY_URL?: string;
  PUSH_GATEWAY_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  PUBLIC_APP_URL?: string;
  ASSISTANT_BASE_URL?: string;
  ASSISTANT_API_KEY?: string;
  ASSISTANT_MODEL?: string;
  CONFIG_ENCRYPTION_KEY?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}
type User = { id: string; name: string };
const fail = (status: number, message: string): never => {
  throw new HttpError(status, message);
};
const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hash = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const one = <T = Record<string, any>>(e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .first<T>();
const all = async <T = Record<string, any>>(
  e: Env,
  sql: string,
  ...p: unknown[]
) =>
  (
    await e.DB.prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;
const run = (e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .run();
const body = (r: Request, limit = 100000) => readJson(r, limit);
const str = z.string().trim().min(1).max(120);
async function identity(r: Request, e: Env): Promise<User> {
  const account = await accountIdentity(r, e);
  if (account) return account;
  const token = r.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (token) {
    const u = await one(
      e,
      "SELECT user_id,name FROM native_tokens WHERE hash=? AND expires>?",
      await hash(token),
      now(),
    );
    if (u) return { id: u.user_id, name: u.name };
    fail(401, "Код входа истёк. Подключите приложение заново.");
  }
  const id = r.headers.get("oai-authenticated-user-id");
  if (id) {
    let name =
      r.headers.get("oai-authenticated-user-full-name") ||
      r.headers.get("oai-authenticated-user-email") ||
      "Игрок";
    if (
      r.headers.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
    ) {
      try {
        name = decodeURIComponent(name);
      } catch {}
    }
    return { id, name: name.slice(0, 120) };
  }
  const host = new URL(r.url).hostname;
  if (
    e.LOCAL_DEV === "true" &&
    ["localhost", "127.0.0.1", "::1"].includes(host)
  )
    return {
      id: r.headers.get("x-dev-user") || "local-gm",
      name: r.headers.get("x-dev-name") || "Мастер",
    };
  return fail(
    401,
    "Войдите по email, через ChatGPT или выберите локальный режим",
  );
}
async function owner(e: Env, u: User) {
  await run(
    e,
    "INSERT OR IGNORE INTO site_config(id,value) VALUES('owner',?)",
    e.AUTH_ENABLED === "true" ? "unclaimed" : u.id,
  );
  return (await one(e, "SELECT value FROM site_config WHERE id='owner'"))!
    .value as string;
}
async function admin(e: Env, u: User) {
  if ((await owner(e, u)) !== u.id) fail(403, "Только владелец сервиса");
}
async function campaign(e: Env, id: string, u: User, gm = false) {
  return getCampaign(e, id, u, gm ? "edit_materials" : undefined);
}
async function session(e: Env, id: string, u: User, gm = false) {
  const s = await one(e, "SELECT * FROM sessions WHERE id=?", id);
  if (!s) fail(404, "Встреча не найдена");
  if (gm) {
    if (s!.owner_id !== u.id) fail(403, "Только мастер может менять встречу");
  } else if (!s!.public && s!.owner_id !== u.id) {
    if (!s!.campaign_id) fail(403, "Нет доступа к встрече");
    await campaign(e, s!.campaign_id, u);
  }
  return s!;
}
async function settings(e: Env) {
  const c = await one(e, "SELECT value FROM site_config WHERE id='settings'");
  return c
    ? JSON.parse(c.value)
    : {
        pricing: defaultPricing,
        about:
          "neustroy — истории на пересечении настольных игр, физики и воображения. Мастер и преподаватель физики: геометрия миров, живые персонажи и приключения под вашу компанию.",
        contact: "Контакты ещё не заполнены",
        offer: "",
        agreement: "",
        timezone: "Europe/Moscow",
      };
}
async function enqueue(e: Env, event: string, data: unknown) {
  const entries = ["integration", "telegram"];
  await e.DB.batch(
    entries.map((target) =>
      e.DB.prepare(
        "INSERT INTO outbox(id,event,data,target,created_at) VALUES(?,?,?,?,?)",
      ).bind(uid(), event, JSON.stringify(data), target, now()),
    ),
  );
}
async function sendOutbox(e: Env) {
  const rows = await all(
    e,
    "SELECT * FROM outbox WHERE status='pending' AND attempts<5 ORDER BY created_at LIMIT 15",
  );
  for (const row of rows) {
    if (
      row.target === "telegram" &&
      (!e.TELEGRAM_BOT_TOKEN || !e.TELEGRAM_CHAT_ID)
    )
      continue;
    if (
      row.target === "integration" &&
      (!e.INTEGRATION_URL || !e.INTEGRATION_SECRET)
    )
      continue;
    try {
      let response: Response;
      if (row.target === "telegram") {
        response = await fetch(
          `https://api.telegram.org/bot${e.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: e.TELEGRAM_CHAT_ID,
              text: `Questbook · ${row.event}\n${row.data}`.slice(0, 4000),
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
        const result = (await response.json()) as { ok: boolean };
        if (!response.ok || !result.ok)
          throw Error("Telegram отклонил отправку");
      } else {
        response = await fetch(e.INTEGRATION_URL!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            secret: e.INTEGRATION_SECRET,
            eventId: row.id,
            event: row.event,
            data: JSON.parse(row.data),
          }),
          signal: AbortSignal.timeout(15000),
        });
        const result = (await response.json()) as { ok: boolean };
        if (!response.ok || !result.ok)
          throw Error("Интеграция отклонила запрос");
      }
      await run(
        e,
        "UPDATE outbox SET status='sent',attempts=attempts+1,error=NULL WHERE id=?",
        row.id,
      );
    } catch {
      await run(
        e,
        "UPDATE outbox SET attempts=attempts+1,error='Не удалось доставить; проверьте настройки интеграции' WHERE id=?",
        row.id,
      );
    }
  }
}
async function externalBusy(e: Env, start: string, end: string) {
  if (!e.INTEGRATION_URL || !e.INTEGRATION_SECRET) return [];
  const r = await fetch(e.INTEGRATION_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      secret: e.INTEGRATION_SECRET,
      action: "availability",
      start,
      end,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const result = (await r.json()) as {
    ok: boolean;
    busy: { start: string; end: string }[];
  };
  if (!r.ok || !result.ok) fail(503, "Календарь мастера временно недоступен");
  return z
    .array(
      z.object({ start: z.string().datetime(), end: z.string().datetime() }),
    )
    .parse(result.busy);
}
async function confirmTime(
  e: Env,
  ownerId: string,
  id: string,
  start: string,
  end: string,
  update: D1PreparedStatement,
) {
  if (Date.parse(start) < Date.now())
    fail(400, "Нельзя подтвердить прошедшую дату");
  const busy = await externalBusy(e, start, end);
  if (busy.some((b) => b.start < end && b.end > start))
    fail(409, "Это время занято в календаре мастера");
  await e.DB.batch([
    e.DB.prepare(
      "INSERT INTO reservations(id,owner_id,start,end) VALUES(?,?,?,?)",
    ).bind(id, ownerId, start, end),
    update,
  ]);
}
const sessionSchema = z
  .object({
    campaignId: z.string().nullable(),
    title: str,
    start: z.string().datetime(),
    end: z.string().datetime(),
    public: z.boolean(),
    capacity: z.number().int().min(1).max(6),
    description: z.string().max(3000),
  })
  .refine(
    (s) =>
      Date.parse(s.end) > Date.parse(s.start) &&
      Date.parse(s.end) - Date.parse(s.start) <= 8 * 3600000,
    "Продолжительность должна быть от 1 минуты до 8 часов",
  );
export async function api(
  r: Request,
  e: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(r.url),
    p = url.pathname
      .replace(/^\/api/, "")
      .split("/")
      .filter(Boolean),
    method = r.method;
  if (p[0] === "auth" && p[1] === "guest" && method === "POST")
    return guestJoin(r, e);
  if (p[0] === "auth") return authRoute(r, e, () => body(r));
  const u = await identity(r, e);
  if (
    u.id.startsWith("guest:") &&
    (["telegram", "native-token", "push", "bookings", "integrations"].includes(
      p[0],
    ) ||
      (p[0] === "campaigns" &&
        ((method === "POST" && !p[1]) ||
          ["join", "restore"].includes(p[1]) ||
          p[2] === "join-public")))
  )
    fail(403, "Для этого действия нужен постоянный аккаунт");
  e = await configuredEnv(e);
  const siteOwner = await owner(e, u);
  if (p[0] === "integrations")
    return integrationSettings(r, e, u, u.id === siteOwner, () => body(r));
  if (p[0] === "telegram") return telegramAccount(r, e, u, p);
  if (p[0] === "assistant")
    return assistant(r, e, u, () => body(r, 7 * 1024 * 1024));
  if (p[0] === "me" && method === "GET")
    return json({
      user: u,
      isAdmin: u.id === siteOwner,
      accounts: e.AUTH_ENABLED === "true",
      local: e.LOCAL_DEV === "true" || e.LOCAL_SERVER === "true",
      integrations: {
        telegram: !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_CHAT_ID),
        google: !!(e.INTEGRATION_URL && e.INTEGRATION_SECRET),
        push: !!(e.PUSH_GATEWAY_URL && e.PUSH_GATEWAY_SECRET),
      },
    });
  if (p[0] === "native-token" && method === "POST") {
    const token = uid() + uid();
    await run(
      e,
      "DELETE FROM native_tokens WHERE user_id=? AND origin='manual'",
      u.id,
    );
    await run(
      e,
      "INSERT INTO native_tokens(hash,user_id,name,expires) VALUES(?,?,?,?)",
      await hash(token),
      u.id,
      u.name,
      new Date(Date.now() + 30 * 86400000).toISOString(),
    );
    return json({ token, expiresInDays: 30 });
  }
  if (p[0] === "native-token" && method === "DELETE") {
    await run(e, "DELETE FROM native_tokens WHERE user_id=?", u.id);
    return json({ ok: true });
  }
  if (p[0] === "push" && method === "POST") {
    const b = z
      .object({
        token: z.string().min(10).max(4096),
        platform: z.enum(["ios", "android"]),
      })
      .parse(await body(r));
    await run(
      e,
      "INSERT OR IGNORE INTO push_tokens(user_id,token,platform) VALUES(?,?,?)",
      u.id,
      b.token,
      b.platform,
    );
    return json({ ok: true });
  }
  if (p[0] === "settings") {
    if (method === "GET") return json(await settings(e));
    if (method === "PUT") {
      await admin(e, u);
      const shape = Object.fromEntries(
        Object.keys(defaultPricing).map((k) => [
          k,
          z.number().int().min(0).max(1000000),
        ]),
      );
      const b = z
        .object({
          pricing: z.object(shape),
          about: z.string().max(5000),
          contact: z.string().max(1000),
          offer: z.string().max(30000),
          agreement: z.string().max(30000),
          timezone: z.string().max(60),
        })
        .parse(await body(r));
      try {
        new Intl.DateTimeFormat("ru", { timeZone: b.timezone });
      } catch {
        fail(400, "Неизвестный часовой пояс");
      }
      await run(
        e,
        "INSERT INTO site_config(id,value) VALUES('settings',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
        JSON.stringify(b),
      );
      return json(b);
    }
  }
  if (p[0] === "rule-packs") {
    if (method === "GET")
      return json(
        (
          await all(e, "SELECT id,data FROM rule_packs WHERE user_id=?", u.id)
        ).map((x) => ({ id: x.id, ...JSON.parse(x.data) })),
      );
    if (method === "POST") {
      const data = rulePackSchema.parse(await body(r)),
        id = uid();
      await run(
        e,
        "INSERT INTO rule_packs(id,user_id,data,updated_at) VALUES(?,?,?,?)",
        id,
        u.id,
        JSON.stringify(data),
        now(),
      );
      return json({ id, ...data }, 201);
    }
    if (method === "DELETE" && p[1]) {
      await run(
        e,
        "DELETE FROM rule_packs WHERE id=? AND user_id=?",
        p[1],
        u.id,
      );
      return json({ ok: true });
    }
  }
  if (p[0] === "characters") {
    if (p[2] === "portrait") {
      const row = await one(
        e,
        "SELECT id,portrait_key,portrait_mime FROM characters WHERE id=? AND user_id=?",
        p[1],
        u.id,
      );
      if (!row) fail(404, "Персонаж не найден");
      if (method === "PUT") {
        const mime = r.headers.get("content-type") || "";
        if (!["image/png", "image/jpeg", "image/webp"].includes(mime))
          fail(400, "Разрешены PNG, JPG и WebP");
        if (Number(r.headers.get("content-length") || 0) > 5 * 1024 * 1024)
          fail(413, "Изображение больше 5 МБ");
        const file = (await readBytes(r, 5 * 1024 * 1024))
          .buffer as ArrayBuffer;
        if (file.byteLength > 5 * 1024 * 1024)
          fail(413, "Изображение больше 5 МБ");
        const key = "portraits/" + row!.id;
        await e.BUCKET.put(key, file, { httpMetadata: { contentType: mime } });
        await run(
          e,
          "UPDATE characters SET portrait_key=?,portrait_mime=? WHERE id=? AND user_id=?",
          key,
          mime,
          p[1],
          u.id,
        );
        return json({ ok: true });
      }
      if (method === "GET") {
        if (!row!.portrait_key) fail(404, "Портрет не добавлен");
        const file = await e.BUCKET.get(row!.portrait_key);
        if (!file) fail(404, "Портрет не найден");
        return new Response(file!.body, {
          headers: {
            "Content-Type": row!.portrait_mime,
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      fail(405, "Метод не поддерживается");
    }
    if (method === "GET")
      return json(
        (
          await all(
            e,
            "SELECT * FROM characters WHERE user_id=? ORDER BY updated_at DESC",
            u.id,
          )
        ).map((c) => ({
          ...c,
          data: characterSchema.parse(JSON.parse(c.data)),
        })),
      );
    if (method === "POST") {
      const data = characterSchema.parse(await body(r));
      const id = uid();
      await run(
        e,
        "INSERT INTO characters(id,user_id,data,updated_at) VALUES(?,?,?,?)",
        id,
        u.id,
        JSON.stringify(data),
        now(),
      );
      return json({ id, data, revision: 1 }, 201);
    }
    if (method === "PUT" && p[1]) {
      const b = z
        .object({ data: characterSchema, revision: z.number().int().min(1) })
        .parse(await body(r));
      const result = await run(
        e,
        "UPDATE characters SET data=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=? AND revision=?",
        JSON.stringify(b.data),
        now(),
        p[1],
        u.id,
        b.revision,
      );
      if (!result.meta.changes)
        fail(
          409,
          "Лист изменился на другом устройстве. Перезагрузите страницу перед сохранением.",
        );
      return json({ id: p[1], data: b.data, revision: b.revision + 1 });
    }
    if (method === "DELETE" && p[1]) {
      await run(
        e,
        "DELETE FROM characters WHERE id=? AND user_id=?",
        p[1],
        u.id,
      );
      return json({ ok: true });
    }
  }
  if (p[0] === "campaigns" && p[1] === "restore" && method === "POST")
    return restoreCampaign(r, e, u);
  if (
    p[0] === "campaigns" &&
    ["backup", "guest-links", "time-slots", "search"].includes(p[2])
  )
    return campaignUtilities(r, e, u, p, async (path, method = "GET", data) => {
      const headers = new Headers(r.headers);
      headers.delete("content-length");
      headers.set("Content-Type", "application/json");
      const response = await api(
        new Request(new URL("/api/" + path, r.url), {
          method,
          headers,
          body: data === undefined ? undefined : JSON.stringify(data),
        }),
        e,
        ctx,
      );
      const value = await response.json();
      if (!response.ok)
        throw new HttpError(response.status, (value as any).error);
      return value;
    });
  if (p[0] === "campaigns")
    return ["chat", "documents", "log", "rules-config"].includes(p[2])
      ? gameTools(r, e, u, p, () => body(r))
      : campaignRoutes(r, e, u, p, () => body(r));
  if (p[0] === "sessions") {
    if (method === "GET") {
      const rows = await all(
        e,
        "SELECT s.*,c.name AS campaign_name FROM sessions s LEFT JOIN campaigns c ON c.id=s.campaign_id WHERE s.public=1 OR s.owner_id=? OR s.campaign_id IN (SELECT campaign_id FROM members WHERE user_id=?) ORDER BY s.start",
        u.id,
        u.id,
      );
      for (const s of rows) {
        s.votes = await all(
          e,
          "SELECT user_id,name,answer FROM votes WHERE session_id=?",
          s.id,
        );
        s.attendees = await all(
          e,
          "SELECT user_id,name FROM attendees WHERE session_id=?",
          s.id,
        );
      }
      return json(rows);
    }
    if (method === "POST" && !p[1]) {
      const b = sessionSchema.parse(await body(r));
      if (b.campaignId)
        await getCampaign(e, b.campaignId, u, "manage_sessions");
      if (b.public && !b.campaignId) await admin(e, u);
      if (b.public && b.campaignId)
        await getCampaign(e, b.campaignId, u, "publish_campaign");
      if (!b.campaignId && !b.public)
        fail(400, "Выберите кампанию или откройте набор");
      if (Date.parse(b.start) <= Date.now()) fail(400, "Укажите будущую дату");
      const id = uid();
      await run(
        e,
        "INSERT INTO sessions(id,campaign_id,owner_id,title,start,end,public,capacity,description) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        b.campaignId,
        u.id,
        b.title,
        b.start,
        b.end,
        b.public ? 1 : 0,
        b.capacity,
        b.description,
      );
      return json({ id }, 201);
    }
    if (p[2] === "vote" && method === "POST") {
      const s = await session(e, p[1], u);
      if (s.status !== "proposed") fail(409, "Голосование уже закрыто");
      const b = z
        .object({ answer: z.enum(["yes", "maybe", "no"]) })
        .parse(await body(r));
      await run(
        e,
        "INSERT INTO votes(session_id,user_id,name,answer) VALUES(?,?,?,?) ON CONFLICT(session_id,user_id) DO UPDATE SET answer=excluded.answer,name=excluded.name",
        s.id,
        u.id,
        u.name,
        b.answer,
      );
      return json({ ok: true });
    }
    if (p[2] === "join" && method === "POST") {
      const s = await session(e, p[1], u);
      if (
        !s.public ||
        s.status === "cancelled" ||
        Date.parse(s.end) < Date.now()
      )
        fail(400, "Набор закрыт");
      const result = await run(
        e,
        "INSERT OR IGNORE INTO attendees(session_id,user_id,name) SELECT ?,?,? WHERE (SELECT COUNT(*) FROM attendees WHERE session_id=?)<?",
        s.id,
        u.id,
        u.name,
        s.id,
        s.capacity,
      );
      if (
        !result.meta.changes &&
        !(await one(
          e,
          "SELECT 1 FROM attendees WHERE session_id=? AND user_id=?",
          s.id,
          u.id,
        ))
      )
        fail(409, "Свободных мест больше нет");
      return json({ ok: true });
    }
    if (p[2] === "join" && method === "DELETE") {
      await run(
        e,
        "DELETE FROM attendees WHERE session_id=? AND user_id=?",
        p[1],
        u.id,
      );
      return json({ ok: true });
    }
    if (p[2] === "confirm" && method === "POST") {
      const s = await session(e, p[1], u, true);
      if (s.status !== "proposed") fail(409, "Встреча уже обработана");
      await confirmTime(
        e,
        s.owner_id,
        s.id,
        s.start,
        s.end,
        e.DB.prepare("UPDATE sessions SET status='confirmed' WHERE id=?").bind(
          s.id,
        ),
      );
      await enqueue(e, "session.confirmed", {
        id: s.id,
        title: s.title,
        start: s.start,
        end: s.end,
      });
      ctx.waitUntil(sendOutbox(e));
      ctx.waitUntil(sendPush(e, s));
      return json({ ok: true });
    }
    if (p[2] === "cancel" && method === "POST") {
      const s = await session(e, p[1], u, true);
      await e.DB.batch([
        e.DB.prepare("DELETE FROM reservations WHERE id=?").bind(s.id),
        e.DB.prepare("UPDATE sessions SET status='cancelled' WHERE id=?").bind(
          s.id,
        ),
      ]);
      await enqueue(e, "session.cancelled", {
        id: s.id,
        title: s.title,
        start: s.start,
        end: s.end,
      });
      ctx.waitUntil(sendOutbox(e));
      return json({ ok: true });
    }
  }
  if (p[0] === "clues") {
    if (method === "GET" && !p[1]) {
      const cid = url.searchParams.get("campaign") || "";
      const c = await campaign(e, cid, u);
      const rows = await all(e, "SELECT * FROM clues WHERE campaign_id=?", cid);
      const visible = [];
      for (const row of rows)
        if (await materialVisible(e, c, u, row))
          visible.push({
            ...row,
            recipients: JSON.parse(row.recipients),
            roles: JSON.parse(row.visible_roles),
          });
      return json(visible);
    }
    if (method === "POST") {
      const b = z
        .object({
          campaignId: str,
          title: str,
          body: z.string().max(20000),
          kind: z.enum(["note", "chat", "photo", "map"]),
          revealed: z.boolean(),
          recipients: z.array(str).max(50),
          roles: z.array(str).max(50).default([]),
          folderId: z.string().nullable().default(null),
        })
        .parse(await body(r));
      await campaign(e, b.campaignId, u, true);
      await validFolder(e, b.campaignId, b.folderId);
      const id = uid();
      await run(
        e,
        "INSERT INTO clues(id,campaign_id,title,body,kind,revealed,recipients,visible_roles,folder_id) VALUES(?,?,?,?,?,?,?,?,?)",
        id,
        b.campaignId,
        b.title,
        b.body,
        b.kind,
        +b.revealed,
        JSON.stringify(b.recipients),
        JSON.stringify(b.roles),
        b.folderId,
      );
      return json({ id }, 201);
    }
    const clue = await one(e, "SELECT * FROM clues WHERE id=?", p[1]);
    if (!clue) fail(404, "Материал не найден");
    const c = await campaign(e, clue!.campaign_id, u, method !== "GET");
    if (p[2] === "text" && method === "PUT") {
      const b = z
        .object({ text: z.string().max(100000) })
        .parse(await body(r, 500000));
      await run(
        e,
        "INSERT INTO clue_text(clue_id,text) VALUES(?,?) ON CONFLICT(clue_id) DO UPDATE SET text=excluded.text",
        clue!.id,
        b.text,
      );
      return json({ ok: true });
    }
    if (method === "PATCH") {
      const b = z
        .object({
          revealed: z.boolean(),
          recipients: z.array(str).max(50),
          roles: z.array(str).max(50).optional(),
          title: str.optional(),
          body: z.string().max(20000).optional(),
          folderId: z.string().nullable().optional(),
        })
        .parse(await body(r));
      await validFolder(e, clue!.campaign_id, b.folderId ?? null);
      await run(
        e,
        "UPDATE clues SET revealed=?,recipients=?,visible_roles=?,title=?,body=?,folder_id=? WHERE id=?",
        +b.revealed,
        JSON.stringify(b.recipients),
        JSON.stringify(b.roles ?? JSON.parse(clue!.visible_roles)),
        b.title ?? clue!.title,
        b.body ?? clue!.body,
        b.folderId === undefined ? clue!.folder_id : b.folderId,
        clue!.id,
      );
      return json({ ok: true });
    }
    if (p[2] === "file" && method === "PUT") {
      const type = r.headers.get("content-type") || "";
      if (
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
          "text/plain",
        ].includes(type)
      )
        fail(400, "Разрешены JPG, PNG, WebP, PDF и TXT");
      if (Number(r.headers.get("content-length") || 0) > 5 * 1024 * 1024)
        fail(413, "Максимум 5 МБ");
      const file = (await readBytes(r, 5 * 1024 * 1024)).buffer as ArrayBuffer;
      if (file.byteLength > 5 * 1024 * 1024) fail(413, "Максимум 5 МБ");
      const key = clue!.file_key || `clues/${clue!.id}`;
      await e.BUCKET.put(key, file, { httpMetadata: { contentType: type } });
      await run(
        e,
        "UPDATE clues SET file_key=?,mime=?,file_name=? WHERE id=?",
        key,
        type,
        (r.headers.get("x-file-name") || "Материал").slice(0, 200),
        clue!.id,
      );
      if (type === "text/plain")
        await run(
          e,
          "INSERT INTO clue_text(clue_id,text) VALUES(?,?) ON CONFLICT(clue_id) DO UPDATE SET text=excluded.text",
          clue!.id,
          new TextDecoder().decode(file).slice(0, 100000),
        );
      return json({ ok: true });
    }
    if (p[2] === "file" && method === "GET") {
      if (!(await materialVisible(e, c, u, clue!)))
        fail(404, "Материал пока не открыт");
      if (!clue!.file_key) fail(404, "Файл не прикреплён");
      const file = await e.BUCKET.get(clue!.file_key);
      if (!file) fail(404, "Файл не найден");
      return new Response(file!.body, {
        headers: {
          "Content-Type": clue!.mime,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(clue!.file_name)}`,
        },
      });
    }
    if (method === "DELETE") {
      if (clue!.file_key) await e.BUCKET.delete(clue!.file_key);
      await run(e, "DELETE FROM clues WHERE id=?", clue!.id);
      return json({ ok: true });
    }
  }
  if (p[0] === "availability" && method === "GET") {
    const start = z.string().datetime().parse(url.searchParams.get("start"));
    const end = z.string().datetime().parse(url.searchParams.get("end"));
    if (end <= start || Date.parse(end) - Date.parse(start) > 93 * 86400000)
      fail(400, "Период не больше 93 дней");
    const local = await all(
      e,
      "SELECT start,end FROM reservations WHERE owner_id=? AND start<? AND end>?",
      siteOwner,
      end,
      start,
    );
    const external = await externalBusy(e, start, end);
    return json({
      busy: [...local, ...external],
      externalConnected: !!e.INTEGRATION_URL,
    });
  }
  if (p[0] === "bookings") {
    if (method === "GET")
      return json(
        (
          await all(
            e,
            "SELECT * FROM bookings WHERE user_id=? OR gm_id=? ORDER BY created_at DESC",
            u.id,
            u.id,
          )
        ).map((b) => ({ ...b, data: JSON.parse(b.data) })),
      );
    if (method === "POST" && !p[1]) {
      const b = bookingSchema.parse(await body(r));
      if (b.start && Date.parse(b.start) < Date.now())
        fail(400, "Укажите будущую дату");
      const quote = price(b, (await settings(e)).pricing),
        id = uid();
      await run(
        e,
        "INSERT INTO bookings(id,user_id,gm_id,data,total,created_at) VALUES(?,?,?,?,?,?)",
        id,
        u.id,
        siteOwner,
        JSON.stringify(b),
        quote.total,
        now(),
      );
      await enqueue(e, "booking.requested", {
        id,
        booking: b,
        total: quote.total,
      });
      ctx.waitUntil(sendOutbox(e));
      return json({ id, total: quote.total, status: "pending" }, 201);
    }
    if (method === "POST" && ["confirm", "decline"].includes(p[2])) {
      await admin(e, u);
      const b = await one(
        e,
        "SELECT * FROM bookings WHERE id=? AND gm_id=?",
        p[1],
        u.id,
      );
      if (!b) fail(404, "Заявка не найдена");
      if (b!.status !== "pending") fail(409, "Заявка уже обработана");
      const data = JSON.parse(b!.data);
      const update = e.DB.prepare(
        "UPDATE bookings SET status=? WHERE id=?",
      ).bind(p[2] === "confirm" ? "confirmed" : "declined", b!.id);
      if (p[2] === "confirm") {
        if (!data.start)
          fail(
            400,
            "Для подтверждения сначала согласуйте дату с клиентом и укажите её в заявке",
          );
        await confirmTime(
          e,
          u.id,
          b!.id,
          data.start,
          new Date(Date.parse(data.start) + data.hours * 3600000).toISOString(),
          update,
        );
      } else await update.run();
      await enqueue(
        e,
        `booking.${p[2] === "confirm" ? "confirmed" : "declined"}`,
        { id: b!.id, booking: data, total: b!.total },
      );
      ctx.waitUntil(sendOutbox(e));
      return json({ ok: true });
    }
    if (method === "PATCH" && p[1]) {
      await admin(e, u);
      const b = z.object({ start: z.string().datetime() }).parse(await body(r));
      const row = await one(
        e,
        "SELECT data FROM bookings WHERE id=? AND gm_id=? AND status='pending'",
        p[1],
        u.id,
      );
      if (!row) fail(404, "Ожидающая заявка не найдена");
      await run(
        e,
        "UPDATE bookings SET data=? WHERE id=?",
        JSON.stringify({ ...JSON.parse(row!.data), start: b.start }),
        p[1],
      );
      return json({ ok: true });
    }
  }
  if (p[0] === "outbox") {
    await admin(e, u);
    if (method === "GET")
      return json(
        await all(
          e,
          "SELECT id,event,target,status,attempts,error,created_at FROM outbox ORDER BY created_at DESC LIMIT 100",
        ),
      );
    if (method === "POST") {
      await run(e, "UPDATE outbox SET attempts=0 WHERE status='pending'");
      await sendOutbox(e);
      return json({ ok: true });
    }
  }
  return fail(404, "Маршрут не найден");
}
async function sendPush(e: Env, s: Record<string, any>) {
  if (!e.PUSH_GATEWAY_URL || !e.PUSH_GATEWAY_SECRET) return;
  const recipients = await all(
    e,
    "SELECT DISTINCT p.token,p.platform FROM push_tokens p WHERE p.user_id IN (SELECT user_id FROM members WHERE campaign_id=? UNION SELECT user_id FROM attendees WHERE session_id=?)",
    s.campaign_id,
    s.id,
  );
  if (!recipients.length) return;
  const response = await fetch(e.PUSH_GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${e.PUSH_GATEWAY_SECRET}`,
    },
    body: JSON.stringify({
      eventId: s.id,
      recipients,
      title: "Встреча подтверждена",
      body: s.title,
      data: { sessionId: s.id, start: s.start },
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) console.error("Push gateway rejected event", s.id);
}
export default {
  async fetch(r: Request, e: Env, ctx: ExecutionContext) {
    const url = new URL(r.url);
    const origin = r.headers.get("origin");
    const nativeOrigin = [
      "capacitor://localhost",
      "http://localhost",
      "https://localhost",
    ].includes(origin || "");
    const isApi = url.pathname.startsWith("/api/");
    if (isApi && r.method === "OPTIONS" && nativeOrigin)
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": origin!,
          "Access-Control-Allow-Headers":
            "Authorization,Content-Type,X-File-Name",
          "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          Vary: "Origin",
        },
      });
    let response: Response;
    try {
      if (url.pathname === "/telegram/webhook") {
        if (r.method !== "POST") fail(405, "Метод не поддерживается");
        response = await telegramWebhook(r, await configuredEnv(e), api, ctx);
      } else if (url.pathname === "/mcp") {
        response = await mcp(r, e, ctx, api);
      } else if (isApi) {
        if (
          !["GET", "HEAD", "OPTIONS"].includes(r.method) &&
          origin &&
          origin !== url.origin &&
          !nativeOrigin &&
          !(e.LOCAL_DEV === "true" && origin === "http://127.0.0.1:5173")
        )
          fail(403, "Источник запроса не разрешён");
        if (
          nativeOrigin &&
          !url.pathname.startsWith("/api/auth/") &&
          !r.headers.get("authorization")
        )
          fail(401, "Подключите приложение с кодом входа");
        response = await api(r, e, ctx);
      } else {
        const asset =
          assets[url.pathname] ||
          (!url.pathname.includes(".") ? assets["/index.html"] : undefined);
        response = asset
          ? new Response(
              Uint8Array.from(atob(asset.data), (c) => c.charCodeAt(0)),
              {
                headers: {
                  "Content-Type": asset.type,
                  "Cache-Control": url.pathname.startsWith("/assets/")
                    ? "public,max-age=31536000,immutable"
                    : "no-cache",
                  "X-Content-Type-Options": "nosniff",
                  "Referrer-Policy": "same-origin",
                  ...(asset.encoding
                    ? { "Content-Encoding": asset.encoding }
                    : {}),
                },
              },
            )
          : new Response("Not found", { status: 404 });
      }
    } catch (error) {
      const err = error as Error;
      if (error instanceof AccessError)
        response = json({ error: err.message }, error.status);
      else if (error instanceof z.ZodError)
        response = json(
          {
            error: error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          },
          400,
        );
      else if (error instanceof HttpError)
        response = json({ error: err.message }, error.status);
      else if (err.message.includes("TIME_CONFLICT"))
        response = json(
          { error: "Это время уже занято другой подтверждённой игрой" },
          409,
        );
      else {
        console.error("Request failed", url.pathname, err.message);
        response = json(
          { error: "Сервер не смог выполнить запрос. Повторите позже." },
          500,
        );
      }
    }
    if (isApi && nativeOrigin) {
      response = new Response(response.body, response);
      response.headers.set("Access-Control-Allow-Origin", origin!);
      response.headers.set("Vary", "Origin");
    }
    return response;
  },
};

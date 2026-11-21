import { z } from "zod";
import type { Env } from "./index";
import { digest } from "./crypto";
import { roll } from "../src/domain";
import { HttpError, readJson } from "./http";
type User = { id: string; name: string };
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
function equal(a: string, b: string) {
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
}
export async function telegramAccount(
  r: Request,
  e: Env,
  u: User,
  p: string[],
) {
  if (r.method === "GET")
    return json({
      enabled: !!(e.TELEGRAM_BOT_TOKEN && e.TELEGRAM_BOT_USERNAME),
      username: e.TELEGRAM_BOT_USERNAME || "",
      linked: !!(await e.DB.prepare(
        "SELECT chat_id FROM telegram_users WHERE user_id=?",
      )
        .bind(u.id)
        .first()),
    });
  if (r.method === "DELETE") {
    await e.DB.batch([
      e.DB.prepare("DELETE FROM telegram_users WHERE user_id=?").bind(u.id),
      e.DB.prepare("DELETE FROM telegram_links WHERE user_id=?").bind(u.id),
      e.DB.prepare("DELETE FROM telegram_login_codes WHERE user_id=?").bind(
        u.id,
      ),
      e.DB.prepare(
        "DELETE FROM native_tokens WHERE user_id=? AND origin='telegram'",
      ).bind(u.id),
    ]);
    return json({ ok: true });
  }
  if (r.method !== "POST" || p[1] !== "link")
    throw new HttpError(405, "Метод не поддерживается");
  if (!e.TELEGRAM_BOT_TOKEN || !e.TELEGRAM_BOT_USERNAME)
    throw new HttpError(503, "Администратор ещё не подключил Telegram-бота");
  const token =
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  await e.DB.batch([
    e.DB.prepare(
      "DELETE FROM telegram_links WHERE user_id=? OR expires<?",
    ).bind(u.id, new Date().toISOString()),
    e.DB.prepare(
      "INSERT INTO telegram_links(hash,user_id,user_name,expires) VALUES(?,?,?,?)",
    ).bind(
      await digest(token),
      u.id,
      u.name,
      new Date(Date.now() + 10 * 60000).toISOString(),
    ),
  ]);
  return json({
    url: `https://t.me/${e.TELEGRAM_BOT_USERNAME}?start=${token}`,
    expiresInMinutes: 10,
  });
}
export async function telegramLogin(r: Request, e: Env, data: unknown) {
  const b = z.object({ code: z.string().regex(/^\d{8}$/) }).parse(data),
    hash = await digest(b.code),
    at = new Date().toISOString();
  const ip = r.headers.get("cf-connecting-ip") || "local";
  const t = Date.now();
  const limit = await e.DB.prepare(
    "INSERT INTO auth_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count",
  )
    .bind("telegram-login:" + (await digest(ip)), t + 900000, t, t, t + 900000)
    .first<{ count: number }>();
  if ((limit?.count || 0) > 10)
    throw new HttpError(429, "Слишком много попыток. Повторите позже.");
  const row = await e.DB.prepare(
    "DELETE FROM telegram_login_codes WHERE hash=? AND expires>? RETURNING user_id,name",
  )
    .bind(hash, at)
    .first<{ user_id: string; name: string }>();
  if (!row)
    throw new HttpError(401, "Код неверен или истёк. Запросите /login у бота");
  const token = crypto.randomUUID() + crypto.randomUUID();
  await e.DB.prepare(
    "INSERT INTO native_tokens(hash,user_id,name,expires,origin) VALUES(?,?,?,?,'telegram')",
  )
    .bind(
      await digest(token),
      row.user_id,
      row.name,
      new Date(Date.now() + 30 * 86400000).toISOString(),
    )
    .run();
  return json({ ok: true, user: { id: row.user_id, name: row.name }, token });
}
export async function telegramWebhook(
  r: Request,
  e: Env,
  api: (r: Request, e: Env, ctx: ExecutionContext) => Promise<Response>,
  ctx: ExecutionContext,
) {
  const secret = r.headers.get("x-telegram-bot-api-secret-token") || "";
  if (!e.TELEGRAM_WEBHOOK_SECRET || !equal(secret, e.TELEGRAM_WEBHOOK_SECRET))
    throw new HttpError(403, "Неверная подпись webhook");
  const update = z
    .object({
      update_id: z.number().int(),
      message: z
        .object({
          text: z.string().max(10000).optional(),
          chat: z.object({ id: z.number().int(), type: z.string() }),
          from: z
            .object({
              id: z.number().int(),
              first_name: z.string().max(120).optional(),
            })
            .optional(),
        })
        .optional(),
    })
    .parse(await readJson(r, 60000));
  const message = update.message;
  if (!message?.text || message.chat.type !== "private" || !message.from)
    return json({ ok: true });
  const botId = (e.TELEGRAM_BOT_TOKEN || "").split(":")[0];
  const dedup = await e.DB.prepare(
    "INSERT OR IGNORE INTO telegram_updates(bot_id,id,created_at) VALUES(?,?,?)",
  )
    .bind(botId, update.update_id, new Date().toISOString())
    .run();
  if (!dedup.meta.changes) {
    const cached = await e.DB.prepare(
      "SELECT reply FROM telegram_updates WHERE bot_id=? AND id=?",
    )
      .bind(botId, update.update_id)
      .first<{ reply: string }>();
    return cached?.reply ? json(JSON.parse(cached.reply)) : json({ ok: true });
  }
  const chat = String(message.chat.id),
    telegramId = String(message.from.id),
    raw = message.text.trim().split(/\s+/, 1)[0],
    command = raw.split("@")[0],
    text = message.text.trim().slice(raw.length).trim();
  const reply = async (text: string) => {
    const response = {
      method: "sendMessage",
      chat_id: chat,
      text: text.slice(0, 4000),
      protect_content: true,
    };
    if (command !== "/login")
      await e.DB.prepare(
        "UPDATE telegram_updates SET reply=? WHERE bot_id=? AND id=?",
      )
        .bind(JSON.stringify(response), botId, update.update_id)
        .run();
    return json(response);
  };
  let linked = await e.DB.prepare(
    "SELECT * FROM telegram_users WHERE chat_id=? AND telegram_id=?",
  )
    .bind(chat, telegramId)
    .first<Record<string, string>>();
  if (command === "/start" && text) {
    const link = await e.DB.prepare(
      "DELETE FROM telegram_links WHERE hash=? AND expires>? RETURNING user_id,user_name",
    )
      .bind(await digest(text), new Date().toISOString())
      .first<{ user_id: string; user_name: string }>();
    if (!link)
      return reply(
        "Ссылка недействительна. Создайте новую в настройках neustroy.",
      );
    const existing = await e.DB.prepare(
      "SELECT user_id FROM telegram_users WHERE chat_id=? OR telegram_id=?",
    )
      .bind(chat, telegramId)
      .first<{ user_id: string }>();
    if (existing && existing.user_id !== link.user_id)
      return reply(
        "Этот Telegram уже связан с другим профилем. Сначала отключите прежнюю привязку.",
      );
    await e.DB.prepare(
      "INSERT INTO telegram_users(chat_id,telegram_id,user_id,name) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,telegram_id=excluded.telegram_id,name=excluded.name",
    )
      .bind(chat, telegramId, link.user_id, link.user_name)
      .run();
    return reply(
      "Профиль подключён: " +
        link.user_name +
        "\n/games — выбрать игру\n/login — код входа в приложение\n/help — команды",
    );
  }
  if (!linked)
    return reply(
      "Сначала войдите в neustroy и выберите «Настройки → Telegram → Подключить». Бот получит доступ только к вашему профилю.",
    );
  const invoke = async (path: string, method = "GET", body?: unknown) => {
    const response = await api(
      new Request("https://neustroy-bot.local/api/" + path, {
        method,
        headers: {
          "Content-Type": "application/json",
          "oai-authenticated-user-id": linked!.user_id,
          "oai-authenticated-user-full-name": encodeURIComponent(linked!.name),
          "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      e,
      ctx,
    );
    const result = (await response.json()) as any;
    if (!response.ok) throw new Error(result.error || "Нет доступа");
    return result;
  };
  try {
    if (command === "/login") {
      const bytes = crypto.getRandomValues(new Uint32Array(1));
      const code = String(10000000 + (bytes[0] % 90000000));
      await e.DB.batch([
        e.DB.prepare(
          "DELETE FROM telegram_login_codes WHERE user_id=? OR expires<?",
        ).bind(linked.user_id, new Date().toISOString()),
        e.DB.prepare(
          "INSERT INTO telegram_login_codes(hash,user_id,name,expires) VALUES(?,?,?,?)",
        ).bind(
          await digest(code),
          linked.user_id,
          linked.name,
          new Date(Date.now() + 5 * 60000).toISOString(),
        ),
      ]);
      return reply(
        `Код входа: ${code}\nДействует 5 минут, используется один раз. Не пересылайте его другим людям.`,
      );
    }
    if (command === "/games") {
      const games = await invoke("campaigns");
      return reply(
        games.length
          ? games.map((g: any) => `${g.name}\n/use ${g.id}`).join("\n\n")
          : "Пока нет игр. Создайте игру в приложении или вступите по приглашению.",
      );
    }
    if (command === "/use") {
      const games = await invoke("campaigns");
      const game = games.find((g: any) => g.id === text);
      if (!game) return reply("Игра не найдена. Выберите её через /games.");
      await e.DB.prepare(
        "UPDATE telegram_users SET campaign_id=? WHERE chat_id=?",
      )
        .bind(game.id, chat)
        .run();
      return reply("Выбрана игра: " + game.name);
    }
    if (command === "/sessions") {
      const sessions = await invoke("sessions");
      return reply(
        sessions
          .filter(
            (s: any) =>
              s.status !== "cancelled" && s.end > new Date().toISOString(),
          )
          .slice(0, 10)
          .map((s: any) => `${s.title}\n${s.start} UTC · ${s.status}`)
          .join("\n\n") || "Ближайших встреч нет.",
      );
    }
    if (command === "/dice") {
      const result = roll(text || "1d20");
      if (linked.campaign_id)
        await invoke(`campaigns/${linked.campaign_id}/log`, "POST", {
          kind: "roll",
          text: `${result.formula}: ${result.total} [${result.dice.join(", ")}]`,
          visibility: "private",
        });
      return reply(
        `${result.formula}: ${result.total} [${result.dice.join(", ")}]`,
      );
    }
    if (
      ["/note", "/shared", "/chat", "/materials", "/summary"].includes(
        command,
      ) &&
      !linked.campaign_id
    )
      return reply("Сначала выберите игру через /games и /use.");
    if (command === "/note" || command === "/shared") {
      if (!text) return reply("Добавьте текст после команды.");
      await invoke(`campaigns/${linked.campaign_id}/notes`, "POST", {
        title: text.split(/\r?\n/, 1)[0].slice(0, 100),
        body: text,
        visibility: command === "/shared" ? "shared" : "private",
        links: [],
      });
      return reply(
        command === "/shared"
          ? "Общая запись сохранена."
          : "Личная запись сохранена.",
      );
    }
    if (command === "/chat") {
      if (!text) return reply("Добавьте текст после /chat.");
      await invoke(`campaigns/${linked.campaign_id}/chat`, "POST", { text });
      return reply("Отправлено в общий чат игры.");
    }
    if (command === "/materials") {
      const rows = await invoke(
        "clues?campaign=" + encodeURIComponent(linked.campaign_id),
      );
      return reply(
        rows
          .slice(0, 15)
          .map((row: any) => row.title + "\n" + row.body.slice(0, 600))
          .join("\n\n") || "Мастер пока не открыл материалы.",
      );
    }
    if (command === "/summary") {
      const result = await invoke("assistant", "POST", {
        action: "summary",
        prompt: "Составь краткую сводку доступного мне журнала игры.",
        campaignId: linked.campaign_id,
        provider: "server",
      });
      return reply(result.text);
    }
    return reply(
      "/games — мои игры\n/use ID — выбрать игру\n/note текст — личная заметка\n/shared текст — общая заметка\n/chat текст — сообщение в общий чат\n/dice 2d6+3 — бросок\n/sessions — ближайшие встречи\n/materials — доступные материалы\n/summary — сводка с моделью сервера\n/login — код входа в приложение",
    );
  } catch (error) {
    return reply((error as Error).message || "Не удалось выполнить команду");
  }
}

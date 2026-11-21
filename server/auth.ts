import { z } from "zod";
import type { Env } from "./index";
import { configuredEnv } from "./secrets";
import { telegramLogin } from "./telegram";
import { digest } from "./crypto";
export { digest } from "./crypto";
const encode = (b: ArrayBuffer) =>
  Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join(
    "",
  );
const bytes = (h: string) =>
  Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return encode(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: bytes(salt),
        iterations: 100000,
        hash: "SHA-256",
      },
      key,
      256,
    ),
  );
}
function equal(a: string, b: string) {
  let n = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return n === 0;
}
const reply = (
  v: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(v, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const cookie = (r: Request, token: string, days = 30) =>
  `neustroy_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${days * 86400}${new URL(r.url).protocol === "https:" ? "; Secure" : ""}`;
export async function accountIdentity(r: Request, e: Env) {
  const bearer = r.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const token =
    bearer ||
    r.headers.get("cookie")?.match(/(?:^|;\s*)neustroy_session=([^;]+)/)?.[1];
  if (!token) return null;
  const row = await e.DB.prepare(
    "SELECT a.id,a.name FROM account_sessions s JOIN accounts a ON a.id=s.user_id WHERE s.hash=? AND s.expires>?",
  )
    .bind(await digest(token), new Date().toISOString())
    .first<{ id: string; name: string }>();
  if (row) return row;
  return e.DB.prepare(
    "SELECT user_id AS id,name FROM native_tokens WHERE hash=? AND expires>?",
  )
    .bind(await digest(token), new Date().toISOString())
    .first<{ id: string; name: string }>();
}
async function limited(e: Env, key: string, max: number, seconds: number) {
  const t = Date.now();
  const row = await e.DB.prepare(
    "INSERT INTO auth_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,reset_at=CASE WHEN reset_at<=? THEN ? ELSE reset_at END RETURNING count",
  )
    .bind(key, t + seconds * 1000, t, t, t + seconds * 1000)
    .first<{ count: number }>();
  return (row?.count || 0) > max;
}
const credentials = z.object({
  email: z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((x) => x.toLowerCase()),
  password: z
    .string()
    .min(12, "Пароль должен содержать не меньше 12 символов")
    .max(128),
  name: z.string().trim().min(1).max(80).optional(),
});
export async function authRoute(
  r: Request,
  e: Env,
  body: () => Promise<unknown>,
) {
  e = await configuredEnv(e);
  const action = new URL(r.url).pathname.split("/").pop();
  if (action === "status" && r.method === "GET")
    return reply({
      accounts: true,
      local: e.LOCAL_DEV === "true" || e.LOCAL_SERVER === "true",
      adminSetup: !!e.ADMIN_SETUP_SECRET,
      passwordReset: !!(e.RESEND_API_KEY && e.MAIL_FROM && e.PUBLIC_APP_URL),
    });
  if (r.method !== "POST")
    return reply({ error: "Метод не поддерживается" }, 405);
  if (action === "telegram-code") return telegramLogin(r, e, await body());
  if (action === "logout") {
    const token =
      r.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1] ||
      r.headers.get("cookie")?.match(/(?:^|;\s*)neustroy_session=([^;]+)/)?.[1];
    if (token) {
      const hash = await digest(token);
      await e.DB.batch([
        e.DB.prepare("DELETE FROM account_sessions WHERE hash=?").bind(hash),
        e.DB.prepare("DELETE FROM native_tokens WHERE hash=?").bind(hash),
      ]);
    }
    return reply({ ok: true }, 200, { "Set-Cookie": cookie(r, "", 0) });
  }
  if (action === "claim-owner") {
    const account = await accountIdentity(r, e);
    const platformId = r.headers.get("oai-authenticated-user-id");
    const u = account || (platformId ? { id: platformId, name: "" } : null);
    if (!u) return reply({ error: "Сначала войдите в аккаунт" }, 401);
    if (u.id.startsWith("guest:"))
      return reply({ error: "Нужен постоянный аккаунт" }, 403);
    if (await limited(e, "claim:" + u.id, 5, 3600))
      return reply({ error: "Слишком много попыток" }, 429);
    const b = z
      .object({ setupKey: z.string().min(20).max(200) })
      .parse(await body());
    if (!e.ADMIN_SETUP_SECRET || !equal(b.setupKey, e.ADMIN_SETUP_SECRET))
      return reply({ error: "Неверный ключ настройки" }, 403);
    const result = await e.DB.prepare(
      "INSERT INTO site_config(id,value) VALUES('admin_setup_used',?) ON CONFLICT(id) DO NOTHING",
    )
      .bind(u.id)
      .run();
    if (!result.meta.changes)
      return reply({ error: "Ключ первичной настройки уже использован" }, 409);
    await e.DB.prepare(
      "INSERT INTO site_config(id,value) VALUES('owner',?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
    )
      .bind(u.id)
      .run();
    return reply({ ok: true });
  }
  if (action === "forgot-password") {
    const b = z
      .object({
        email: z
          .string()
          .trim()
          .email()
          .max(254)
          .transform((v) => v.toLowerCase()),
      })
      .parse(await body());
    if (!e.RESEND_API_KEY || !e.MAIL_FROM || !e.PUBLIC_APP_URL)
      return reply(
        { error: "Отправка писем ещё не подключена владельцем сервиса" },
        503,
      );
    const ip = r.headers.get("cf-connecting-ip") || "local";
    if (await limited(e, "reset-ip:" + (await digest(ip)), 20, 3600))
      return reply({ error: "Слишком много запросов. Повторите позже." }, 429);
    const answer = {
      ok: true,
      message:
        "Если аккаунт существует, на почту придёт ссылка для смены пароля.",
    };
    if (await limited(e, "reset-email:" + (await digest(b.email)), 3, 3600))
      return reply(answer);
    const user = await e.DB.prepare("SELECT id FROM accounts WHERE email=?")
      .bind(b.email)
      .first<{ id: string }>();
    if (user) {
      const token = encode(crypto.getRandomValues(new Uint8Array(32)).buffer),
        hash = await digest(token);
      const base = new URL(e.PUBLIC_APP_URL);
      if (
        base.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(base.hostname)
      )
        return reply({ error: "Неверная настройка адреса сайта" }, 503);
      base.pathname = "/";
      base.search = "";
      base.hash = "";
      base.searchParams.set("reset_token", token);
      await e.DB.batch([
        e.DB.prepare(
          "DELETE FROM password_resets WHERE user_id=? OR expires<?",
        ).bind(user.id, new Date().toISOString()),
        e.DB.prepare(
          "INSERT INTO password_resets(hash,user_id,expires) VALUES(?,?,?)",
        ).bind(hash, user.id, new Date(Date.now() + 30 * 60000).toISOString()),
      ]);
      try {
        const result = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${e.RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: e.MAIL_FROM,
            to: [b.email],
            subject: "neustroy · смена пароля",
            text: `Ссылка действует 30 минут и используется один раз:\n${base}\n\nВ мобильном приложении можно вставить код:\n${token}\n\nЕсли вы не запрашивали смену пароля, просто проигнорируйте письмо.`,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!result.ok) throw Error("Mail rejected");
      } catch {
        await e.DB.prepare("DELETE FROM password_resets WHERE hash=?")
          .bind(hash)
          .run();
        console.error("Password reset mail could not be delivered");
      }
    }
    return reply(answer);
  }
  if (action === "reset-password") {
    const b = z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password: z.string().min(12).max(128),
      })
      .parse(await body());
    if (await limited(e, "reset-token:" + (await digest(b.token)), 10, 900))
      return reply({ error: "Слишком много попыток" }, 429);
    const tokenHash = await digest(b.token),
      at = new Date().toISOString(),
      salt = encode(crypto.getRandomValues(new Uint8Array(32)).buffer),
      hash = await passwordHash(b.password, salt);
    const lookup =
      "SELECT user_id FROM password_resets WHERE hash=? AND expires>?";
    const results = await e.DB.batch([
      e.DB.prepare(
        `UPDATE accounts SET salt=?,password_hash=? WHERE id=(${lookup})`,
      ).bind(salt, hash, tokenHash, at),
      e.DB.prepare(
        `DELETE FROM account_sessions WHERE user_id=(${lookup})`,
      ).bind(tokenHash, at),
      e.DB.prepare(`DELETE FROM native_tokens WHERE user_id=(${lookup})`).bind(
        tokenHash,
        at,
      ),
      e.DB.prepare(
        `DELETE FROM password_resets WHERE user_id=(${lookup})`,
      ).bind(tokenHash, at),
    ]);
    if (!results[0].meta.changes)
      return reply(
        { error: "Ссылка недействительна или истекла. Запросите новую." },
        400,
      );
    return reply({ ok: true }, 200, { "Set-Cookie": cookie(r, "", 0) });
  }
  if (!["register", "login"].includes(action || ""))
    return reply({ error: "Маршрут не найден" }, 404);
  const input = await body();
  const b: z.infer<typeof credentials> =
    action === "register"
      ? credentials.parse(input)
      : credentials.omit({ name: true }).parse(input);
  const ip = r.headers.get("cf-connecting-ip") || "local";
  const key = await digest(ip + ":" + b.email);
  if (
    (await limited(e, "login:" + key, 10, 900)) ||
    (await limited(e, "ip:" + (await digest(ip)), 100, 3600))
  )
    return reply({ error: "Слишком много попыток. Повторите позже." }, 429);
  let user = await e.DB.prepare("SELECT * FROM accounts WHERE email=?")
    .bind(b.email)
    .first<Record<string, string>>();
  if (action === "register") {
    if (!b.name) return reply({ error: "Укажите имя" }, 400);
    if (user)
      return reply(
        {
          error:
            "Не удалось создать аккаунт. Попробуйте войти или используйте другой адрес.",
        },
        409,
      );
    const salt = encode(crypto.getRandomValues(new Uint8Array(32)).buffer),
      id = "account:" + crypto.randomUUID();
    await e.DB.prepare(
      "INSERT INTO accounts(id,email,name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(
        id,
        b.email,
        b.name,
        salt,
        await passwordHash(b.password, salt),
        new Date().toISOString(),
      )
      .run();
    user = { id, name: b.name };
    if (
      e.LOCAL_SERVER === "true" &&
      r.headers.get("x-neustroy-loopback") === "true"
    ) {
      await e.DB.batch([
        e.DB.prepare(
          "UPDATE site_config SET value=? WHERE id='owner' AND value='unclaimed'",
        ).bind(id),
        e.DB.prepare(
          "INSERT OR IGNORE INTO site_config(id,value) SELECT 'admin_setup_used',? WHERE EXISTS(SELECT 1 FROM site_config WHERE id='owner' AND value=?)",
        ).bind(id, id),
      ]);
    }
  } else {
    const computed = await passwordHash(
      b.password,
      user?.salt || "00000000000000000000000000000000",
    );
    if (!user || !equal(computed, user.password_hash))
      return reply({ error: "Неверный email или пароль" }, 401);
  }
  const token = crypto.randomUUID() + crypto.randomUUID();
  await e.DB.prepare(
    "INSERT INTO account_sessions(hash,user_id,expires) VALUES(?,?,?)",
  )
    .bind(
      await digest(token),
      user!.id,
      new Date(Date.now() + 30 * 86400000).toISOString(),
    )
    .run();
  await e.DB.prepare("DELETE FROM account_sessions WHERE expires<?")
    .bind(new Date().toISOString())
    .run();
  const native =
    r.headers.get("x-neustroy-client") === "native" ||
    ["capacitor://localhost", "http://localhost", "https://localhost"].includes(
      r.headers.get("origin") || "",
    );
  return reply(
    {
      ok: true,
      user: { id: user!.id, name: user!.name },
      ...(native ? { token } : {}),
    },
    200,
    { "Set-Cookie": cookie(r, token) },
  );
}

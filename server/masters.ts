import { z } from "zod";
import { defaultPricing } from "../src/domain";
import { HttpError, readJson } from "./http";
import type { Env } from "./index";

type User = { id: string; name: string };
type LegacySettings = {
  pricing: typeof defaultPricing;
  about: string;
  timezone: string;
};
const clean = (max: number) => z.string().trim().max(max);
const tags = z.array(clean(50).min(1)).max(15);
const pricing = z.object(
  Object.fromEntries(
    Object.keys(defaultPricing).map((key) => [
      key,
      z.number().int().min(0).max(1000000),
    ]),
  ) as Record<keyof typeof defaultPricing, z.ZodNumber>,
);
export const gameListing = z
  .object({
    format: z.enum(["online", "offline", "both"]).default("online"),
    city: clean(100).default(""),
    tags: tags.default([]),
    accepts: z
      .array(z.enum(["player", "observer"]))
      .min(1)
      .max(2)
      .default(["player", "observer"]),
  })
  .refine(
    (v) => v.format === "online" || v.city.length >= 2,
    "Укажите город для очной игры",
  );
const profileSchema = z
  .object({
    handle: z.string().regex(/^[a-z][a-z0-9-]{2,29}$/),
    name: clean(80).min(1),
    description: clean(3000),
    city: clean(100),
    formats: z
      .array(z.enum(["online", "offline"]))
      .min(1)
      .max(2),
    tags,
    pricing,
    offers: z
      .array(
        z.object({
          name: clean(100).min(1),
          description: clean(500),
          price: z.number().int().min(0).max(1000000),
        }),
      )
      .max(30),
    visible: z.boolean(),
  })
  .refine(
    (v) => !v.formats.includes("offline") || v.city.length >= 2,
    "Укажите город для очных игр",
  );
export type MasterProfile = z.infer<typeof profileSchema>;
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const first = <T>(e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .first<T>();
const list = async <T>(e: Env, sql: string, ...p: unknown[]) =>
  (
    await e.DB.prepare(sql)
      .bind(...p)
      .all<T>()
  ).results;
const run = (e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .run();
export async function isMaster(e: Env, userId: string, ownerId: string) {
  return (
    userId === ownerId ||
    !!(await first(
      e,
      "SELECT user_id FROM master_access WHERE user_id=?",
      userId,
    ))
  );
}
export async function requireMaster(e: Env, userId: string, ownerId: string) {
  if (!(await isMaster(e, userId, ownerId)))
    throw new HttpError(403, "Для публикации нужна роль ведущего");
}
const seeded = (legacy: LegacySettings): MasterProfile => ({
  handle: "neustroy",
  name: "neustroy",
  description: legacy.about,
  city: "",
  formats: ["online"],
  tags: ["D&D", "фэнтези", "детектив", "новички"],
  pricing: legacy.pricing,
  offers: [],
  visible: true,
});
export async function publicMasters(
  e: Env,
  owner: string,
  legacy: LegacySettings,
) {
  const stored = await list<{
    user_id: string;
    handle: string;
    data: string;
    visible: number;
  }>(
    e,
    "SELECT p.* FROM master_profiles p WHERE p.user_id=? OR EXISTS(SELECT 1 FROM master_access a WHERE a.user_id=p.user_id) ORDER BY p.handle LIMIT 100",
    owner,
  );
  const published = stored
    .filter((p) => p.visible)
    .map((p) => ({
      userId: p.user_id,
      profile: JSON.parse(p.data) as MasterProfile,
    }));
  if (owner !== "unclaimed" && !stored.some((p) => p.user_id === owner))
    published.unshift({ userId: owner, profile: seeded(legacy) });
  return published;
}

type Match = {
  query: string;
  city: string;
  format: "online" | "offline" | "any";
  tags: string[];
  budget: number;
};
export function matchMasters(profiles: MasterProfile[], query: Match) {
  const normalized = (value: string) =>
    value.toLocaleLowerCase().replace(/ё/g, "е").trim();
  const text = normalized(query.query);
  const allWords = [
    ...new Set([
      ...(text.match(/[\p{L}\d]{3,}/gu) || []),
      ...query.tags.map(normalized),
    ]),
  ];
  const city = normalized(query.city);
  return profiles
    .filter(
      (p) =>
        (query.format === "any" || p.formats.includes(query.format)) &&
        (!city || normalized(p.city).includes(city)) &&
        (!query.budget || p.pricing.hour <= query.budget),
    )
    .map((profile) => {
      const profileTags = profile.tags.map(normalized);
      const matched = profile.tags.filter((_, i) =>
        allWords.some(
          (word) =>
            profileTags[i].includes(word) || word.includes(profileTags[i]),
        ),
      );
      const haystack = normalized(profile.name + " " + profile.description);
      const score =
        matched.length * 5 +
        allWords.filter((word) => haystack.includes(word)).length;
      return { profile, matched, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score || a.profile.name.localeCompare(b.profile.name, "ru"),
    );
}

export async function masterRoutes(
  r: Request,
  e: Env,
  u: User,
  owner: string,
  legacy: LegacySettings,
  p: string[],
) {
  const path = p[1],
    method = r.method;
  if (path === "access") return masterAccess(r, e, u, owner, p[2]);
  if (path === "mine") {
    const enabled = await isMaster(e, u.id, owner);
    if (method === "GET") {
      const current = await first<{ data: string }>(
        e,
        "SELECT data FROM master_profiles WHERE user_id=?",
        u.id,
      );
      return json({
        enabled,
        profile: current
          ? JSON.parse(current.data)
          : u.id === owner
            ? seeded(legacy)
            : null,
      });
    }
    if (method === "PUT") {
      if (!enabled)
        throw new HttpError(403, "Доступ ведущего ещё не активирован");
      const profile = profileSchema.parse(await readJson(r, 50000));
      if (profile.handle === "neustroy" && u.id !== owner)
        throw new HttpError(409, "Этот адрес занят");
      const reserved = await first(
        e,
        "SELECT handle FROM master_profiles WHERE handle=? AND user_id<>?",
        profile.handle,
        u.id,
      );
      if (reserved) throw new HttpError(409, "Этот адрес занят");
      await run(
        e,
        "INSERT INTO master_profiles(user_id,handle,data,visible) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET handle=excluded.handle,data=excluded.data,visible=excluded.visible",
        u.id,
        profile.handle,
        JSON.stringify(profile),
        Number(profile.visible),
      );
      return json(profile);
    }
  }
  if (path === "match" && method === "POST") {
    const query = z
      .object({
        query: clean(800).default(""),
        city: clean(100).default(""),
        format: z.enum(["online", "offline", "any"]).default("any"),
        tags: tags.default([]),
        budget: z.number().int().min(0).max(1000000).default(0),
      })
      .parse(await readJson(r, 10000));
    return json(
      matchMasters(
        (await publicMasters(e, owner, legacy)).map((p) => p.profile),
        query,
      ),
    );
  }
  if (!path && method === "GET")
    return json((await publicMasters(e, owner, legacy)).map((p) => p.profile));
  throw new HttpError(404, "Раздел ведущего не найден");
}

type Order = {
  id: string;
  user_id: string;
  rubles: number;
  return_url: string;
  state: string;
  created_at: string;
  provider_id: string | null;
  checkout_url: string | null;
};
type Payment = {
  id: string;
  status: string;
  paid?: boolean;
  amount?: { value: string; currency: string };
  refunded_amount?: { value: string };
  metadata?: { master_order: string };
  confirmation?: { confirmation_url: string };
};
const getOrder = (e: Env, id: string, user: string) =>
  first<Order>(
    e,
    "SELECT * FROM master_orders WHERE id=? AND user_id=?",
    id,
    user,
  );
function paymentOptions(e: Env) {
  const rubles = Number(e.GM_ACCESS_PRICE_RUB);
  const ready = !!(
    e.YOOKASSA_SHOP_ID &&
    e.YOOKASSA_SECRET &&
    e.PUBLIC_APP_URL?.startsWith("https://") &&
    Number.isInteger(rubles) &&
    rubles >= 1 &&
    rubles <= 1000000
  );
  return { ready, rubles: ready ? rubles : null };
}
async function paymentRequest(
  e: Env,
  path: string,
  body?: unknown,
  idempotency?: string,
) {
  const response = await fetch("https://api.yookassa.ru/v3/payments" + path, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization:
        "Basic " + btoa(e.YOOKASSA_SHOP_ID + ":" + e.YOOKASSA_SECRET),
      ...(body
        ? {
            "Content-Type": "application/json",
            "Idempotence-Key": idempotency!,
          }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new HttpError(502, "Платёжный сервис временно недоступен");
  return (await response.json()) as Payment;
}
function verifyPayment(order: Order, payment: Payment) {
  if (
    !/^[\w-]{12,100}$/.test(payment.id) ||
    (order.provider_id && payment.id !== order.provider_id) ||
    payment.metadata?.master_order !== order.id ||
    payment.amount?.currency !== "RUB" ||
    Number(payment.amount.value) !== order.rubles
  )
    throw new HttpError(502, "Параметры платежа не совпали с заказом");
}
async function recordPayment(e: Env, order: Order, payment: Payment) {
  verifyPayment(order, payment);
  if (
    payment.status === "succeeded" &&
    payment.paid &&
    Number(payment.refunded_amount?.value || 0) === 0
  ) {
    await e.DB.batch([
      e.DB.prepare(
        "UPDATE master_orders SET state='paid',provider_id=? WHERE id=? AND state='pending'",
      ).bind(payment.id, order.id),
      e.DB.prepare(
        "INSERT OR IGNORE INTO master_access(user_id,granted_at,payment_id) SELECT user_id,?,provider_id FROM master_orders WHERE id=? AND state='paid'",
      ).bind(new Date().toISOString(), order.id),
    ]);
    return "paid";
  }
  if (payment.status === "canceled") {
    await run(
      e,
      "UPDATE master_orders SET state='canceled' WHERE id=? AND state='pending'",
      order.id,
    );
    return "canceled";
  }
  return "pending";
}
async function masterAccess(
  r: Request,
  e: Env,
  u: User,
  owner: string,
  action?: string,
) {
  const enabled = await isMaster(e, u.id, owner);
  const options = paymentOptions(e);
  const permanent = u.id.startsWith("account:");
  const getPending = () =>
    first<Order>(
      e,
      "SELECT * FROM master_orders WHERE user_id=? AND state='pending'",
      u.id,
    );
  if (r.method === "GET" && !action) {
    const pending = permanent ? await getPending() : null;
    return json({
      enabled,
      ready: options.ready && permanent,
      rubles: options.rubles,
      pending: pending
        ? { id: pending.id, url: pending.checkout_url, rubles: pending.rubles }
        : null,
    });
  }
  if (r.method !== "POST" || !["checkout", "verify"].includes(action || ""))
    throw new HttpError(405, "Метод не поддерживается");
  if (enabled) return json({ enabled: true, state: "paid" });
  if (!permanent)
    throw new HttpError(403, "Для покупки зарегистрируйтесь по email");
  if (action === "verify") {
    if (!e.YOOKASSA_SHOP_ID || !e.YOOKASSA_SECRET)
      throw new HttpError(503, "Провайдер оплаты недоступен");
    const { id } = z.object({ id: z.uuid() }).parse(await readJson(r, 2000));
    const order = await getOrder(e, id, u.id);
    if (!order) throw new HttpError(404, "Заказ не найден");
    if (!order.provider_id)
      throw new HttpError(409, "Сначала откройте страницу оплаты");
    const state = await recordPayment(
      e,
      order,
      await paymentRequest(e, "/" + encodeURIComponent(order.provider_id)),
    );
    return json({ enabled: state === "paid", state });
  }
  if (!options.ready)
    throw new HttpError(503, "Оплата доступа пока не подключена");
  const { rubles } = z
    .object({ rubles: z.number().int().positive() })
    .parse(await readJson(r, 2000));
  let order = await getPending();
  if (!order) {
    if (rubles !== options.rubles)
      throw new HttpError(409, "Цена изменилась. Обновите страницу");
    const id = crypto.randomUUID();
    const returnUrl = new URL(e.PUBLIC_APP_URL!);
    returnUrl.pathname = "/";
    returnUrl.search = "";
    returnUrl.hash = "master";
    await run(
      e,
      "INSERT OR IGNORE INTO master_orders(id,user_id,rubles,return_url,created_at) VALUES(?,?,?,?,?)",
      id,
      u.id,
      rubles,
      returnUrl.href,
      new Date().toISOString(),
    );
    order = await getPending();
  }
  if (!order) throw new HttpError(409, "Обновите статус доступа ведущего");
  if (order.rubles !== rubles)
    throw new HttpError(409, "Проверьте сумму незавершённого заказа");
  if (order.provider_id && order.checkout_url)
    return json({ id: order.id, url: order.checkout_url, state: "pending" });
  if (Date.now() - Date.parse(order.created_at) > 23 * 3600000)
    throw new HttpError(
      409,
      "Не удалось восстановить заказ. Обратитесь к владельцу сервиса",
    );
  const payment = await paymentRequest(
    e,
    "",
    {
      amount: { value: order.rubles.toFixed(2), currency: "RUB" },
      capture: true,
      confirmation: { type: "redirect", return_url: order.return_url },
      description: "Доступ ведущего neustroy",
      metadata: { master_order: order.id },
    },
    order.id,
  );
  verifyPayment(order, payment);
  if (payment.status === "succeeded" || payment.status === "canceled") {
    const state = await recordPayment(e, order, payment);
    return json({ id: order.id, state, enabled: state === "paid" });
  }
  const url = payment.confirmation?.confirmation_url;
  if (!url || !url.startsWith("https://"))
    throw new HttpError(502, "Платёжный сервис не вернул ссылку");
  await run(
    e,
    "UPDATE master_orders SET provider_id=?,checkout_url=? WHERE id=? AND state='pending'",
    payment.id,
    url,
    order.id,
  );
  return json({ id: order.id, url, state: "pending" });
}

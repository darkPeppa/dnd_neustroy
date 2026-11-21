import { z } from "zod";
import { getCampaign } from "./campaigns";
import { gameListing } from "./masters";
import { HttpError, readJson } from "./http";
import type { Env } from "./index";

type User = { id: string; name: string };
type ResultRow = Record<string, any>;
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const many = async (e: Env, sql: string, ...p: unknown[]) =>
  (
    await e.DB.prepare(sql)
      .bind(...p)
      .all<ResultRow>()
  ).results;
const one = (e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .first<ResultRow>();
const run = (e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .run();
const format = (v: string) => v.trim().toLocaleLowerCase().replace(/ё/g, "е");

export async function discoverGames(
  r: Request,
  e: Env,
  u: User,
  siteOwner: string,
) {
  const url = new URL(r.url);
  const city = format((url.searchParams.get("city") || "").slice(0, 100));
  const query = format((url.searchParams.get("q") || "").slice(0, 150));
  const channel = url.searchParams.get("format") || "any";
  const found = await many(
    e,
    `SELECT c.id,c.name,c.description,c.listing,m.data AS master,
    a.state AS application,a.role_id AS requested_role,
    EXISTS(SELECT 1 FROM members b WHERE b.campaign_id=c.id AND b.user_id=?) AS joined
    FROM campaigns c LEFT JOIN game_applications a ON a.campaign_id=c.id AND a.user_id=?
    LEFT JOIN master_profiles m ON m.user_id=c.owner_id AND m.visible=1
    WHERE c.visibility='public' AND (c.owner_id=? OR EXISTS (SELECT 1 FROM master_access x WHERE x.user_id=c.owner_id))
    ORDER BY c.name LIMIT 1000`,
    u.id,
    u.id,
    siteOwner,
  );
  return json(
    found
      .map(({ master, listing, ...c }) => {
        const profile = master ? JSON.parse(master) : null;
        return {
          ...c,
          name: String(c.name),
          description: String(c.description),
          ...gameListing.parse(JSON.parse(listing)),
          master: profile
            ? { name: profile.name, handle: profile.handle }
            : null,
        };
      })
      .filter(
        (c) =>
          (!city || format(c.city).includes(city)) &&
          (channel === "any" || c.format === "both" || c.format === channel) &&
          (!query ||
            format(
              [c.name, c.description, c.city, ...c.tags, c.master?.name].join(
                " ",
              ),
            ).includes(query)),
      )
      .slice(0, 100),
  );
}

export async function gameApplications(
  r: Request,
  e: Env,
  u: User,
  id: string,
  item: string | undefined,
  siteOwner: string,
) {
  if (r.method === "POST" && !item) {
    const b = z
      .object({
        role: z.enum(["player", "observer"]),
        message: z.string().trim().max(1200).default(""),
      })
      .parse(await readJson(r, 10000));
    const c = await one(
      e,
      "SELECT listing FROM campaigns WHERE id=? AND visibility='public' AND (owner_id=? OR EXISTS (SELECT 1 FROM master_access WHERE user_id=owner_id))",
      id,
      siteOwner,
    );
    if (!c) throw new HttpError(404, "Игра не опубликована");
    if (!gameListing.parse(JSON.parse(c.listing)).accepts.includes(b.role))
      throw new HttpError(409, "Мастер закрыл набор для этой роли");
    if (
      await one(
        e,
        "SELECT user_id FROM members WHERE campaign_id=? AND user_id=?",
        id,
        u.id,
      )
    )
      throw new HttpError(409, "Вы уже в этой кампании");
    const result = await run(
      e,
      `INSERT INTO game_applications(id,campaign_id,user_id,name,role_id,message,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM campaigns WHERE id=? AND visibility='public' AND listing=?)
      ON CONFLICT(campaign_id,user_id) DO UPDATE SET role_id=excluded.role_id,message=excluded.message WHERE state='pending'`,
      crypto.randomUUID(),
      id,
      u.id,
      u.name,
      b.role,
      b.message,
      new Date().toISOString(),
      id,
      c.listing,
    );
    if (!result.meta.changes)
      throw new HttpError(409, "Заявка уже обработана или набор изменился");
    return json({ state: "pending" }, 201);
  }
  if (r.method === "DELETE" && !item) {
    await run(
      e,
      "DELETE FROM game_applications WHERE campaign_id=? AND user_id=? AND state='pending'",
      id,
      u.id,
    );
    return json({ ok: true });
  }
  await getCampaign(e, id, u, "manage_members");
  if (r.method === "GET" && !item)
    return json(
      await many(
        e,
        "SELECT * FROM game_applications WHERE campaign_id=? ORDER BY created_at DESC LIMIT 100",
        id,
      ),
    );
  if (r.method === "PATCH" && item) {
    const b = z
      .object({ decision: z.enum(["approved", "declined"]) })
      .parse(await readJson(r, 2000));
    const statements: D1PreparedStatement[] = [];
    if (b.decision === "approved")
      statements.push(
        e.DB.prepare(
          `INSERT OR IGNORE INTO members(campaign_id,user_id,name,role_id)
      SELECT campaign_id,user_id,name,role_id FROM game_applications WHERE id=? AND campaign_id=? AND state='pending'`,
        ).bind(item, id),
      );
    statements.push(
      e.DB.prepare(
        "UPDATE game_applications SET state=? WHERE id=? AND campaign_id=? AND state='pending'",
      ).bind(b.decision, item, id),
    );
    const results = await e.DB.batch(statements);
    if (!results.at(-1)?.meta.changes)
      throw new HttpError(409, "Заявка уже обработана");
    return json({ state: b.decision });
  }
  throw new HttpError(405, "Метод не поддерживается");
}

const appearance = z
  .object({
    prompt: z.string().trim().max(160),
    base: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    pattern: z.enum(["triangles", "stars", "rings"]),
  })
  .nullable()
  .default(null);
export const rulesConfig = z
  .object({
    mode: z.enum(["rules", "custom"]),
    edition: z.enum(["srd-2014", "srd-2024", "custom"]),
    enabledModules: z.array(z.string().min(1).max(80)).max(50),
    custom: z.record(z.string(), z.unknown()).default({}),
    assistant: z.boolean().default(true),
    appearance,
  })
  .refine(
    (v) => JSON.stringify(v).length <= 20000,
    "Слишком большая настройка",
  );

const base = {
  mode: "rules",
  edition: "srd-2024",
  enabledModules: ["*"],
  custom: {},
  assistant: true,
  appearance: null,
};
export const builtInPresets = [
  { id: "base-2024", name: "База · SRD 2024", config: base },
  {
    id: "base-2014",
    name: "База · SRD 2014",
    config: { ...base, edition: "srd-2014" },
  },
  {
    id: "investigation",
    name: "Детектив",
    config: {
      ...base,
      mode: "custom",
      enabledModules: ["npc", "quest", "connections", "reminder", "safety"],
      custom: {
        description: "Расследование, улики и связи. Бой по договорённости.",
      },
    },
  },
  {
    id: "starter",
    name: "Первая игра",
    config: {
      ...base,
      mode: "custom",
      enabledModules: ["quest", "combat", "inventory", "safety"],
      custom: {
        description:
          "Объясняйте правила по ходу игры, давайте готовый выбор действий.",
      },
    },
  },
  {
    id: "sandbox",
    name: "Кастом мастера",
    config: { ...base, mode: "custom", edition: "custom" },
  },
];
export async function presets(r: Request, e: Env, u: User, id?: string) {
  if (r.method === "GET") {
    const mine = await many(
      e,
      "SELECT id,name,config FROM campaign_presets WHERE user_id=? ORDER BY name",
      u.id,
    );
    return json([
      ...builtInPresets,
      ...mine.map((p) => ({ ...p, config: JSON.parse(p.config), owned: true })),
    ]);
  }
  if (r.method === "POST") {
    const b = z
      .object({ name: z.string().trim().min(1).max(100), config: rulesConfig })
      .parse(await readJson(r, 35000));
    if (
      (await one(
        e,
        "SELECT count(*) AS n FROM campaign_presets WHERE user_id=?",
        u.id,
      ))!.n >= 30
    )
      throw new HttpError(409, "Можно сохранить до 30 шаблонов");
    const id = crypto.randomUUID();
    await run(
      e,
      "INSERT INTO campaign_presets(id,user_id,name,config) VALUES(?,?,?,?)",
      id,
      u.id,
      b.name,
      JSON.stringify(b.config),
    );
    return json({ id, name: b.name, config: b.config, owned: true }, 201);
  }
  if (r.method === "DELETE" && id) {
    await run(
      e,
      "DELETE FROM campaign_presets WHERE id=? AND user_id=?",
      id,
      u.id,
    );
    return json({ ok: true });
  }
  throw new HttpError(405, "Метод не поддерживается");
}

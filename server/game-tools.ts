import { z } from "zod";
import { rulesConfig } from "./game-directory";
import { AccessError, getCampaign, CampaignAccess } from "./campaigns";
import type { Env } from "./index";
type User = { id: string; name: string };
const title = z.string().trim().min(1).max(160);
const kinds = [
  "npc",
  "quest",
  "inventory",
  "expenses",
  "loot",
  "encounter",
  "combat",
  "board",
  "world",
  "achievement",
  "safety",
  "template",
  "preferences",
  "connections",
  "reminder",
  "advancement",
  "music",
] as const;
const gmKinds = new Set([
  "npc",
  "quest",
  "encounter",
  "combat",
  "board",
  "world",
  "achievement",
  "template",
  "connections",
  "advancement",
  "music",
]);
const docSchema = z.object({
  kind: z.enum(kinds),
  title,
  data: z.record(z.string(), z.unknown()),
  secret: z.string().max(12000).default(""),
  visibility: z.enum(["private", "shared", "roles"]).default("shared"),
  roles: z.array(z.string().min(1).max(120)).max(50).default([]),
  revision: z.number().int().positive().optional(),
});
const all = async (e: Env, sql: string, ...p: unknown[]) =>
  (
    await e.DB.prepare(sql)
      .bind(...p)
      .all<Record<string, any>>()
  ).results;
const one = (e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .first<Record<string, any>>();
const json = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const canRead = (c: CampaignAccess, u: User, d: Record<string, any>) =>
  d.user_id === u.id ||
  (d.visibility !== "private" &&
    (c.permissions.includes("edit_materials") ||
      (c.permissions.includes("view_materials") &&
        (d.visibility === "shared" ||
          (d.visibility === "roles" &&
            JSON.parse(d.roles).includes(c.role_id))))));
const format = (c: CampaignAccess, d: Record<string, any>) => ({
  id: d.id,
  campaign_id: d.campaign_id,
  user_id: d.user_id,
  kind: d.kind,
  title: d.title,
  data: JSON.parse(d.data),
  ...(c.permissions.includes("edit_materials") ? { secret: d.gm_secret } : {}),
  visibility: d.visibility,
  roles: JSON.parse(d.roles),
  revision: d.revision,
  created_at: d.created_at,
  updated_at: d.updated_at,
});
export async function gameTools(
  r: Request,
  e: Env,
  u: User,
  p: string[],
  body: () => Promise<unknown>,
) {
  const c = await getCampaign(e, p[1], u),
    kind = p[2],
    id = p[3],
    method = r.method;
  if (kind === "chat") {
    const peer = new URL(r.url).searchParams.get("peer") || "";
    if (
      peer &&
      !(await one(
        e,
        "SELECT user_id FROM members WHERE campaign_id=? AND user_id=?",
        c.id,
        peer,
      ))
    )
      throw new AccessError(404, "Собеседник не участвует в игре");
    if (method === "GET")
      return json(
        peer
          ? await all(
              e,
              "SELECT id,author_id,author_name,recipient_id,text,created_at FROM (SELECT * FROM chat_messages WHERE campaign_id=? AND ((author_id=? AND recipient_id=?) OR (author_id=? AND recipient_id=?)) ORDER BY created_at DESC,id DESC LIMIT 150) ORDER BY created_at,id",
              c.id,
              u.id,
              peer,
              peer,
              u.id,
            )
          : await all(
              e,
              "SELECT id,author_id,author_name,recipient_id,text,created_at FROM (SELECT * FROM chat_messages WHERE campaign_id=? AND recipient_id IS NULL ORDER BY created_at DESC,id DESC LIMIT 150) ORDER BY created_at,id",
              c.id,
            ),
      );
    if (method === "POST") {
      const b = z
        .object({ text: z.string().trim().min(1).max(4000) })
        .parse(await body());
      const mid = crypto.randomUUID();
      await e.DB.prepare(
        "INSERT INTO chat_messages(id,campaign_id,author_id,author_name,recipient_id,text,created_at) VALUES(?,?,?,?,?,?,?)",
      )
        .bind(
          mid,
          c.id,
          u.id,
          u.name,
          peer || null,
          b.text,
          new Date().toISOString(),
        )
        .run();
      return json({ id: mid }, 201);
    }
  }
  if (kind === "documents") {
    if (method === "GET")
      return json(
        (
          await all(
            e,
            "SELECT * FROM game_documents WHERE campaign_id=? ORDER BY updated_at DESC",
            c.id,
          )
        )
          .filter((d) => canRead(c, u, d))
          .map((d) => format(c, d)),
      );
    const old = id
      ? await one(
          e,
          "SELECT * FROM game_documents WHERE id=? AND campaign_id=?",
          id,
          c.id,
        )
      : null;
    if (id && (!old || !canRead(c, u, old)))
      throw new AccessError(404, "Запись не найдена");
    if (
      old &&
      old.user_id !== u.id &&
      !c.permissions.includes("edit_materials")
    )
      throw new AccessError(403, "Редактирование доступно автору или мастеру");
    if (method === "DELETE") {
      await e.DB.prepare(
        "DELETE FROM game_documents WHERE id=? AND campaign_id=?",
      )
        .bind(id, c.id)
        .run();
      return json({ ok: true });
    }
    const b = docSchema.parse(await body());
    if (JSON.stringify(b.data).length > 40000)
      throw new AccessError(413, "Слишком большая запись");
    if (
      (gmKinds.has(b.kind) || b.secret) &&
      !c.permissions.includes("edit_materials")
    )
      throw new AccessError(403, "Этот инструмент настраивает мастер");
    if (old && old.kind !== b.kind)
      throw new AccessError(400, "Тип записи нельзя менять");
    const at = new Date().toISOString();
    if (method === "POST") {
      const did = crypto.randomUUID();
      await e.DB.prepare(
        "INSERT INTO game_documents(id,campaign_id,user_id,kind,title,data,gm_secret,visibility,roles,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          did,
          c.id,
          u.id,
          b.kind,
          b.title,
          JSON.stringify(b.data),
          b.secret,
          b.visibility,
          JSON.stringify(b.roles),
          at,
          at,
        )
        .run();
      return json({ id: did }, 201);
    }
    if (method === "PUT") {
      const result = await e.DB.prepare(
        "UPDATE game_documents SET title=?,data=?,gm_secret=?,visibility=?,roles=?,revision=revision+1,updated_at=? WHERE id=? AND campaign_id=? AND revision=?",
      )
        .bind(
          b.title,
          JSON.stringify(b.data),
          c.permissions.includes("edit_materials")
            ? b.secret
            : old?.gm_secret || "",
          b.visibility,
          JSON.stringify(b.roles),
          at,
          id,
          c.id,
          b.revision || 0,
        )
        .run();
      if (!result.meta.changes)
        throw new AccessError(
          409,
          "Запись изменилась. Обновите перед сохранением.",
        );
      return json({ ok: true });
    }
  }
  if (kind === "log") {
    if (method === "GET")
      return json(
        await all(
          e,
          "SELECT * FROM game_log WHERE campaign_id=? AND (visibility='shared' OR user_id=?) ORDER BY created_at DESC LIMIT 500",
          c.id,
          u.id,
        ),
      );
    if (method === "POST") {
      const b = z
        .object({
          kind: z.enum([
            "roll",
            "event",
            "decision",
            "combat",
            "safety",
            "note",
          ]),
          text: z.string().trim().min(1).max(4000),
          visibility: z.enum(["private", "shared"]).default("private"),
          sessionId: z.string().nullable().default(null),
        })
        .parse(await body());
      if (
        b.visibility === "shared" &&
        !c.permissions.includes("write_shared_notes")
      )
        throw new AccessError(403, "Нет права писать в общий журнал");
      if (
        b.sessionId &&
        !(await one(
          e,
          "SELECT id FROM sessions WHERE id=? AND campaign_id=?",
          b.sessionId,
          c.id,
        ))
      )
        throw new AccessError(400, "Встреча принадлежит другой игре");
      const lid = crypto.randomUUID();
      await e.DB.prepare(
        "INSERT INTO game_log(id,campaign_id,session_id,user_id,user_name,kind,text,visibility,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      )
        .bind(
          lid,
          c.id,
          b.sessionId,
          u.id,
          u.name,
          b.kind,
          b.text,
          b.visibility,
          new Date().toISOString(),
        )
        .run();
      return json({ id: lid }, 201);
    }
  }
  if (kind === "rules-config") {
    if (method === "GET") return json(JSON.parse(c.rules_config));
    await getCampaign(e, c.id, u, "manage_rules");
    const b = rulesConfig.parse(await body());
    await e.DB.prepare("UPDATE campaigns SET rules_config=? WHERE id=?")
      .bind(JSON.stringify(b), c.id)
      .run();
    return json(b);
  }
  throw new AccessError(405, "Метод не поддерживается");
}

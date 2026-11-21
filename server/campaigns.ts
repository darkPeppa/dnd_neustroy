import { z } from "zod";
import type { Env } from "./index";
type User = { id: string; name: string };
export const permissionIds = [
  "view_materials",
  "edit_materials",
  "manage_members",
  "manage_sessions",
  "write_shared_notes",
  "publish_campaign",
  "manage_rules",
] as const;
export const defaultRoles = {
  gm: { name: "Мастер", permissions: [...permissionIds] },
  player: {
    name: "Игрок",
    permissions: ["view_materials", "write_shared_notes"],
  },
  observer: { name: "Наблюдатель", permissions: ["view_materials"] },
};
export class AccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const deny = (status: number, message: string): never => {
  throw new AccessError(status, message);
};
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
const run = (e: Env, sql: string, ...p: unknown[]) =>
  e.DB.prepare(sql)
    .bind(...p)
    .run();
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const list = (s: string) => JSON.parse(s || "[]") as string[];
const title = z.string().trim().min(1).max(120);
const ids = z.array(z.string().min(1).max(120)).max(50);
export type CampaignAccess = Record<string, any> & {
  permissions: string[];
  role_id: string;
};
export async function getCampaign(
  e: Env,
  id: string,
  u: User,
  permission?: string,
): Promise<CampaignAccess> {
  const c = await one(
    e,
    "SELECT c.*,m.role_id FROM campaigns c JOIN members m ON m.campaign_id=c.id WHERE c.id=? AND m.user_id=?",
    id,
    u.id,
  );
  if (!c) return deny(404, "Кампания не найдена");
  const role = await one(
    e,
    "SELECT permissions FROM campaign_roles WHERE campaign_id=? AND id=?",
    id,
    c.role_id,
  );
  const permissions =
    c.owner_id === u.id
      ? [...permissionIds]
      : role
        ? list(role.permissions)
        : defaultRoles[c.role_id as keyof typeof defaultRoles]?.permissions ||
          [];
  if (permission && !permissions.includes(permission))
    deny(403, "Недостаточно прав в этой игре");
  return { ...c, role_id: String(c.role_id), permissions };
}
export async function folderVisible(
  e: Env,
  c: CampaignAccess,
  u: User,
  id: string | null,
) {
  if (!id || c.owner_id === u.id || c.permissions.includes("edit_materials"))
    return true;
  const visited = new Set<string>();
  let next: string | null = id;
  while (next) {
    if (visited.has(next) || visited.size >= 128) return false;
    visited.add(next);
    const f = await one(
      e,
      "SELECT * FROM folders WHERE id=? AND campaign_id=?",
      next,
      c.id,
    );
    if (!f) return false;
    const roles = list(f.visible_roles),
      recipients = list(f.recipients);
    if (
      (roles.length || recipients.length) &&
      !roles.includes(c.role_id) &&
      !recipients.includes(u.id)
    )
      return false;
    next = f.parent_id;
  }
  return true;
}
export async function materialVisible(
  e: Env,
  c: CampaignAccess,
  u: User,
  row: Record<string, any>,
) {
  if (c.owner_id === u.id || c.permissions.includes("edit_materials"))
    return true;
  if (!(await folderVisible(e, c, u, row.folder_id))) return false;
  return (
    list(row.recipients).includes(u.id) ||
    (!!row.revealed &&
      c.permissions.includes("view_materials") &&
      (!list(row.visible_roles).length ||
        list(row.visible_roles).includes(c.role_id)))
  );
}
export async function validFolder(
  e: Env,
  campaignId: string,
  folderId: string | null,
) {
  if (
    folderId &&
    !(await one(
      e,
      "SELECT id FROM folders WHERE id=? AND campaign_id=?",
      folderId,
      campaignId,
    ))
  )
    deny(400, "Папка принадлежит другой игре");
}
const noteSchema = z.object({
  title,
  body: z.string().max(20000),
  visibility: z.enum(["private", "shared"]),
  folderId: z.string().nullable().default(null),
  sessionId: z.string().nullable().default(null),
  links: ids.default([]),
  revision: z.number().int().positive().optional(),
});
const folderSchema = z.object({
  name: title,
  parentId: z.string().nullable().default(null),
  position: z.number().int().min(0).max(100000).default(0),
  roles: ids.default([]),
  recipients: ids.default([]),
});
export async function campaignRoutes(
  r: Request,
  e: Env,
  u: User,
  p: string[],
  body: () => Promise<unknown>,
): Promise<Response> {
  const method = r.method,
    id = p[1],
    action = p[2],
    item = p[3];
  if (!id && method === "GET") {
    const rows = await all(
      e,
      "SELECT c.*,m.role_id FROM campaigns c JOIN members m ON m.campaign_id=c.id WHERE m.user_id=?",
      u.id,
    );
    return json(
      await Promise.all(
        rows.map(async (row) => {
          const c = await getCampaign(e, row.id, u);
          return {
            ...c,
            invite: c.permissions.includes("manage_members") ? c.invite : null,
          };
        }),
      ),
    );
  }
  if (!id && method === "POST") {
    const b = z.object({ name: title }).parse(await body()),
      cid = crypto.randomUUID();
    await e.DB.batch([
      e.DB.prepare(
        "INSERT INTO campaigns(id,owner_id,name,invite) VALUES(?,?,?,?)",
      ).bind(cid, u.id, b.name, crypto.randomUUID()),
      e.DB.prepare(
        "INSERT INTO members(campaign_id,user_id,name,role_id) VALUES(?,?,?,'gm')",
      ).bind(cid, u.id, u.name),
    ]);
    return json({ id: cid }, 201);
  }
  if (id === "discover" && method === "GET")
    return json(
      await all(
        e,
        "SELECT id,name,description FROM campaigns WHERE visibility='public' ORDER BY name LIMIT 100",
      ),
    );
  if (id === "join" && method === "POST") {
    const b = z.object({ invite: title }).parse(await body()),
      c = await one(e, "SELECT id FROM campaigns WHERE invite=?", b.invite);
    if (!c) deny(404, "Код приглашения не найден");
    await run(
      e,
      "INSERT OR IGNORE INTO members(campaign_id,user_id,name,role_id) VALUES(?,?,?,'player')",
      c!.id,
      u.id,
      u.name,
    );
    return json({ id: c!.id });
  }
  if (action === "join-public" && method === "POST") {
    const c = await one(
      e,
      "SELECT id FROM campaigns WHERE id=? AND visibility='public'",
      id,
    );
    if (!c) deny(404, "Игра не открыта");
    await run(
      e,
      "INSERT OR IGNORE INTO members(campaign_id,user_id,name,role_id) VALUES(?,?,?,'observer')",
      id,
      u.id,
      u.name,
    );
    return json({ id });
  }
  const c = await getCampaign(e, id, u);
  if (!action && method === "PATCH") {
    await getCampaign(e, id, u, "publish_campaign");
    const b = z
      .object({
        name: title,
        description: z.string().max(5000),
        visibility: z.enum(["private", "public"]),
      })
      .parse(await body());
    await run(
      e,
      "UPDATE campaigns SET name=?,description=?,visibility=? WHERE id=?",
      b.name,
      b.description,
      b.visibility,
      id,
    );
    return json({ ok: true });
  }
  if (action === "invite" && method === "POST") {
    await getCampaign(e, id, u, "manage_members");
    const invite = crypto.randomUUID();
    await run(e, "UPDATE campaigns SET invite=? WHERE id=?", invite, id);
    return json({ invite });
  }
  if (action === "roles") {
    if (method === "GET") {
      const custom = await all(
        e,
        "SELECT id,name,permissions FROM campaign_roles WHERE campaign_id=?",
        id,
      );
      const result = new Map(
        Object.entries(defaultRoles).map(([id, v]) => [id, { id, ...v }]),
      );
      for (const row of custom)
        result.set(row.id, {
          id: row.id,
          name: row.name,
          permissions: list(row.permissions),
        });
      return json([...result.values()]);
    }
    if (c.owner_id !== u.id) deny(403, "Роли настраивает владелец игры");
    const b = z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
        name: title,
        permissions: z.array(z.enum(permissionIds)).max(permissionIds.length),
      })
      .parse(await body());
    if (b.id === "gm") deny(400, "Роль мастера защищена");
    await run(
      e,
      "INSERT INTO campaign_roles(campaign_id,id,name,permissions) VALUES(?,?,?,?) ON CONFLICT(campaign_id,id) DO UPDATE SET name=excluded.name,permissions=excluded.permissions",
      id,
      b.id,
      b.name,
      JSON.stringify([...new Set(b.permissions)]),
    );
    return json({ ok: true });
  }
  if (action === "members") {
    if (method === "GET")
      return json(
        await all(
          e,
          "SELECT user_id,name,role_id FROM members WHERE campaign_id=?",
          id,
        ),
      );
    await getCampaign(e, id, u, "manage_members");
    const b = z.object({ roleId: title }).parse(await body());
    const role = await one(
      e,
      "SELECT permissions FROM campaign_roles WHERE campaign_id=? AND id=?",
      id,
      b.roleId,
    );
    const permissions = role
      ? list(role.permissions)
      : defaultRoles[b.roleId as keyof typeof defaultRoles]?.permissions;
    if (!permissions) deny(400, "Роль не найдена");
    if (item === c.owner_id) deny(400, "Роль владельца игры защищена");
    if (
      c.owner_id !== u.id &&
      (b.roleId === "gm" ||
        permissions!.some((x) => !c.permissions.includes(x)))
    )
      deny(403, "Нельзя передать больше прав, чем у вас");
    await run(
      e,
      "UPDATE members SET role_id=? WHERE campaign_id=? AND user_id=?",
      b.roleId,
      id,
      item,
    );
    return json({ ok: true });
  }
  if (action === "folders") {
    if (method === "GET") {
      const rows = await all(
        e,
        "SELECT * FROM folders WHERE campaign_id=? ORDER BY position,name",
        id,
      );
      const visible = [];
      for (const f of rows)
        if (await folderVisible(e, c, u, f.id))
          visible.push({
            ...f,
            roles: list(f.visible_roles),
            recipients: list(f.recipients),
          });
      return json(visible);
    }
    await getCampaign(e, id, u, "edit_materials");
    if (item === "organize" && method === "POST") {
      for (const [name, kind] of [
        ["Улики", "note"],
        ["Переписки", "chat"],
        ["Изображения", "photo"],
        ["Журнал", "journal"],
      ]) {
        let folder = await one(
          e,
          "SELECT id FROM folders WHERE campaign_id=? AND parent_id IS NULL AND name=?",
          id,
          name,
        );
        if (!folder) {
          folder = { id: crypto.randomUUID() };
          await run(
            e,
            "INSERT INTO folders(id,campaign_id,name) VALUES(?,?,?)",
            folder.id,
            id,
            name,
          );
        }
        if (kind === "journal")
          await run(
            e,
            "UPDATE notes SET folder_id=? WHERE campaign_id=? AND visibility='shared' AND folder_id IS NULL",
            folder.id,
            id,
          );
        else
          await run(
            e,
            "UPDATE clues SET folder_id=? WHERE campaign_id=? AND kind=? AND folder_id IS NULL",
            folder.id,
            id,
            kind,
          );
      }
      return json({ ok: true });
    }
    if (!["POST", "PATCH"].includes(method))
      return deny(405, "Метод не поддерживается");
    const b = folderSchema.parse(await body());
    await validFolder(e, id, b.parentId);
    if (method === "POST") {
      const fid = crypto.randomUUID();
      await run(
        e,
        "INSERT INTO folders(id,campaign_id,parent_id,name,position,visible_roles,recipients) VALUES(?,?,?,?,?,?,?)",
        fid,
        id,
        b.parentId,
        b.name,
        b.position,
        JSON.stringify(b.roles),
        JSON.stringify(b.recipients),
      );
      return json({ id: fid }, 201);
    }
    await validFolder(e, id, item);
    let parent = b.parentId;
    const visited = new Set<string>();
    while (parent) {
      if (parent === item || visited.has(parent) || visited.size >= 128)
        deny(400, "Папка не может содержать саму себя");
      visited.add(parent);
      parent = (
        await one(
          e,
          "SELECT parent_id FROM folders WHERE id=? AND campaign_id=?",
          parent,
          id,
        )
      )?.parent_id;
    }
    await run(
      e,
      "UPDATE folders SET parent_id=?,name=?,position=?,visible_roles=?,recipients=? WHERE id=? AND campaign_id=?",
      b.parentId,
      b.name,
      b.position,
      JSON.stringify(b.roles),
      JSON.stringify(b.recipients),
      item,
      id,
    );
    return json({ ok: true });
  }
  if (action === "notes") {
    const readable = async (n: Record<string, any>) =>
      n.user_id === u.id ||
      (n.visibility === "shared" &&
        c.permissions.includes("view_materials") &&
        (await folderVisible(e, c, u, n.folder_id)));
    if (method === "GET") {
      const visible = [];
      for (const n of await all(
        e,
        "SELECT * FROM notes WHERE campaign_id=? ORDER BY updated_at DESC",
        id,
      ))
        if (await readable(n)) visible.push({ ...n, links: list(n.links) });
      return json(visible);
    }
    const old = item
      ? await one(
          e,
          "SELECT * FROM notes WHERE id=? AND campaign_id=?",
          item,
          id,
        )
      : null;
    if (item && (!old || !(await readable(old))))
      deny(404, "Заметка не найдена");
    if (
      old &&
      old.user_id !== u.id &&
      !c.permissions.includes("edit_materials")
    )
      deny(403, "Эту заметку редактирует автор или мастер");
    if (method === "DELETE") {
      await run(e, "DELETE FROM notes WHERE id=? AND campaign_id=?", item, id);
      return json({ ok: true });
    }
    const b = noteSchema.parse(await body());
    if (
      b.visibility === "shared" &&
      !c.permissions.includes("write_shared_notes")
    )
      deny(403, "Нет права публиковать общие заметки");
    if (old && old.user_id !== u.id && b.visibility === "private")
      deny(403, "Нельзя сделать чужую заметку приватной");
    await validFolder(e, id, b.folderId);
    if (!(await folderVisible(e, c, u, b.folderId)))
      deny(403, "Нет доступа к папке");
    if (
      b.sessionId &&
      !(await one(
        e,
        "SELECT id FROM sessions WHERE id=? AND campaign_id=?",
        b.sessionId,
        id,
      ))
    )
      deny(400, "Сессия принадлежит другой игре");
    for (const link of b.links) {
      const n = await one(
        e,
        "SELECT * FROM notes WHERE id=? AND campaign_id=?",
        link,
        id,
      );
      const material = await one(
        e,
        "SELECT * FROM clues WHERE id=? AND campaign_id=?",
        link,
        id,
      );
      if (
        (n && !(await readable(n))) ||
        (material && !(await materialVisible(e, c, u, material))) ||
        (!n && !material)
      )
        deny(400, "Ссылка недоступна в этой игре");
      if (b.visibility === "shared" && n?.visibility === "private")
        deny(400, "Общая заметка не должна ссылаться на приватную");
    }
    const at = new Date().toISOString();
    if (method === "POST") {
      const nid = crypto.randomUUID();
      await run(
        e,
        "INSERT INTO notes(id,campaign_id,user_id,author_name,title,body,visibility,folder_id,session_id,links,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        nid,
        id,
        u.id,
        u.name,
        b.title,
        b.body,
        b.visibility,
        b.folderId,
        b.sessionId,
        JSON.stringify(b.links),
        at,
        at,
      );
      return json({ id: nid }, 201);
    }
    if (method === "PUT") {
      const result = await run(
        e,
        "UPDATE notes SET title=?,body=?,visibility=?,folder_id=?,session_id=?,links=?,updated_at=?,revision=revision+1 WHERE id=? AND campaign_id=? AND revision=?",
        b.title,
        b.body,
        b.visibility,
        b.folderId,
        b.sessionId,
        JSON.stringify(b.links),
        at,
        item,
        id,
        b.revision || 0,
      );
      if (!result.meta.changes)
        deny(409, "Заметка изменилась. Обновите журнал перед сохранением.");
      return json({ ok: true });
    }
  }
  return deny(404, "Маршрут не найден");
}

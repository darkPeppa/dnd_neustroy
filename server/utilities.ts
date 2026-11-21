import { z } from "zod";
import { getCampaign, AccessError, permissionIds } from "./campaigns";
import { digest } from "./crypto";
import { readJson } from "./http";
import type { Env } from "./index";
import QR from "qrcode/lib/core/qrcode.js";
type User = { id: string; name: string };
type Invoke = (path: string, method?: string, data?: unknown) => Promise<any>;
const reply = (v: unknown, status = 200) =>
  Response.json(v, { status, headers: { "Cache-Control": "no-store" } });
const rows = async (e: Env, sql: string, ...p: unknown[]) =>
  (
    await e.DB.prepare(sql)
      .bind(...p)
      .all<Record<string, any>>()
  ).results;
export async function guestJoin(r: Request, e: Env) {
  const b = z
    .object({
      code: z.string().regex(/^[a-f0-9]{64}$/),
      name: z.string().trim().min(1).max(80),
    })
    .parse(await readJson(r, 4000));
  const hash = await digest(b.code),
    now = new Date().toISOString();
  const link = await e.DB.prepare(
    "UPDATE guest_links SET uses=uses+1 WHERE hash=? AND expires>? AND uses<max_uses RETURNING campaign_id,role_id,expires",
  )
    .bind(hash, now)
    .first<{ campaign_id: string; role_id: string; expires: string }>();
  if (!link) throw new AccessError(410, "Приглашение истекло или отозвано");
  const uid = "guest:" + crypto.randomUUID(),
    token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = await digest(token);
  await e.DB.batch([
    e.DB.prepare(
      "INSERT INTO members(campaign_id,user_id,name,role_id) VALUES(?,?,?,?)",
    ).bind(link.campaign_id, uid, b.name, link.role_id),
    e.DB.prepare(
      "INSERT INTO native_tokens(hash,user_id,name,expires,origin) VALUES(?,?,?,?,'guest')",
    ).bind(tokenHash, uid, b.name, link.expires),
    e.DB.prepare(
      "INSERT INTO guest_sessions(link_hash,token_hash,user_id) VALUES(?,?,?)",
    ).bind(hash, tokenHash, uid),
  ]);
  return reply(
    { token, campaignId: link.campaign_id, expires: link.expires },
    201,
  );
}
export function commonTimes(
  slots: { user_id: string; start: string; end: string }[],
  duration: number,
) {
  const users = [...new Set(slots.map((s) => s.user_id))];
  const points = [...new Set(slots.flatMap((s) => [s.start, s.end]))].sort();
  const result: { start: string; end: string }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const start = points[i],
      end = points[i + 1];
    if (
      users.length &&
      users.every((u) =>
        slots.some((s) => s.user_id === u && s.start <= start && s.end >= end),
      )
    ) {
      const last = result.at(-1);
      if (last?.end === start) last.end = end;
      else result.push({ start, end });
    }
  }
  return result.filter(
    (s) => Date.parse(s.end) - Date.parse(s.start) >= duration * 60000,
  );
}
export async function campaignUtilities(
  r: Request,
  e: Env,
  u: User,
  p: string[],
  invoke: Invoke,
) {
  const id = p[1],
    action = p[2],
    c = await getCampaign(e, id, u),
    method = r.method;
  if (action === "guest-links") {
    await getCampaign(e, id, u, "manage_members");
    if (method === "GET")
      return reply(
        await rows(
          e,
          "SELECT hash,role_id,expires,uses,max_uses FROM guest_links WHERE campaign_id=? AND expires>?",
          id,
          new Date().toISOString(),
        ),
      );
    if (method === "DELETE") {
      await e.DB.batch([
        e.DB.prepare(
          "DELETE FROM native_tokens WHERE hash IN (SELECT token_hash FROM guest_sessions WHERE link_hash IN (SELECT hash FROM guest_links WHERE campaign_id=? AND hash=?))",
        ).bind(id, p[3]),
        e.DB.prepare(
          "DELETE FROM members WHERE campaign_id=? AND user_id IN (SELECT user_id FROM guest_sessions WHERE link_hash=?)",
        ).bind(id, p[3]),
        e.DB.prepare(
          "DELETE FROM guest_sessions WHERE link_hash IN (SELECT hash FROM guest_links WHERE campaign_id=? AND hash=?)",
        ).bind(id, p[3]),
        e.DB.prepare(
          "DELETE FROM guest_links WHERE campaign_id=? AND hash=?",
        ).bind(id, p[3]),
      ]);
      return reply({ ok: true });
    }
    if (method === "POST") {
      const b = z
        .object({
          hours: z.number().int().min(1).max(168).default(24),
          maxUses: z.number().int().min(1).max(50).default(6),
          role: z.enum(["player", "observer"]).default("observer"),
        })
        .parse(await readJson(r, 4000));
      const code = Array.from(crypto.getRandomValues(new Uint8Array(32)), (x) =>
        x.toString(16).padStart(2, "0"),
      ).join("");
      const expires = new Date(Date.now() + b.hours * 3600000).toISOString();
      await e.DB.prepare(
        "INSERT INTO guest_links(hash,campaign_id,role_id,expires,max_uses,created_by) VALUES(?,?,?,?,?,?)",
      )
        .bind(await digest(code), id, b.role, expires, b.maxUses, u.id)
        .run();
      const url = new URL(e.PUBLIC_APP_URL || r.url);
      url.pathname = "/";
      url.search = "";
      url.hash = "guest=" + code;
      const qr = QR.create(url.toString(), {
        errorCorrectionLevel: "M",
      }).modules;
      return reply(
        {
          code,
          url: url.toString(),
          expires,
          qr: { size: qr.size, data: Array.from(qr.data) },
        },
        201,
      );
    }
  }
  if (action === "time-slots") {
    if (method === "GET") {
      const slots = await rows(
        e,
        "SELECT * FROM time_slots WHERE campaign_id=? AND end>? ORDER BY start",
        id,
        new Date().toISOString(),
      );
      const duration = Math.min(
        480,
        Math.max(30, Number(new URL(r.url).searchParams.get("minutes")) || 120),
      );
      return reply({
        slots,
        common: commonTimes(slots as any, duration),
        minutes: duration,
      });
    }
    if (method === "POST") {
      const b = z
        .object({
          start: z.iso.datetime(),
          end: z.iso.datetime(),
          timezone: z.string().max(80),
        })
        .parse(await readJson(r, 4000));
      if (
        b.end <= b.start ||
        Date.parse(b.end) - Date.parse(b.start) > 7 * 86400000
      )
        throw new AccessError(
          400,
          "Окно времени должно быть от 1 минуты до 7 дней",
        );
      try {
        new Intl.DateTimeFormat("ru", { timeZone: b.timezone });
      } catch {
        throw new AccessError(400, "Неизвестный часовой пояс");
      }
      if (
        (
          await rows(
            e,
            "SELECT id FROM time_slots WHERE campaign_id=? AND user_id=?",
            id,
            u.id,
          )
        ).length >= 100
      )
        throw new AccessError(400, "Максимум 100 окон времени");
      await e.DB.prepare(
        "INSERT INTO time_slots(id,campaign_id,user_id,name,start,end,timezone) VALUES(?,?,?,?,?,?,?)",
      )
        .bind(crypto.randomUUID(), id, u.id, u.name, b.start, b.end, b.timezone)
        .run();
      return reply({ ok: true }, 201);
    }
    if (method === "DELETE") {
      await e.DB.prepare(
        "DELETE FROM time_slots WHERE campaign_id=? AND id=? AND user_id=?",
      )
        .bind(id, p[3], u.id)
        .run();
      return reply({ ok: true });
    }
  }
  if (action === "search" && method === "GET") {
    const query = (new URL(r.url).searchParams.get("q") || "")
      .trim()
      .toLocaleLowerCase()
      .slice(0, 120);
    if (query.length < 2) return reply([]);
    const [notes, clues, docs, log] = await Promise.all([
      invoke(`campaigns/${id}/notes`),
      invoke(`clues?campaign=${id}`),
      invoke(`campaigns/${id}/documents`),
      invoke(`campaigns/${id}/log`),
    ]);
    const index = new Map(
      (
        await rows(
          e,
          "SELECT clue_id,text FROM clue_text WHERE clue_id IN (SELECT id FROM clues WHERE campaign_id=?)",
          id,
        )
      ).map((t) => [t.clue_id, t.text]),
    );
    const found: unknown[] = [];
    for (const [kind, list] of [
      ["note", notes],
      ["material", clues],
      ["document", docs],
      ["log", log],
    ] as const)
      for (const row of list) {
        const text = [
          row.title,
          row.body,
          row.text,
          JSON.stringify(row.data || ""),
          kind === "material" ? index.get(row.id) : "",
        ]
          .filter(Boolean)
          .join("\n");
        const offset = text.toLocaleLowerCase().indexOf(query);
        if (offset >= 0)
          found.push({
            id: row.id,
            kind,
            title: row.title || row.kind || "Запись",
            snippet: text.slice(Math.max(0, offset - 60), offset + 200),
          });
      }
    return reply(found.slice(0, 100));
  }
  if (action === "backup" && method === "GET") {
    if (c.owner_id !== u.id)
      throw new AccessError(403, "Копию кампании выгружает её владелец");
    const [folders, roles, notes, documents, log, clues, sessions] =
      await Promise.all([
        invoke(`campaigns/${id}/folders`),
        invoke(`campaigns/${id}/roles`),
        invoke(`campaigns/${id}/notes`),
        invoke(`campaigns/${id}/documents`),
        invoke(`campaigns/${id}/log`),
        invoke(`clues?campaign=${id}`),
        invoke("sessions"),
      ]);
    let size = 0;
    for (const clue of clues)
      if (clue.file_key) {
        const file = await e.BUCKET.get(clue.file_key);
        if (!file)
          throw new AccessError(409, "Не найден файл материала: " + clue.title);
        const bytes = new Uint8Array(
          await new Response(file.body).arrayBuffer(),
        );
        size += bytes.byteLength;
        if (size > 25 * 1024 * 1024)
          throw new AccessError(
            413,
            "Для копии через приложение максимум 25 МБ вложений; используйте копию папки данных сервера",
          );
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        clue.file = btoa(binary);
      }
    return reply({
      format: "neustroy-campaign",
      version: 1,
      createdAt: new Date().toISOString(),
      scope:
        "Доступные владельцу материалы, общие и его личные записи. Чужие личные заметки, личные чаты и аккаунты не включаются.",
      campaign: {
        name: c.name,
        description: c.description,
        rules: JSON.parse(c.rules_config),
      },
      folders,
      roles,
      notes,
      documents,
      log,
      clues,
      sessions: sessions.filter((s: any) => s.campaign_id === id),
    });
  }
  throw new AccessError(405, "Метод не поддерживается");
}
const text = z.string().max(40000),
  identifier = z.string().min(1).max(120),
  ids = z.array(identifier).max(50);
const archiveSchema = z.object({
  format: z.literal("neustroy-campaign"),
  version: z.literal(1),
  campaign: z.object({
    name: z.string().min(1).max(120),
    description: z.string().max(5000),
    rules: z.record(z.string(), z.unknown()),
  }),
  folders: z
    .array(
      z.object({
        id: identifier,
        parent_id: identifier.nullable(),
        name: z.string().min(1).max(120),
        position: z.number().int(),
        roles: ids,
        recipients: ids,
      }),
    )
    .max(300),
  roles: z
    .array(
      z.object({
        id: identifier,
        name: z.string().max(120),
        permissions: z.array(z.enum(permissionIds)).max(7),
      }),
    )
    .max(50),
  notes: z
    .array(
      z.object({
        id: identifier,
        user_id: identifier,
        title: z.string().min(1).max(120),
        body: z.string().max(20000),
        visibility: z.enum(["private", "shared"]),
        folder_id: identifier.nullable(),
        session_id: identifier.nullable(),
        links: ids,
      }),
    )
    .max(1000),
  documents: z
    .array(
      z.object({
        id: identifier,
        kind: identifier,
        title: z.string().min(1).max(160),
        data: z.record(z.string(), z.unknown()),
        secret: z.string().max(12000).optional(),
        visibility: z.enum(["private", "shared", "roles"]),
        roles: ids,
      }),
    )
    .max(500),
  clues: z
    .array(
      z.object({
        id: identifier,
        title: z.string().min(1).max(120),
        body: z.string().max(20000),
        kind: z.enum(["note", "chat", "photo", "map"]),
        revealed: z.union([z.boolean(), z.number().int().min(0).max(1)]),
        roles: ids,
        recipients: ids,
        folder_id: identifier.nullable(),
        file: z
          .string()
          .max(7 * 1024 * 1024)
          .optional(),
        mime: z
          .enum([
            "image/png",
            "image/jpeg",
            "image/webp",
            "text/plain",
            "application/pdf",
          ])
          .nullable()
          .optional(),
        file_name: z.string().max(200).nullable().optional(),
      }),
    )
    .max(500),
  log: z
    .array(
      z.object({
        id: identifier,
        kind: identifier,
        text: z.string().max(4000),
        visibility: z.enum(["private", "shared"]),
        created_at: z.string(),
      }),
    )
    .max(500),
  sessions: z
    .array(
      z.object({
        id: identifier,
        title: z.string().max(120),
        start: z.iso.datetime(),
        end: z.iso.datetime(),
        capacity: z.number().int().min(1).max(20),
        description: z.string().max(5000),
      }),
    )
    .max(200),
});
export async function restoreCampaign(r: Request, e: Env, u: User) {
  const b = archiveSchema.parse(await readJson(r, 40 * 1024 * 1024)),
    cid = crypto.randomUUID(),
    at = new Date().toISOString();
  const all = [
    ...b.folders,
    ...b.notes,
    ...b.documents,
    ...b.clues,
    ...b.log,
    ...b.sessions,
  ];
  const mapping = new Map(all.map((x) => [x.id, crypto.randomUUID()]));
  if (mapping.size !== all.length)
    throw new AccessError(400, "Повторяющиеся идентификаторы в копии");
  const mapped = (id: string | null) => (id ? mapping.get(id) || null : null);
  const statements = [
    e.DB.prepare(
      "INSERT INTO campaigns(id,owner_id,name,invite,description,rules_config) VALUES(?,?,?,?,?,?)",
    ).bind(
      cid,
      u.id,
      b.campaign.name + "",
      crypto.randomUUID(),
      b.campaign.description,
      JSON.stringify(b.campaign.rules),
    ),
    e.DB.prepare(
      "INSERT INTO members(campaign_id,user_id,name,role_id) VALUES(?,?,?,'gm')",
    ).bind(cid, u.id, u.name),
  ];
  for (const role of b.roles)
    if (role.id !== "gm")
      statements.push(
        e.DB.prepare(
          "INSERT INTO campaign_roles(campaign_id,id,name,permissions) VALUES(?,?,?,?)",
        ).bind(cid, role.id, role.name, JSON.stringify(role.permissions)),
      );
  const remaining = [...b.folders],
    done = new Set<string>();
  while (remaining.length) {
    const index = remaining.findIndex(
      (f) => !f.parent_id || done.has(f.parent_id),
    );
    if (index < 0)
      throw new AccessError(400, "Цикл или отсутствующая папка в копии");
    const [f] = remaining.splice(index, 1);
    done.add(f.id);
    statements.push(
      e.DB.prepare(
        "INSERT INTO folders(id,campaign_id,parent_id,name,position,visible_roles,recipients) VALUES(?,?,?,?,?,?,?)",
      ).bind(
        mapped(f.id),
        cid,
        mapped(f.parent_id),
        f.name,
        f.position,
        JSON.stringify(f.roles),
        JSON.stringify(f.recipients),
      ),
    );
  }
  for (const s of b.sessions)
    statements.push(
      e.DB.prepare(
        "INSERT INTO sessions(id,campaign_id,owner_id,title,start,end,capacity,description) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        mapped(s.id),
        cid,
        u.id,
        s.title,
        s.start,
        s.end,
        s.capacity,
        s.description,
      ),
    );
  for (const n of b.notes)
    statements.push(
      e.DB.prepare(
        "INSERT INTO notes(id,campaign_id,user_id,author_name,title,body,visibility,folder_id,session_id,links,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        mapped(n.id),
        cid,
        u.id,
        u.name,
        n.title,
        n.body,
        n.visibility,
        mapped(n.folder_id),
        mapped(n.session_id),
        JSON.stringify(n.links.map(mapped).filter(Boolean)),
        at,
        at,
      ),
    );
  for (const d of b.documents)
    statements.push(
      e.DB.prepare(
        "INSERT INTO game_documents(id,campaign_id,user_id,kind,title,data,gm_secret,visibility,roles,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      ).bind(
        mapped(d.id),
        cid,
        u.id,
        d.kind,
        d.title,
        JSON.stringify(d.data),
        d.secret || "",
        d.visibility,
        JSON.stringify(d.roles),
        at,
        at,
      ),
    );
  for (const l of b.log)
    statements.push(
      e.DB.prepare(
        "INSERT INTO game_log(id,campaign_id,user_id,user_name,kind,text,visibility,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).bind(
        mapped(l.id),
        cid,
        u.id,
        u.name,
        l.kind,
        l.text,
        l.visibility,
        l.created_at,
      ),
    );
  const written: string[] = [];
  try {
    let total = 0;
    for (const x of b.clues) {
      const key = x.file ? `clues/${mapped(x.id)}` : null;
      if (x.file && key) {
        const file = Uint8Array.from(atob(x.file), (c) => c.charCodeAt(0));
        total += file.byteLength;
        if (file.byteLength > 5 * 1024 * 1024 || total > 25 * 1024 * 1024)
          throw new AccessError(413, "Слишком много вложений");
        await e.BUCKET.put(key, file, {
          httpMetadata: { contentType: x.mime || "text/plain" },
        });
        written.push(key);
      }
      statements.push(
        e.DB.prepare(
          "INSERT INTO clues(id,campaign_id,title,body,kind,revealed,recipients,visible_roles,folder_id,file_key,file_name,mime) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          mapped(x.id),
          cid,
          x.title,
          x.body,
          x.kind,
          +x.revealed,
          JSON.stringify(x.recipients),
          JSON.stringify(x.roles),
          mapped(x.folder_id),
          key,
          x.file_name || null,
          x.mime || null,
        ),
      );
    }
    await e.DB.batch(statements);
  } catch (error) {
    await Promise.allSettled(written.map((key) => e.BUCKET.delete(key)));
    throw error;
  }
  return reply({ id: cid, name: b.campaign.name }, 201);
}

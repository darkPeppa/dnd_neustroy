import { useEffect, useState } from "react";
import type { AppContext } from "../main";
import { request, upload, downloadClue, clueImageUrl, saveFile } from "../api";
import { Field, Empty, Modal } from "../ui";
import { GameTools } from "./GameTools";
import { CampaignUtilities } from "./CampaignUtilities";
import { AssistantPanel, assistantRequest } from "./Helpers";
type Row = Record<string, any>;
const permissionNames: Record<string, string> = {
  view_materials: "Чтение материалов",
  edit_materials: "Редактор материалов",
  manage_members: "Назначение ролей",
  manage_sessions: "Создание встреч",
  write_shared_notes: "Общие записи",
  publish_campaign: "Открытая игра",
  manage_rules: "Домашние правила и модули",
};
export function GameWorkspace({
  ctx,
  section = "campaigns",
}: {
  ctx: AppContext;
  section?: string;
}) {
  const [games, setGames] = useState<Row[]>([]),
    [cid, setCid] = useState(localStorage.getItem("neustroy-campaign") || ""),
    [tab, setTab] = useState(section),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [invite, setInvite] = useState(""),
    [discover, setDiscover] = useState<Row[]>([]);
  const game = games.find((g) => g.id === cid),
    can = (p: string) =>
      game?.owner_id === ctx.me.user.id || game?.permissions?.includes(p);
  async function load() {
    const rows = await request<Row[]>("campaigns");
    setGames(rows);
    if (!rows.some((r) => r.id === cid)) setCid(rows[0]?.id || "");
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => ctx.toast(e.message, true));
  }, []);
  useEffect(() => {
    setTab(section);
  }, [section]);
  useEffect(() => {
    localStorage.setItem("neustroy-campaign", cid);
  }, [cid]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {section === "chat"
              ? "Чаты"
              : section === "journal"
                ? "Журнал игры"
                : section === "tools"
                  ? "Инструменты партии"
                  : "Кампании"}
          </h1>
          <p>Материалы, записи и доступы вашей игры.</p>
        </div>
        <Field label="Текущая игра">
          <select value={cid} onChange={(e) => setCid(e.target.value)}>
            <option value="">Выберите игру</option>
            {games.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="tabs">
        {[
          ["campaigns", "Игры"],
          ["materials", "Материалы и карты"],
          ["journal", "Записи и лог"],
          ["chat", "Чаты"],
          ["tools", "Инструменты"],
          ["access", "Редактор мастера"],
        ].map(([id, label]) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "campaigns" && (
        <>
          <div className="two-col">
            <section className="card">
              <h2>Создать игру</h2>
              <Field label="Название">
                <input
                  value={name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <button
                disabled={busy || !name.trim()}
                onClick={() =>
                  perform(async () => {
                    const r = await request("campaigns", "POST", { name });
                    await load();
                    setCid(r.id);
                    setName("");
                  })
                }
              >
                Создать
              </button>
            </section>
            <section className="card">
              <h2>Присоединиться</h2>
              <Field label="Приглашение мастера">
                <input
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                />
              </Field>
              <button
                disabled={busy || !invite}
                onClick={() =>
                  perform(async () => {
                    const r = await request("campaigns/join", "POST", {
                      invite,
                    });
                    await load();
                    setCid(r.id);
                  })
                }
              >
                Вступить
              </button>
            </section>
          </div>
          <div className="card">
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                perform(async () =>
                  setDiscover(await request("campaigns/discover")),
                )
              }
            >
              Найти открытые игры
            </button>
            {discover.map((g) => (
              <div className="line-item" key={g.id}>
                <div>
                  <h3>{g.name}</h3>
                  <p>{g.description}</p>
                </div>
                <button
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      await request(`campaigns/${g.id}/join-public`, "POST");
                      await load();
                      setCid(g.id);
                    })
                  }
                >
                  Присоединиться
                </button>
              </div>
            ))}
          </div>
          {games.map((g) => (
            <section className="card" key={g.id}>
              <h2>{g.name}</h2>
              <p>{g.description}</p>
              <p>
                {g.visibility === "public" ? "Открытая игра" : "По приглашению"}{" "}
                · {g.role_id}
              </p>
              {g.invite && (
                <p>
                  Приглашение: <code>{g.invite}</code>
                </p>
              )}
              <button
                className="ghost"
                onClick={() => {
                  setCid(g.id);
                  setTab("materials");
                }}
              >
                Открыть игру
              </button>
            </section>
          ))}
        </>
      )}
      {cid && game && (
        <CampaignUtilities key={cid} cid={cid} game={game} ctx={ctx} />
      )}
      {!cid && tab !== "campaigns" ? (
        <Empty
          title="Выберите игру"
          text="Создайте кампанию или присоединитесь по приглашению."
        />
      ) : (
        <>
          {tab === "materials" && (
            <Materials
              key={cid}
              cid={cid}
              canEdit={can("edit_materials")}
              ctx={ctx}
            />
          )}
          {tab === "journal" && (
            <Journal
              key={cid}
              cid={cid}
              canEdit={can("edit_materials")}
              userId={ctx.me.user.id}
              ctx={ctx}
            />
          )}
          {tab === "chat" && (
            <Chat key={cid} cid={cid} userId={ctx.me.user.id} ctx={ctx} />
          )}
          {tab === "access" && game && (
            <Access
              key={cid}
              game={game}
              userId={ctx.me.user.id}
              ctx={ctx}
              refresh={load}
            />
          )}
          {tab === "tools" && game && (
            <GameTools cid={cid} game={game} ctx={ctx} />
          )}
        </>
      )}
    </>
  );
}
function Materials({
  cid,
  canEdit,
  ctx,
}: {
  cid: string;
  canEdit: boolean;
  ctx: AppContext;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [folders, setFolders] = useState<Row[]>([]),
    [roles, setRoles] = useState<Row[]>([]),
    [members, setMembers] = useState<Row[]>([]),
    [folder, setFolder] = useState(""),
    [edit, setEdit] = useState<Row>(),
    [file, setFile] = useState<File>(),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<{ url: string; name: string }>(),
    [newFolder, setNewFolder] = useState(""),
    [folderEdit, setFolderEdit] = useState<Row>();
  async function load() {
    const [clues, fs, rs, ms] = await Promise.all([
      request("clues?campaign=" + cid),
      request(`campaigns/${cid}/folders`),
      request(`campaigns/${cid}/roles`),
      request(`campaigns/${cid}/members`),
    ]);
    setRows(clues);
    setFolders(fs);
    setRoles(rs);
    setMembers(ms);
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => ctx.toast(e.message, true));
  }, [cid]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  const folderOptions = (
    <>
      <option value="">Без папки</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </>
  );
  return (
    <>
      <div className="row wrap">
        <Field label="Папка">
          <select value={folder} onChange={(e) => setFolder(e.target.value)}>
            <option value="">Все материалы</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        {canEdit && (
          <>
            <button
              disabled={busy}
              onClick={() => {
                setEdit({
                  title: "",
                  body: "",
                  kind: "note",
                  revealed: false,
                  recipients: [],
                  roles: [],
                  folderId: folder || null,
                });
                setFile(undefined);
              }}
            >
              Добавить материал
            </button>
            <button
              className="ghost"
              disabled={busy}
              onClick={() =>
                perform(() =>
                  request(`campaigns/${cid}/folders/organize`, "POST"),
                )
              }
            >
              Разложить по папкам
            </button>
            <button
              className="ghost"
              disabled={!folder}
              onClick={() => {
                const f = folders.find((x) => x.id === folder);
                if (f) setFolderEdit({ ...f, parentId: f.parent_id });
              }}
            >
              Настроить папку
            </button>
          </>
        )}
      </div>
      {canEdit && (
        <div className="row wrap">
          <Field label="Новая папка">
            <input
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
            />
          </Field>
          <button
            className="ghost"
            disabled={busy || !newFolder.trim()}
            onClick={() =>
              perform(async () => {
                await request(`campaigns/${cid}/folders`, "POST", {
                  name: newFolder,
                  parentId: folder || null,
                  roles: [],
                  recipients: [],
                });
                setNewFolder("");
              })
            }
          >
            Создать папку
          </button>
        </div>
      )}
      {rows
        .filter((r) => !folder || r.folder_id === folder)
        .map((r) => (
          <article className="card" key={r.id}>
            <div className="row between">
              <h2>{r.title}</h2>
              <span className="badge">
                {r.revealed ? "Открыт по ролям" : "Закрыт"}
              </span>
            </div>
            <p className="rule-description">{r.body}</p>
            {/^https:\/\//.test(r.body.trim()) && (
              <a
                className="button ghost"
                href={r.body.trim()}
                target="_blank"
                rel="noreferrer"
              >
                Открыть ссылку на карту
              </a>
            )}
            {r.file_key && (
              <div className="row wrap">
                {r.mime?.startsWith("image/") && (
                  <button
                    className="ghost"
                    onClick={() =>
                      perform(async () =>
                        setPreview({
                          url: await clueImageUrl(r.id),
                          name: r.title,
                        }),
                      )
                    }
                  >
                    Посмотреть
                  </button>
                )}
                <button
                  className="ghost"
                  onClick={() =>
                    perform(() => downloadClue(r.id, r.file_name || "Материал"))
                  }
                >
                  Скачать файл
                </button>
              </div>
            )}
            {canEdit && (
              <div className="row wrap">
                <button
                  className="ghost"
                  onClick={() => {
                    setEdit({ ...r, folderId: r.folder_id });
                    setFile(undefined);
                  }}
                >
                  Редактор и доступ
                </button>
                <button
                  className="danger ghost"
                  onClick={() =>
                    perform(() => request(`clues/${r.id}`, "DELETE"))
                  }
                >
                  Удалить
                </button>
              </div>
            )}
          </article>
        ))}
      {preview && (
        <Modal title={preview.name} onClose={() => setPreview(undefined)}>
          <img
            className="material-preview"
            src={preview.url}
            alt={preview.name}
          />
        </Modal>
      )}
      {edit && (
        <Modal
          title={edit.id ? "Редактировать материал" : "Новый материал"}
          onClose={() => setEdit(undefined)}
        >
          <Field label="Название">
            <input
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
            />
          </Field>
          <Field label="Тип">
            <select
              disabled={!!edit.id}
              value={edit.kind}
              onChange={(e) => setEdit({ ...edit, kind: e.target.value })}
            >
              {[
                ["note", "Улика / текст"],
                ["chat", "Переписка из сюжета"],
                ["photo", "Изображение"],
                ["map", "Карта"],
              ].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Содержимое или HTTPS-ссылка">
            <textarea
              rows={7}
              value={edit.body}
              onChange={(e) => setEdit({ ...edit, body: e.target.value })}
            />
          </Field>
          <Field label="Папка">
            <select
              value={edit.folderId || ""}
              onChange={(e) =>
                setEdit({ ...edit, folderId: e.target.value || null })
              }
            >
              {folderOptions}
            </select>
          </Field>
          <label className="check-line">
            <input
              type="checkbox"
              checked={!!edit.revealed}
              onChange={(e) => setEdit({ ...edit, revealed: e.target.checked })}
            />
            Открыть участникам выбранных ролей
          </label>
          <Audience
            roles={roles}
            members={members}
            value={edit}
            change={setEdit}
          />
          <Field label="Файл до 5 МБ · JPG, PNG, WebP, PDF, TXT">
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"
              onChange={(e) => setFile(e.target.files?.[0])}
            />
          </Field>
          {edit.kind === "map" && (
            <button
              className="ghost"
              disabled={busy || !edit.body.trim()}
              onClick={() =>
                perform(async () => {
                  const image = await assistantRequest({
                    action: "map",
                    prompt: edit.body,
                    campaignId: cid,
                  });
                  const bytes = Uint8Array.from(atob(image.base64), (c) =>
                    c.charCodeAt(0),
                  );
                  setFile(new File([bytes], "map.png", { type: image.mime }));
                  ctx.toast(
                    "Карта подготовлена. Проверьте изображение перед сохранением.",
                  );
                  setPreview({
                    url: URL.createObjectURL(
                      new Blob([bytes], { type: image.mime }),
                    ),
                    name: "Карта · предпросмотр",
                  });
                })
              }
            >
              Сгенерировать карту по описанию
            </button>
          )}
          <button
            disabled={busy || !edit.title.trim()}
            onClick={() =>
              perform(async () => {
                const result = await request(
                  edit.id ? `clues/${edit.id}` : "clues",
                  edit.id ? "PATCH" : "POST",
                  { ...edit, campaignId: cid, revealed: !!edit.revealed },
                );
                if (file) await upload(edit.id || result.id, file);
                setEdit(undefined);
                setFile(undefined);
              })
            }
          >
            Сохранить
          </button>
        </Modal>
      )}
      {folderEdit && (
        <Modal title="Редактор папки" onClose={() => setFolderEdit(undefined)}>
          <Field label="Название">
            <input
              value={folderEdit.name}
              onChange={(e) =>
                setFolderEdit({ ...folderEdit, name: e.target.value })
              }
            />
          </Field>
          <Field label="Родительская папка">
            <select
              value={folderEdit.parentId || ""}
              onChange={(e) =>
                setFolderEdit({
                  ...folderEdit,
                  parentId: e.target.value || null,
                })
              }
            >
              <option value="">Корень игры</option>
              {folders
                .filter((f) => f.id !== folderEdit.id)
                .map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Порядок">
            <input
              type="number"
              min={0}
              value={folderEdit.position}
              onChange={(e) =>
                setFolderEdit({
                  ...folderEdit,
                  position: Number(e.target.value),
                })
              }
            />
          </Field>
          <Audience
            roles={roles}
            members={members}
            value={folderEdit}
            change={setFolderEdit}
          />
          <p className="muted">
            Пустые списки — все участники. Ограничения родителя сохраняются.
          </p>
          <button
            disabled={busy}
            onClick={() =>
              perform(async () => {
                await request(
                  `campaigns/${cid}/folders/${folderEdit.id}`,
                  "PATCH",
                  folderEdit,
                );
                setFolderEdit(undefined);
              })
            }
          >
            Сохранить папку
          </button>
        </Modal>
      )}
    </>
  );
}
function Audience({
  roles,
  members,
  value,
  change,
}: {
  roles: Row[];
  members: Row[];
  value: Row;
  change: (v: Row) => void;
}) {
  return (
    <>
      <h3>Роли</h3>
      <p className="muted">Пустой список ролей — все роли с правом чтения.</p>
      {roles
        .filter((r) => r.id !== "gm")
        .map((r) => (
          <label className="check-line" key={r.id}>
            <input
              type="checkbox"
              checked={value.roles?.includes(r.id) || false}
              onChange={(e) =>
                change({
                  ...value,
                  roles: e.target.checked
                    ? [...(value.roles || []), r.id]
                    : (value.roles || []).filter((x: string) => x !== r.id),
                })
              }
            />
            {r.name}
          </label>
        ))}
      <h3>Личный доступ</h3>
      {members.map((m) => (
        <label className="check-line" key={m.user_id}>
          <input
            type="checkbox"
            checked={value.recipients?.includes(m.user_id) || false}
            onChange={(e) =>
              change({
                ...value,
                recipients: e.target.checked
                  ? [...(value.recipients || []), m.user_id]
                  : (value.recipients || []).filter(
                      (x: string) => x !== m.user_id,
                    ),
              })
            }
          />
          {m.name}
        </label>
      ))}
    </>
  );
}
function Access({
  game,
  userId,
  ctx,
  refresh,
}: {
  game: Row;
  userId: string;
  ctx: AppContext;
  refresh: () => Promise<void>;
}) {
  const [form, setForm] = useState({ ...game }),
    [roles, setRoles] = useState<Row[]>([]),
    [members, setMembers] = useState<Row[]>([]),
    [edit, setEdit] = useState<Row>(),
    [busy, setBusy] = useState(false);
  const can = (p: string) =>
    game.owner_id === userId || game.permissions?.includes(p);
  async function load() {
    setRoles(await request(`campaigns/${game.id}/roles`));
    setMembers(await request(`campaigns/${game.id}/members`));
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
      await refresh();
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => ctx.toast(e.message, true));
  }, [game.id]);
  return (
    <>
      <section className="card">
        <h2>Параметры игры</h2>
        <Field label="Название">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </Field>
        <Field label="Описание">
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>
        <label className="check-line">
          <input
            type="checkbox"
            checked={form.visibility === "public"}
            onChange={(e) =>
              setForm({
                ...form,
                visibility: e.target.checked ? "public" : "private",
              })
            }
          />
          Показывать другим пользователям сервиса
        </label>
        <button
          disabled={busy || !can("publish_campaign")}
          onClick={() =>
            perform(() => request(`campaigns/${game.id}`, "PATCH", form))
          }
        >
          Сохранить
        </button>
        {can("manage_members") && (
          <button
            disabled={busy}
            className="ghost"
            onClick={() =>
              perform(() => request(`campaigns/${game.id}/invite`, "POST"))
            }
          >
            Обновить приглашение
          </button>
        )}
      </section>
      <section className="card">
        <h2>Роли участников</h2>
        {members.map((m) => (
          <div key={m.user_id} className="line-item">
            <span>{m.name}</span>
            <select
              aria-label={`Роль ${m.name}`}
              disabled={
                busy || !can("manage_members") || m.user_id === game.owner_id
              }
              value={m.role_id}
              onChange={(e) =>
                perform(() =>
                  request(
                    `campaigns/${game.id}/members/${m.user_id}`,
                    "PATCH",
                    { roleId: e.target.value },
                  ),
                )
              }
            >
              {roles.map((r) => (
                <option value={r.id} key={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </section>
      {game.owner_id === userId && (
        <section className="card">
          <h2>Редактор ролей</h2>
          {roles
            .filter((r) => r.id !== "gm")
            .map((r) => (
              <button className="ghost" key={r.id} onClick={() => setEdit(r)}>
                {r.name}
              </button>
            ))}
          <button
            onClick={() => setEdit({ id: "", name: "", permissions: [] })}
          >
            Новая роль
          </button>
          {edit && (
            <>
              <Field label="Код · латиница">
                <input
                  value={edit.id}
                  onChange={(e) => setEdit({ ...edit, id: e.target.value })}
                />
              </Field>
              <Field label="Название">
                <input
                  value={edit.name}
                  onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                />
              </Field>
              {Object.entries(permissionNames).map(([id, label]) => (
                <label key={id} className="check-line">
                  <input
                    type="checkbox"
                    checked={edit.permissions.includes(id)}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        permissions: e.target.checked
                          ? [...edit.permissions, id]
                          : edit.permissions.filter((x: string) => x !== id),
                      })
                    }
                  />
                  {label}
                </label>
              ))}
              <button
                disabled={busy}
                onClick={() =>
                  perform(async () => {
                    await request(`campaigns/${game.id}/roles`, "PUT", edit);
                    setEdit(undefined);
                  })
                }
              >
                Сохранить роль
              </button>
            </>
          )}
        </section>
      )}
      <GameTools cid={game.id} game={game} ctx={ctx} configOnly />
    </>
  );
}
function Journal({
  cid,
  userId,
  canEdit,
  ctx,
}: {
  cid: string;
  userId: string;
  canEdit: boolean;
  ctx: AppContext;
}) {
  const [notes, setNotes] = useState<Row[]>([]),
    [materials, setMaterials] = useState<Row[]>([]),
    [logs, setLogs] = useState<Row[]>([]),
    [edit, setEdit] = useState<Row>(),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [ns, ms, ls] = await Promise.all([
      request(`campaigns/${cid}/notes`),
      request("clues?campaign=" + cid),
      request(`campaigns/${cid}/log`),
    ]);
    setNotes(ns);
    setMaterials(ms);
    setLogs(ls);
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    load().catch((e) => ctx.toast(e.message, true));
  }, [cid]);
  function begin(n?: Row) {
    setEdit(
      n
        ? { ...n, folderId: n.folder_id, sessionId: n.session_id }
        : {
            title: "",
            body: "",
            visibility: "private",
            links: [],
            folderId: null,
            sessionId: null,
          },
    );
  }
  return (
    <>
      <div className="row wrap">
        <button onClick={() => begin()}>Быстрая запись</button>
        <button
          className="ghost"
          disabled={busy}
          onClick={() =>
            perform(async () => {
              const r = await assistantRequest({
                action: "summary",
                campaignId: cid,
                prompt:
                  "Составь сводку доступного мне журнала игры: события, решения, квесты и открытые вопросы.",
              });
              setEdit({
                title: "Сводка игры",
                body: r.text,
                visibility: "private",
                links: [],
                folderId: null,
                sessionId: null,
              });
            })
          }
        >
          Сводка с помощником
        </button>
        <button
          className="ghost"
          onClick={() =>
            saveFile(
              new Blob([JSON.stringify(notes, null, 2)], {
                type: "application/json",
              }),
              "journal.json",
            )
          }
        >
          Экспорт
        </button>
        <button className="ghost" onClick={() => window.print()}>
          Печать / PDF
        </button>
      </div>
      <div className="row wrap">
        <Field label="Найти">
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </Field>
        <Field label="Доступ">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Все доступные</option>
            <option value="private">Мои личные</option>
            <option value="shared">Общие</option>
          </select>
        </Field>
      </div>
      {notes
        .filter(
          (n) =>
            (filter === "all" || n.visibility === filter) &&
            (n.title + " " + n.body)
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .map((n) => (
          <article className="card journal-note" id={"note-" + n.id} key={n.id}>
            <h2>{n.title}</h2>
            <p className="muted">
              {n.visibility === "private" ? "Личная" : "Общая"} ·{" "}
              {n.author_name} · {new Date(n.updated_at).toLocaleString()}
            </p>
            <p className="rule-description">{n.body}</p>
            <div className="row wrap">
              {n.links.map((id: string) => {
                const link = [...notes, ...materials].find((m) => m.id === id);
                return link ? (
                  <button
                    className="ghost"
                    key={id}
                    onClick={() => {
                      if (notes.some((x) => x.id === id)) {
                        setQuery(link.title);
                        setFilter("all");
                      } else ctx.toast(link.title + ": " + link.body);
                    }}
                  >
                    {link.title}
                  </button>
                ) : null;
              })}
            </div>
            {(n.user_id === userId ||
              (canEdit && n.visibility === "shared")) && (
              <div className="row wrap">
                <button className="ghost" onClick={() => begin(n)}>
                  Редактировать
                </button>
                <button
                  className="danger ghost"
                  disabled={busy}
                  onClick={() =>
                    perform(() =>
                      request(`campaigns/${cid}/notes/${n.id}`, "DELETE"),
                    )
                  }
                >
                  Удалить
                </button>
              </div>
            )}
          </article>
        ))}
      <section className="card">
        <h2>Лог игры</h2>
        {logs.length ? (
          logs.map((l) => (
            <div className="log-row" key={l.id}>
              <time>{new Date(l.created_at).toLocaleString()}</time>
              <strong>{l.user_name}</strong>
              <span>{l.text}</span>
            </div>
          ))
        ) : (
          <p>
            Броски и игровые события появятся здесь. Личные события видны только
            автору.
          </p>
        )}
      </section>
      {edit && (
        <Modal title="Запись в журнал" onClose={() => setEdit(undefined)}>
          <Field label="Название">
            <input
              value={edit.title}
              maxLength={120}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
            />
          </Field>
          <Field label="Текст">
            <textarea
              rows={10}
              maxLength={20000}
              value={edit.body}
              onChange={(e) => setEdit({ ...edit, body: e.target.value })}
            />
          </Field>
          <VoiceInput
            onText={(text) =>
              setEdit({ ...edit, body: edit.body + "\n" + text })
            }
            toast={ctx.toast}
          />
          <label className="check-line">
            <input
              type="checkbox"
              checked={edit.visibility === "shared"}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  visibility: e.target.checked ? "shared" : "private",
                  links: e.target.checked
                    ? edit.links.filter(
                        (id: string) =>
                          !notes.some(
                            (n) => n.id === id && n.visibility === "private",
                          ),
                      )
                    : edit.links,
                })
              }
            />
            Общая запись
          </label>
          <p className="muted">
            Личные записи видны только вам, включая записи от мастера.
          </p>
          <h3>Связанные заметки и материалы</h3>
          {[
            ...notes.filter(
              (n) =>
                n.id !== edit.id &&
                (edit.visibility === "private" || n.visibility === "shared"),
            ),
            ...materials,
          ].map((n) => (
            <label className="check-line" key={n.id}>
              <input
                type="checkbox"
                checked={edit.links.includes(n.id)}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    links: e.target.checked
                      ? [...edit.links, n.id]
                      : edit.links.filter((id: string) => id !== n.id),
                  })
                }
              />
              {n.title}
            </label>
          ))}
          <button
            disabled={busy || !edit.title.trim()}
            onClick={() =>
              perform(async () => {
                await request(
                  `campaigns/${cid}/notes${edit.id ? "/" + edit.id : ""}`,
                  edit.id ? "PUT" : "POST",
                  edit,
                );
                setEdit(undefined);
              })
            }
          >
            Сохранить
          </button>
        </Modal>
      )}
    </>
  );
}
export function VoiceInput({
  onText,
  toast,
}: {
  onText: (text: string) => void;
  toast: (s: string, error?: boolean) => void;
}) {
  const [active, setActive] = useState(false);
  return (
    <button
      type="button"
      className="ghost"
      disabled={active}
      onClick={() => {
        const Speech =
          (window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition;
        if (!Speech) {
          toast(
            "Используйте диктовку клавиатуры: браузер не поддерживает распознавание речи.",
            true,
          );
          return;
        }
        const speech = new Speech();
        speech.lang = "ru-RU";
        speech.interimResults = false;
        speech.onresult = (e: any) => onText(e.results[0][0].transcript);
        speech.onerror = () => {
          setActive(false);
          toast("Диктовка недоступна. Проверьте разрешение микрофона.", true);
        };
        speech.onend = () => setActive(false);
        setActive(true);
        speech.start();
      }}
    >
      {active ? "Слушаю…" : "Продиктовать заметку"}
    </button>
  );
}
function Chat({
  cid,
  userId,
  ctx,
}: {
  cid: string;
  userId: string;
  ctx: AppContext;
}) {
  const [members, setMembers] = useState<Row[]>([]),
    [peer, setPeer] = useState(""),
    [messages, setMessages] = useState<Row[]>([]),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false);
  const path = `campaigns/${cid}/chat${peer ? "?peer=" + encodeURIComponent(peer) : ""}`;
  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const [ms, chat] = await Promise.all([
          request<Row[]>(`campaigns/${cid}/members`),
          request<Row[]>(path),
        ]);
        if (live) {
          setMembers(ms);
          setMessages(chat);
        }
      } catch (e) {
        if (live) ctx.toast((e as Error).message, true);
      }
    }
    load();
    const timer = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [cid, peer]);
  return (
    <section className="card">
      <Field label="Разговор">
        <select
          value={peer}
          onChange={(e) => {
            setPeer(e.target.value);
            setMessages([]);
          }}
        >
          <option value="">Общий чат игры</option>
          {members
            .filter((m) => m.user_id !== userId)
            .map((m) => (
              <option key={m.user_id} value={m.user_id}>
                Лично: {m.name}
              </option>
            ))}
        </select>
      </Field>
      <p className="muted">
        {peer
          ? "Переписка доступна только двум собеседникам. Роль мастера не открывает чужие личные чаты."
          : "Сообщения видны участникам игры."}
      </p>
      <div className="chat-messages" role="log">
        {messages.map((m) => (
          <article
            key={m.id}
            className={
              m.author_id === userId ? "chat-message own" : "chat-message"
            }
          >
            <strong>{m.author_name}</strong>
            <p>{m.text}</p>
            <time>{new Date(m.created_at).toLocaleString()}</time>
          </article>
        ))}
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await request(path, "POST", { text });
            setText("");
            setMessages(await request(path));
          } catch (e) {
            ctx.toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Сообщение">
          <textarea
            maxLength={4000}
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <button disabled={busy || !text.trim()}>Отправить</button>
      </form>
    </section>
  );
}

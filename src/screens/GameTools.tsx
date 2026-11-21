import { useEffect, useRef, useState } from "react";
import definitions from "../../data/tool-modules.json";
import type { AppContext } from "../main";
import { request, appFetch, authHeaders, saveFile } from "../api";
import { Field, Modal } from "../ui";
import { assistantRequest } from "./Helpers";
type Row = Record<string, any>;
type Spec = {
  id: string;
  name: string;
  gm?: boolean;
  fields?: string[][];
  rows?: [string, string, string[][]][];
};
const modules = definitions as unknown as Spec[];
function num(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function defaults(kind: string, members = 4): Row {
  const values: Record<string, Row> = {
    inventory: { strength: 10, coins: 0, items: [] },
    expenses: { members, receipts: [] },
    loot: { members, coins: 0, items: [] },
    encounter: { level: 1, players: members, monsters: [] },
    combat: { round: 1, turn: 0, participants: [] },
    board: { columns: 20, rows: 20, feet: 5, tokens: [], fog: "" },
    world: {
      year: 1,
      month: 1,
      day: 1,
      daysPerMonth: 30,
      monthsPerYear: 12,
      travelDays: 0,
    },
    advancement: {
      str: 10,
      dex: 10,
      con: 10,
      int: 10,
      wis: 10,
      cha: 10,
      classes: [],
    },
  };
  return values[kind] || {};
}
export function GameTools({
  cid,
  game,
  ctx,
  configOnly = false,
}: {
  cid: string;
  game: Row;
  ctx: AppContext;
  configOnly?: boolean;
}) {
  const [docs, setDocs] = useState<Row[]>([]),
    [config, setConfig] = useState<Row>({
      mode: "rules",
      edition: "srd-2024",
      enabledModules: ["*"],
      custom: {},
    }),
    [kind, setKind] = useState("inventory"),
    [edit, setEdit] = useState<Row>(),
    [busy, setBusy] = useState(false),
    [members, setMembers] = useState<Row[]>([]);
  const gm =
      game.owner_id === ctx.me.user.id ||
      game.permissions?.includes("edit_materials"),
    rules =
      game.owner_id === ctx.me.user.id ||
      game.permissions?.includes("manage_rules");
  async function load() {
    const [d, c, m] = await Promise.all([
      request(`campaigns/${cid}/documents`),
      request(`campaigns/${cid}/rules-config`),
      request(`campaigns/${cid}/members`),
    ]);
    setDocs(d);
    setConfig(c);
    setMembers(m);
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
  const enabled = (config.enabledModules || []).includes("*")
    ? modules.map((m) => m.id)
    : config.enabledModules || [];
  const definition = modules.find((m) => m.id === kind);
  function begin(doc?: Row) {
    setEdit(
      doc
        ? { ...doc }
        : {
            kind,
            title: definition?.name || "",
            data: defaults(kind, members.length || 4),
            secret: "",
            visibility: kind === "npc" ? "private" : "shared",
            roles: [],
          },
    );
  }
  const save = async (d: Row) =>
    request(
      `campaigns/${cid}/documents${d.id ? "/" + d.id : ""}`,
      d.id ? "PUT" : "POST",
      d,
    );
  if (configOnly)
    return (
      <section className="card">
        <h2>Правила и модули кампании</h2>
        <Field label="Режим">
          <select
            value={config.mode}
            disabled={!rules}
            onChange={(e) => setConfig({ ...config, mode: e.target.value })}
          >
            <option value="rules">По правилам редакции</option>
            <option value="custom">Домашние правила</option>
          </select>
        </Field>
        <Field label="Редакция">
          <select
            value={config.edition}
            disabled={!rules}
            onChange={(e) => setConfig({ ...config, edition: e.target.value })}
          >
            <option value="srd-2014">2014 · SRD 5.1</option>
            <option value="srd-2024">2024 · SRD 5.2.1</option>
            <option value="custom">Своя редакция</option>
          </select>
        </Field>
        {modules.map((m) => (
          <label className="check-line" key={m.id}>
            <input
              type="checkbox"
              disabled={!rules}
              checked={enabled.includes(m.id)}
              onChange={(e) =>
                setConfig({
                  ...config,
                  enabledModules: e.target.checked
                    ? [...enabled, m.id]
                    : enabled.filter((id: string) => id !== m.id),
                })
              }
            />
            {m.name}
          </label>
        ))}
        {config.mode === "custom" && (
          <Field label="Описание домашних правил">
            <textarea
              value={config.custom?.description || ""}
              onChange={(e) =>
                setConfig({
                  ...config,
                  custom: { ...config.custom, description: e.target.value },
                })
              }
            />
          </Field>
        )}
        <button
          disabled={busy || !rules}
          onClick={() =>
            perform(() =>
              request(`campaigns/${cid}/rules-config`, "PUT", config),
            )
          }
        >
          Сохранить правила игры
        </button>
      </section>
    );
  return (
    <>
      <div className="row wrap">
        <Field label="Инструмент">
          <select
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setEdit(undefined);
            }}
          >
            {modules
              .filter((m) => enabled.includes(m.id))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        </Field>
        {definition && enabled.includes(kind) && (!definition.gm || gm) && (
          <button disabled={busy} onClick={() => begin()}>
            Создать запись
          </button>
        )}
      </div>
      {!enabled.length && (
        <p>
          Мастер отключил дополнительные инструменты. Настройки находятся в
          редакторе кампании.
        </p>
      )}
      {kind === "safety" && (
        <button
          className="stop-button"
          disabled={busy}
          onClick={() =>
            perform(async () => {
              await request(`campaigns/${cid}/chat`, "POST", {
                text: "СТОП. Нужна пауза. Продолжим после согласия участников.",
              });
              await request(`campaigns/${cid}/log`, "POST", {
                kind: "safety",
                text: "Запрошена пауза в игре",
                visibility: "shared",
              });
              ctx.toast("Сигнал отправлен в общий чат");
            })
          }
        >
          СТОП · сделать паузу
        </button>
      )}
      {kind === "npc" && gm && (
        <button
          className="ghost"
          disabled={busy}
          onClick={() =>
            perform(async () => {
              const r = await assistantRequest({
                action: "npc",
                campaignId: cid,
                prompt:
                  "Создай NPC для " +
                  game.name +
                  ": внешность, мотивация, голос, секреты и связи.",
              });
              setEdit({
                kind: "npc",
                title: "Новый NPC",
                data: { appearance: r.text },
                secret: "",
                visibility: "private",
                roles: [],
              });
            })
          }
        >
          Придумать NPC с помощником
        </button>
      )}
      {docs
        .filter((d) => d.kind === kind)
        .map((d) => (
          <section className="card" key={d.id}>
            <div className="row between">
              <h2>{d.title}</h2>
              <span className="badge">
                {d.visibility === "private"
                  ? "Личная запись"
                  : d.visibility === "roles"
                    ? "По ролям"
                    : "Общая"}
              </span>
            </div>
            <ToolResult
              kind={kind}
              data={d.data}
              gm={gm}
              ctx={ctx}
              update={(next) => perform(() => save({ ...d, data: next }))}
            />
            {kind === "board" && (
              <BattleMap
                data={d.data}
                cid={cid}
                editable={gm}
                update={(next) => perform(() => save({ ...d, data: next }))}
                ctx={ctx}
              />
            )}
            {kind === "connections" && <ConnectionBoard data={d.data} />}
            {kind === "music" && <AudioPlayer data={d.data} />}
            <ToolData definition={definition} data={d.data} />
            {d.secret && (
              <details>
                <summary>Секрет мастера</summary>
                <p>{d.secret}</p>
              </details>
            )}
            {(d.user_id === ctx.me.user.id || gm) && (
              <div className="row wrap">
                <button className="ghost" onClick={() => begin(d)}>
                  Редактировать
                </button>
                <button
                  className="danger ghost"
                  disabled={busy}
                  onClick={() =>
                    perform(() =>
                      request(`campaigns/${cid}/documents/${d.id}`, "DELETE"),
                    )
                  }
                >
                  Удалить
                </button>
                <button
                  className="ghost"
                  onClick={() =>
                    saveFile(
                      new Blob([JSON.stringify(d, null, 2)], {
                        type: "application/json",
                      }),
                      d.kind + ".json",
                    )
                  }
                >
                  Экспорт записи
                </button>
              </div>
            )}
          </section>
        ))}
      {edit && definition && (
        <Modal title={definition.name} onClose={() => setEdit(undefined)}>
          <Field label="Название">
            <input
              maxLength={160}
              value={edit.title}
              onChange={(e) => setEdit({ ...edit, title: e.target.value })}
            />
          </Field>
          <Field label="Видимость">
            <select
              value={edit.visibility}
              onChange={(e) => setEdit({ ...edit, visibility: e.target.value })}
            >
              <option value="private">Только автор</option>
              <option value="shared">Участникам кампании</option>
            </select>
          </Field>
          {definition.fields?.map((f) => (
            <ToolField
              key={f[0]}
              field={f}
              data={edit.data}
              update={(next) => setEdit({ ...edit, data: next })}
            />
          ))}
          {definition.rows?.map(([key, label, fields]) => (
            <section className="tool-rows" key={key}>
              <h3>{label}</h3>
              {(edit.data[key] || []).map((row: Row, index: number) => (
                <div className="tool-row" key={index}>
                  {fields.map((f) => (
                    <ToolField
                      key={f[0]}
                      field={f}
                      data={row}
                      update={(next) =>
                        setEdit({
                          ...edit,
                          data: {
                            ...edit.data,
                            [key]: edit.data[key].map((r: Row, i: number) =>
                              i === index ? next : r,
                            ),
                          },
                        })
                      }
                    />
                  ))}
                  <button
                    type="button"
                    className="danger ghost"
                    onClick={() =>
                      setEdit({
                        ...edit,
                        data: {
                          ...edit.data,
                          [key]: edit.data[key].filter(
                            (_: Row, i: number) => i !== index,
                          ),
                        },
                      })
                    }
                  >
                    Удалить строку
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  setEdit({
                    ...edit,
                    data: {
                      ...edit.data,
                      [key]: [...(edit.data[key] || []), {}],
                    },
                  })
                }
              >
                Добавить: {label}
              </button>
            </section>
          ))}
          {gm && (
            <Field label="Секрет мастера · скрыт от игроков">
              <textarea
                value={edit.secret || ""}
                onChange={(e) => setEdit({ ...edit, secret: e.target.value })}
              />
            </Field>
          )}
          <ToolResult
            kind={kind}
            data={edit.data}
            gm={gm}
            ctx={ctx}
            update={(next) => setEdit({ ...edit, data: next })}
          />
          {kind === "board" && (
            <BattleMap
              data={edit.data}
              cid={cid}
              editable={gm}
              update={(next) => setEdit({ ...edit, data: next })}
              ctx={ctx}
            />
          )}
          <button
            disabled={busy || !edit.title.trim()}
            onClick={() =>
              perform(async () => {
                await save(edit);
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
function ToolField({
  field: f,
  data,
  update,
}: {
  field: string[];
  data: Row;
  update: (next: Row) => void;
}) {
  const [id, label, type, variants] = f;
  if (type === "hidden") return null;
  if (type === "boolean")
    return (
      <label className="check-line">
        <input
          type="checkbox"
          checked={!!data[id]}
          onChange={(e) => update({ ...data, [id]: e.target.checked })}
        />
        {label}
      </label>
    );
  return (
    <Field label={label}>
      {type === "select" ? (
        <select
          value={data[id] || ""}
          onChange={(e) => update({ ...data, [id]: e.target.value })}
        >
          <option value="">Выберите</option>
          {variants.split(",").map((v) => {
            const [id, label] = v.split(":");
            return (
              <option value={id} key={id}>
                {label}
              </option>
            );
          })}
        </select>
      ) : type === "number" ? (
        <input
          type="number"
          step="any"
          value={data[id] ?? 0}
          onChange={(e) => update({ ...data, [id]: num(e.target.value) })}
        />
      ) : type === "date" ? (
        <input
          type="date"
          value={data[id] || ""}
          onChange={(e) => update({ ...data, [id]: e.target.value })}
        />
      ) : (
        <textarea
          rows={id === "description" ? 4 : 2}
          value={data[id] || ""}
          onChange={(e) => update({ ...data, [id]: e.target.value })}
        />
      )}
    </Field>
  );
}
function ToolData({ definition, data }: { definition?: Spec; data: Row }) {
  return (
    <>
      {definition?.fields
        ?.filter((f) => !["hidden", "boolean"].includes(f[2]) && data[f[0]])
        .map(([id, label]) => (
          <div className="line-item" key={id}>
            <span>{label}</span>
            <span className="rule-description">{String(data[id])}</span>
          </div>
        ))}
      {definition?.rows?.map(([key, label, fields]) => (
        <div key={key}>
          <h3>{label}</h3>
          {(data[key] || []).map((row: Row, i: number) => (
            <div className="tool-summary-row" key={i}>
              {fields
                .filter((f) => row[f[0]] !== undefined)
                .map(([id, label]) => (
                  <span key={id}>
                    {label}: {String(row[id])}
                  </span>
                ))}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
function ToolResult({
  kind,
  data: d,
  gm,
  ctx,
  update,
}: {
  kind: string;
  data: Row;
  gm: boolean;
  ctx: AppContext;
  update: (next: Row) => void;
}) {
  if (kind === "inventory") {
    const items: Row[] = d.items || [];
    const weight = items.reduce((a, i) => a + num(i.qty) * num(i.weight), 0),
      capacity = num(d.capacity) || 15 * (num(d.strength) || 10);
    return (
      <>
        <p className="calculated">
          Вес {weight.toFixed(1)} / {capacity} фунтов{" "}
          {weight > capacity ? "· перегруз" : ""} · монеты {num(d.coins)}
        </p>
        <div className="row wrap">
          {[
            ["short", "Короткий отдых"],
            ["long", "Долгий отдых"],
          ].map(([id, label]) => (
            <button
              className="ghost"
              key={id}
              onClick={() =>
                update({
                  ...d,
                  items: items.map((i) =>
                    i.rest === id || (id === "long" && i.rest === "short")
                      ? { ...i, charges: num(i.maxCharges) }
                      : i,
                  ),
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
        {items.map((i, index) =>
          num(i.maxCharges) > 0 ? (
            <button
              className="ghost"
              key={index}
              disabled={num(i.charges) <= 0}
              onClick={() =>
                update({
                  ...d,
                  items: items.map((x, k) =>
                    k === index
                      ? { ...x, charges: Math.max(0, num(x.charges) - 1) }
                      : x,
                  ),
                })
              }
            >
              {i.name} · {num(i.charges)}/{num(i.maxCharges)} · использовать
            </button>
          ) : null,
        )}
      </>
    );
  }
  if (kind === "loot" || kind === "expenses") {
    const total =
        kind === "loot"
          ? num(d.coins) +
            (d.items || []).reduce(
              (a: number, i: Row) => a + num(i.qty) * num(i.value),
              0,
            )
          : (d.receipts || []).reduce(
              (a: number, i: Row) => a + num(i.amount),
              0,
            ),
      members = Math.max(1, num(d.members, 4)),
      share = Math.floor((total * 100) / members) / 100;
    return (
      <p className="calculated">
        Всего: {total} · каждому из {members}: {share} · остаток:{" "}
        {(total - share * members).toFixed(2)}
      </p>
    );
  }
  if (kind === "combat") {
    const participants: Row[] = [...(d.participants || [])].sort(
        (a, b) => num(b.initiative) - num(a.initiative),
      ),
      turn = Math.max(0, Math.min(num(d.turn), participants.length - 1)),
      round = Math.max(1, num(d.round, 1));
    return (
      <>
        <p className="calculated">
          Раунд {round} · ход: {participants[turn]?.name || "—"}
        </p>
        {participants.map((p, i) => (
          <div className={"combatant " + (i === turn ? "current" : "")} key={i}>
            <strong>{p.name}</strong>
            <span>
              Хиты {num(p.hp)} · КД {num(p.ac)} · {p.conditions}
            </span>
            <span>
              {num(p.expiresRound) > 0 && num(p.expiresRound) < round
                ? "Эффект завершён"
                : p.effect}
            </span>
          </div>
        ))}
        {gm && (
          <button
            disabled={!participants.length}
            onClick={() => {
              const next = (turn + 1) % participants.length;
              update({
                ...d,
                participants,
                turn: next,
                round: round + (next === 0 ? 1 : 0),
              });
            }}
          >
            Следующий ход
          </button>
        )}
      </>
    );
  }
  if (kind === "encounter") {
    const count = (d.monsters || []).reduce(
        (a: number, m: Row) => a + num(m.count),
        0,
      ),
      xp = (d.monsters || []).reduce(
        (a: number, m: Row) => a + num(m.count) * num(m.xp),
        0,
      ),
      factor =
        count <= 1
          ? 1
          : count === 2
            ? 1.5
            : count <= 6
              ? 2
              : count <= 10
                ? 2.5
                : count <= 14
                  ? 3
                  : 4;
    return (
      <p className="calculated">
        Противников: {count} · XP {xp} · множитель 2014: {xp * factor}{" "}
        {num(d.budget) > 0 ? `/ бюджет ${d.budget}` : ""}. Окружение и
        особенности способностей оценивает мастер.
      </p>
    );
  }
  if (kind === "world")
    return (
      <>
        <p className="calculated">
          {num(d.day, 1)}.{num(d.month, 1)}.{num(d.year, 1)} · {d.weather} ·{" "}
          {d.location}
        </p>
        {(d.events || [])
          .filter(
            (e: Row) =>
              num(e.day) === num(d.day) && num(e.month) === num(d.month),
          )
          .map((e: Row, i: number) => (
            <p key={i}>
              {e.name}: {e.description}
            </p>
          ))}
        {gm && (
          <button
            onClick={() => {
              const days = Math.max(1, num(d.daysPerMonth, 30)),
                months = Math.max(1, num(d.monthsPerYear, 12)),
                day = num(d.day, 1) + 1,
                month = num(d.month, 1) + (day > days ? 1 : 0);
              update({
                ...d,
                day: day > days ? 1 : day,
                month: month > months ? 1 : month,
                year: num(d.year, 1) + (month > months ? 1 : 0),
                travelDays: num(d.travelDays) + 1,
              });
            }}
          >
            Следующий день
          </button>
        )}
      </>
    );
  if (kind === "advancement") {
    const classes: Row[] = d.classes || [],
      level = classes.reduce((n, c) => n + num(c.level), 0),
      requirements: Record<string, string[]> = {
        barbarian: ["str"],
        bard: ["cha"],
        cleric: ["wis"],
        druid: ["wis"],
        monk: ["dex", "wis"],
        paladin: ["str", "cha"],
        ranger: ["dex", "wis"],
        rogue: ["dex"],
        sorcerer: ["cha"],
        warlock: ["cha"],
        wizard: ["int"],
      };
    return (
      <>
        <p className="calculated">
          Суммарный уровень {level} · владение +
          {2 + Math.floor((Math.max(1, level) - 1) / 4)}
        </p>
        {classes.map((c, i) => {
          const req = requirements[c.classId] || [],
            valid =
              c.classId === "fighter"
                ? num(d.str) >= 13 || num(d.dex) >= 13
                : req.every((k) => num(d[k]) >= 13);
          return (
            <p key={i}>
              {c.classId} {c.level}:{" "}
              {classes.length === 1 || valid
                ? "базовые требования выполнены"
                : "требуется 13: " +
                  (c.classId === "fighter" ? "str или dex" : req.join(", "))}
            </p>
          );
        })}
      </>
    );
  }
  if (kind === "quest" && d.due)
    return (
      <p>
        Напомнить: {d.due} · {d.status}
      </p>
    );
  return null;
}
function AudioPlayer({ data }: { data: Row }) {
  const ref = useRef<HTMLAudioElement>(null),
    [volume, setVolume] = useState(0.5);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);
  return (
    <div className="audio-player">
      <audio
        ref={ref}
        controls
        src={/^https:\/\//.test(data.url) ? data.url : undefined}
        loop={!!data.loop}
      />
      <Field label="Моя громкость">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(+e.target.value)}
        />
      </Field>
    </div>
  );
}
function BattleMap({
  data: d,
  editable,
  update,
  ctx,
}: {
  data: Row;
  cid: string;
  editable: boolean;
  update: (next: Row) => void;
  ctx: AppContext;
}) {
  const [url, setUrl] = useState(""),
    [selected, setSelected] = useState(0),
    [fogMode, setFogMode] = useState(false),
    [measure, setMeasure] = useState(false),
    [from, setFrom] = useState<[number, number]>(),
    [distance, setDistance] = useState(0);
  const columns = Math.max(2, Math.min(60, num(d.columns, 20))),
    rows = Math.max(2, Math.min(60, num(d.rows, 20))),
    fog = new Set<string>((d.fog || "").split(";").filter(Boolean));
  useEffect(() => {
    let live = true,
      loaded = "";
    if (d.mapId)
      appFetch(`clues/${d.mapId}/file`, { headers: authHeaders() })
        .then(async (r) => {
          if (!r.ok) throw Error("Нет доступа к карте");
          loaded = URL.createObjectURL(await r.blob());
          if (live) setUrl(loaded);
          else URL.revokeObjectURL(loaded);
        })
        .catch((e) => ctx.toast(e.message, true));
    return () => {
      live = false;
      if (loaded) URL.revokeObjectURL(loaded);
    };
  }, [d.mapId]);
  return (
    <>
      <div className="row wrap">
        {editable && (
          <>
            <Field label="Жетон">
              <select
                value={selected}
                onChange={(e) => setSelected(+e.target.value)}
              >
                {(d.tokens || []).map((t: Row, i: number) => (
                  <option key={i} value={i}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <label className="check-line">
              <input
                type="checkbox"
                checked={fogMode}
                onChange={(e) => setFogMode(e.target.checked)}
              />
              Открывать клетки
            </label>
          </>
        )}
        <label className="check-line">
          <input
            type="checkbox"
            checked={measure}
            onChange={(e) => {
              setMeasure(e.target.checked);
              setFrom(undefined);
            }}
          />
          Измерить двумя касаниями
        </label>
        <span>{distance > 0 ? `${distance} футов` : ""}</span>
      </div>
      <svg
        className="battle-map"
        viewBox={`0 0 ${columns * 40} ${rows * 40}`}
        role="img"
        aria-label="Карта с сеткой"
        onClick={(e) => {
          const p = e.currentTarget.createSVGPoint();
          p.x = e.clientX;
          p.y = e.clientY;
          const matrix = e.currentTarget.getScreenCTM();
          if (!matrix) return;
          const point = p.matrixTransform(matrix.inverse()),
            x = Math.max(0, Math.min(columns - 1, Math.floor(point.x / 40))),
            y = Math.max(0, Math.min(rows - 1, Math.floor(point.y / 40)));
          if (measure) {
            if (from) {
              setDistance(
                Math.max(Math.abs(x - from[0]), Math.abs(y - from[1])) *
                  num(d.feet, 5),
              );
              setFrom(undefined);
            } else setFrom([x, y]);
          } else if (editable) {
            if (fogMode) {
              const cell = `${x},${y}`;
              if (fog.has(cell)) fog.delete(cell);
              else fog.add(cell);
              update({ ...d, fog: [...fog].join(";") });
            } else
              update({
                ...d,
                tokens: (d.tokens || []).map((t: Row, i: number) =>
                  i === selected ? { ...t, x, y } : t,
                ),
              });
          }
        }}
      >
        <defs>
          <pattern
            id="battle-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path d="M40 0H0V40" fill="none" stroke="#9299a8" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="#202634" />
        {url && (
          <image
            href={url}
            width="100%"
            height="100%"
            preserveAspectRatio="none"
          />
        )}
        <rect width="100%" height="100%" fill="url(#battle-grid)" />
        {(d.tokens || []).map((t: Row, i: number) =>
          editable || !fog.has(`${num(t.x)},${num(t.y)}`) ? (
            <g key={i}>
              <circle
                cx={num(t.x) * 40 + 20}
                cy={num(t.y) * 40 + 20}
                r={13}
                fill={selected === i ? "#c8ad75" : "#6994ff"}
              />
              <text
                x={num(t.x) * 40 + 20}
                y={num(t.y) * 40 + 24}
                textAnchor="middle"
                fontSize="10"
                fill="#10131b"
              >
                {(t.name || "").slice(0, 4)}
              </text>
            </g>
          ) : null,
        )}
        {[...fog].map((cell) => {
          const [x, y] = cell.split(",").map(Number);
          return Number.isFinite(x) && Number.isFinite(y) ? (
            <rect
              key={cell}
              x={x * 40}
              y={y * 40}
              width={40}
              height={40}
              fill="black"
              opacity={editable ? 0.5 : 1}
            />
          ) : null;
        })}
      </svg>
      <p className="muted">
        Туман скрывает клетки на игровом поле. Секретный исходник карты храните
        отдельным закрытым материалом.
      </p>
    </>
  );
}
function ConnectionBoard({ data }: { data: Row }) {
  const nodes: Row[] = (data.nodes || []).slice(0, 60),
    point = (i: number) => [
      300 + 230 * Math.cos((i / nodes.length) * Math.PI * 2),
      250 + 190 * Math.sin((i / nodes.length) * Math.PI * 2),
    ];
  return (
    <svg
      className="connection-board"
      viewBox="0 0 600 500"
      role="img"
      aria-label="Связи персонажей и улик"
    >
      {(data.edges || []).map((e: Row, i: number) => {
        const a = nodes.findIndex((n) => n.name === e.from),
          b = nodes.findIndex((n) => n.name === e.to);
        if (a < 0 || b < 0) return null;
        const [x1, y1] = point(a),
          [x2, y2] = point(b);
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8997b5" />
            <text
              x={(x1 + x2) / 2}
              y={(y1 + y2) / 2}
              fontSize={10}
              textAnchor="middle"
              fill="#c8ad75"
            >
              {e.label}
            </text>
          </g>
        );
      })}
      {nodes.map((n, i) => {
        const [x, y] = point(i);
        return (
          <g key={i}>
            <rect
              x={x - 45}
              y={y - 18}
              width={90}
              height={36}
              rx={4}
              fill="#26344d"
              stroke="#6994ff"
            />
            <text
              x={x}
              y={y + 4}
              fill="#eee7d8"
              textAnchor="middle"
              fontSize={10}
            >
              {n.name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

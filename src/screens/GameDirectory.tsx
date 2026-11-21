import { useEffect, useState, type CSSProperties } from "react";
import { offlineMode, request } from "../api";
import { Field } from "../ui";
import type { AppContext } from "../main";

type Row = Record<string, any>;
export const roleNames: Record<string, string> = {
  player: "Игрок",
  observer: "Наблюдатель",
};
export function parseObject(value: unknown): Row {
  if (value && typeof value === "object") return value as Row;
  try {
    return JSON.parse(String(value || "{}"));
  } catch {
    return {};
  }
}
export function GameDirectory({
  ctx,
  open,
  refresh,
}: {
  ctx: AppContext;
  open: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const [city, setCity] = useState(""),
    [format, setFormat] = useState("any"),
    [query, setQuery] = useState(""),
    [games, setGames] = useState<Row[]>([]),
    [editing, setEditing] = useState<Row>(),
    [role, setRole] = useState("player"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [searched, setSearched] = useState(false);
  const load = async () => {
    setGames(
      await request(
        "campaigns/discover?" + new URLSearchParams({ city, format, q: query }),
      ),
    );
    setSearched(true);
  };
  async function act(f: () => Promise<unknown>) {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (offlineMode()) return null;
  return (
    <section className="card">
      <h2>Открытые игры</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void act(load);
        }}
        className="two-col"
      >
        <Field label="Город">
          <input
            maxLength={100}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Например, Казань"
          />
        </Field>
        <Field label="Формат">
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="any">Любой</option>
            <option value="online">Онлайн</option>
            <option value="offline">Очно</option>
          </select>
        </Field>
        <Field label="Название или тема">
          <input
            maxLength={150}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        <button disabled={busy}>Найти игры</button>
      </form>
      {searched && !games.length && <p>Игры по этим параметрам не найдены.</p>}
      {games.map((g) => (
        <article className="card" key={g.id}>
          <h3>{g.name}</h3>
          <p>{g.description}</p>
          <p>
            {g.format === "online"
              ? "Онлайн"
              : g.format === "offline"
                ? "Очно"
                : "Онлайн и очно"}
            {g.city ? " · " + g.city : ""}
            {g.master ? " · " + g.master.name : ""}
          </p>
          {g.tags?.length > 0 && <p>{g.tags.join(" · ")}</p>}
          {g.joined ? (
            <button
              onClick={() =>
                void act(async () => {
                  await refresh();
                  open(g.id);
                })
              }
            >
              Открыть игру
            </button>
          ) : g.application === "pending" ? (
            <>
              <p>
                Заявка ожидает решения мастера · {roleNames[g.requested_role]}
              </p>
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await request(`campaigns/${g.id}/applications`, "DELETE");
                    await load();
                  })
                }
              >
                Отозвать заявку
              </button>
            </>
          ) : g.application === "declined" ? (
            <p>Заявка отклонена.</p>
          ) : (
            <button
              onClick={() => {
                setEditing(g);
                setRole(g.accepts[0]);
                setMessage("");
              }}
            >
              Подать заявку
            </button>
          )}
          {editing?.id === g.id && (
            <div>
              <Field label="Роль">
                <select value={role} onChange={(e) => setRole(e.target.value)}>
                  {g.accepts.map((r: string) => (
                    <option key={r} value={r}>
                      {roleNames[r]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Сообщение мастеру">
                <textarea
                  value={message}
                  maxLength={1200}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await request(`campaigns/${g.id}/applications`, "POST", {
                      role,
                      message,
                    });
                    setEditing(undefined);
                    await load();
                  })
                }
              >
                Отправить заявку
              </button>
              <button className="ghost" onClick={() => setEditing(undefined)}>
                Отмена
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}
export function IncomingApplications({
  cid,
  ctx,
  onChange,
}: {
  cid: string;
  ctx: AppContext;
  onChange: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false);
  const load = async () =>
    setRows(await request(`campaigns/${cid}/applications`));
  useEffect(() => {
    load().catch((e) => ctx.toast(e.message, true));
  }, [cid]);
  return (
    <section className="card">
      <h2>Заявки на вступление</h2>
      <button
        className="ghost"
        disabled={busy}
        onClick={() => load().catch((e) => ctx.toast(e.message, true))}
      >
        Обновить
      </button>
      {!rows.length && <p>Заявок пока нет.</p>}
      {rows.map((row) => (
        <article className="line-item" key={row.id}>
          <div>
            <strong>
              {row.name} · {roleNames[row.role_id]}
            </strong>
            <p>{row.message}</p>
            <small>
              {row.state === "pending"
                ? "Новая"
                : row.state === "approved"
                  ? "Принята"
                  : "Отклонена"}
            </small>
          </div>
          {row.state === "pending" &&
            (["approved", "declined"] as const).map((decision) => (
              <button
                className={decision === "declined" ? "ghost" : ""}
                key={decision}
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await request(
                      `campaigns/${cid}/applications/${row.id}`,
                      "PATCH",
                      { decision },
                    );
                    await Promise.all([load(), onChange()]);
                  } catch (e) {
                    ctx.toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {decision === "approved" ? "Принять" : "Отклонить"}
              </button>
            ))}
        </article>
      ))}
    </section>
  );
}
export function ListingFields({
  listing,
  onChange,
}: {
  listing: Row;
  onChange: (r: Row) => void;
}) {
  return (
    <>
      <Field label="Формат игры">
        <select
          value={listing.format ?? "online"}
          onChange={(e) => onChange({ ...listing, format: e.target.value })}
        >
          <option value="online">Онлайн</option>
          <option value="offline">Очно</option>
          <option value="both">Онлайн и очно</option>
        </select>
      </Field>
      <Field label="Город для поиска">
        <input
          value={listing.city ?? ""}
          maxLength={100}
          onChange={(e) => onChange({ ...listing, city: e.target.value })}
        />
      </Field>
      <Field label="Темы через запятую">
        <input
          value={(listing.tags || []).join(",")}
          onChange={(e) =>
            onChange({ ...listing, tags: e.target.value.split(",") })
          }
        />
      </Field>
      {Object.entries(roleNames).map(([id, label]) => (
        <label className="check-line" key={id}>
          <input
            type="checkbox"
            checked={(listing.accepts || ["player", "observer"]).includes(id)}
            onChange={(e) => {
              const accepting = listing.accepts || ["player", "observer"];
              onChange({
                ...listing,
                accepts: e.target.checked
                  ? [...accepting, id]
                  : accepting.filter((r: string) => r !== id),
              });
            }}
          />
          Принимать заявки · {label}
        </label>
      ))}
    </>
  );
}
const palettes = [
  ["#131527", "#9c73df", "stars"],
  ["#101c1a", "#5da37e", "triangles"],
  ["#25151b", "#ad6872", "rings"],
  ["#0d1a2d", "#78a9e8", "stars"],
  ["#241e18", "#c5a16a", "triangles"],
];
function fromMood(prompt: string) {
  const mood = prompt.toLowerCase();
  const keywords = [
    /космос|зв[её]зд|магия/,
    /лес|болот|растен/,
    /ужас|вампир|хоррор/,
    /зим|снег|льд/,
    /пустын|детектив|город/,
  ];
  const match = keywords.findIndex((p) => p.test(mood));
  const hash = Array.from(mood).reduce(
    (h, c) => (h * 31 + c.charCodeAt(0)) >>> 0,
    0,
  );
  const [base, accent, pattern] =
    palettes[match >= 0 ? match : hash % palettes.length];
  return { prompt, base, accent, pattern };
}
export function campaignAppearance(config: Row): CSSProperties | undefined {
  const a = config?.appearance;
  if (
    !a ||
    !["triangles", "stars", "rings"].includes(a.pattern) ||
    ![a.base, a.accent].every(
      (x) => typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x),
    )
  )
    return undefined;
  const pattern =
    a.pattern === "stars"
      ? `radial-gradient(circle, ${a.accent}46 1px, transparent 1.5px)`
      : a.pattern === "rings"
        ? `repeating-radial-gradient(circle at 95% 10%, ${a.accent}24 0 1px, transparent 1px 34px)`
        : `repeating-linear-gradient(60deg, ${a.accent}24 0 1px, transparent 1px 26px), repeating-linear-gradient(-60deg, ${a.accent}24 0 1px, transparent 1px 26px)`;
  return {
    backgroundColor: a.base,
    backgroundImage: pattern,
    backgroundSize: a.pattern === "stars" ? "24px 24px" : undefined,
  };
}
export function CampaignPresets({
  ctx,
  cid,
  config,
  setConfig,
}: {
  ctx: AppContext;
  cid: string;
  config: Row;
  setConfig: (r: Row) => void;
}) {
  const [presets, setPresets] = useState<Row[]>([]),
    [choice, setChoice] = useState("base-2024"),
    [title, setTitle] = useState(""),
    [mood, setMood] = useState(config.appearance?.prompt || ""),
    [busy, setBusy] = useState(false);
  const load = async () => setPresets(await request("campaign-presets"));
  async function act(f: () => Promise<unknown>) {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void act(load);
  }, [cid]);
  return (
    <div className="campaign-config-extras">
      <h3>Шаблоны настроек</h3>
      <Field label="Шаблон">
        <select value={choice} onChange={(e) => setChoice(e.target.value)}>
          {presets.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <button
        className="ghost"
        disabled={busy || !presets.some((p) => p.id === choice)}
        onClick={() => {
          const p = presets.find((x) => x.id === choice);
          if (p) {
            setConfig(p.config);
            setMood(p.config.appearance?.prompt || "");
          }
        }}
      >
        Загрузить в редактор
      </button>
      <Field label="Имя своего шаблона">
        <input
          value={title}
          maxLength={100}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <button
        className="ghost"
        disabled={busy || !title.trim()}
        onClick={() =>
          void act(async () => {
            const p = await request("campaign-presets", "POST", {
              name: title,
              config,
            });
            await load();
            setChoice(p.id);
            setTitle("");
          })
        }
      >
        Сохранить шаблон
      </button>
      {presets.find((p) => p.id === choice)?.owned && (
        <button
          className="ghost"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await request("campaign-presets/" + choice, "DELETE");
              await load();
              setChoice("base-2024");
            })
          }
        >
          Убрать шаблон
        </button>
      )}
      <h3>Помощник и фон игры</h3>
      <label className="check-line">
        <input
          checked={config.assistant !== false}
          type="checkbox"
          onChange={(e) =>
            setConfig({ ...config, assistant: e.target.checked })
          }
        />
        Показывать помощника участникам
      </label>
      <Field label="Атмосфера фона">
        <input
          value={mood}
          maxLength={160}
          onChange={(e) => setMood(e.target.value)}
          placeholder="Например, зимний лес"
        />
      </Field>
      <button
        className="ghost"
        disabled={!mood.trim()}
        onClick={() =>
          setConfig({ ...config, appearance: fromMood(mood.trim()) })
        }
      >
        Сгенерировать фон
      </button>
      {config.appearance && (
        <>
          <div className="campaign-backdrop" style={campaignAppearance(config)}>
            {config.appearance.prompt}
          </div>
          <button
            className="ghost"
            onClick={() => setConfig({ ...config, appearance: null })}
          >
            Сбросить фон
          </button>
        </>
      )}
      <p className="muted">
        Чтобы применить настройки к игре, нажмите «Сохранить правила».
      </p>
    </div>
  );
}

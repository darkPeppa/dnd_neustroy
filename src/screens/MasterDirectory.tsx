import { useEffect, useState } from "react";
import { offlineMode, request } from "../api";
import { defaultPricing } from "../domain";
import type { AppContext } from "../main";
import { Field, money } from "../ui";

export type Profile = {
  handle: string;
  name: string;
  description: string;
  city: string;
  formats: string[];
  tags: string[];
  pricing: typeof defaultPricing;
  offers: { name: string; description: string; price: number }[];
  visible: boolean;
};
const priceNames: Record<keyof typeof defaultPricing, string> = {
  hour: "Час игры",
  extraPlayer: "Игрок сверх четырёх",
  offline: "Выезд",
  customCharacter: "Лист от мастера",
  chronicle: "Хроника",
  video: "Видеозапись",
  miniatures: "Миниатюра",
};
type Match = { profile: Profile; matched: string[]; score: number };
const fields = {
  name: "Имя",
  handle: "Адрес профиля · латиницей",
  city: "Город",
  description: "Об играх",
} as const;

export function MasterFinder({
  ctx,
  onPick,
  selected,
  withSearch = true,
}: {
  ctx: AppContext;
  onPick: (p: Profile) => void;
  selected?: string;
  withSearch?: boolean;
}) {
  const [matches, setMatches] = useState<Match[]>([]),
    [query, setQuery] = useState(""),
    [city, setCity] = useState(""),
    [format, setFormat] = useState("any"),
    [budget, setBudget] = useState(""),
    [tags, setTags] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request<Profile[]>("masters")
      .then((profiles) =>
        setMatches(
          profiles.map((profile) => ({ profile, score: 0, matched: [] })),
        ),
      )
      .catch((e) => ctx.toast(e.message, true));
  }, []);
  async function find(useDescription: boolean) {
    setBusy(true);
    try {
      setMatches(
        await request("masters/match", "POST", {
          query: useDescription ? query : "",
          city,
          format,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          budget: Number(budget || 0),
        }),
      );
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card master-directory">
      <h2>Ведущие и их услуги</h2>
      {withSearch && (
        <div className="two-col">
          <div>
            <Field label="Формат">
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                <option value="any">Любой</option>
                <option value="online">Онлайн</option>
                <option value="offline">Очно</option>
              </select>
            </Field>
            <Field label="Город">
              <input
                value={city}
                maxLength={100}
                onChange={(e) => setCity(e.target.value)}
              />
            </Field>
            <Field label="Бюджет за час, ₽">
              <input
                type="number"
                min="0"
                max="1000000"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </Field>
            <Field label="Жанры и пожелания через запятую">
              <input
                value={tags}
                maxLength={240}
                onChange={(e) => setTags(e.target.value)}
              />
            </Field>
            <button disabled={busy} onClick={() => void find(false)}>
              Подобрать по анкете
            </button>
          </div>
          {ctx.agentEnabled && (
            <div>
              <Field label="Опишите игру для помощника">
                <textarea
                  maxLength={800}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </Field>
              <button
                className="ghost"
                disabled={busy || !query.trim()}
                onClick={() => void find(true)}
              >
                Подобрать по описанию
              </button>
              <p className="muted">
                Подбор по доступным профилям, жанрам и ценам.
              </p>
            </div>
          )}
        </div>
      )}
      {matches.map(({ profile: p, matched }) => (
        <article className="card" key={p.handle}>
          <h3>{p.name}</h3>
          <p>{p.description}</p>
          <p>
            {p.formats
              .map((f) => (f === "online" ? "Онлайн" : "Очно"))
              .join(" · ")}
            {p.city ? " · " + p.city : ""} · {money(p.pricing.hour)} / час
          </p>
          {matched.length > 0 && <p>Совпадения: {matched.join(", ")}</p>}
          <details>
            <summary>Прайс и магазин</summary>
            <dl>
              {Object.entries(priceNames).map(([id, label]) => (
                <div className="line-item" key={id}>
                  <dt>{label}</dt>
                  <dd>{money(p.pricing[id as keyof typeof defaultPricing])}</dd>
                </div>
              ))}
            </dl>
            {p.offers.map((offer, i) => (
              <div key={i}>
                <strong>
                  {offer.name} · {money(offer.price)}
                </strong>
                <p>{offer.description}</p>
              </div>
            ))}
          </details>
          <button disabled={p.handle === selected} onClick={() => onPick(p)}>
            {p.handle === selected ? "Выбран" : "Выбрать ведущего"}
          </button>
        </article>
      ))}
      {!matches.length && <p>Ведущие по этим параметрам не найдены.</p>}
    </section>
  );
}

export function MasterOffice({ ctx }: { ctx: AppContext }) {
  const [profile, setProfile] = useState<Profile>(),
    [access, setAccess] = useState<any>(),
    [busy, setBusy] = useState(false);
  const load = async () => {
    const [a, m] = await Promise.all([
      request("masters/access"),
      request("masters/mine"),
    ]);
    setAccess(a);
    if (m.enabled)
      setProfile(
        m.profile || {
          name: ctx.me.user.name,
          handle: "",
          description: "",
          city: "",
          formats: ["online"],
          tags: [],
          pricing: { ...defaultPricing },
          offers: [],
          visible: false,
        },
      );
  };
  async function act(fn: () => Promise<unknown>) {
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
    void act(load);
  }, []);
  if (!access) return <p>Загрузка кабинета ведущего…</p>;
  return (
    <section className="card">
      <h2>Кабинет ведущего</h2>
      {!access.enabled && (
        <>
          <p>
            Доступ ведущего открывает публикацию игр, собственный прайс и
            каталог услуг.
          </p>
          {access.ready ? (
            <>
              <p>
                Разовый доступ ·{" "}
                {money(access.pending?.rubles ?? access.rubles)}
              </p>
              {access.pending?.url ? (
                <a
                  className="button"
                  href={access.pending.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть страницу оплаты
                </a>
              ) : (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const r = await request(
                        "masters/access/checkout",
                        "POST",
                        { rubles: access.pending?.rubles ?? access.rubles },
                      );
                      await load();
                      if (r.enabled) ctx.refresh();
                    })
                  }
                >
                  Создать заказ на доступ
                </button>
              )}
              {access.pending?.id && (
                <button
                  disabled={busy}
                  className="ghost"
                  onClick={() =>
                    void act(async () => {
                      const r = await request("masters/access/verify", "POST", {
                        id: access.pending.id,
                      });
                      await load();
                      if (r.enabled) {
                        ctx.refresh();
                        ctx.toast("Доступ ведущего активирован");
                      } else
                        ctx.toast(
                          r.state === "canceled"
                            ? "Платёж отменён"
                            : "Оплата ещё не подтверждена",
                        );
                    })
                  }
                >
                  Проверить оплату
                </button>
              )}
            </>
          ) : (
            <p>
              {offlineMode()
                ? "Для каталога нужен сервер с аккаунтами."
                : "Для покупки нужен аккаунт email и подключённая оплата на сервере."}
            </p>
          )}
        </>
      )}
      {profile && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              setProfile(
                await request("masters/mine", "PUT", {
                  ...profile,
                  tags: profile.tags.map((t) => t.trim()).filter(Boolean),
                }),
              );
              ctx.toast("Профиль ведущего сохранён");
            });
          }}
        >
          {Object.entries(fields).map(([key, label]) => (
            <Field label={label} key={key}>
              <input
                value={profile[key as keyof typeof fields]}
                onChange={(e) =>
                  setProfile({ ...profile, [key]: e.target.value })
                }
              />
            </Field>
          ))}
          <Field label="Жанры через запятую">
            <input
              value={profile.tags.join(",")}
              onChange={(e) =>
                setProfile({ ...profile, tags: e.target.value.split(",") })
              }
            />
          </Field>
          {["online", "offline"].map((id) => (
            <label className="check-line" key={id}>
              <input
                type="checkbox"
                checked={profile.formats.includes(id)}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    formats: e.target.checked
                      ? [...profile.formats, id]
                      : profile.formats.filter((f) => f !== id),
                  })
                }
              />
              {id === "online" ? "Онлайн" : "Очно"}
            </label>
          ))}
          <h3>Прайс</h3>
          {Object.entries(priceNames).map(([id, label]) => (
            <Field key={id} label={label + ", ₽"}>
              <input
                type="number"
                min="0"
                max="1000000"
                value={profile.pricing[id as keyof typeof defaultPricing]}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    pricing: { ...profile.pricing, [id]: +e.target.value },
                  })
                }
              />
            </Field>
          ))}
          <h3>Каталог услуг</h3>
          {profile.offers.map((offer, i) => (
            <fieldset key={i}>
              <Field label="Название услуги">
                <input
                  value={offer.name}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      offers: profile.offers.map((o, j) =>
                        j === i ? { ...o, name: e.target.value } : o,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="Описание">
                <input
                  value={offer.description}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      offers: profile.offers.map((o, j) =>
                        j === i ? { ...o, description: e.target.value } : o,
                      ),
                    })
                  }
                />
              </Field>
              <Field label="Цена, ₽">
                <input
                  type="number"
                  min="0"
                  value={offer.price}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      offers: profile.offers.map((o, j) =>
                        j === i ? { ...o, price: +e.target.value } : o,
                      ),
                    })
                  }
                />
              </Field>
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  setProfile({
                    ...profile,
                    offers: profile.offers.filter((_, j) => i !== j),
                  })
                }
              >
                Убрать услугу
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="ghost"
            onClick={() =>
              setProfile({
                ...profile,
                offers: [
                  ...profile.offers,
                  { name: "", description: "", price: 0 },
                ],
              })
            }
          >
            Добавить услугу
          </button>
          <label className="check-line">
            <input
              type="checkbox"
              checked={profile.visible}
              onChange={(e) =>
                setProfile({ ...profile, visible: e.target.checked })
              }
            />
            Принимать заявки из каталога
          </label>
          <button disabled={busy}>Сохранить мой прайс и профиль</button>
        </form>
      )}
    </section>
  );
}

export function pickMaster(ctx: AppContext, p: Profile) {
  sessionStorage.setItem("neustroy-selected-master", p.handle);
  ctx.go("builder");
}

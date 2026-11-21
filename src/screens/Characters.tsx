import { useEffect, useState } from "react";
import {
  Plus,
  BookOpen,
  Heart,
  Shield,
  Sparkles,
  Download,
  Trash2,
  Dices,
  RotateCcw,
  Printer,
  Palette,
  Check,
} from "lucide-react";
import type { AppContext } from "../main";
import { SheetImport, CharacterExtras } from "./Helpers";
import { request, saveFile } from "../api";
import { Busy, Empty, Field, Modal } from "../ui";
import { Octahedron, TriangleNet } from "../brand";
import { loadCatalog, type CatalogEntry } from "./Rules";
import {
  editions,
  sheetThemes,
  classFeatures,
  subclasses,
  baseEdition,
  type Edition,
} from "../rules";
import {
  stats,
  statNames,
  classes,
  skills,
  mod,
  signed,
  proficiency,
  maxHp,
  armorClass,
  spellDC,
  spellModifier,
  availableSpells,
  defaultCharacter,
  slotMax,
  check,
  cast,
  roll,
  characterSchema,
  classInfo,
  type Character,
  type ClassId,
} from "../domain";
type Sheet = { id: string; data: Character; revision: number };
const presets = (c: Character) => {
  const scores = { str: 8, dex: 14, con: 13, int: 10, wis: 12, cha: 10 };
  const ability = classInfo(c).ability;
  scores[ability] = 15;
  return scores;
};
export function ThemePicker({
  value,
  onChange,
}: {
  value: Character["theme"];
  onChange: (t: Character["theme"]) => void;
}) {
  return (
    <div className="theme-picker">
      {Object.entries(sheetThemes).map(([id, name]) => (
        <button
          key={id}
          className={`theme-choice ${value === id ? "selected" : ""}`}
          data-sheet-theme={id}
          onClick={() => onChange(id as Character["theme"])}
        >
          <span className="theme-preview">
            <TriangleNet theme={id} />
            <Octahedron />
          </span>
          <strong>{name}</strong>
          {value === id && <Check size={15} />}
        </button>
      ))}
    </div>
  );
}
export function Characters({ ctx }: { ctx: AppContext }) {
  const [sheets, setSheets] = useState<Sheet[]>(),
    [active, setActive] = useState<string>(),
    [c, setC] = useState<Character>(),
    [revision, setRevision] = useState(0),
    [tab, setTab] = useState("play"),
    [editStep, setEditStep] = useState(0),
    [create, setCreate] = useState(false),
    [createStep, setCreateStep] = useState(0),
    [draft, setDraft] = useState(defaultCharacter()),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [log, setLog] = useState<string[]>([]),
    [mode, setMode] = useState<"normal" | "advantage" | "disadvantage">(
      "normal",
    ),
    [circle, setCircle] = useState(1),
    [hpDelta, setHpDelta] = useState(1),
    [ability, setAbility] = useState(""),
    [remove, setRemove] = useState(false),
    [spellSearch, setSpellSearch] = useState(""),
    [onlyPrepared, setOnlyPrepared] = useState(false),
    [spellLimit, setSpellLimit] = useState(20),
    [catalog, setCatalog] = useState<CatalogEntry[]>([]),
    [packs, setPacks] = useState<any[]>([]);
  const load = () =>
    request<Sheet[]>("characters")
      .then((list) =>
        setSheets(
          list.map((s) => ({ ...s, data: characterSchema.parse(s.data) })),
        ),
      )
      .catch((e) => ctx.toast(e.message, true));
  useEffect(() => {
    load();
    loadCatalog()
      .then(setCatalog)
      .catch(() => {});
    request("rule-packs")
      .then(setPacks)
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  const open = (s: Sheet) => {
    if (
      dirty &&
      !window.confirm("Переключить лист и оставить изменения несохранёнными?")
    )
      return;
    setActive(s.id);
    setC(characterSchema.parse(s.data));
    setRevision(s.revision);
    setDirty(false);
    setAbility("");
    setLog([]);
    setTab("play");
  };
  const update = (patch: Partial<Character>) => {
    setC((value) => ({ ...value!, ...patch }));
    setDirty(true);
  };
  async function save(next = c) {
    if (!next || !active || busy) return;
    setBusy(true);
    try {
      const s = await request<Sheet>(`characters/${active}`, "PUT", {
        data: next,
        revision,
      });
      setC(s.data);
      setRevision(s.revision);
      setDirty(false);
      setSheets((list) => list?.map((x) => (x.id === s.id ? s : x)));
      return s;
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const addLog = (s: string) => setLog((l) => [s, ...l].slice(0, 30));
  const doCheck = (name: string, bonus: number) => {
    const r = check(bonus, mode);
    addLog(
      `${name}: ${r.total} (${r.dice.join(", ")}; ${signed(bonus)})${r.natural === 20 ? " · натуральная 20" : r.natural === 1 ? " · натуральная 1" : ""}`,
    );
  };
  async function castSpell(id: string) {
    if (!c) return;
    try {
      const r = cast(c, id, circle, mode);
      if (!(await save(r.character))) return;
      addLog(
        `${r.spell.name}: ${r.results.map((x, i) => `${r.results.length > 1 ? `луч ${i + 1}: ` : ""}${x.attack ? `атака ${x.attack.total} [${x.attack.dice.join(", ")}]${x.attack.natural === 20 ? " · крит" : x.attack.natural === 1 ? " · промах" : ""}; ` : ""}${x.damage ? `${r.spell.kind === "heal" ? "лечение" : "урон"} ${x.damage.total} [${x.damage.dice.join(", ")}]` : "эффект: см. описание"}`).join(" / ")}${r.spell.kind === "save" ? `; спасбросок ${r.spell.save}, Сл ${r.dc}` : ""}`,
      );
    } catch (e) {
      ctx.toast((e as Error).message, true);
    }
  }
  const identityFields = (
    value: Character,
    set: (p: Partial<Character>) => void,
  ) => (
    <>
      <div className="two-col">
        <Field label="Имя героя">
          <input
            required
            maxLength={80}
            value={value.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label="Уровень">
          <input
            type="number"
            min="1"
            max="20"
            value={value.level}
            onChange={(e) => {
              const level = Math.max(1, Math.min(20, +e.target.value));
              set({ level, spentSlots: {}, prepared: [] });
            }}
          />
        </Field>
        <Field label="Класс">
          <select
            value={value.classId}
            onChange={(e) => {
              const classId = e.target.value as ClassId;
              set({ classId, subclass: "", prepared: [], spentSlots: {} });
            }}
          >
            {Object.entries(classes).map(([id, cl]) => (
              <option value={id} key={id}>
                {cl.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Редакция правил">
          <select
            value={value.edition}
            onChange={(e) => {
              if (value.edition !== e.target.value)
                set({
                  edition: e.target.value as Edition,
                  subclass: "",
                  prepared: [],
                  spentSlots: {},
                });
            }}
          >
            {Object.entries(editions).map(([id, v]) => (
              <option value={id} key={id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {value.edition === "custom" && (
        <Field label="Основа для расчётов">
          <select
            value={value.rulesBase}
            onChange={(e) =>
              set({ rulesBase: e.target.value as Character["rulesBase"] })
            }
          >
            <option value="srd-2014">5e 2014</option>
            <option value="srd-2024">5e 2024</option>
          </select>
        </Field>
      )}
      {value.classId === "custom" && (
        <div className="custom-class-form">
          <div className="two-col">
            <Field label="Название своего класса">
              <input
                value={value.customClass.name}
                onChange={(e) =>
                  set({
                    customClass: { ...value.customClass, name: e.target.value },
                  })
                }
              />
            </Field>
            <Field label="Кость хитов">
              <select
                value={value.customClass.hitDie}
                onChange={(e) =>
                  set({
                    customClass: {
                      ...value.customClass,
                      hitDie: +e.target.value,
                    },
                  })
                }
              >
                {[4, 6, 8, 10, 12, 20].map((n) => (
                  <option value={n} key={n}>
                    d{n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Основная характеристика">
              <select
                value={value.customClass.ability}
                onChange={(e) =>
                  set({
                    customClass: {
                      ...value.customClass,
                      ability: e.target.value as (typeof stats)[number],
                    },
                  })
                }
              >
                {stats.map((s) => (
                  <option key={s} value={s}>
                    {statNames[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Прогрессия ячеек">
              <select
                value={value.customClass.caster}
                onChange={(e) =>
                  set({
                    customClass: {
                      ...value.customClass,
                      caster: e.target
                        .value as Character["customClass"]["caster"],
                    },
                  })
                }
              >
                <option value="none">Без заклинаний</option>
                <option value="full">Полный заклинатель</option>
                <option value="half">Половинный заклинатель</option>
                <option value="pact">Магия договора</option>
              </select>
            </Field>
          </div>
        </div>
      )}
      <div className="two-col">
        <Field label="Вид / происхождение">
          <input
            list="ancestry-options"
            value={value.ancestry}
            maxLength={80}
            onChange={(e) => set({ ancestry: e.target.value })}
          />
          <datalist id="ancestry-options">
            {catalog
              .filter(
                (x) => x.kind === "species" && x.edition === baseEdition(value),
              )
              .map((x) => (
                <option value={x.name} key={x.id} />
              ))}
          </datalist>
        </Field>
        <Field label="Предыстория">
          <input
            list="background-options"
            value={value.background}
            maxLength={100}
            onChange={(e) => set({ background: e.target.value })}
          />
          <datalist id="background-options">
            {catalog
              .filter(
                (x) =>
                  x.kind === "backgrounds" && x.edition === baseEdition(value),
              )
              .map((x) => (
                <option value={x.name} key={x.id} />
              ))}
          </datalist>
        </Field>
      </div>
      <Field label="Подкласс из SRD">
        <select
          value={value.subclass}
          onChange={(e) => set({ subclass: e.target.value })}
        >
          <option value="">Пока не выбран</option>
          {subclasses(value).map((x) => (
            <option key={x.key} value={x.key}>
              {x.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
  const scoreFields = (
    value: Character,
    set: (p: Partial<Character>) => void,
  ) => (
    <>
      <div className="row between">
        <h3>Шесть характеристик</h3>
        <button
          className="ghost"
          type="button"
          onClick={() => {
            const sorted = [15, 14, 13, 12, 10, 8];
            const primary = classInfo(value).ability;
            const order = [primary, ...stats.filter((s) => s !== primary)];
            set({
              scores: Object.fromEntries(
                order.map((s, i) => [s, sorted[i]]),
              ) as Character["scores"],
            });
          }}
        >
          Стандартный массив
        </button>
      </div>
      <p className="muted">
        Распределите 15, 14, 13, 12, 10, 8 или введите согласованные с мастером
        значения. Бонусы происхождения, предыстории и черт включите в итоговые
        числа.
      </p>
      <div className="stat-grid">
        {stats.map((s) => (
          <Field label={statNames[s]} key={s}>
            <input
              type="number"
              min="3"
              max="20"
              value={value.scores[s]}
              onChange={(e) =>
                set({
                  scores: {
                    ...value.scores,
                    [s]: Math.max(3, Math.min(20, +e.target.value)),
                  },
                })
              }
            />
            <small>Модификатор {signed(mod(value.scores[s]))}</small>
          </Field>
        ))}
      </div>
    </>
  );
  if (!sheets) return <Busy />;
  const f = c ? classFeatures(c) : [],
    spells = c ? availableSpells(c) : [],
    filteredSpells = spells.filter(
      (s) =>
        (!onlyPrepared || s.level === 0 || c!.prepared.includes(s.id)) &&
        `${s.name} ${s.text}`.toLowerCase().includes(spellSearch.toLowerCase()),
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ЛИСТЫ ПЕРСОНАЖЕЙ</span>
          <h1>Мои персонажи</h1>
          <p>
            Сначала история и характеристики. Потом — оформление под ваш мир.
          </p>
        </div>
        <div className="row">
          <SheetImport
            ctx={ctx}
            onDraft={(value) => {
              setDraft(value);
              setCreateStep(0);
              setCreate(true);
            }}
          />
          <button
            onClick={() => {
              setDraft(defaultCharacter());
              setCreateStep(0);
              setCreate(true);
            }}
          >
            <Plus size={17} />
            Создать героя
          </button>
        </div>
      </div>
      {!sheets.length ? (
        <Empty
          title="Пока нет персонажей"
          text="Создайте персонажа по базовым правилам или используйте собственную систему."
        >
          <button onClick={() => setCreate(true)}>Создать первого героя</button>
        </Empty>
      ) : (
        <>
          <div className="character-strip">
            {sheets.map((s) => (
              <button
                className={
                  active === s.id ? "character-tab selected" : "character-tab"
                }
                key={s.id}
                onClick={() => open(s)}
              >
                <span className="character-initial">{s.data.name[0]}</span>
                <span>
                  <strong>{s.data.name}</strong>
                  <small>
                    {classes[s.data.classId].name} · {s.data.level} ур. ·{" "}
                    {s.data.edition === "srd-2024"
                      ? "2024"
                      : s.data.edition === "custom"
                        ? "Свои"
                        : "2014"}
                  </small>
                </span>
              </button>
            ))}
          </div>
          {!c ? (
            <Empty
              title="Кто сегодня отправится в путь?"
              text="Откройте лист персонажа."
            />
          ) : (
            <div className="character-sheet" data-sheet-theme={c.theme}>
              <div className="sheet-decoration">
                <TriangleNet theme={c.theme} />
              </div>
              <div className="sheet-header">
                <div>
                  <span className="badge">{editions[c.edition].name}</span>
                  <h2>{c.name}</h2>
                  <p>
                    {c.ancestry} · {classInfo(c).name} · {c.level} уровень
                  </p>
                </div>
                <div className="row wrap">
                  <button
                    className="ghost icon-button"
                    aria-label="Печать листа"
                    onClick={() => window.print()}
                  >
                    <Printer size={18} />
                  </button>
                  <button
                    className="ghost icon-button"
                    aria-label="Экспорт листа"
                    onClick={() =>
                      saveFile(
                        new Blob([JSON.stringify(c, null, 2)], {
                          type: "application/json",
                        }),
                        `${c.name}.json`,
                      )
                    }
                  >
                    <Download size={18} />
                  </button>
                  <button
                    className="ghost icon-button"
                    aria-label="Удалить героя"
                    onClick={() => setRemove(true)}
                  >
                    <Trash2 size={18} />
                  </button>
                  <button
                    disabled={!dirty || busy}
                    onClick={async () => {
                      if (await save()) ctx.toast("Лист сохранён");
                    }}
                  >
                    {busy
                      ? "Сохраняем…"
                      : dirty
                        ? "Сохранить лист"
                        : "Сохранено"}
                  </button>
                </div>
              </div>
              <div className="tabs">
                {[
                  ["play", "За столом"],
                  ["spells", "Заклинания"],
                  ["edit", "Заполнить лист"],
                  ["appearance", "Оформление"],
                ].map(([id, n]) => (
                  <button
                    key={id}
                    className={tab === id ? "selected" : ""}
                    onClick={() => setTab(id)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="metric-grid">
                <div className="metric">
                  <Heart />
                  <strong>
                    {c.hp}
                    <small> / {maxHp(c)}</small>
                  </strong>
                  <span>Хиты · временные {c.tempHp}</span>
                </div>
                <div className="metric">
                  <Shield />
                  <strong>{armorClass(c)}</strong>
                  <span>Класс доспеха</span>
                </div>
                <div className="metric">
                  <Dices />
                  <strong>{signed(mod(c.scores.dex))}</strong>
                  <span>Инициатива</span>
                </div>
                <div className="metric">
                  <Sparkles />
                  <strong>{signed(proficiency(c.level))}</strong>
                  <span>Бонус мастерства</span>
                </div>
              </div>
              {tab === "play" && (
                <>
                  <div className="two-col">
                    <section className="card">
                      <h3>Характеристики и проверки</h3>
                      <Field label="Режим броска">
                        <select
                          value={mode}
                          onChange={(e) =>
                            setMode(e.target.value as typeof mode)
                          }
                        >
                          <option value="normal">Обычный</option>
                          <option value="advantage">Преимущество</option>
                          <option value="disadvantage">Помеха</option>
                        </select>
                      </Field>
                      <div className="stat-grid">
                        {stats.map((s) => (
                          <button
                            className="stat"
                            key={s}
                            onClick={() =>
                              doCheck(statNames[s], mod(c.scores[s]))
                            }
                          >
                            <span>{statNames[s]}</span>
                            <strong>{signed(mod(c.scores[s]))}</strong>
                            <small>{c.scores[s]}</small>
                          </button>
                        ))}
                      </div>
                      <h3>Спасброски</h3>
                      <div className="chips">
                        {stats.map((s) => (
                          <button
                            className="ghost"
                            key={s}
                            onClick={() =>
                              doCheck(
                                "Спасбросок · " + statNames[s],
                                mod(c.scores[s]) +
                                  (classes[c.classId].saves.includes(s)
                                    ? proficiency(c.level)
                                    : 0),
                              )
                            }
                          >
                            {statNames[s]}{" "}
                            {signed(
                              mod(c.scores[s]) +
                                (classes[c.classId].saves.includes(s)
                                  ? proficiency(c.level)
                                  : 0),
                            )}
                          </button>
                        ))}
                      </div>
                    </section>
                    <section className="card">
                      <h3>Состояние и отдых</h3>
                      <div className="row hp-control">
                        <input
                          aria-label="Количество хитов"
                          type="number"
                          min="1"
                          max="999"
                          value={hpDelta}
                          onChange={(e) =>
                            setHpDelta(
                              Math.max(1, Math.min(999, +e.target.value)),
                            )
                          }
                        />
                        <button
                          className="danger ghost"
                          disabled={busy}
                          onClick={() => {
                            const absorbed = Math.min(c.tempHp, hpDelta);
                            save({
                              ...c,
                              tempHp: c.tempHp - absorbed,
                              hp: Math.max(0, c.hp - hpDelta + absorbed),
                            });
                          }}
                        >
                          Урон
                        </button>
                        <button
                          className="ghost"
                          disabled={busy}
                          onClick={() =>
                            save({
                              ...c,
                              hp: Math.min(maxHp(c), c.hp + hpDelta),
                            })
                          }
                        >
                          Лечение
                        </button>
                      </div>
                      <div className="row wrap">
                        <button
                          className="ghost"
                          disabled={busy}
                          onClick={() =>
                            save({
                              ...c,
                              hp: maxHp(c),
                              tempHp: 0,
                              spentSlots: {},
                            })
                          }
                        >
                          <RotateCcw size={16} />
                          Долгий отдых
                        </button>
                        {classInfo(c).caster === "pact" && (
                          <button
                            className="ghost"
                            disabled={busy}
                            onClick={() => save({ ...c, spentSlots: {} })}
                          >
                            Короткий отдых · ячейки
                          </button>
                        )}
                      </div>
                      <h3>Умения по классу и уровню</h3>
                      <Field label="Доступное умение">
                        <select
                          value={ability}
                          onChange={(e) => setAbility(e.target.value)}
                        >
                          <option value="">Выберите способность</option>
                          {f.map((x) => (
                            <option value={x.id} key={x.id}>
                              {x.name} · с {x.level} ур.
                            </option>
                          ))}
                        </select>
                      </Field>
                      {ability && (
                        <p className="rule-description">
                          {f.find((x) => x.id === ability)?.text}
                        </p>
                      )}
                      <p className="muted">
                        Каталог учитывает выбранную редакцию и подкласс.
                        Ограничения применений и дополнительные условия смотрите
                        в описании.
                      </p>
                    </section>
                  </div>
                  <section className="card">
                    <h3>Навыки</h3>
                    <div className="skills-grid">
                      {Object.entries(skills).map(([id, s]) => {
                        const bonus =
                          mod(c.scores[s.stat]) +
                          proficiency(c.level) *
                            (c.expertise.includes(id)
                              ? 2
                              : c.proficientSkills.includes(id)
                                ? 1
                                : 0);
                        return (
                          <button
                            className="skill"
                            key={id}
                            onClick={() => doCheck(s.name, bonus)}
                          >
                            <span>
                              {c.expertise.includes(id)
                                ? "◆"
                                : c.proficientSkills.includes(id)
                                  ? "●"
                                  : "○"}{" "}
                              {s.name}
                            </span>
                            <strong>{signed(bonus)}</strong>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}
              {tab === "spells" && (
                <>
                  <section className="card">
                    <div className="section-title">
                      <h3>Магия вашей редакции</h3>
                      <span>
                        Атака {signed(proficiency(c.level) + spellModifier(c))}{" "}
                        · Сл {spellDC(c)}
                      </span>
                    </div>
                    <p className="muted">
                      Выберите известные / подготовленные заклинания. Количество
                      и условия сверяйте с умением Spellcasting вашего класса.
                      Редакции не смешиваются.
                    </p>
                    <div className="row wrap">
                      {slotMax(c).map(
                        (max, i) =>
                          max > 0 && (
                            <button
                              key={i}
                              className={circle === i + 1 ? "" : "ghost"}
                              onClick={() => setCircle(i + 1)}
                            >
                              {i + 1} круг ·{" "}
                              {Math.max(0, max - (c.spentSlots[i + 1] || 0))}/
                              {max}
                            </button>
                          ),
                      )}
                    </div>
                    <div className="two-col">
                      <Field label="Найти заклинание">
                        <input
                          type="search"
                          value={spellSearch}
                          onChange={(e) => {
                            setSpellSearch(e.target.value);
                            setSpellLimit(20);
                          }}
                          placeholder="Название или текст"
                        />
                      </Field>
                      <Field label="Режим атаки">
                        <select
                          value={mode}
                          onChange={(e) =>
                            setMode(e.target.value as typeof mode)
                          }
                        >
                          <option value="normal">Обычный</option>
                          <option value="advantage">Преимущество</option>
                          <option value="disadvantage">Помеха</option>
                        </select>
                      </Field>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={onlyPrepared}
                        onChange={(e) => setOnlyPrepared(e.target.checked)}
                      />
                      Только выбранные и заговоры
                    </label>
                    <small className="muted">
                      Доступно {spells.length} заклинаний класса и уровня. Для
                      полного справочника откройте библиотеку.
                    </small>
                  </section>
                  <div className="two-col">
                    {filteredSpells.slice(0, spellLimit).map((s) => (
                      <article className="card spell" key={s.id}>
                        <span className="badge">
                          {s.level === 0 ? "Заговор" : `${s.level} круг`} ·{" "}
                          {
                            {
                              attack: "Атака",
                              save: "Спасбросок",
                              auto: "Урон",
                              heal: "Лечение",
                              utility: "Эффект",
                            }[s.kind]
                          }
                        </span>
                        <h3>{s.name}</h3>
                        <details>
                          <summary>Описание и условия</summary>
                          <p className="rule-description">{s.text}</p>
                        </details>
                        <div className="row between">
                          {s.level > 0 ? (
                            <label className="check">
                              <input
                                type="checkbox"
                                checked={c.prepared.includes(s.id)}
                                onChange={(e) =>
                                  update({
                                    prepared: e.target.checked
                                      ? [...c.prepared, s.id]
                                      : c.prepared.filter((x) => x !== s.id),
                                  })
                                }
                              />
                              Выбрано
                            </label>
                          ) : (
                            <span className="muted">Без ячейки</span>
                          )}
                          <button
                            disabled={
                              busy ||
                              (s.level > 0 && !c.prepared.includes(s.id))
                            }
                            onClick={() => castSpell(s.id)}
                          >
                            Сотворить{s.level ? ` · ${circle} круг` : ""}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                  {filteredSpells.length > spellLimit && (
                    <button
                      className="ghost"
                      onClick={() => setSpellLimit(spellLimit + 20)}
                    >
                      Показать ещё
                    </button>
                  )}
                  {!spells.length && (
                    <Empty
                      title="У этого героя другая магия"
                      text="Умения класса доступны на вкладке «За столом». Собственные заклинания можно подключить пакетом правил."
                    />
                  )}
                  <p className="muted">
                    Сложные эффекты, количество целей, попадания, спасброски,
                    сопротивления и концентрацию разрешает мастер. Для урона,
                    который невозможно однозначно вывести из данных,
                    используется описание.
                  </p>
                </>
              )}
              {tab === "play" && active && (
                <CharacterExtras
                  id={active}
                  character={c}
                  revision={revision}
                  ctx={ctx}
                  onSaved={(row) => {
                    setC(row.data);
                    setRevision(row.revision);
                    setDirty(false);
                    setSheets((list) =>
                      list?.map((x) => (x.id === row.id ? row : x)),
                    );
                  }}
                />
              )}
              {tab === "edit" && (
                <section className="card sheet-editor">
                  <div className="edit-steps">
                    {[
                      "Герой и редакция",
                      "Характеристики",
                      "Владения и снаряжение",
                      "Пакеты и заметки",
                    ].map((n, i) => (
                      <button
                        key={n}
                        className={editStep === i ? "selected" : ""}
                        onClick={() => setEditStep(i)}
                      >
                        {i + 1}. {n}
                      </button>
                    ))}
                  </div>
                  {editStep === 0 && identityFields(c, update)}
                  {editStep === 1 && (
                    <>
                      {scoreFields(c, update)}
                      <div className="two-col">
                        <Field label="Текущие хиты">
                          <input
                            type="number"
                            min="0"
                            value={c.hp}
                            onChange={(e) =>
                              update({ hp: Math.max(0, +e.target.value) })
                            }
                          />
                        </Field>
                        <Field label="Временные хиты">
                          <input
                            type="number"
                            min="0"
                            value={c.tempHp}
                            onChange={(e) =>
                              update({ tempHp: Math.max(0, +e.target.value) })
                            }
                          />
                        </Field>
                      </div>
                      <p className="muted">
                        Максимум хитов по среднему значению кости: {maxHp(c)}.{" "}
                        <button
                          className="text-button"
                          onClick={() => update({ hp: maxHp(c) })}
                        >
                          Выставить полные хиты
                        </button>
                      </p>
                    </>
                  )}
                  {editStep === 2 && (
                    <>
                      <div className="two-col">
                        <Field label="Доспех">
                          <select
                            value={c.armor}
                            onChange={(e) =>
                              update({
                                armor: e.target.value as Character["armor"],
                              })
                            }
                          >
                            <option value="none">Без доспеха</option>
                            <option value="leather">Кожаный</option>
                            <option value="chain">Кольчуга</option>
                            <option value="plate">Латы</option>
                          </select>
                        </Field>
                        <label className="check">
                          <input
                            type="checkbox"
                            checked={c.shield}
                            onChange={(e) =>
                              update({ shield: e.target.checked })
                            }
                          />
                          Щит · +2 КД
                        </label>
                      </div>
                      <h3>Владения и компетентность</h3>
                      <p className="muted">
                        Сначала показаны классовые навыки. Остальные можно
                        выбрать для предыстории и других источников.
                      </p>
                      <div className="proficiency-editor">
                        {Object.entries(skills)
                          .sort(
                            ([a], [b]) =>
                              Number(classes[c.classId].skills.includes(b)) -
                              Number(classes[c.classId].skills.includes(a)),
                          )
                          .map(([id, s]) => (
                            <div key={id}>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  checked={c.proficientSkills.includes(id)}
                                  onChange={(e) =>
                                    update({
                                      proficientSkills: e.target.checked
                                        ? [...c.proficientSkills, id]
                                        : c.proficientSkills.filter(
                                            (x) => x !== id,
                                          ),
                                      expertise: c.expertise.filter(
                                        (x) => x !== id,
                                      ),
                                    })
                                  }
                                />
                                {s.name}
                                {classes[c.classId].skills.includes(id) && (
                                  <small>класс</small>
                                )}
                              </label>
                              <label className="check">
                                <input
                                  type="checkbox"
                                  disabled={!c.proficientSkills.includes(id)}
                                  checked={c.expertise.includes(id)}
                                  onChange={(e) =>
                                    update({
                                      expertise: e.target.checked
                                        ? [...c.expertise, id]
                                        : c.expertise.filter((x) => x !== id),
                                    })
                                  }
                                />
                                ×2
                              </label>
                            </div>
                          ))}
                      </div>
                      <Field label="Снаряжение, оружие, деньги и предметы">
                        <textarea
                          rows={6}
                          value={c.inventory}
                          onChange={(e) =>
                            update({ inventory: e.target.value })
                          }
                        />
                      </Field>
                      <Field label="Черты · по одной на строку">
                        <textarea
                          value={c.feats.join("\n")}
                          onChange={(e) =>
                            update({
                              feats: e.target.value.split("\n").slice(0, 50),
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                  {editStep === 3 && (
                    <>
                      <h3>Подключить собственные правила</h3>
                      {packs.length ? (
                        packs
                          .filter(
                            (p) =>
                              p.edition === "custom" ||
                              p.edition === baseEdition(c),
                          )
                          .map((p) => (
                            <div className="line-item" key={p.id}>
                              <div>
                                <strong>{p.name}</strong>
                                <p>{p.description}</p>
                              </div>
                              <button
                                className="ghost"
                                onClick={() => {
                                  update({
                                    customSpells: [
                                      ...c.customSpells,
                                      ...p.spells.filter(
                                        (s: any) =>
                                          !c.customSpells.some(
                                            (v) => v.id === s.id,
                                          ),
                                      ),
                                    ],
                                    customFeatures: [
                                      ...c.customFeatures,
                                      ...p.features.filter(
                                        (s: any) =>
                                          !c.customFeatures.some(
                                            (v) => v.id === s.id,
                                          ),
                                      ),
                                    ],
                                  });
                                  ctx.toast(
                                    "Пакет добавлен в лист. Сохраните изменения.",
                                  );
                                }}
                              >
                                Добавить
                              </button>
                            </div>
                          ))
                      ) : (
                        <p className="muted">
                          Создайте свой пакет в библиотеке правил.
                        </p>
                      )}
                      <p className="muted">
                        В листе: {c.customSpells.length} своих заклинаний и{" "}
                        {c.customFeatures.length} способностей.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => ctx.go("rules")}
                      >
                        Открыть мастерскую правил
                      </button>
                      <Field label="Биография, заметки, состояния и ресурсы">
                        <textarea
                          rows={8}
                          value={c.notes}
                          onChange={(e) => update({ notes: e.target.value })}
                        />
                      </Field>
                    </>
                  )}
                  <div className="builder-actions">
                    <button
                      className="ghost"
                      disabled={editStep === 0}
                      onClick={() => setEditStep(editStep - 1)}
                    >
                      Назад
                    </button>
                    {editStep < 3 ? (
                      <button onClick={() => setEditStep(editStep + 1)}>
                        Продолжить
                      </button>
                    ) : (
                      <button disabled={busy || !dirty} onClick={() => save()}>
                        Сохранить заполненный лист
                      </button>
                    )}
                  </div>
                </section>
              )}
              {tab === "appearance" && (
                <section className="card">
                  <span className="eyebrow">ФОРМА СЛЕДУЕТ ЗА ИСТОРИЕЙ</span>
                  <h2>Одни правила. Ваше оформление.</h2>
                  <p>
                    Тема сохраняется вместе с персонажем и применяется к экрану
                    и печати. Числа и содержимое листа сохраняются при смене
                    оформления.
                  </p>
                  <ThemePicker
                    value={c.theme}
                    onChange={(theme) => update({ theme })}
                  />
                  <div className="row wrap">
                    <button disabled={!dirty || busy} onClick={() => save()}>
                      Сохранить оформление
                    </button>
                    <button className="ghost" onClick={() => window.print()}>
                      <Printer size={17} />
                      Печать / сохранить PDF
                    </button>
                  </div>
                </section>
              )}
              {log.length > 0 && (
                <section className="card roll-log">
                  <div className="section-title">
                    <h3>Летопись бросков</h3>
                    <button className="text-button" onClick={() => setLog([])}>
                      Очистить
                    </button>
                  </div>
                  {log.map((s, i) => (
                    <p key={i}>
                      <Dices size={16} />
                      {s}
                    </p>
                  ))}
                </section>
              )}
              <section className="print-sheet">
                <div className="print-title">
                  <Octahedron />
                  <div>
                    <h1>{c.name}</h1>
                    <p>
                      {classInfo(c).name} · {c.level} уровень ·{" "}
                      {editions[c.edition].name}
                    </p>
                    <p>
                      {c.ancestry} · {c.background}
                    </p>
                  </div>
                  <strong>neustroy</strong>
                </div>
                <TriangleNet theme={c.theme} />
                <div className="print-stats">
                  {stats.map((s) => (
                    <div key={s}>
                      <span>{statNames[s]}</span>
                      <strong>{c.scores[s]}</strong>
                      <small>{signed(mod(c.scores[s]))}</small>
                    </div>
                  ))}
                </div>
                <p>
                  Хиты {c.hp}/{maxHp(c)} · КД {armorClass(c)} · Инициатива{" "}
                  {signed(mod(c.scores.dex))} · Мастерство{" "}
                  {signed(proficiency(c.level))}
                </p>
                <div className="print-columns">
                  <div>
                    <h2>Навыки</h2>
                    {Object.entries(skills).map(([id, s]) => (
                      <p key={id}>
                        {s.name}:{" "}
                        {signed(
                          mod(c.scores[s.stat]) +
                            proficiency(c.level) *
                              (c.expertise.includes(id)
                                ? 2
                                : c.proficientSkills.includes(id)
                                  ? 1
                                  : 0),
                        )}
                      </p>
                    ))}
                    <h2>Снаряжение</h2>
                    <p>{c.inventory || "—"}</p>
                  </div>
                  <div>
                    <h2>Умения и черты</h2>
                    {f.map((x) => (
                      <p key={x.id}>
                        {x.name} · {x.level} ур.
                      </p>
                    ))}
                    <p>{c.feats.join(", ")}</p>
                    <h2>Заклинания</h2>
                    {spells
                      .filter((s) => s.level === 0 || c.prepared.includes(s.id))
                      .map((s) => (
                        <p key={s.id}>
                          {s.name} ·{" "}
                          {s.level === 0 ? "заговор" : s.level + " круг"}
                        </p>
                      ))}
                  </div>
                </div>
                <h2>История и заметки</h2>
                <p className="print-notes">{c.notes}</p>
              </section>
            </div>
          )}
        </>
      )}
      {create && (
        <Modal title="Новый герой" onClose={() => setCreate(false)}>
          <div className="edit-steps">
            {["Система", "Персонаж", "Характеристики"].map((n, i) => (
              <button
                key={n}
                className={i === createStep ? "selected" : ""}
                onClick={() => setCreateStep(i)}
              >
                {i + 1}. {n}
              </button>
            ))}
          </div>
          {createStep === 0 && (
            <>
              <p>
                Правила и оформление выбираются независимо. Редакцию можно
                изменить позже, пересмотрев способности и заклинания.
              </p>
              <div className="edition-tabs vertical">
                {Object.entries(editions).map(([id, e]) => (
                  <button
                    key={id}
                    className={draft.edition === id ? "selected" : ""}
                    onClick={() =>
                      setDraft({ ...draft, edition: id as Edition })
                    }
                  >
                    <BookOpen />
                    <span>
                      {e.name}
                      <small>{e.source}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {createStep === 1 &&
            identityFields(draft, (patch) => setDraft({ ...draft, ...patch }))}
          {createStep === 2 &&
            scoreFields(draft, (patch) => setDraft({ ...draft, ...patch }))}
          <div className="builder-actions">
            <button
              className="ghost"
              disabled={!createStep}
              onClick={() => setCreateStep(createStep - 1)}
            >
              Назад
            </button>
            {createStep < 2 ? (
              <button onClick={() => setCreateStep(createStep + 1)}>
                Продолжить
              </button>
            ) : (
              <button
                disabled={busy || !draft.name.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const sheet = await request<Sheet>("characters", "POST", {
                      ...draft,
                      hp: maxHp(draft),
                    });
                    setDirty(false);
                    setSheets((s) => [sheet, ...(s || [])]);
                    setActive(sheet.id);
                    setC(sheet.data);
                    setRevision(sheet.revision);
                    setCreate(false);
                    setTab("appearance");
                    ctx.toast("Герой создан. Можно выбрать оформление.");
                  } catch (e) {
                    ctx.toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Создать и выбрать оформление
              </button>
            )}
          </div>
        </Modal>
      )}
      {remove && (
        <Modal title="Удалить героя?" onClose={() => setRemove(false)}>
          <p>
            Лист «{c?.name}» будет удалён. Сохраните экспорт, если хотите
            оставить копию.
          </p>
          <button
            className="danger"
            onClick={async () => {
              try {
                await request(`characters/${active}`, "DELETE");
                setActive(undefined);
                setC(undefined);
                setDirty(false);
                setRemove(false);
                load();
              } catch (e) {
                ctx.toast((e as Error).message, true);
              }
            }}
          >
            Удалить лист
          </button>
        </Modal>
      )}
    </>
  );
}

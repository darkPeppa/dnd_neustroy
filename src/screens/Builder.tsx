import { useEffect, useState } from "react";
import { Sparkles, Check, CalendarDays, RotateCcw } from "lucide-react";
import type { AppContext } from "../main";
import { request } from "../api";
import {
  price,
  bookingSchema,
  defaultCharacter,
  type Booking,
} from "../domain";
import { Field, money, dateTime, localInput } from "../ui";
const initial = {
  format: "online",
  players: 4,
  age: "adults",
  hours: 4,
  experience: "none",
  rules: "simple",
  characters: "ready",
  characterDetails: "",
  genres: [],
  mood: "На усмотрение мастера",
  settings: [],
  extras: [],
  wishes: "",
  alternatives: "",
  name: "",
  channel: "telegram",
  contact: "",
  consent: false,
  start: "",
};
import { MasterFinder, type Profile } from "./MasterDirectory";
const steps = [
  "Компания",
  "Опыт и правила",
  "Персонажи",
  "Жанр и атмосфера",
  "Мир истории",
  "Дата и время",
  "Особые детали",
  "Ваша заявка",
];
export function Builder({ ctx }: { ctx: AppContext }) {
  const [step, setStep] = useState(0),
    [form, setForm] = useState<any>(() => {
      try {
        return {
          ...initial,
          ...JSON.parse(localStorage.getItem("questbook-booking") || "{}"),
        };
      } catch {
        return initial;
      }
    }),
    [busy, setBusy] = useState(false),
    [submitted, setSubmitted] = useState<any>(),
    [availability, setAvailability] = useState<any>(),
    [availabilityError, setAvailabilityError] = useState(""),
    [master, setMaster] = useState<Profile>(),
    [showMasters, setShowMasters] = useState(false);
  useEffect(() => {
    request<Profile[]>("masters")
      .then((rows) => {
        const chosen = sessionStorage.getItem("neustroy-selected-master");
        setMaster(rows.find((r) => r.handle === chosen) || rows[0]);
      })
      .catch(() => {});
  }, []);
  const prices = master?.pricing || ctx.settings.pricing;
  const patch = (p: any) => setForm((f: any) => ({ ...f, ...p }));
  useEffect(() => {
    localStorage.setItem("questbook-booking", JSON.stringify(form));
  }, [form]);
  async function loadAvailability() {
    setAvailabilityError("");
    const start = new Date();
    const end = new Date(Date.now() + 30 * 86400000);
    try {
      setAvailability(
        await request(
          `availability?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}${master ? "&master=" + encodeURIComponent(master.handle) : ""}`,
        ),
      );
    } catch (e) {
      setAvailabilityError((e as Error).message);
    }
  }
  useEffect(() => {
    if (step === 5) loadAvailability();
  }, [step, master?.handle]);
  const quote = price(form, prices);
  const choices = (
    key: string,
    values: [string, string][],
    multiple = false,
  ) => (
    <div className="choice-grid">
      {values.map(([value, label]) => {
        const active = multiple
          ? form[key].includes(value)
          : form[key] === value;
        return (
          <button
            type="button"
            className={`choice ${active ? "selected" : ""}`}
            key={value}
            onClick={() =>
              patch({
                [key]: multiple
                  ? active
                    ? form[key].filter((x: string) => x !== value)
                    : [...form[key], value]
                  : value,
              })
            }
          >
            {label}
            {active && <Check size={16} />}
          </button>
        );
      })}
    </div>
  );
  const surprise = () => {
    if (step === 0) patch({ format: "surprise", age: "surprise" });
    if (step === 1) patch({ experience: "surprise", rules: "surprise" });
    if (step === 2) patch({ characters: "surprise", characterDetails: "" });
    if (step === 3) patch({ genres: [], mood: "На усмотрение мастера" });
    if (step === 4) patch({ settings: [] });
    if (step === 5)
      patch({ start: "", alternatives: "Согласуем удобную дату лично" });
    if (step === 6) patch({ extras: [], wishes: "Просто сделайте красиво!" });
    setStep(Math.min(7, step + 1));
  };
  const slots = Array.from({ length: 14 }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i + 1);
    return {
      date,
      slots: [12, 16, 19]
        .filter((h) => h + form.hours <= 24)
        .map((h) => {
          const d = new Date(date);
          d.setHours(h, 0, 0, 0);
          return d;
        }),
    };
  });
  const summary = (key: string) =>
    (
      ({
        format: {
          online: "Онлайн",
          offline: "Офлайн",
          surprise: "На выбор мастера",
        },
        age: { adults: "Взрослые", children: "Дети", surprise: "Обсудим" },
        characters: {
          ready: "Готовые листы",
          custom: "Листы от мастера",
          self: "Свои персонажи",
          surprise: "На выбор мастера",
        },
        rules: {
          base: "Базовые",
          simple: "Упрощённые",
          "very-simple": "Сильно упрощённые",
          surprise: "На выбор мастера",
        },
      }) as any
    )[key]?.[form[key]] || form[key];
  if (submitted)
    return (
      <section className="success card">
        <span className="success-icon">
          <Check size={32} />
        </span>
        <span className="eyebrow">НАЧАЛО НОВОЙ ИСТОРИИ</span>
        <h1>Заявка у мастера.</h1>
        <p>
          Сохранена под номером <strong>{submitted.id.slice(0, 8)}</strong>.
          <br />
          Предварительная стоимость: {money(submitted.total)}.
        </p>
        <p>
          Дата будет забронирована после подтверждения мастером. Статус заявки
          доступен в настройках.
        </p>
        <p className="muted">
          {ctx.me.integrations.google || ctx.me.integrations.telegram
            ? "Настроенные уведомления поставлены в очередь отправки."
            : "Внешние уведомления ещё не подключены. Заявка сохранена в приложении."}
        </p>
        <div className="row">
          <button onClick={() => ctx.go("settings")}>Мои заявки</button>
          <button
            className="ghost"
            onClick={() => {
              setSubmitted(undefined);
              setStep(0);
              setForm(initial);
            }}
          >
            Ещё одно приключение
          </button>
        </div>
      </section>
    );
  return (
    <>
      <section className="card">
        <strong>Ведущий · {master?.name || "neustroy"}</strong>
        <button className="ghost" onClick={() => setShowMasters(!showMasters)}>
          {showMasters ? "Свернуть каталог" : "Выбрать ведущего"}
        </button>
      </section>
      {showMasters && (
        <MasterFinder
          ctx={ctx}
          selected={master?.handle}
          onPick={(p) => {
            setMaster(p);
            sessionStorage.setItem("neustroy-selected-master", p.handle);
            setShowMasters(false);
          }}
        />
      )}
      <div className="page-heading">
        <div>
          <h1>Ваше идеальное приключение</h1>
          <p>
            Несколько вопросов — и у мастера появится замысел именно для вас.
          </p>
        </div>
        <button
          className="text-button"
          onClick={() => {
            if (window.confirm("Очистить сохранённый черновик?")) {
              setForm(initial);
              setStep(0);
            }
          }}
        >
          <RotateCcw size={15} />
          Начать заново
        </button>
      </div>
      <div className="builder-layout">
        <div>
          <div className="step-progress">
            {steps.map((s, i) => (
              <button
                key={s}
                title={s}
                className={i === step ? "current" : i < step ? "done" : ""}
                onClick={() => setStep(i)}
                aria-label={`${i + 1}. ${s}`}
              >
                {i < step ? <Check size={15} /> : i + 1}
              </button>
            ))}
          </div>
          <section className="card builder-card">
            <span className="eyebrow">
              ШАГ {step + 1} ИЗ {steps.length}
            </span>
            <h2>
              {
                [
                  "С кем отправляемся в путь?",
                  "Насколько вы знакомы с игрой?",
                  "Кто станет героем истории?",
                  "Какой будет эта история?",
                  "Где начнётся приключение?",
                  "Освободим вечер для магии?",
                  "Добавим что-то особенное?",
                  "Осталось познакомиться.",
                ][step]
              }
            </h2>
            {step === 0 && (
              <>
                <Field label="Формат игры">
                  {choices("format", [
                    ["online", "Онлайн"],
                    ["offline", "За одним столом"],
                    ["surprise", "Помогите выбрать"],
                  ])}
                </Field>
                <div className="two-col">
                  <Field label={`Игроков: ${form.players}`}>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      value={form.players}
                      onChange={(e) => patch({ players: +e.target.value })}
                    />
                  </Field>
                  <Field label={`Длительность: ${form.hours} ч`}>
                    <input
                      type="range"
                      min="2"
                      max="8"
                      value={form.hours}
                      onChange={(e) =>
                        patch({ hours: +e.target.value, start: "" })
                      }
                    />
                  </Field>
                </div>
                <Field label="Возраст участников">
                  {choices("age", [
                    ["adults", "Взрослые"],
                    ["children", "Дети"],
                    ["surprise", "Обсудим лично"],
                  ])}
                </Field>
              </>
            )}
            {step === 1 && (
              <>
                <Field label="Опыт в D&D или других НРИ">
                  {choices("experience", [
                    ["none", "Совсем нет — это наша первая игра"],
                    ["little", "Немного · 1–3 игры"],
                    ["medium", "Играем время от времени"],
                    ["expert", "Большой опыт"],
                    ["surprise", "Расскажем при знакомстве"],
                  ])}
                </Field>
                <Field label="Правила">
                  {choices("rules", [
                    ["base", "Базовые — по всем правилам"],
                    ["simple", "Упрощённые — больше истории"],
                    ["very-simple", "Сильно упрощённые — только самое нужное"],
                    ["surprise", "Пусть мастер подберёт"],
                  ])}
                </Field>
              </>
            )}
            {step === 2 && (
              <>
                <Field label="Подготовка листов">
                  {choices("characters", [
                    ["ready", "Выберем из готовых"],
                    ["custom", "Опишем идею — мастер составит листы"],
                    ["self", "Составим самостоятельно"],
                    ["surprise", "Просто сделайте красиво"],
                  ])}
                </Field>
                {form.characters === "ready" && (
                  <>
                    <p className="muted">
                      Стартовые варианты. Выберите по одному для каждого игрока
                      — мастер уточнит состав партии.
                    </p>
                    <div className="two-col">
                      {Array.from({ length: form.players }, (_, i) => (
                        <Field key={i} label={`Игрок ${i + 1}`}>
                          <select
                            value={
                              form.characterDetails.split("|")[i] || "Не выбран"
                            }
                            onChange={(e) => {
                              const selected = Array.from(
                                { length: form.players },
                                (_, j) =>
                                  form.characterDetails.split("|")[j] ||
                                  "Не выбран",
                              );
                              selected[i] = e.target.value;
                              patch({ characterDetails: selected.join("|") });
                            }}
                          >
                            {[
                              "Не выбран",
                              "Воин · защитник",
                              "Плут · разведчик",
                              "Волшебник · исследователь",
                              "Жрец · целитель",
                            ].map((n) => (
                              <option key={n}>{n}</option>
                            ))}
                          </select>
                        </Field>
                      ))}
                    </div>
                  </>
                )}
                {form.characters === "custom" && (
                  <Field label="Класс, происхождение, предыстория для каждого игрока">
                    <textarea
                      rows={5}
                      placeholder="Игрок 1: плут, эльф, бывший придворный…"
                      value={form.characterDetails}
                      onChange={(e) =>
                        patch({ characterDetails: e.target.value })
                      }
                    />
                  </Field>
                )}
                {form.characters === "self" && (
                  <>
                    <p>
                      В личном кабинете есть редактор листов с автоматическими
                      расчётами.
                    </p>
                    <button
                      className="ghost"
                      onClick={() => ctx.go("characters")}
                    >
                      Открыть листы персонажей
                    </button>
                  </>
                )}
              </>
            )}
            {step === 3 && (
              <>
                <Field label="Жанры · можно несколько">
                  {choices(
                    "genres",
                    [
                      "Детектив",
                      "Ужасы",
                      "Комедия",
                      "Драма",
                      "Романтика",
                      "Триллер",
                      "Экшен",
                      "Приключение",
                    ].map((s) => [s, s]),
                    true,
                  )}
                </Field>
                <Field label="Атмосфера">
                  {choices(
                    "mood",
                    [
                      "Лёгкая и уютная",
                      "Серьёзная и драматичная",
                      "Хаотичная и весёлая",
                      "Реалистичная и напряжённая",
                      "На усмотрение мастера",
                    ].map((s) => [s, s]),
                  )}
                </Field>
              </>
            )}
            {step === 4 && (
              <>
                <Field label="Выберите мир · можно несколько">
                  {choices(
                    "settings",
                    [
                      "Классическое фэнтези",
                      "Азиатское фэнтези",
                      "Славянское фэнтези",
                      "Вампиры",
                      "Fairycore",
                      "Современность",
                      "Космос",
                      "Постапокалипсис",
                      "Академия магии",
                      "Пираты",
                      "Киберпанк",
                      "Сказочный лес",
                      "Аниме",
                      "Мир любимого фэндома",
                    ].map((s) => [s, s]),
                    true,
                  )}
                </Field>
                <Field label="Ваш мир или фэндом">
                  <input
                    value={form.customSetting || ""}
                    placeholder="Название и что вам в нём нравится"
                    onChange={(e) => patch({ customSetting: e.target.value })}
                  />
                </Field>
                <p className="muted">
                  Если не выбирать мир, мастер предложит подходящий.
                </p>
              </>
            )}
            {step === 5 && (
              <>
                <p>
                  Выберите начало игры. Время показано в вашем часовом поясе:{" "}
                  <strong>
                    {Intl.DateTimeFormat().resolvedOptions().timeZone}
                  </strong>
                  .
                </p>
                <p className="muted">
                  {availability?.externalConnected
                    ? "Учитываем подтверждённые игры и Google Календарь мастера."
                    : "Учитываем подтверждённые игры в приложении. Внешний календарь мастера пока не подключён."}
                </p>
                {availabilityError && (
                  <p className="error-text">
                    {availabilityError}{" "}
                    <button className="text-button" onClick={loadAvailability}>
                      Повторить
                    </button>
                  </p>
                )}
                <div className="booking-slots">
                  {availability &&
                    slots.map((day) => (
                      <div key={day.date.toDateString()}>
                        <span>
                          {day.date.toLocaleDateString("ru", {
                            day: "numeric",
                            month: "short",
                            weekday: "short",
                          })}
                        </span>
                        <div>
                          {day.slots.map((date) => {
                            const start = date.toISOString(),
                              end = new Date(
                                +date + form.hours * 3600000,
                              ).toISOString(),
                              occupied = availability.busy.some(
                                (b: any) => b.start < end && b.end > start,
                              );
                            return (
                              <button
                                className={form.start === start ? "" : "ghost"}
                                disabled={occupied}
                                key={start}
                                onClick={() => patch({ start })}
                              >
                                {date.getHours()}:00
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
                <Field label="Или предложите другую дату">
                  <input
                    type="datetime-local"
                    min={localInput(new Date())}
                    value={form.start ? localInput(new Date(form.start)) : ""}
                    onChange={(e) =>
                      patch({
                        start: e.target.value
                          ? new Date(e.target.value).toISOString()
                          : "",
                      })
                    }
                  />
                </Field>
                <Field label="Другие удобные окна или комментарий к дате">
                  <textarea
                    value={form.alternatives}
                    placeholder="Например, по субботам после 16:00"
                    onChange={(e) => patch({ alternatives: e.target.value })}
                  />
                </Field>
                <small className="muted">
                  Выбор времени — пожелание. Окончательную доступность проверим
                  при подтверждении.
                </small>
              </>
            )}
            {step === 6 && (
              <>
                <Field label="Дополнительные услуги">
                  {choices(
                    "extras",
                    [
                      [
                        "chronicle",
                        `Иллюстрированная хроника · ${money(prices.chronicle)}`,
                      ],
                      ["video", `Видеозапись · ${money(prices.video)}`],
                      [
                        "miniatures",
                        `Миниатюры · ${money(prices.miniatures)} за игрока`,
                      ],
                    ],
                    true,
                  )}
                </Field>
                <Field label="Пожелания, темы, которых стоит избегать, доступность площадки">
                  <textarea
                    rows={6}
                    value={form.wishes}
                    onChange={(e) => patch({ wishes: e.target.value })}
                    placeholder="Всё, что поможет сделать игру вашей"
                  />
                </Field>
              </>
            )}
            {step === 7 && (
              <>
                <div className="summary-box">
                  {[
                    ["Формат", summary("format")],
                    ["Партия", `${form.players} игроков · ${summary("age")}`],
                    ["Правила", summary("rules")],
                    ["Персонажи", summary("characters")],
                    ["Жанры", form.genres.join(", ") || "На выбор мастера"],
                    ["Атмосфера", form.mood],
                    [
                      "Мир",
                      [...form.settings, form.customSetting || ""]
                        .filter(Boolean)
                        .join(", ") || "На выбор мастера",
                    ],
                    [
                      "Дата",
                      form.start ? dateTime(form.start) : "Согласуем лично",
                    ],
                  ].map(([n, v]) => (
                    <div className="line-item" key={n}>
                      <span>{n}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>
                <Field label="Как к вам обращаться">
                  <input
                    autoComplete="name"
                    required
                    maxLength={80}
                    value={form.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Field>
                <div className="two-col">
                  <Field label="Как с вами связаться">
                    <select
                      value={form.channel}
                      onChange={(e) => patch({ channel: e.target.value })}
                    >
                      <option value="telegram">Telegram</option>
                      <option value="email">Email</option>
                      <option value="phone">Телефон</option>
                    </select>
                  </Field>
                  <Field
                    label={
                      {
                        telegram: "Telegram @username",
                        email: "Email",
                        phone: "Телефон",
                      }[form.channel as string] || "Контакт"
                    }
                  >
                    <input
                      type={
                        form.channel === "email"
                          ? "email"
                          : form.channel === "phone"
                            ? "tel"
                            : "text"
                      }
                      autoComplete={
                        form.channel === "email"
                          ? "email"
                          : form.channel === "phone"
                            ? "tel"
                            : "off"
                      }
                      value={form.contact}
                      onChange={(e) => patch({ contact: e.target.value })}
                    />
                  </Field>
                </div>
                <label className="check consent">
                  <input
                    type="checkbox"
                    checked={form.consent}
                    onChange={(e) => patch({ consent: e.target.checked })}
                  />
                  Разрешаю использовать указанные контакты, чтобы обработать мою
                  заявку и связаться по поводу игры.
                </label>
                <p className="muted">
                  Это заявка без оплаты. Стоимость предварительная, дата требует
                  подтверждения.{" "}
                  {form.channel === "phone"
                    ? "По телефону мастер свяжется вручную."
                    : form.channel === "telegram"
                      ? "Чтобы бот присылал подтверждения в Telegram, сначала нужно начать с ним диалог."
                      : ""}
                </p>
              </>
            )}
            <div className="builder-actions">
              <button
                className="ghost"
                disabled={step === 0 || busy}
                onClick={() => setStep(step - 1)}
              >
                Назад
              </button>
              {step < 7 ? (
                <button onClick={() => setStep(step + 1)}>Продолжить</button>
              ) : (
                <button
                  disabled={busy || !form.consent}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const data = bookingSchema.parse({
                        ...form,
                        masterHandle: master?.handle,
                        start: form.start || undefined,
                        settings: [
                          ...form.settings,
                          ...(form.customSetting ? [form.customSetting] : []),
                        ],
                      });
                      const result = await request("bookings", "POST", data);
                      setSubmitted(result);
                      localStorage.removeItem("questbook-booking");
                    } catch (e) {
                      ctx.toast((e as Error).message, true);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {busy ? "Отправляем…" : "Отправить заявку"}
                </button>
              )}
            </div>
            {step < 7 && (
              <button className="surprise-button" onClick={surprise}>
                <Sparkles size={16} />
                Просто сделайте красиво
              </button>
            )}
          </section>
        </div>
        <aside>
          <section className="card quote">
            <span className="eyebrow">ВАШЕ ПРИКЛЮЧЕНИЕ</span>
            <h3>
              История начинается
              <br />с хорошей компании.
            </h3>
            <div className="quote-meta">
              {form.players} игроков · {form.hours} часов
              <br />
              {summary("format")}
            </div>
            {quote.rows.map((r) => (
              <div className="line-item" key={r.name}>
                <span>{r.name}</span>
                <strong>{money(r.amount)}</strong>
              </div>
            ))}
            <div className="quote-total">
              <span>Предварительно</span>
              <strong>{money(quote.total)}</strong>
            </div>
            <small>
              Тестовый прайс. Итог мастер подтвердит при согласовании игры.
              Оплаты на этом этапе нет.
            </small>
            <div className="quote-save">
              <Check size={15} />
              Черновик сохраняется на устройстве
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

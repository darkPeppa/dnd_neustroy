import { TelegramConnection, ServiceConnections } from "./Connections";
import { useEffect, useState } from "react";
import { MasterOffice } from "./MasterDirectory";
import { AgentToggle } from "./AgentSettings";
import { Settings, Check, Copy, Bell, Download } from "lucide-react";
import type { AppContext } from "../main";
import { request, enablePush, saveFile, offlineMode } from "../api";
import { ics } from "../domain";
import { Field, Empty, Modal, money, dateTime, localInput } from "../ui";
export function Admin({ ctx }: { ctx: AppContext }) {
  const [config, setConfig] = useState(ctx.settings),
    [bookings, setBookings] = useState<any[]>([]),
    [outbox, setOutbox] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [tab, setTab] = useState("bookings"),
    [setupKey, setSetupKey] = useState(""),
    [localName, setLocalName] = useState(ctx.me.user.name);
  async function load() {
    try {
      setBookings(await request("bookings"));
      if (ctx.me.isAdmin) setOutbox(await request("outbox"));
    } catch (e) {
      ctx.toast((e as Error).message, true);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function perform(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      ctx.toast(message);
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ЗА КУЛИСАМИ ПРИКЛЮЧЕНИЯ</span>
          <h1>Настройки и заявки</h1>
          <p>Заявки, подключение телефона и инструменты мастера.</p>
        </div>
      </div>
      <div className="tabs">
        {[
          ["bookings", "Мои заявки"],
          ["master", "Кабинет ведущего"],
          ["devices", "Устройства и доступ"],
          ...(ctx.me.isAdmin
            ? [
                ["config", "Сервис"],
                ["integrations", "Интеграции"],
              ]
            : []),
        ].map(([v, n]) => (
          <button
            className={tab === v ? "selected" : ""}
            onClick={() => setTab(v)}
            key={v}
          >
            {n}
          </button>
        ))}
      </div>
      {tab === "master" && <MasterOffice ctx={ctx} />}
      {tab === "devices" && <AgentToggle ctx={ctx} />}
      {tab === "bookings" && (
        <>
          {!bookings.length ? (
            <Empty
              title="Первая история ещё впереди"
              text="Отправьте заявку через конструктор приключений."
            >
              <button onClick={() => ctx.go("builder")}>
                Создать приключение
              </button>
            </Empty>
          ) : (
            bookings.map((b) => (
              <article className="card" key={b.id}>
                <div className="row between">
                  <span
                    className={`badge ${b.status === "confirmed" ? "green" : ""}`}
                  >
                    {
                      {
                        pending: "Ждёт подтверждения",
                        confirmed: "Бронь подтверждена",
                        declined: "Не подтверждена",
                      }[b.status as string]
                    }
                  </span>
                  <small>
                    № {b.id.slice(0, 8)} · {dateTime(b.created_at)}
                  </small>
                </div>
                <h2>
                  {b.data.name} · {b.data.players} игроков · {b.data.hours} ч
                </h2>
                <p>
                  {b.data.start ? dateTime(b.data.start) : "Дата согласуется"} ·{" "}
                  {b.data.format} · {money(b.total)}
                </p>
                <p>
                  {b.data.genres.join(", ")} · {b.data.settings.join(", ")} ·{" "}
                  {b.data.mood}
                </p>
                <details>
                  <summary>Полная анкета</summary>
                  <div className="booking-details">
                    {Object.entries(b.data)
                      .filter(([k]) => k !== "consent")
                      .map(([k, v]) => (
                        <div className="line-item" key={k}>
                          <span>
                            {{
                              format: "Формат",
                              players: "Игроки",
                              age: "Возраст",
                              hours: "Часов",
                              experience: "Опыт",
                              rules: "Правила",
                              characters: "Листы",
                              characterDetails: "Персонажи",
                              genres: "Жанры",
                              mood: "Атмосфера",
                              settings: "Сеттинг",
                              extras: "Доп. услуги",
                              wishes: "Пожелания",
                              start: "Дата (UTC)",
                              alternatives: "Другие окна",
                              name: "Имя",
                              channel: "Канал связи",
                              contact: "Контакт",
                            }[k] || k}
                          </span>
                          <strong>
                            {Array.isArray(v) ? v.join(", ") : String(v)}
                          </strong>
                        </div>
                      ))}
                  </div>
                </details>
                <p>
                  Связаться: {b.data.channel} · {b.data.contact}
                </p>
                {b.status === "confirmed" && (
                  <button
                    className="ghost"
                    onClick={() =>
                      saveFile(
                        new Blob(
                          [
                            ics(
                              "Игра с мастером · Questbook",
                              b.data.start,
                              new Date(
                                Date.parse(b.data.start) +
                                  b.data.hours * 3600000,
                              ).toISOString(),
                              b.id,
                            ),
                          ],
                          { type: "text/calendar;charset=utf-8" },
                        ),
                        "questbook-booking.ics",
                      )
                    }
                  >
                    <Download size={16} />
                    Добавить в календарь
                  </button>
                )}
                {b.gm_id === ctx.me.user.id && b.status === "pending" && (
                  <>
                    <Field label="Согласованная дата · ваше местное время">
                      <input
                        type="datetime-local"
                        defaultValue={
                          b.data.start ? localInput(new Date(b.data.start)) : ""
                        }
                        onBlur={(e) => {
                          if (e.target.value)
                            perform(
                              () =>
                                request(`bookings/${b.id}`, "PATCH", {
                                  start: new Date(e.target.value).toISOString(),
                                }),
                              "Дата заявки обновлена",
                            );
                        }}
                      />
                    </Field>
                    <div className="row">
                      <button
                        disabled={busy || !b.data.start}
                        onClick={() =>
                          perform(
                            () => request(`bookings/${b.id}/confirm`, "POST"),
                            "Бронь подтверждена",
                          )
                        }
                      >
                        Подтвердить бронь
                      </button>
                      <button
                        disabled={busy}
                        className="ghost"
                        onClick={() =>
                          perform(
                            () => request(`bookings/${b.id}/decline`, "POST"),
                            "Заявка отклонена",
                          )
                        }
                      >
                        Отклонить
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))
          )}
        </>
      )}
      {tab === "devices" && !offlineMode() && ctx.me.accounts && (
        <TelegramConnection ctx={ctx} />
      )}
      {tab === "devices" && (
        <section className="card prose">
          <h2>Чтение и управление</h2>
          <div className="row wrap">
            {[
              ["large", "Крупный шрифт"],
              ["contrast", "Высокий контраст"],
              ["family", "Простое семейное меню"],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  defaultChecked={
                    localStorage.getItem("neustroy-" + key) === "true"
                  }
                  onChange={(e) => {
                    localStorage.setItem(
                      "neustroy-" + key,
                      String(e.target.checked),
                    );
                    ctx.refresh();
                  }}
                />{" "}
                {label}
              </label>
            ))}
          </div>
          <h2>Ваш режим</h2>
          <p>
            {offlineMode()
              ? "На этом устройстве, без аккаунта. Данные не отправляются на сервер."
              : ctx.me.local && !ctx.me.accounts
                ? "Общая партия в локальной сети, без регистрации."
                : "Аккаунт в облаке. Вход по email и паролю или через ChatGPT."}
          </p>
          {ctx.me.local && !ctx.me.accounts && !offlineMode() && (
            <>
              <Field label="Имя в локальной партии">
                <input
                  value={localName}
                  onChange={(e) => setLocalName(e.target.value)}
                />
              </Field>
              <button
                className="ghost"
                onClick={() =>
                  perform(async () => {
                    await request("local/profile", "POST", { name: localName });
                    ctx.refresh();
                  }, "Имя обновлено")
                }
              >
                Сохранить имя
              </button>
            </>
          )}
          {offlineMode() ? (
            <button
              className="ghost"
              onClick={() => {
                localStorage.removeItem("neustroy-mode");
                location.assign("/");
              }}
            >
              Перейти ко входу в облако
            </button>
          ) : (
            <div className="row wrap">
              <button
                className="ghost"
                onClick={() => {
                  localStorage.setItem("neustroy-mode", "offline");
                  location.assign("/local");
                }}
              >
                Локально на этом устройстве
              </button>
              <button
                className="ghost"
                onClick={() =>
                  perform(async () => {
                    await request("auth/logout", "POST");
                    sessionStorage.removeItem("questbook-token");
                    location.reload();
                  }, "Вы вышли из аккаунта")
                }
              >
                Выйти из аккаунта
              </button>
            </div>
          )}
          <h2>Доступ через ChatGPT и агентов</h2>
          <p>
            Сервер MCP доступен по адресу <code>/mcp</code>. Агент может читать
            и заполнять ваши листы, искать правила, бросать кубики и видеть
            открытые вам улики. Модель выбирается в ChatGPT или Codex. Доступ к
            закрытым материалам по-прежнему проверяется на сервере.
          </p>
          <p className="muted">
            Подключение через плагин neustroy. Обычный аккаунт и аккаунт ChatGPT
            создают отдельные игровые профили; они не объединяются автоматически
            по email.
          </p>
          {!ctx.me.isAdmin && ctx.me.accounts && (
            <>
              <h2>Первичная настройка мастера</h2>
              <p>
                Если вы владелец сайта, введите одноразовый ключ настройки из
                файла <code>.local/accounts/admin-setup.txt</code> в исходном
                проекте или из /data/admin-setup.txt в контейнере.
              </p>
              <Field label="Ключ настройки владельца">
                <input
                  type="password"
                  value={setupKey}
                  onChange={(e) => setSetupKey(e.target.value)}
                />
              </Field>
              <button
                disabled={busy || !setupKey}
                onClick={() =>
                  perform(async () => {
                    await request("auth/claim-owner", "POST", { setupKey });
                    ctx.refresh();
                    setSetupKey("");
                  }, "Вы получили права владельца")
                }
              >
                Завершить настройку
              </button>
            </>
          )}
          <h2>Подключить мобильное приложение</h2>
          <p>
            Создайте код в веб-версии, откройте мобильную сборку и вставьте его
            на экране входа. Код действует 30 дней. Новый код отключает
            предыдущий.
          </p>
          <div className="row wrap">
            <button
              disabled={busy}
              onClick={() =>
                perform(async () => {
                  const r = await request("native-token", "POST");
                  setToken(r.token);
                }, "Код создан")
              }
            >
              Создать код подключения
            </button>
            <button
              className="ghost"
              onClick={() =>
                perform(
                  () => request("native-token", "DELETE"),
                  "Подключения отозваны",
                )
              }
            >
              Отключить мобильные устройства
            </button>
          </div>
          {token && (
            <Field label="Секретный код · сохраните только на своём устройстве">
              <input type="password" readOnly value={token} />
              <button
                className="ghost"
                onClick={() =>
                  navigator.clipboard
                    .writeText(token)
                    .then(() => ctx.toast("Код скопирован"))
                }
              >
                <Copy size={15} />
                Копировать код
              </button>
            </Field>
          )}
          <h2>Уведомления</h2>
          <p>
            Локальное напоминание за час включается у конкретной подтверждённой
            встречи. Push о подтверждении требует настройки FCM/APNs и
            серверного шлюза.
          </p>
          <button
            className="ghost"
            onClick={() =>
              enablePush()
                .then(() => ctx.toast("Запрошена регистрация устройства"))
                .catch((e) => ctx.toast(e.message, true))
            }
          >
            <Bell size={16} />
            Подключить push на телефоне
          </button>
        </section>
      )}
      {tab === "config" && ctx.me.isAdmin && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            perform(async () => {
              await request("settings", "PUT", config);
              ctx.refresh();
            }, "Настройки сохранены");
          }}
        >
          <Field label="Часовой пояс мастера">
            <input
              value={config.timezone}
              onChange={(e) =>
                setConfig({ ...config, timezone: e.target.value })
              }
            />
          </Field>
          {[
            ["about", "О мастере"],
            ["contact", "Контакты"],
            ["offer", "Публичная оферта · ваши условия и реквизиты"],
            ["agreement", "Пользовательское соглашение"],
          ].map(([k, label]) => (
            <Field key={k} label={label}>
              <textarea
                rows={k === "offer" || k === "agreement" ? 8 : 4}
                value={config[k]}
                onChange={(e) => setConfig({ ...config, [k]: e.target.value })}
              />
            </Field>
          ))}
          <button disabled={busy}>Сохранить настройки</button>
        </form>
      )}
      {tab === "integrations" && ctx.me.isAdmin && (
        <ServiceConnections ctx={ctx} />
      )}
      {tab === "integrations" && ctx.me.isAdmin && (
        <>
          <section className="card">
            <h2>Подключения</h2>
            <div className="integration-list">
              {[
                ["Telegram мастеру", ctx.me.integrations.telegram],
                ["Google Таблицы и Календарь", ctx.me.integrations.google],
                ["Шлюз мобильных push", ctx.me.integrations.push],
              ].map(([name, connected]) => (
                <div className="line-item" key={String(name)}>
                  <strong>{name}</strong>
                  <span className={`badge ${connected ? "green" : ""}`}>
                    {connected ? "Настроено" : "Не подключено"}
                  </span>
                </div>
              ))}
            </div>
            <p className="muted">
              Статус означает наличие конфигурации; успешная доставка
              отображается ниже. Ключи хранятся только на сервере. Инструкция и
              код Apps Script находятся в README проекта.
            </p>
          </section>
          <section className="card">
            <div className="section-title">
              <h2>Очередь уведомлений</h2>
              <button
                className="ghost"
                disabled={busy}
                onClick={() =>
                  perform(
                    () => request("outbox", "POST"),
                    "Повторная отправка завершена",
                  )
                }
              >
                Повторить отправку
              </button>
            </div>
            {!outbox.length ? (
              <p className="muted">
                После отправки заявки здесь появятся события доставки.
              </p>
            ) : (
              outbox.map((o) => (
                <div className="outbox-item" key={o.id}>
                  <strong>{o.event}</strong>
                  <span>
                    {o.target} ·{" "}
                    {o.status === "sent" ? "доставлено" : "ожидает"} · попыток{" "}
                    {o.attempts}
                  </span>
                  {o.error && <small className="error-text">{o.error}</small>}
                </div>
              ))
            )}
          </section>
        </>
      )}
    </>
  );
}

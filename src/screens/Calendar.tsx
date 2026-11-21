import { useEffect, useState } from "react";
import {
  Plus,
  CalendarDays,
  Download,
  Bell,
  Users,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { AppContext } from "../main";
import { request, saveFile, notifySession } from "../api";
import { ics } from "../domain";
import { Field, Modal, Empty, Busy, dateTime, localInput } from "../ui";
export function Calendar({ ctx }: { ctx: AppContext }) {
  const [sessions, setSessions] = useState<any[]>(),
    [campaigns, setCampaigns] = useState<any[]>([]),
    [filter, setFilter] = useState("all"),
    [modal, setModal] = useState(false),
    [month, setMonth] = useState(new Date()),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({
      title: "",
      campaignId: "",
      start: localInput(new Date(Date.now() + 86400000)),
      hours: 4,
      public: false,
      capacity: 6,
      description: "",
    }),
    [campaignName, setCampaignName] = useState(""),
    [invite, setInvite] = useState("");
  async function load() {
    try {
      const [s, c] = await Promise.all([
        request("sessions"),
        request("campaigns"),
      ]);
      setSessions(s);
      setCampaigns(c);
    } catch (e) {
      ctx.toast((e as Error).message, true);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function action(path: string, method = "POST", data?: unknown) {
    setBusy(true);
    try {
      await request(path, method, data);
      await load();
    } catch (e) {
      ctx.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (!sessions) return <Busy />;
  const key = (d: Date) =>
    `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  const list = sessions
    .filter((s) =>
      filter === "public" ? s.public : filter === "mine" ? !s.public : true,
    )
    .filter((s) => !selected || key(new Date(s.start)) === selected)
    .filter((s) => Date.parse(s.end) > Date.now())
    .sort((a, b) => a.start.localeCompare(b.start));
  const first = new Date(month.getFullYear(), month.getMonth(), 1),
    offset = (first.getDay() + 6) % 7,
    days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">СОБРАТЬ ВСЕХ — УЖЕ ПРИКЛЮЧЕНИЕ</span>
          <h1>Календарь партии</h1>
          <p>Предлагайте даты, голосуйте и находите людей для новой истории.</p>
        </div>
        <button onClick={() => setModal(true)}>
          <Plus size={17} /> Предложить встречу
        </button>
      </div>
      <div className="calendar-layout">
        <aside>
          <section className="card month">
            <div className="section-title">
              <button
                className="icon-button"
                aria-label="Предыдущий месяц"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() - 1, 1),
                  )
                }
              >
                <ChevronLeft size={18} />
              </button>
              <strong>
                {month.toLocaleDateString("ru", {
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              <button
                className="icon-button"
                aria-label="Следующий месяц"
                onClick={() =>
                  setMonth(
                    new Date(month.getFullYear(), month.getMonth() + 1, 1),
                  )
                }
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="month-grid">
              {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
                <small key={d}>{d}</small>
              ))}
              {Array.from({ length: offset }, (_, i) => (
                <span key={`b${i}`} />
              ))}
              {Array.from({ length: days }, (_, i) => {
                const date = new Date(
                    month.getFullYear(),
                    month.getMonth(),
                    i + 1,
                  ),
                  k = key(date),
                  has = sessions.some(
                    (s) =>
                      s.status !== "cancelled" && key(new Date(s.start)) === k,
                  );
                return (
                  <button
                    key={k}
                    className={`${selected === k ? "selected" : ""} ${has ? "has-event" : ""} ${key(new Date()) === k ? "today" : ""}`}
                    onClick={() => setSelected(selected === k ? "" : k)}
                  >
                    {i + 1}
                    {has && <i />}
                  </button>
                );
              })}
            </div>
            {selected && (
              <button className="text-button" onClick={() => setSelected("")}>
                Показать все даты
              </button>
            )}
            <small className="muted">
              Время на устройстве:{" "}
              {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </small>
          </section>
          <section className="card">
            <h3>Ваши кампании</h3>
            {campaigns.map((c) => (
              <div className="campaign-line" key={c.id}>
                <strong>{c.name}</strong>
                {c.owner_id === ctx.me.user.id && (
                  <button
                    className="text-button"
                    onClick={() => {
                      navigator.clipboard
                        .writeText(c.invite)
                        .then(() => ctx.toast("Код приглашения скопирован"))
                        .catch(() => ctx.toast(c.invite));
                    }}
                  >
                    Код приглашения
                  </button>
                )}
              </div>
            ))}
            <Field label="Новая кампания">
              <input
                placeholder="Название истории"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </Field>
            <button
              className="ghost"
              disabled={!campaignName || busy}
              onClick={async () => {
                await action("campaigns", "POST", { name: campaignName });
                setCampaignName("");
              }}
            >
              Создать кампанию
            </button>
            <Field label="Вступить по приглашению">
              <input
                placeholder="Код от мастера"
                value={invite}
                onChange={(e) => setInvite(e.target.value)}
              />
            </Field>
            <button
              className="ghost"
              disabled={!invite || busy}
              onClick={async () => {
                await action("campaigns/join", "POST", { invite });
                setInvite("");
              }}
            >
              Присоединиться
            </button>
          </section>
        </aside>
        <div>
          <div className="tabs">
            {[
              ["all", "Все встречи"],
              ["mine", "Мои кампании"],
              ["public", "Найти соигроков"],
            ].map(([v, n]) => (
              <button
                key={v}
                className={filter === v ? "selected" : ""}
                onClick={() => setFilter(v)}
              >
                {n}
              </button>
            ))}
          </div>
          {!list.length ? (
            <Empty
              title="Эта глава ещё не запланирована"
              text="Создайте кампанию, пригласите друзей и предложите первую дату."
            />
          ) : (
            list.map((s) => {
              const myVote = s.votes.find(
                  (v: any) => v.user_id === ctx.me.user.id,
                )?.answer,
                joined = s.attendees.some(
                  (a: any) => a.user_id === ctx.me.user.id,
                ),
                mine = s.owner_id === ctx.me.user.id;
              return (
                <article className="card session-card" key={s.id}>
                  <div className="row between">
                    <span
                      className={`badge ${s.status === "confirmed" ? "green" : ""}`}
                    >
                      {
                        {
                          proposed: "Выбираем дату",
                          confirmed: "Подтверждено",
                          cancelled: "Отменено",
                        }[s.status as string]
                      }
                    </span>
                    {s.public && (
                      <span className="badge">
                        Открытая игра · {s.attendees.length}/{s.capacity}
                      </span>
                    )}
                  </div>
                  <h2>{s.title}</h2>
                  <p className="session-time">
                    <CalendarDays size={17} />
                    {dateTime(s.start)} ·{" "}
                    {Math.round(
                      (Date.parse(s.end) - Date.parse(s.start)) / 3600000,
                    )}{" "}
                    ч
                  </p>
                  <p>{s.description}</p>
                  <small className="muted">
                    {s.campaign_name || "Набор в новую партию"}
                  </small>
                  {s.status === "proposed" && (
                    <>
                      <h4>Получится прийти?</h4>
                      <div className="row wrap">
                        {[
                          ["yes", "Буду"],
                          ["maybe", "Под вопросом"],
                          ["no", "Не могу"],
                        ].map(([v, n]) => (
                          <button
                            disabled={busy}
                            className={myVote === v ? "" : "ghost"}
                            key={v}
                            onClick={() =>
                              action(`sessions/${s.id}/vote`, "POST", {
                                answer: v,
                              })
                            }
                          >
                            {n} ·{" "}
                            {s.votes.filter((x: any) => x.answer === v).length}
                          </button>
                        ))}
                      </div>
                      <p className="muted">
                        {s.votes
                          .map(
                            (v: any) =>
                              `${v.name}: ${{ yes: "да", maybe: "возможно", no: "нет" }[v.answer as string]}`,
                          )
                          .join(" · ") || "Пока никто не проголосовал"}
                      </p>
                    </>
                  )}
                  {s.public && s.status !== "cancelled" && (
                    <button
                      disabled={
                        busy || (!joined && s.attendees.length >= s.capacity)
                      }
                      className="ghost"
                      onClick={() =>
                        action(
                          `sessions/${s.id}/join`,
                          joined ? "DELETE" : "POST",
                        )
                      }
                    >
                      <Users size={16} />
                      {joined
                        ? "Освободить место"
                        : s.attendees.length >= s.capacity
                          ? "Все места заняты"
                          : "Присоединиться к игре"}
                    </button>
                  )}
                  <div className="session-actions row wrap">
                    {s.status === "confirmed" && (
                      <>
                        <button
                          className="ghost"
                          onClick={() =>
                            saveFile(
                              new Blob([ics(s.title, s.start, s.end, s.id)], {
                                type: "text/calendar;charset=utf-8",
                              }),
                              "questbook.ics",
                            )
                          }
                        >
                          <Download size={16} /> В календарь
                        </button>
                        <button
                          className="ghost"
                          onClick={() =>
                            notifySession(s)
                              .then(() => ctx.toast("Напомним за час до игры"))
                              .catch((e) => ctx.toast(e.message, true))
                          }
                        >
                          <Bell size={16} /> Напомнить
                        </button>
                      </>
                    )}
                    {mine && s.status === "proposed" && (
                      <button
                        disabled={busy}
                        onClick={() => action(`sessions/${s.id}/confirm`)}
                      >
                        Утвердить дату
                      </button>
                    )}
                    {mine && s.status !== "cancelled" && (
                      <button
                        className="text-button danger-text"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Отменить встречу и освободить время?",
                            )
                          )
                            action(`sessions/${s.id}/cancel`);
                        }}
                      >
                        Отменить встречу
                      </button>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </div>
      {modal && (
        <Modal title="Новая встреча за столом" onClose={() => setModal(false)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await request("sessions", "POST", {
                  ...form,
                  campaignId: form.campaignId || null,
                  start: new Date(form.start).toISOString(),
                  end: new Date(
                    +new Date(form.start) + form.hours * 3600000,
                  ).toISOString(),
                });
                await load();
                setModal(false);
                ctx.toast("Дата предложена. Можно голосовать!");
              } catch (e) {
                ctx.toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Название">
              <input
                required
                maxLength={120}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </Field>
            <Field label="Кампания">
              <select
                value={form.campaignId}
                required={!form.public}
                onChange={(e) =>
                  setForm({ ...form, campaignId: e.target.value })
                }
              >
                <option value="">Выберите кампанию</option>
                {campaigns
                  .filter((c) => c.owner_id === ctx.me.user.id)
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="two-col">
              <Field label="Начало · ваше местное время">
                <input
                  required
                  type="datetime-local"
                  min={localInput(new Date())}
                  value={form.start}
                  onChange={(e) => setForm({ ...form, start: e.target.value })}
                />
              </Field>
              <Field label="Длительность, часов">
                <input
                  type="number"
                  min="2"
                  max="8"
                  value={form.hours}
                  onChange={(e) => setForm({ ...form, hours: +e.target.value })}
                />
              </Field>
            </div>
            {ctx.me.isAdmin && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={form.public}
                  onChange={(e) =>
                    setForm({ ...form, public: e.target.checked })
                  }
                />
                Открыть набор соигроков
              </label>
            )}
            <Field label="Количество мест">
              <input
                type="number"
                min="1"
                max="6"
                value={form.capacity}
                onChange={(e) =>
                  setForm({ ...form, capacity: +e.target.value })
                }
              />
            </Field>
            <Field label="Подробности, формат, место встречи">
              <textarea
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>
            <button disabled={busy}>Предложить дату</button>
          </form>
        </Modal>
      )}
    </>
  );
}

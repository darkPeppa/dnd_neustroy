import { useState } from "react";
import type { AppContext } from "../main";
import { request, saveFile } from "../api";
import { Field } from "../ui";
type Row = Record<string, any>;
export function CampaignUtilities({
  cid,
  game,
  ctx,
}: {
  cid: string;
  game: Row;
  ctx: AppContext;
}) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState("search"),
    [query, setQuery] = useState(""),
    [found, setFound] = useState<Row[]>([]),
    [slots, setSlots] = useState<Row>({ slots: [], common: [] }),
    [start, setStart] = useState(""),
    [end, setEnd] = useState(""),
    [zone, setZone] = useState(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
    [link, setLink] = useState<Row>(),
    [links, setLinks] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [hours, setHours] = useState(24),
    [role, setRole] = useState("observer"),
    [preview, setPreview] = useState<Row>();
  const gm = game.owner_id === ctx.me.user.id,
    manage = gm || game.permissions?.includes("manage_members");
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
  const times = () => request(`campaigns/${cid}/time-slots`).then(setSlots);
  return (
    <section className="card campaign-utilities">
      <button className="ghost" onClick={() => setOpen(!open)}>
        Поиск · время · приглашения · копии {open ? "▴" : "▾"}
      </button>
      {open && (
        <>
          <div className="tabs">
            {[
              ["search", "Поиск"],
              ["time", "Общее время"],
              ["invite", "Гости"],
              ["backup", "Копии и шаблоны"],
            ].map(([id, title]) => (
              <button
                key={id}
                className={tab === id ? "selected" : ""}
                onClick={() => {
                  setTab(id);
                  if (id === "time") act(times);
                  if (id === "invite" && manage)
                    act(() =>
                      request(`campaigns/${cid}/guest-links`).then(setLinks),
                    );
                }}
              >
                {title}
              </button>
            ))}
          </div>
          {tab === "search" && (
            <>
              <Field label="По всем доступным материалам">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter")
                      act(() =>
                        request(
                          `campaigns/${cid}/search?q=${encodeURIComponent(query)}`,
                        ).then(setFound),
                      );
                  }}
                />
              </Field>
              <button
                disabled={busy || query.trim().length < 2}
                onClick={() =>
                  act(() =>
                    request(
                      `campaigns/${cid}/search?q=${encodeURIComponent(query)}`,
                    ).then(setFound),
                  )
                }
              >
                Найти
              </button>
              {found.map((row) => (
                <article className="note-card" key={row.id}>
                  <strong>{row.title}</strong>
                  <small>{row.kind}</small>
                  <p className="prewrap">{row.snippet}</p>
                </article>
              ))}
              <p className="muted">
                Поиск учитывает права. Текст TXT индексируется при загрузке; PDF
                — при извлечении текста в редакторе материала.
              </p>
            </>
          )}
          {tab === "time" && (
            <>
              <p>
                Укажите свободные окна в своём часовом поясе. Общие интервалы
                рассчитаны для всех, кто добавил окна, минимум на 2 часа.
              </p>
              <Field label="Ваш часовой пояс">
                <input value={zone} onChange={(e) => setZone(e.target.value)} />
              </Field>
              <p className="muted">
                Поля ниже используют часовой пояс этого устройства:{" "}
                {Intl.DateTimeFormat().resolvedOptions().timeZone}. Выбранный
                пояс сохраняется как подпись.
              </p>
              <Field label="Свободен с">
                <input
                  type="datetime-local"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </Field>
              <Field label="До">
                <input
                  type="datetime-local"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </Field>
              <button
                disabled={busy || !start || !end}
                onClick={() =>
                  act(async () => {
                    await request(`campaigns/${cid}/time-slots`, "POST", {
                      start: new Date(start).toISOString(),
                      end: new Date(end).toISOString(),
                      timezone: zone,
                    });
                    await times();
                  })
                }
              >
                Добавить окно
              </button>
              <h3>Пересечения</h3>
              {slots.common.map((s: Row) => (
                <p key={s.start}>
                  {new Date(s.start).toLocaleString()} —{" "}
                  {new Date(s.end).toLocaleString()}
                </p>
              ))}
              {!slots.common.length && <p>Общих окон пока нет.</p>}
              <h3>Ответы участников</h3>
              {slots.slots.map((s: Row) => (
                <p key={s.id}>
                  {s.name}: {new Date(s.start).toLocaleString()} —{" "}
                  {new Date(s.end).toLocaleString()} ({s.timezone}){" "}
                  {s.user_id === ctx.me.user.id && (
                    <button
                      className="text-button"
                      onClick={() =>
                        act(async () => {
                          await request(
                            `campaigns/${cid}/time-slots/${s.id}`,
                            "DELETE",
                          );
                          await times();
                        })
                      }
                    >
                      Удалить
                    </button>
                  )}
                </p>
              ))}
              <p className="muted">
                Участники без ответа в расчёт ещё не входят.
              </p>
            </>
          )}
          {tab === "invite" &&
            (manage ? (
              <>
                <p>
                  Временный вход без регистрации. Права ограничены выбранной
                  ролью; доступ закончится вместе со ссылкой. Внешняя приватная
                  защита хостинга продолжает действовать.
                </p>
                <Field label="Часов действия · 1–168">
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={hours}
                    onChange={(e) => setHours(+e.target.value)}
                  />
                </Field>
                <Field label="Роль гостя">
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                  >
                    <option value="observer">Наблюдатель</option>
                    <option value="player">Игрок</option>
                  </select>
                </Field>
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      setLink(
                        await request(`campaigns/${cid}/guest-links`, "POST", {
                          hours,
                          role,
                          maxUses: 6,
                        }),
                      );
                      setLinks(await request(`campaigns/${cid}/guest-links`));
                    })
                  }
                >
                  Создать приглашение
                </button>
                {link && (
                  <>
                    <a href={link.url}>{link.url}</a>
                    <svg
                      aria-label="QR-код приглашения"
                      viewBox={`-4 -4 ${link.qr.size + 8} ${link.qr.size + 8}`}
                      style={{
                        width: 240,
                        maxWidth: "100%",
                        background: "white",
                      }}
                    >
                      {link.qr.data.map((v: number, i: number) =>
                        v ? (
                          <rect
                            key={i}
                            x={i % link.qr.size}
                            y={Math.floor(i / link.qr.size)}
                            width="1"
                            height="1"
                            fill="black"
                          />
                        ) : null,
                      )}
                    </svg>
                    <p>
                      Код для приложения: <code>{link.code}</code>
                    </p>
                  </>
                )}
                {links.map((l) => (
                  <p key={l.hash}>
                    {l.role_id} · до {new Date(l.expires).toLocaleString()} ·{" "}
                    {l.uses}/{l.max_uses}{" "}
                    <button
                      onClick={() =>
                        act(async () => {
                          await request(
                            `campaigns/${cid}/guest-links/${l.hash}`,
                            "DELETE",
                          );
                          setLinks(
                            await request(`campaigns/${cid}/guest-links`),
                          );
                        })
                      }
                    >
                      Отозвать
                    </button>
                  </p>
                ))}
              </>
            ) : (
              <p>Приглашения создаёт мастер.</p>
            ))}
          {tab === "backup" && (
            <>
              <p>
                Копия содержит доступные владельцу материалы с вложениями до 25
                МБ, общие и его личные записи. Чужие личные записи и переписки
                не выгружаются. Восстановление создаёт отдельную игру; встречи
                нужно подтвердить заново.
              </p>
              {gm && (
                <button
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const data = await request(`campaigns/${cid}/backup`);
                      saveFile(
                        new Blob([JSON.stringify(data)], {
                          type: "application/json",
                        }),
                        "neustroy-campaign.json",
                      );
                    })
                  }
                >
                  Скачать копию
                </button>
              )}
              {gm && (
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      const data = await request(`campaigns/${cid}/backup`);
                      data.log = [];
                      data.sessions = [];
                      data.notes = data.notes.filter(
                        (n: Row) => n.visibility === "shared",
                      );
                      data.campaign.name += " · заготовка";
                      saveFile(
                        new Blob([JSON.stringify(data)], {
                          type: "application/json",
                        }),
                        "neustroy-template.json",
                      );
                    })
                  }
                >
                  Экспортировать заготовку
                </button>
              )}
              <Field label="Восстановить кампанию или заготовку · JSON до 40 МБ">
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) =>
                    act(async () => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      if (f.size > 40 * 1024 * 1024)
                        throw Error("Максимум 40 МБ");
                      const data = JSON.parse(await f.text());
                      if (data.format !== "neustroy-campaign")
                        throw Error("Это не копия neustroy");
                      setPreview(data);
                    })
                  }
                />
              </Field>
              {preview && (
                <div className="card">
                  <h3>{preview.campaign.name}</h3>
                  <p>
                    Материалов: {preview.clues?.length}, заметок:{" "}
                    {preview.notes?.length}, инструментов:{" "}
                    {preview.documents?.length}
                  </p>
                  <button
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await request("campaigns/restore", "POST", preview);
                        setPreview(undefined);
                        ctx.refresh();
                        ctx.toast("Создана восстановленная кампания");
                      })
                    }
                  >
                    Создать отдельную игру из копии
                  </button>
                  <button
                    className="ghost"
                    onClick={() => setPreview(undefined)}
                  >
                    Отмена
                  </button>
                </div>
              )}
              <button
                className="ghost"
                onClick={() =>
                  act(async () => {
                    const [notes, log, materials] = await Promise.all([
                      request(`campaigns/${cid}/notes`),
                      request(`campaigns/${cid}/log`),
                      request(`clues?campaign=${cid}`),
                    ]);
                    setFound(
                      [...notes, ...log, ...materials].map((n: Row) => ({
                        id: n.id,
                        title: n.title || n.kind,
                        snippet: n.body || n.text,
                      })),
                    );
                    setTab("print");
                  })
                }
              >
                Версия журнала и материалов для печати / PDF
              </button>
            </>
          )}
          {tab === "print" && (
            <>
              <button onClick={() => window.print()}>
                Печать / сохранить PDF
              </button>
              <div className="print-journal">
                <h2>{game.name}</h2>
                {found.map((n) => (
                  <article key={n.id}>
                    <h3>{n.title}</h3>
                    <p className="prewrap">{n.snippet}</p>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  BookOpen,
  CalendarDays,
  FolderLock,
  Sparkles,
  Store,
  Settings,
  Plus,
  Menu,
  Dices,
  ChevronRight,
  Users,
  PanelLeftClose,
  Check,
  ExternalLink,
  Download,
} from "lucide-react";
import { request, enablePush, native, saveFile, offlineMode } from "./api";
import { Auth } from "./screens/Auth";
import { Rules } from "./screens/Rules";
import { Octahedron, TriangleNet } from "./brand";
import { Busy, Empty, Field, Modal, dateTime, money } from "./ui";
import { Characters } from "./screens/Characters";
import { Calendar } from "./screens/Calendar";
import { GameWorkspace } from "./screens/GameWorkspace";
import { AssistantPanel } from "./screens/Helpers";
import { Builder } from "./screens/Builder";
import { Admin } from "./screens/Admin";
import { defaultPricing, ics, roll } from "./domain";
import "./style.css";
import "./neustroy.css";
import "./game-theme.css";
type Page =
  | "rules"
  | "home"
  | "characters"
  | "calendar"
  | "materials"
  | "journal"
  | "chat"
  | "tools"
  | "assistant"
  | "builder"
  | "shop"
  | "settings"
  | "about"
  | "intro"
  | "contact"
  | "offer"
  | "agreement";
const nav = [
  { id: "home", name: "За столом", icon: Dices },
  { id: "characters", name: "Персонажи", icon: BookOpen },
  { id: "rules", name: "Библиотека правил", icon: BookOpen },
  { id: "calendar", name: "Календарь", icon: CalendarDays },
  { id: "materials", name: "Кампании и материалы", icon: FolderLock },
  { id: "journal", name: "Журнал игры", icon: BookOpen },
  { id: "chat", name: "Чаты партии", icon: Users },
  { id: "tools", name: "Инструменты", icon: Dices },
  { id: "assistant", name: "Помощники", icon: Sparkles },
  { id: "builder", name: "Заявка мастеру", icon: Sparkles },
  { id: "shop", name: "Магазин и услуги", icon: Store },
];
export type AppContext = {
  me: any;
  settings: any;
  toast: (s: string, error?: boolean) => void;
  go: (p: Page) => void;
  refresh: () => void;
};
function App() {
  const simple = localStorage.getItem("neustroy-family") === "true";
  const [page, setPage] = useState<Page>(
      (location.hash.slice(1) || "home") as Page,
    ),
    [me, setMe] = useState<any>(),
    [settings, setSettings] = useState<any>(),
    [error, setError] = useState(""),
    [message, setMessage] = useState<{ text: string; error?: boolean }>(),
    [menu, setMenu] = useState(false),
    [dice, setDice] = useState(false),
    [formula, setFormula] = useState("1d20"),
    [result, setResult] = useState<any>(),
    [token, setToken] = useState("");
  const toast = (text: string, error = false) => setMessage({ text, error });
  async function load() {
    try {
      const [m, s] = await Promise.all([request("me"), request("settings")]);
      sessionStorage.setItem("neustroy-user", m.user.id);
      setMe(m);
      setSettings(s);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
    const change = () => setPage((location.hash.slice(1) || "home") as Page);
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (message) {
      const t = setTimeout(() => setMessage(undefined), 6500);
      return () => clearTimeout(t);
    }
  }, [message]);
  const go = (p: Page) => {
    location.hash = p;
    setPage(p);
    setMenu(false);
    window.scrollTo(0, 0);
  };
  const ctx: AppContext = { me, settings, toast, go, refresh: load };
  if (error && offlineMode())
    return (
      <div className="auth-page">
        <img src="/icon.svg" width="64" />
        <h1>Локальная база</h1>
        <p role="alert">{error}</p>
        <button onClick={load}>Повторить запуск</button>
        <p className="muted">
          Разрешите хранение данных в браузере и откройте приложение через HTTPS
          или localhost.
        </p>
      </div>
    );
  if (
    error ||
    new URLSearchParams(location.search).has("reset_token") ||
    location.hash.startsWith("#guest=")
  )
    return <Auth onReady={load} />;
  if (!me || !settings) return <Busy />;
  return (
    <div
      className={`shell ${localStorage.getItem("neustroy-large") === "true" ? "table-large" : ""} ${localStorage.getItem("neustroy-contrast") === "true" ? "table-contrast" : ""}`}
    >
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <a className="brand" href="#home" onClick={() => go("home")}>
          <img src="/icon.svg" alt="" />
          neustroy<span>ИГРОВОЙ СТОЛ</span>
        </a>
        <div className="workspace-label">ВАШЕ ПРОСТРАНСТВО</div>
        <nav>
          {nav
            .filter(
              (n) =>
                !simple ||
                [
                  "home",
                  "characters",
                  "rules",
                  "calendar",
                  "materials",
                  "journal",
                  "chat",
                ].includes(n.id),
            )
            .map((n) => (
              <button
                key={n.id}
                className={page === n.id ? "nav-item active" : "nav-item"}
                onClick={() => go(n.id as Page)}
              >
                <n.icon size={19} />
                {n.name}
                {n.id === "builder" && <span className="nav-star">✧</span>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="nav-item" onClick={() => go("settings")}>
            <Settings size={18} />
            Настройки
          </button>
          <div className="profile">
            <span className="avatar">
              {me.user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{me.user.name.split("@")[0]}</strong>
              <small>{me.isAdmin ? "Администратор" : "Игрок"}</small>
            </div>
          </div>
        </div>
      </aside>
      {menu && (
        <div className="mobile-backdrop" onClick={() => setMenu(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(!menu)}
              aria-label="Открыть меню"
            >
              <Menu />
            </button>
            <span className="breadcrumb">
              Ваше пространство <ChevronRight size={14} />{" "}
              <strong>
                {nav.find((n) => n.id === page)?.name || "neustroy"}
              </strong>
            </span>
          </div>
          <div className="row">
            <span className="mode-badge">
              {offlineMode()
                ? "На этом устройстве"
                : me.local
                  ? "Локальная сеть"
                  : "Облако"}
            </span>
            <button className="dice-top ghost" onClick={() => setDice(true)}>
              <Dices size={17} /> Бросить кубики <kbd>D20</kbd>
            </button>
          </div>
        </header>
        <main>
          {page === "home" && <Home ctx={ctx} />}
          {page === "characters" && <Characters ctx={ctx} />}
          {page === "rules" && <Rules ctx={ctx} />}
          {page === "calendar" && <Calendar ctx={ctx} />}
          {page === "materials" && <GameWorkspace ctx={ctx} />}
          {page === "journal" && <GameWorkspace ctx={ctx} section="journal" />}
          {page === "chat" && <GameWorkspace ctx={ctx} section="chat" />}
          {page === "tools" && <GameWorkspace ctx={ctx} section="tools" />}
          {page === "assistant" && <AssistantPanel ctx={ctx} />}
          {page === "builder" && <Builder ctx={ctx} />}
          {page === "settings" && <Admin ctx={ctx} />}
          {page === "shop" && (
            <>
              <div className="page-heading">
                <span className="eyebrow">ЧУТЬ БОЛЬШЕ ВОЛШЕБСТВА</span>
                <h1>Магазин и услуги</h1>
                <p>Добавьте вашей истории что-то особенное.</p>
              </div>
              <div className="three-col">
                {[
                  {
                    name: "Хроника приключения",
                    text: "Иллюстрированная текстовая история вашей партии.",
                    cost: settings.pricing.chronicle,
                  },
                  {
                    name: "Запись игры",
                    text: "Вернуться к любимым моментам вашей сессии.",
                    cost: settings.pricing.video,
                  },
                  {
                    name: "Индивидуальная миниатюра",
                    text: "Ваш персонаж в маленьком материальном мире.",
                    cost: settings.pricing.miniatures,
                  },
                ].map((x) => (
                  <article className="card service" key={x.name}>
                    <Sparkles />
                    <h2>{x.name}</h2>
                    <p>{x.text}</p>
                    <strong>{money(x.cost)}</strong>
                    <button onClick={() => go("builder")}>
                      Добавить к приключению
                    </button>
                  </article>
                ))}
              </div>
              <section className="card">
                <h2>Прайс-лист</h2>
                {Object.entries(settings.pricing).map(([k, v]) => (
                  <div className="line-item" key={k}>
                    <span>
                      {
                        {
                          hour: "Час игры для группы до 4 игроков",
                          extraPlayer: "Каждый игрок сверх 4",
                          offline: "Выезд мастера",
                          customCharacter: "Подготовка одного персонажа",
                          chronicle: "Хроника",
                          video: "Видеозапись",
                          miniatures: "Одна миниатюра",
                        }[k]
                      }
                    </span>
                    <strong>{money(v as number)}</strong>
                  </div>
                ))}
                <p className="muted">
                  Тестовые цены. Мастер может изменить их в настройках.
                </p>
              </section>
              <Empty
                title="Вещи, которые хочется забрать с собой"
                text="Сумочки для кубиков и другие физические товары появятся здесь после добавления каталога."
              />
            </>
          )}
          {["about", "intro", "contact", "offer", "agreement"].includes(
            page,
          ) && (
            <section className="card prose">
              <h1>
                {
                  {
                    about: "О мастере",
                    intro: "Что такое D&D",
                    contact: "Контакты",
                    offer: "Публичная оферта",
                    agreement: "Пользовательское соглашение",
                  }[
                    page as
                      | "about"
                      | "intro"
                      | "contact"
                      | "offer"
                      | "agreement"
                  ]
                }
              </h1>
              <p>
                {page === "intro"
                  ? "Dungeons & Dragons — совместная история. Мастер описывает мир, игроки решают, что делают их персонажи, а кубики помогают узнать, что получилось. Победа здесь — хорошее приключение вместе. Начните с готового персонажа и одной игры: учить все правила заранее не нужно."
                  : page === "about"
                    ? settings.about
                    : page === "contact"
                      ? settings.contact
                      : settings[page] ||
                        "Документ пока не опубликован. Владелец сервиса должен добавить условия и реквизиты перед приёмом коммерческих заказов."}
              </p>
              <button onClick={() => go("builder")}>
                Придумать приключение
              </button>
            </section>
          )}
        </main>
        <footer>
          <span>✧ neustroy · Место для вашей истории</span>
          <div>
            {[
              { id: "about", n: "О мастере" },
              { id: "intro", n: "Что такое D&D" },
              { id: "contact", n: "Контакты" },
              { id: "offer", n: "Оферта" },
              { id: "agreement", n: "Соглашение" },
            ].map((x) => (
              <a href={`#${x.id}`} key={x.id} onClick={() => go(x.id as Page)}>
                {x.n}
              </a>
            ))}
          </div>
          <small>
            Открытая библиотека SRD 5.1 и SRD 5.2.1. Редакция выбирается
            отдельно для каждого листа. This work includes material taken from
            the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the
            Coast LLC, available at{" "}
            <a
              href="https://dnd.wizards.com/resources/systems-reference-document"
              target="_blank"
              rel="noreferrer"
            >
              SRD
            </a>
            . The SRD 5.1 is licensed under the{" "}
            <a
              href="https://creativecommons.org/licenses/by/4.0/legalcode"
              target="_blank"
              rel="noreferrer"
            >
              Creative Commons Attribution 4.0 International License
            </a>
            . Русские названия и краткие описания адаптированы.
          </small>
        </footer>
      </div>
      {message && (
        <div className={`toast ${message.error ? "error" : ""}`} role="status">
          {message.error ? "!" : <Check size={18} />} {message.text}
        </div>
      )}
      {dice && (
        <Modal title="Пусть решают кубики" onClose={() => setDice(false)}>
          <p className="muted">Обычный бросок или формула с модификатором.</p>
          <div className="dice-types">
            {[4, 6, 8, 10, 12, 20, 100].map((n) => (
              <button
                className="ghost"
                key={n}
                onClick={() => {
                  setFormula(`1d${n}`);
                  setResult(roll(`1d${n}`));
                }}
              >
                d{n}
              </button>
            ))}
          </div>
          <Field label="Формула">
            <input
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              placeholder="2d6+3"
            />
          </Field>
          <button
            onClick={() => {
              try {
                setResult(roll(formula));
              } catch (e) {
                toast((e as Error).message, true);
              }
            }}
          >
            Бросить
          </button>
          {result && (
            <div className="roll-result">
              <strong>{result.total}</strong>
              <span>
                {result.dice.join(" + ")}{" "}
                {result.bonus !== 0
                  ? `(${result.bonus > 0 ? "+" : ""}${result.bonus})`
                  : ""}
              </span>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function Home({ ctx }: { ctx: AppContext }) {
  const [data, setData] = useState<any>(),
    [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      request("characters"),
      request("sessions"),
      request("campaigns"),
    ])
      .then(([characters, sessions, campaigns]) =>
        setData({ characters, sessions, campaigns }),
      )
      .catch((e) => setError(e.message));
  }, []);
  const upcoming =
    data?.sessions
      .filter(
        (s: any) => s.status !== "cancelled" && Date.parse(s.end) > Date.now(),
      )
      .slice(0, 5) || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Игровой стол</h1>
          <p>Персонажи, ближайшие встречи и записи кампании.</p>
        </div>
        <span className="badge">neustroy</span>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="quick-grid">
        {[
          { name: "Листы", value: data?.characters.length, page: "characters" },
          {
            name: "Кампании",
            value: data?.campaigns.length,
            page: "materials",
          },
          { name: "Встречи", value: upcoming.length, page: "calendar" },
        ].map((item) => (
          <button
            key={item.page}
            className="quick-card"
            onClick={() => ctx.go(item.page as Page)}
          >
            <strong>{item.value ?? "…"}</strong>
            <span>{item.name}</span>
          </button>
        ))}
      </div>
      <div className="two-col">
        <section className="card">
          <h2>Ближайшие встречи</h2>
          {!data ? (
            <Busy />
          ) : upcoming.length ? (
            upcoming.map((s: any) => (
              <article className="session-compact" key={s.id}>
                <div>
                  <h3>{s.title}</h3>
                  <p>
                    {dateTime(s.start)} · {s.campaign_name || "Открытая игра"} ·{" "}
                    {s.status}
                  </p>
                </div>
                <button className="ghost" onClick={() => ctx.go("calendar")}>
                  Открыть
                </button>
              </article>
            ))
          ) : (
            <p>Запланированных встреч пока нет.</p>
          )}
          <button className="ghost" onClick={() => ctx.go("calendar")}>
            Календарь
          </button>
        </section>
        <section className="card">
          <h2>Журнал партии</h2>
          <p>Личные заметки, общие записи, лог бросков и сводки сессий.</p>
          <div className="row wrap">
            <button onClick={() => ctx.go("journal")}>Открыть журнал</button>
            <button className="ghost" onClick={() => ctx.go("chat")}>
              Чат игры
            </button>
          </div>
          <hr />
          <h3>Подготовка мастера</h3>
          <p>Карты, NPC, квесты, бой, склад и календарь мира.</p>
          <button className="ghost" onClick={() => ctx.go("tools")}>
            Инструменты
          </button>
        </section>
      </div>
    </>
  );
}
if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js").catch(() => {}),
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

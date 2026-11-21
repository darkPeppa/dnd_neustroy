import { useEffect, useState } from "react";
import { offlineMode, request } from "../api";
import type { AppContext } from "../main";
export function AgentToggle({ ctx }: { ctx: AppContext }) {
  const [busy, setBusy] = useState(false);
  return (
    <section className="card">
      <h2>Помощник в интерфейсе</h2>
      <label className="check-line">
        <input
          type="checkbox"
          disabled={busy}
          checked={ctx.me.assistantEnabled !== false}
          onChange={async (e) => {
            const enabled = e.target.checked;
            setBusy(true);
            try {
              await request("agent-preferences", "PUT", { enabled });
              ctx.refresh();
            } catch (e) {
              ctx.toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        />
        Показывать помощника, генерацию и разбор листов
      </label>
      <p>
        Этот параметр действует для вашего профиля. Мастер также может отключить
        помощник для всей кампании.
      </p>
    </section>
  );
}
export function ConnectAgent({
  ctx,
  provider,
  apiKey,
  linked,
}: {
  ctx: AppContext;
  provider: string;
  apiKey: string;
  linked: (p: string) => void;
}) {
  const [saved, setSaved] = useState(""),
    [storage, setStorage] = useState(false),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const r = await request("agent-connection");
    setSaved(r.provider);
    setStorage(r.storage);
    if (r.provider) linked(r.provider);
  }
  useEffect(() => {
    if (!offlineMode()) load().catch(() => {});
  }, []);
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
  if (!storage) return null;
  return (
    <>
      {saved && <p>В профиле подключён {saved}.</p>}
      {["openai", "openrouter", "groq", "deepseek"].includes(provider) && (
        <button
          className="ghost"
          disabled={busy || apiKey.length < 8}
          onClick={() =>
            void act(async () => {
              await request("agent-connection", "PUT", { provider, apiKey });
              await load();
            })
          }
        >
          Сохранить API-ключ в профиле
        </button>
      )}
      <button
        className="ghost"
        disabled={busy}
        onClick={() =>
          void act(async () => {
            const r = await request("agent-connection/start", "POST");
            setUrl(r.url);
          })
        }
      >
        Подключить аккаунт OpenRouter
      </button>
      {url && (
        <p>
          <a className="button" href={url}>
            Продолжить в OpenRouter
          </a>
        </p>
      )}
      {!!saved && (
        <button
          className="ghost"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await request("agent-connection", "DELETE");
              setSaved("");
              setUrl("");
              linked("basic");
            })
          }
        >
          Отключить сохранённый ключ
        </button>
      )}
    </>
  );
}
export function AgentCallback({ ctx }: { ctx: AppContext }) {
  const [busy, setBusy] = useState(false);
  const url = new URL(location.href);
  const state = url.searchParams.get("agent_state") || "",
    code = url.searchParams.get("code") || "";
  const close = () => {
    url.searchParams.delete("agent_state");
    url.searchParams.delete("code");
    history.replaceState(null, "", url);
    ctx.go("assistant");
  };
  if (!state) return null;
  return (
    <section className="card">
      <h2>Подключение OpenRouter</h2>
      <p>
        {code
          ? "Подтвердите подключение из того же аккаунта neustroy, где вы его начали."
          : "OpenRouter не вернул код. Откройте подключение заново."}
      </p>
      {code && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await request("agent-connection/finish", "POST", { state, code });
              ctx.toast("OpenRouter подключён");
              close();
            } catch (e) {
              ctx.toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Сохранить подключение
        </button>
      )}
      <button className="ghost" onClick={close}>
        Закрыть
      </button>
    </section>
  );
}

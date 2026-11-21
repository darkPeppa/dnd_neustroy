import { useEffect, useState } from "react";
import { request } from "../api";
import { Field } from "../ui";
import type { AppContext } from "../main";
export function TelegramConnection({ ctx }: { ctx: AppContext }) {
  const [status, setStatus] = useState<any>(),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false);
  const load = () =>
    request("telegram")
      .then(setStatus)
      .catch((e) => ctx.toast(e.message, true));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="card">
      <h2>Telegram</h2>
      <p>
        {status?.linked
          ? "Аккаунт связан с ботом."
          : status?.enabled
            ? "Подключите бота к своему игровому профилю."
            : "Администратор ещё не подключил бота."}
      </p>
      {status?.username && <p>@{status.username}</p>}
      {status?.enabled && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const result = await request("telegram/link", "POST");
              setUrl(result.url);
            } catch (e) {
              ctx.toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Создать ссылку привязки
        </button>
      )}
      {url && (
        <p>
          <a
            className="button ghost"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            Открыть бота и нажать Start
          </a>
          <small>Ссылка одноразовая, действует 10 минут.</small>
        </p>
      )}
      {status?.linked && (
        <button
          className="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await request("telegram", "DELETE");
              setUrl("");
              await load();
            } catch (e) {
              ctx.toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Отвязать Telegram
        </button>
      )}
      <p className="muted">
        /games — выбор игры; /note — личная запись; /shared — общая; /dice —
        кубики; /sessions — встречи; /materials — доступные материалы; /summary
        — сводка; /login — одноразовый код входа в приложение. Чужие личные
        записи бот не читает.
      </p>
    </section>
  );
}
const fields = [
  ["TELEGRAM_BOT_TOKEN", "Токен бота из BotFather", "password"],
  ["PUBLIC_APP_URL", "Адрес сайта для писем и ссылок", "url"],
  ["RESEND_API_KEY", "Ключ почтового сервиса Resend", "password"],
  ["MAIL_FROM", "Подтверждённый отправитель email", "text"],
  ["ASSISTANT_BASE_URL", "OpenAI-совместимый API модели сервера", "url"],
  ["ASSISTANT_API_KEY", "Ключ модели сервера · Ollama без ключа", "password"],
  ["ASSISTANT_MODEL", "Модель сервера, например qwen3:4b", "text"],
  ["INTEGRATION_URL", "Google Apps Script URL", "url"],
  ["INTEGRATION_SECRET", "Секрет Google-интеграции", "password"],
  ["TELEGRAM_CHAT_ID", "Chat ID для уведомлений мастеру", "text"],
  ["PUSH_GATEWAY_URL", "Шлюз push-уведомлений", "url"],
  ["PUSH_GATEWAY_SECRET", "Секрет push-шлюза", "password"],
];
export function ServiceConnections({ ctx }: { ctx: AppContext }) {
  const [status, setStatus] = useState<any>(),
    [values, setValues] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false);
  const load = () =>
    request("integrations")
      .then(setStatus)
      .catch((e) => ctx.toast(e.message, true));
  useEffect(() => {
    load();
  }, []);
  return (
    <section className="card">
      <h2>Подключения сервиса</h2>
      <p>
        Telegram: {status?.telegram ? "подключён" : "не подключён"} · Email:{" "}
        {status?.email ? "настроен" : "не настроен"} · Модель сервера:{" "}
        {status?.assistant ? "настроена" : "не настроена"}
      </p>
      <p className="muted">
        Ключи сохраняются на сервере в зашифрованном виде. Пустые поля оставляют
        текущие значения. Токен бота не включается в APK и не публикуется в
        исходниках.
      </p>
      {status && !status.encryptedStorage && (
        <p className="error-text">
          Для сохранения ключей серверу нужен CONFIG_ENCRYPTION_KEY. Локальный
          сервер с аккаунтами создаёт его автоматически.
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await request("integrations", "PUT", values);
            setValues({});
            await load();
            ctx.toast("Подключения сохранены");
          } catch (e) {
            ctx.toast((e as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        {fields.map(([id, label, type]) => (
          <Field label={label} key={id}>
            <input
              type={type}
              autoComplete="off"
              value={values[id] || ""}
              placeholder={
                id === "PUBLIC_APP_URL"
                  ? status?.publicUrl
                  : id === "MAIL_FROM"
                    ? status?.mailFrom
                    : id === "ASSISTANT_BASE_URL"
                      ? status?.assistantUrl
                      : id === "ASSISTANT_MODEL"
                        ? status?.assistantModel
                        : ""
              }
              onChange={(e) => setValues({ ...values, [id]: e.target.value })}
            />
          </Field>
        ))}
        <button disabled={busy || !status?.encryptedStorage}>
          Сохранить подключения
        </button>
      </form>
    </section>
  );
}

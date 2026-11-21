import { useState } from "react";
import { request, native } from "../api";
import { Field } from "../ui";
import { Octahedron } from "../brand";
type Mode =
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password"
  | "telegram-code"
  | "guest";
export function Auth({ onReady }: { onReady: () => void }) {
  const reset = new URLSearchParams(location.search).get("reset_token") || "";
  const guest = new URLSearchParams(location.hash.slice(1)).get("guest") || "";
  const [mode, setMode] = useState<Mode>(
      reset ? "reset-password" : guest ? "guest" : "login",
    ),
    [form, setForm] = useState({
      name: "",
      email: "",
      password: "",
      token: reset,
      code: guest,
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const titles = {
    login: "Вход",
    register: "Регистрация",
    "forgot-password": "Восстановить пароль",
    "reset-password": "Новый пароль",
    "telegram-code": "Вход через Telegram",
    guest: "Вход по приглашению",
  };
  return (
    <main className="table-auth">
      <section className="auth-panel card">
        <div className="auth-brand">
          <Octahedron />
          <strong>neustroy</strong>
        </div>
        <h1>{titles[mode]}</h1>
        <p>Листы персонажей, кампании и журнал игры.</p>
        <div className="tabs">
          <button
            className={mode === "login" ? "selected" : ""}
            onClick={() => setMode("login")}
          >
            Вход
          </button>
          <button
            className={mode === "register" ? "selected" : ""}
            onClick={() => setMode("register")}
          >
            Регистрация
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            setMessage("");
            try {
              const r = await request("auth/" + mode, "POST", form);
              if (mode === "forgot-password") {
                setMessage(r.message);
                return;
              }
              if (mode === "reset-password") {
                const url = new URL(location.href);
                url.searchParams.delete("reset_token");
                history.replaceState(null, "", url);
                setMode("login");
                setForm({ ...form, password: "", token: "" });
                setMessage("Пароль изменён. Войдите с новым паролем.");
                return;
              }
              if (
                (native || mode === "telegram-code" || mode === "guest") &&
                r.token
              )
                sessionStorage.setItem("questbook-token", r.token);
              if (mode === "guest")
                history.replaceState(null, "", "#materials");
              onReady();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {(mode === "register" || mode === "guest") && (
            <Field label="Имя">
              <input
                required
                maxLength={80}
                autoComplete="nickname"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </Field>
          )}
          {mode !== "reset-password" &&
            mode !== "telegram-code" &&
            mode !== "guest" && (
              <Field label="Email">
                <input
                  required
                  type="email"
                  maxLength={254}
                  autoComplete="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </Field>
            )}
          {(mode === "telegram-code" || mode === "guest") && (
            <Field
              label={
                mode === "guest"
                  ? "Код приглашения"
                  : "Код из команды /login у привязанного бота"
              }
            >
              <input
                required
                inputMode={mode === "guest" ? "text" : "numeric"}
                pattern={mode === "guest" ? "[a-f0-9]{64}" : "[0-9]{8}"}
                maxLength={mode === "guest" ? 64 : 8}
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </Field>
          )}
          {mode === "reset-password" && (
            <Field label="Код из письма">
              <input
                required
                value={form.token}
                onChange={(e) => setForm({ ...form, token: e.target.value })}
              />
            </Field>
          )}
          {mode !== "forgot-password" &&
            mode !== "telegram-code" &&
            mode !== "guest" && (
              <Field label="Пароль · от 12 символов">
                <input
                  required
                  type="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
              </Field>
            )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <button className="auth-submit" disabled={busy}>
            {busy ? "Подождите…" : titles[mode]}
          </button>
        </form>
        <button
          className="text-button"
          onClick={() => setMode("forgot-password")}
        >
          Забыли пароль?
        </button>
        <button
          className="ghost auth-option"
          onClick={() => setMode("telegram-code")}
        >
          Войти по коду Telegram
        </button>
        <a
          className="button ghost auth-option"
          href="/signin-with-chatgpt?return_to=%2F"
          target="_top"
        >
          Войти через ChatGPT
        </a>
        <button
          className="ghost auth-option"
          onClick={() => {
            localStorage.setItem("neustroy-mode", "offline");
            location.assign("/local");
          }}
        >
          На этом устройстве · без аккаунта
        </button>
        <p className="auth-note">
          Локальные данные хранятся на устройстве. Экспортируйте листы и
          кампании для резервной копии.
        </p>
      </section>
    </main>
  );
}

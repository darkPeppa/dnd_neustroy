import { useState } from "react";
import { ConnectAgent } from "./AgentSettings";
import { request, appFetch, authHeaders } from "../api";
import type { AppContext } from "../main";
import { Field, Modal } from "../ui";
import { characterSchema, classes, statNames, type Character } from "../domain";
type Config = {
  provider: string;
  apiKey: string;
  model: string;
  imageModel: string;
};
let connection: Config = {
  provider: "basic",
  apiKey: "",
  model: "",
  imageModel: "",
};
export async function assistantRequest(data: Record<string, unknown>) {
  return request("assistant", "POST", {
    ...connection,
    campaignId: localStorage.getItem("neustroy-campaign") || "",
    ...data,
    model: ["portrait", "map"].includes(String(data.action))
      ? connection.imageModel
      : connection.model,
  });
}
export function AssistantPanel({ ctx }: { ctx: AppContext }) {
  const [config, setConfig] = useState(connection),
    [action, setAction] = useState("rules"),
    [edition, setEdition] = useState("srd-2024"),
    [prompt, setPrompt] = useState(""),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false);
  function update(next: Config) {
    connection = next;
    setConfig(next);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Помощники за столом</h1>
          <p>Правила, предыстория, подготовка и журнал игры.</p>
        </div>
      </div>
      <div className="two-col">
        <section className="card">
          <h2>Подключение</h2>
          <Field label="Провайдер">
            <select
              value={config.provider}
              onChange={(e) => update({ ...config, provider: e.target.value })}
            >
              <option value="basic">Базовые помощники · без ключа</option>
              <option value="server">Модель сервера / Ollama</option>
              <option value="openrouter">
                OpenRouter · доступен бесплатный маршрутизатор
              </option>
              <option value="groq">Groq · квота зависит от аккаунта</option>
              <option value="openai">OpenAI API</option>
              <option value="deepseek">DeepSeek API</option>
            </select>
          </Field>
          {!["basic", "server"].includes(config.provider) && (
            <Field label="API-ключ · хранится в памяти этой вкладки">
              <input
                type="password"
                autoComplete="off"
                value={config.apiKey}
                onChange={(e) => update({ ...config, apiKey: e.target.value })}
              />
            </Field>
          )}
          <ConnectAgent
            ctx={ctx}
            provider={config.provider}
            apiKey={config.apiKey}
            linked={(p) =>
              update({ ...connection, provider: p, apiKey: "", model: "" })
            }
          />
          <Field label="Текстовая модель · пусто = стандартная">
            <input
              value={config.model}
              onChange={(e) => update({ ...config, model: e.target.value })}
              list="model-presets"
            />
            <datalist id="model-presets">
              {[
                "qwen3:4b",
                "llama3.2:3b",
                "gemma3:4b",
                "openrouter/free",
                "openai/gpt-oss-20b",
              ].map((m) => (
                <option value={m} key={m} />
              ))}
            </datalist>
          </Field>
          <Field label="Модель изображений · пусто = стандартная">
            <input
              value={config.imageModel}
              onChange={(e) =>
                update({ ...config, imageModel: e.target.value })
              }
            />
          </Field>
          <p className="muted">
            Базовые помощники работают со справочником и шаблонами. Подключённый
            аккаунт или сохранённый ключ позволяет выбрать внешнюю модель.
            ChatGPT/Codex используют MCP в своём клиенте.
          </p>
          <a
            href="https://chatgpt.com/"
            target="_blank"
            rel="noreferrer"
            className="button ghost"
          >
            Открыть ChatGPT
          </a>
        </section>
        <section className="card">
          <h2>Задача</h2>
          <Field label="Помощник">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              {[
                ["rules", "Консультант по правилам"],
                ["backstory", "Предыстория персонажа"],
                ["summary", "Секретарь игры"],
                ["npc", "Персонаж мастера"],
                ["scenario", "Подготовка сценария"],
                ["contradictions", "Противоречия в записях"],
              ].map(([id, label]) => (
                <option value={id} key={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Редакция">
            <select
              value={edition}
              onChange={(e) => setEdition(e.target.value)}
            >
              <option value="srd-2014">2014 · SRD 5.1</option>
              <option value="srd-2024">2024 · SRD 5.2.1</option>
            </select>
          </Field>
          <Field label="Запрос">
            <textarea
              rows={9}
              value={prompt}
              maxLength={50000}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Field>
          <button
            disabled={busy || !prompt.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await assistantRequest({
                  action,
                  prompt,
                  edition,
                  campaignId: localStorage.getItem("neustroy-campaign") || "",
                });
                setResult(r.text);
              } catch (e) {
                ctx.toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Готовлю ответ…" : "Отправить запрос"}
          </button>
        </section>
      </div>
      {result && (
        <section className="card">
          <h2>Ответ для проверки</h2>
          <div className="rule-description">{result}</div>
          <button className="ghost" onClick={() => window.print()}>
            Печать / PDF
          </button>
        </section>
      )}
    </>
  );
}
async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export async function extractSheet(file: File): Promise<Character[]> {
  if (file.size > 5 * 1024 * 1024) throw Error("Максимум 5 МБ");
  if (file.type.startsWith("image/")) {
    const r = await assistantRequest({
      action: "parse-character",
      prompt:
        "Распознай этот лист персонажа. Отметь неизвестные поля и предположения в notes.",
      image: { mime: file.type, base64: await fileBase64(file) },
    });
    return [characterSchema.parse(r.character)];
  }
  let text = "";
  if (
    file.type === "application/pdf" ||
    file.name.toLowerCase().endsWith(".pdf")
  ) {
    const pdf = await import("pdfjs-dist");
    const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
      .default;
    pdf.GlobalWorkerOptions.workerSrc = worker;
    const loading = pdf.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
    });
    const doc = await loading.promise;
    try {
      if (doc.numPages > 40)
        throw Error("Для импорта листа выберите PDF до 40 страниц");
      for (let page = 1; page <= doc.numPages; page++) {
        const p = await doc.getPage(page);
        const content = await p.getTextContent();
        text += content.items.map((i: any) => i.str || "").join(" ") + "\n";
        const fields = await p.getAnnotations();
        text +=
          fields
            .filter((i: any) => i.fieldName)
            .map((i: any) => `${i.fieldName}: ${i.fieldValue ?? ""}`)
            .join("\n") + "\n";
        p.cleanup();
      }
    } finally {
      await loading.destroy();
    }
    if (!text.trim())
      throw Error(
        "В PDF нет текстового слоя. Загрузите изображение листа для распознавания моделью.",
      );
  } else text = await file.text();
  try {
    const data = JSON.parse(text);
    return (Array.isArray(data) ? data : [data]).map((x) =>
      characterSchema.parse(x.data || x),
    );
  } catch (e) {
    if (file.name.toLowerCase().endsWith(".json"))
      throw Error(
        "JSON не соответствует формату листа neustroy. Проверьте файл перед импортом.",
      );
  }
  const r = await assistantRequest({
    action: "parse-character",
    prompt: text.slice(0, 50000),
  });
  return [characterSchema.parse(r.character)];
}
export function SheetImport({
  ctx,
  onDraft,
}: {
  ctx: AppContext;
  onDraft: (c: Character) => void;
}) {
  const [busy, setBusy] = useState(false),
    [drafts, setDrafts] = useState<Character[]>([]),
    [index, setIndex] = useState(0);
  return (
    <>
      <label className="button ghost">
        {busy
          ? "Читаю лист…"
          : ctx.agentEnabled
            ? "Импорт JSON / PDF / фото"
            : "Импорт JSON"}
        <input
          hidden
          disabled={busy}
          type="file"
          accept={
            ctx.agentEnabled
              ? "application/json,application/pdf,image/png,image/jpeg,image/webp,text/plain"
              : "application/json,.json"
          }
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setBusy(true);
            try {
              if (!ctx.agentEnabled && !f.name.toLowerCase().endsWith(".json"))
                throw Error("При выключенном помощнике доступен импорт JSON");
              setDrafts(await extractSheet(f));
              setIndex(0);
            } catch (error) {
              ctx.toast((error as Error).message, true);
            } finally {
              setBusy(false);
              e.target.value = "";
            }
          }}
        />
      </label>
      {drafts.length > 0 && (
        <Modal title="Проверка импорта" onClose={() => setDrafts([])}>
          {drafts.length > 1 && (
            <Field label="Персонаж из файла">
              <select value={index} onChange={(e) => setIndex(+e.target.value)}>
                {drafts.map((c, i) => (
                  <option value={i} key={i}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <h2>{drafts[index].name}</h2>
          <p>
            {classes[drafts[index].classId].name} · уровень{" "}
            {drafts[index].level} · {drafts[index].edition}
          </p>
          <div className="scores-grid">
            {Object.entries(drafts[index].scores).map(([id, n]) => (
              <div className="stat" key={id}>
                <span>{statNames[id as keyof typeof statNames]}</span>
                <strong>{n}</strong>
              </div>
            ))}
          </div>
          <p className="rule-description">{drafts[index].notes}</p>
          <p className="muted">
            Распознавание может ошибаться. Откройте редактор, проверьте поля и
            сохраните лист.
          </p>
          <button
            onClick={() => {
              onDraft(drafts[index]);
              setDrafts([]);
            }}
          >
            Открыть редактор
          </button>
        </Modal>
      )}
    </>
  );
}
export function CharacterExtras({
  id,
  character,
  revision,
  onSaved,
  ctx,
}: {
  id: string;
  character: Character;
  revision: number;
  onSaved: (row: any) => void;
  ctx: AppContext;
}) {
  const [portrait, setPortrait] = useState<string>(),
    [picked, setPicked] = useState<Blob>(),
    [prompt, setPrompt] = useState(""),
    [story, setStory] = useState(""),
    [busy, setBusy] = useState(false);
  async function preview(blob: Blob) {
    if (portrait) URL.revokeObjectURL(portrait);
    setPicked(blob);
    setPortrait(URL.createObjectURL(blob));
  }
  return (
    <section className="card character-extras">
      <h2>Портрет и история</h2>
      {portrait && (
        <img
          src={portrait}
          className="character-portrait"
          alt={`Портрет ${character.name}`}
        />
      )}
      <div className="row wrap">
        <button
          className="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await appFetch(`characters/${id}/portrait`, {
                headers: authHeaders(),
              });
              if (r.ok) await preview(await r.blob());
              else throw Error("Портрет ещё не добавлен");
            } catch (e) {
              ctx.toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Посмотреть сохранённый
        </button>
        <label className="button ghost">
          Загрузить портрет
          <input
            type="file"
            hidden
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                if (f.size > 5 * 1024 * 1024) ctx.toast("Максимум 5 МБ", true);
                else preview(f);
              }
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {ctx.agentEnabled && (
        <>
          <Field label="Промпт для портрета или предыстории">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
            />
          </Field>
          <div className="row wrap">
            <button
              className="ghost"
              disabled={busy || !prompt.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await assistantRequest({
                    action: "portrait",
                    prompt: `${character.name}, ${character.classId}. ${prompt}`,
                  });
                  await preview(
                    new Blob(
                      [Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))],
                      { type: r.mime },
                    ),
                  );
                } catch (e) {
                  ctx.toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Создать портрет
            </button>
            <button
              className="ghost"
              disabled={busy || !prompt.trim()}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await assistantRequest({
                    action: "backstory",
                    prompt: JSON.stringify({
                      request: prompt,
                      name: character.name,
                      class: character.classId,
                      ancestry: character.ancestry,
                      background: character.background,
                    }),
                  });
                  setStory(r.text);
                } catch (e) {
                  ctx.toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Создать историю
            </button>
          </div>
          <p className="muted">
            Модель и ключ выбираются в разделе «Помощники». Генерация может
            расходовать квоту провайдера. Изображение и история сохраняются
            после вашей проверки.
          </p>
        </>
      )}
      {picked && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await appFetch(`characters/${id}/portrait`, {
                method: "PUT",
                headers: { ...authHeaders(), "Content-Type": picked.type },
                body: picked,
              });
              if (!r.ok) throw Error(((await r.json()) as any).error);
              ctx.toast("Портрет сохранён");
            } catch (e) {
              ctx.toast((e as Error).message, true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Сохранить портрет
        </button>
      )}
      {story && (
        <>
          <Field label="Предыстория для проверки">
            <textarea
              rows={10}
              value={story}
              onChange={(e) => setStory(e.target.value)}
            />
          </Field>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const row = await request(`characters/${id}`, "PUT", {
                  revision,
                  data: {
                    ...character,
                    notes: (character.notes + "\n\n" + story).slice(0, 12000),
                  },
                });
                onSaved(row);
                setStory("");
              } catch (e) {
                ctx.toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            Добавить в историю персонажа
          </button>
        </>
      )}
    </section>
  );
}

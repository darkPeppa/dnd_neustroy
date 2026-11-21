import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture";
import { defaultCharacter } from "../src/domain";

const bot = {
  LOCAL_DEV: "true",
  TELEGRAM_BOT_TOKEN: "123456:THIS_IS_A_FAKE_TEST_TOKEN_00000000",
  TELEGRAM_BOT_USERNAME: "test_neustroy_bot",
  TELEGRAM_WEBHOOK_SECRET: "test-only-webhook-secret",
};
test("Telegram: привязка одноразовая, команды используют права профиля, вход и отвязка отзывают токен", async (t) => {
  const f = await fixture(bot);
  t.after(f.close);
  await f.call("gm", "me");
  const cid = (await f.call("gm", "campaigns", "POST", { name: "Маяк" })).body
    .id;
  const invite = (await f.call("gm", "campaigns")).body[0].invite;
  await f.call("alice", "campaigns/join", "POST", { invite });
  const link = await f.call("alice", "telegram/link", "POST");
  assert.equal(link.status, 200);
  const token = new URL(link.body.url).searchParams.get("start")!;
  const stored = await f.db.prepare("SELECT hash FROM telegram_links").first();
  assert(stored);
  assert.notEqual(stored.hash, token);
  let update = 1;
  async function hook(
    text: string,
    chat = 123,
    from = 123,
    secret = bot.TELEGRAM_WEBHOOK_SECRET,
    id = update++,
  ) {
    const response = await f.mf.dispatchFetch(
      "http://localhost/telegram/webhook",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Bot-Api-Secret-Token": secret,
        },
        body: JSON.stringify({
          update_id: id,
          message: {
            text,
            chat: { id: chat, type: "private" },
            from: { id: from, first_name: "Тест" },
          },
        }),
      },
    );
    return { status: response.status, body: (await response.json()) as any };
  }
  assert.equal(
    (await hook("/start " + token, 123, 123, "wrong-secret")).status,
    403,
  );
  assert.match((await hook("/start " + token)).body.text, /подключён/);
  assert.match(
    (await hook("/start " + token, 456, 456)).body.text,
    /недействительна/,
  );
  assert.equal((await f.call("alice", "telegram")).body.linked, true);
  assert.match((await hook("/games")).body.text, /Маяк/);
  await hook("/use " + cid);
  const messageId = update;
  const note = await hook("/note Личная запись\nВторая строка");
  assert.match(note.body.text, /Личная запись сохранена/);
  const repeated = await hook(
    "/note Личная запись\nВторая строка",
    123,
    123,
    bot.TELEGRAM_WEBHOOK_SECRET,
    messageId,
  );
  assert.equal(repeated.body.text, note.body.text);
  assert.equal(
    (await f.call("alice", `campaigns/${cid}/notes`)).body.length,
    1,
  );
  assert.equal((await f.call("gm", `campaigns/${cid}/notes`)).body.length, 0);
  assert.match((await hook("/dice 2d6+3")).body.text, /2d6\+3/);
  assert.equal((await f.call("alice", `campaigns/${cid}/log`)).body.length, 1);
  const code = (await hook("/login")).body.text.match(/\b\d{8}\b/)[0];
  const logged = await f.call("", "auth/telegram-code", "POST", { code });
  assert.equal(logged.status, 200);
  assert.equal(logged.body.user.id, "alice");
  const bearer = { Authorization: "Bearer " + logged.body.token };
  assert.equal(
    (await f.call("", "auth/telegram-code", "POST", { code })).status,
    401,
  );
  assert.equal(
    (await f.call("", "me", "GET", undefined, bearer)).body.user.id,
    "alice",
  );
  await f.call("alice", "telegram", "DELETE");
  assert.equal((await f.call("", "me", "GET", undefined, bearer)).status, 401);
});

test("Telegram: скрытые материалы не попадают в ответы бота, групповые сообщения игнорируются", async (t) => {
  const f = await fixture(bot);
  t.after(f.close);
  await f.call("gm", "me");
  const cid = (await f.call("gm", "campaigns", "POST", { name: "Секрет" })).body
    .id;
  const invite = (await f.call("gm", "campaigns")).body[0].invite;
  await f.call("alice", "campaigns/join", "POST", { invite });
  const create = (title: string, revealed: boolean) =>
    f.call("gm", "clues", "POST", {
      campaignId: cid,
      title,
      body: title,
      kind: "note",
      revealed,
      recipients: [],
    });
  await create("Только мастер", false);
  await create("Видимая улика", true);
  const token = new URL(
    (await f.call("alice", "telegram/link", "POST")).body.url,
  ).searchParams.get("start");
  let i = 100;
  async function hook(text: string, type = "private") {
    const r = await f.mf.dispatchFetch("http://localhost/telegram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Bot-Api-Secret-Token": bot.TELEGRAM_WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        update_id: i++,
        message: { text, chat: { id: 123, type }, from: { id: 123 } },
      }),
    });
    return (await r.json()) as any;
  }
  await hook("/start " + token);
  await hook("/use " + cid);
  const result = await hook("/materials");
  assert(result.text.includes("Видимая улика"));
  assert(!result.text.includes("Только мастер"));
  assert.deepEqual(await hook("/note Не записывать", "group"), { ok: true });
  assert.equal(
    (await f.call("alice", `campaigns/${cid}/notes`)).body.length,
    0,
  );
});

test("секреты сервиса: обычный игрок не читает настройки, ключи хранятся шифрованными", async (t) => {
  const f = await fixture({
    LOCAL_DEV: "true",
    CONFIG_ENCRYPTION_KEY: "test-encryption-key-not-for-production-123456",
  });
  t.after(f.close);
  await f.call("gm", "me");
  assert.equal((await f.call("alice", "integrations")).status, 403);
  const value = "test-provider-key-not-a-real-credential";
  assert.equal(
    (
      await f.call("gm", "integrations", "PUT", {
        ASSISTANT_API_KEY: value,
        ASSISTANT_BASE_URL: "https://model.example/v1",
        ASSISTANT_MODEL: "test-model",
      })
    ).status,
    200,
  );
  const stored = await f.db
    .prepare(
      "SELECT value FROM site_config WHERE id='integration:ASSISTANT_API_KEY'",
    )
    .first<{ value: string }>();
  assert(stored);
  assert(!stored.value.includes(value));
  const status = (await f.call("gm", "integrations")).body;
  assert.equal(status.assistant, true);
  assert(!JSON.stringify(status).includes(value));
  assert(!JSON.stringify((await f.call("alice", "me")).body).includes(value));
});

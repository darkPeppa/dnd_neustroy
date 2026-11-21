import assert from "node:assert/strict";
import test from "node:test";
import { Response } from "miniflare";
import { fixture } from "./fixture";
import { defaultPricing } from "../src/domain";

const accessConfig = {
  LOCAL_DEV: "true",
  GM_ACCESS_PRICE_RUB: "1200",
  PUBLIC_APP_URL: "https://demo.example.test",
  YOOKASSA_SHOP_ID: "fake-shop",
  YOOKASSA_SECRET: "fake-secret-not-for-production",
};
const profile = {
  handle: "alina-master",
  name: "Алина",
  description: "Детектив для новичков",
  city: "Казань",
  formats: ["online", "offline"],
  tags: ["детектив", "новички"],
  pricing: { ...defaultPricing, hour: 3500 },
  offers: [
    {
      name: "Карта на бумаге",
      description: "Рисунок игрового города",
      price: 500,
    },
  ],
  visible: true,
};

test("доступ ведущего выдаётся после проверки суммы и статуса у платёжного провайдера", async (t) => {
  let providerOrder = "",
    amount = "0.00",
    paid = false,
    creations = 0;
  const paymentId = "test-yookassa-payment-id";
  const f = await fixture(accessConfig, async (r) => {
    assert.equal(new URL(r.url).hostname, "api.yookassa.ru");
    if (r.method === "POST") {
      creations++;
      const data = (await r.json()) as any;
      providerOrder = data.metadata.master_order;
      assert.equal(r.headers.get("Idempotence-Key"), providerOrder);
      assert.equal(data.amount.value, "1200.00");
      return Response.json({
        id: paymentId,
        status: "pending",
        metadata: { master_order: providerOrder },
        amount: data.amount,
        confirmation: {
          confirmation_url: "https://payment.example.test/checkout",
        },
      });
    }
    assert(new URL(r.url).pathname.endsWith(paymentId));
    return Response.json({
      id: paymentId,
      status: paid ? "succeeded" : "pending",
      paid,
      metadata: { master_order: providerOrder },
      amount: { value: amount, currency: "RUB" },
    });
  });
  t.after(f.close);
  await f.call("gm", "me");
  const user = "account:alina";
  assert.equal(
    (await f.call(user, "masters/mine", "PUT", profile)).status,
    403,
  );
  assert.equal(
    (await f.call(user, "masters/access/checkout", "POST", { rubles: 1 }))
      .status,
    409,
  );
  assert.equal(creations, 0);
  const started = await f.call(user, "masters/access/checkout", "POST", {
    rubles: 1200,
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(
    (await f.call(user, "masters/access/checkout", "POST", { rubles: 1200 }))
      .body.id,
    started.body.id,
  );
  assert.equal(creations, 1);
  assert.equal(
    (
      await f.call("account:other", "masters/access/verify", "POST", {
        id: started.body.id,
      })
    ).status,
    404,
  );
  const verify = () =>
    f.call(user, "masters/access/verify", "POST", { id: started.body.id });
  paid = true;
  amount = "1199.00";
  assert.equal((await verify()).status, 502);
  assert.equal((await f.call(user, "me")).body.isMaster, false);
  paid = false;
  amount = "1200.00";
  assert.equal((await verify()).body.enabled, false);
  paid = true;
  assert.equal((await verify()).body.enabled, true);
  assert.equal((await verify()).body.enabled, true);
  assert.equal(
    (await f.call(user, "masters/mine", "PUT", profile)).status,
    200,
  );
});

test("прайс, подбор и бронь относятся к конкретному ведущему", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.call("gm", "me");
  await f.db
    .prepare(
      "INSERT INTO master_access(user_id,granted_at,payment_id) VALUES(?,?,?)",
    )
    .bind("account:alina", new Date().toISOString(), "test-payment")
    .run();
  const made = await f.call("account:alina", "masters/mine", "PUT", profile);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const defaultMaster = (await f.call("player", "masters")).body.find(
    (p: any) => p.handle === "neustroy",
  );
  assert.equal(defaultMaster.pricing.hour, defaultPricing.hour);
  assert.equal(
    (
      await f.call("player", "masters/match", "POST", {
        city: "казань",
        format: "offline",
        query: "Детектив для новичков",
        budget: 4000,
      })
    ).body[0].profile.handle,
    profile.handle,
  );
  assert.deepEqual(
    (
      await f.call("player", "masters/match", "POST", {
        city: "казань",
        budget: 1000,
      })
    ).body,
    [],
  );
  const booked = await f.call("player", "bookings", "POST", {
    masterHandle: profile.handle,
    format: "online",
    players: 4,
    age: "adults",
    hours: 3,
    experience: "little",
    rules: "base",
    characters: "self",
    genres: [],
    mood: "детектив",
    settings: [],
    extras: [],
    wishes: "",
    name: "Игрок",
    channel: "email",
    contact: "player@example.test",
    consent: true,
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.equal(booked.body.total, 10500);
  assert.equal((await f.call("gm", "bookings")).body.length, 0);
  assert.equal(
    (await f.call("gm", `bookings/${booked.body.id}/decline`, "POST")).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        "account:alina",
        `bookings/${booked.body.id}/decline`,
        "POST",
      )
    ).status,
    200,
  );
});

test("каталог фильтрует игры и создаёт участника только после одобрения заявки", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.call("gm", "me");
  const game = (
    await f.call("gm", "campaigns", "POST", { name: "Казанский маяк" })
  ).body.id;
  const mine = (
    await f.call("player", "campaigns", "POST", { name: "Частная игра" })
  ).body.id;
  const publishing = {
    name: "Казанский маяк",
    description: "Расследование",
    visibility: "public",
    listing: {
      format: "offline",
      city: "Казань",
      tags: ["детектив"],
      accepts: ["observer"],
    },
  };
  assert.equal(
    (await f.call("player", `campaigns/${mine}`, "PATCH", publishing)).status,
    403,
  );
  assert.equal(
    (await f.call("gm", `campaigns/${game}`, "PATCH", publishing)).status,
    200,
  );
  assert.deepEqual(
    (await f.call("player", "campaigns/discover?format=online")).body,
    [],
  );
  assert.deepEqual(
    (
      await f.call(
        "player",
        "campaigns/discover?city=" + encodeURIComponent("казань"),
      )
    ).body.map((r: any) => r.id),
    [game],
  );
  assert.equal(
    (await f.call("player", `campaigns/${game}/join-public`, "POST")).status,
    409,
  );
  assert.equal(
    (
      await f.call("player", `campaigns/${game}/applications`, "POST", {
        role: "player",
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call("player", `campaigns/${game}/applications`, "POST", {
        role: "observer",
        message: "Хочу посмотреть",
      })
    ).status,
    201,
  );
  assert.equal((await f.call("player", "clues?campaign=" + game)).status, 404);
  const [application] = (await f.call("gm", `campaigns/${game}/applications`))
    .body;
  assert.equal(
    (
      await f.call(
        "player",
        `campaigns/${game}/applications/${application.id}`,
        "PATCH",
        { decision: "approved" },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await f.call(
        "gm",
        `campaigns/${game}/applications/${application.id}`,
        "PATCH",
        { decision: "approved" },
      )
    ).status,
    200,
  );
  assert.equal(
    (await f.call("player", "campaigns")).body.find(
      (row: any) => row.id === game,
    ).role_id,
    "observer",
  );
});

test("базовый помощник и шаблоны работают без провайдера, переключатели действуют на API", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const cid = (await f.call("gm", "campaigns", "POST", { name: "Лес" })).body
    .id;
  const base = (await f.call("gm", "campaign-presets")).body[0].config;
  const query = {
    provider: "basic",
    action: "npc",
    campaignId: cid,
    prompt: "Лесной сторож",
  };
  assert.match(
    (await f.call("gm", "assistant", "POST", query)).body.text,
    /Лесной сторож/,
  );
  await f.call("gm", "agent-preferences", "PUT", { enabled: false });
  assert.equal((await f.call("gm", "assistant", "POST", query)).status, 403);
  await f.call("gm", "agent-preferences", "PUT", { enabled: true });
  const config = {
    ...base,
    assistant: false,
    appearance: {
      prompt: "Зимний лес",
      base: "#0d1a2d",
      accent: "#78a9e8",
      pattern: "stars",
    },
  };
  assert.equal(
    (await f.call("gm", `campaigns/${cid}/rules-config`, "PUT", config)).status,
    200,
  );
  assert.equal((await f.call("gm", "assistant", "POST", query)).status, 403);
  const saved = await f.call("gm", "campaign-presets", "POST", {
    name: "Личная заготовка",
    config,
  });
  assert.equal(saved.status, 201);
  assert.equal(
    (await f.call("player", "campaign-presets")).body.some(
      (p: any) => p.id === saved.body.id,
    ),
    false,
  );
  assert.equal(
    (await f.call("gm", `campaigns/${cid}/rules-config`)).body.appearance
      .prompt,
    "Зимний лес",
  );
});

test("делегированный ключ привязан к инициатору OAuth и сохраняется в зашифрованном виде", async (t) => {
  const fixtureKey = "fake-openrouter-key-for-tests";
  let exchanges = 0;
  const f = await fixture(
    {
      LOCAL_DEV: "true",
      CONFIG_ENCRYPTION_KEY:
        "test-encryption-configuration-at-least-32-characters",
    },
    async (r) => {
      exchanges++;
      assert.equal(new URL(r.url).pathname, "/api/v1/auth/keys");
      const params = (await r.json()) as any;
      assert.equal(params.code_challenge_method, "S256");
      assert.match(params.code_verifier, /^[A-Za-z0-9_-]{43}$/);
      return Response.json({ key: fixtureKey });
    },
  );
  t.after(f.close);
  const result = await f.call("alice", "agent-connection/start", "POST");
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const auth = new URL(result.body.url);
  const state = new URL(
    auth.searchParams.get("callback_url")!,
  ).searchParams.get("agent_state")!;
  const data = { state, code: "test-code-for-pkce" };
  assert.equal(
    (await f.call("bob", "agent-connection/finish", "POST", data)).status,
    400,
  );
  assert.equal(exchanges, 0);
  assert.equal(
    (await f.call("alice", "agent-connection/finish", "POST", data)).status,
    200,
  );
  assert.equal(
    (await f.call("alice", "agent-connection/finish", "POST", data)).status,
    400,
  );
  const stored = await f.db
    .prepare(
      "SELECT encrypted_key FROM assistant_connections WHERE user_id='alice'",
    )
    .first();
  assert(!String(stored?.encrypted_key).includes(fixtureKey));
  assert.equal(
    (await f.call("alice", "agent-connection")).body.provider,
    "openrouter",
  );
  assert.equal((await f.call("bob", "agent-connection")).body.provider, "");
});

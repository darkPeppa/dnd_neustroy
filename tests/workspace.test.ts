import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixture";
import { defaultCharacter } from "../src/domain";

test("роли: мастер задаёт доступ, игрок не повышает себе права и не меняет правила", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.call("gm", "me");
  const game = (await f.call("gm", "campaigns", "POST", { name: "Кампания" }))
    .body.id;
  const invite = (await f.call("gm", "campaigns")).body[0].invite;
  for (const user of ["alice", "bob"])
    assert.equal(
      (await f.call(user, "campaigns/join", "POST", { invite })).status,
      200,
    );
  // Игрок не может назначить себе мастера или отредактировать роль.
  assert.equal(
    (
      await f.call("alice", `campaigns/${game}/members/alice`, "PATCH", {
        roleId: "gm",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("alice", `campaigns/${game}/roles`, "PUT", {
        id: "admin",
        name: "Обход",
        permissions: ["manage_members"],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("alice", `campaigns/${game}/rules-config`, "PUT", {
        mode: "custom",
        edition: "custom",
        enabledModules: [],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.call("gm", `campaigns/${game}/members/bob`, "PATCH", {
        roleId: "observer",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call("gm", `campaigns/${game}/members/gm`, "PATCH", {
        roleId: "observer",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("gm", `campaigns/${game}/rules-config`, "PUT", {
        mode: "custom",
        edition: "srd-2024",
        enabledModules: ["inventory"],
        custom: { description: "Своя нагрузка" },
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.call("alice", `campaigns/${game}/rules-config`)).body.mode,
    "custom",
  );
});

test("журнал: личные записи не видны мастеру, общие видны группе, ревизия защищает от потери текста", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.call("gm", "me");
  const cid = (await f.call("gm", "campaigns", "POST", { name: "Журнал" })).body
    .id;
  const invite = (await f.call("gm", "campaigns")).body[0].invite;
  await f.call("alice", "campaigns/join", "POST", { invite });
  await f.call("bob", "campaigns/join", "POST", { invite });
  const base = {
    title: "Запись",
    body: "Текст",
    visibility: "private",
    links: [],
  };
  const personal = await f.call(
    "alice",
    `campaigns/${cid}/notes`,
    "POST",
    base,
  );
  assert.equal(personal.status, 201);
  for (const user of ["gm", "bob"]) {
    assert.equal((await f.call(user, `campaigns/${cid}/notes`)).body.length, 0);
    assert.equal(
      (
        await f.call(
          user,
          `campaigns/${cid}/notes/${personal.body.id}`,
          "DELETE",
        )
      ).status,
      404,
    );
  }
  const shared = await f.call("alice", `campaigns/${cid}/notes`, "POST", {
    ...base,
    visibility: "shared",
  });
  assert.equal(shared.status, 201);
  assert.equal((await f.call("bob", `campaigns/${cid}/notes`)).body.length, 1);
  assert.equal(
    (
      await f.call(
        "alice",
        `campaigns/${cid}/notes/${personal.body.id}`,
        "PUT",
        { ...base, revision: 1 },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "alice",
        `campaigns/${cid}/notes/${personal.body.id}`,
        "PUT",
        { ...base, body: "Устаревший текст", revision: 1 },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await f.call("alice", `campaigns/${cid}/notes`, "POST", {
        ...base,
        visibility: "shared",
        links: [personal.body.id],
      })
    ).status,
    400,
  );
  await f.call("gm", `campaigns/${cid}/members/bob`, "PATCH", {
    roleId: "observer",
  });
  assert.equal(
    (
      await f.call("bob", `campaigns/${cid}/notes`, "POST", {
        ...base,
        visibility: "shared",
      })
    ).status,
    403,
  );
  // Наблюдатель сохраняет личные записи, хотя не может публиковать общие.
  assert.equal(
    (await f.call("bob", `campaigns/${cid}/notes`, "POST", base)).status,
    201,
  );
});

test("папки: доступ наследуется, чужая игра и циклический родитель отклоняются", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.call("gm", "me");
  const cid = (await f.call("gm", "campaigns", "POST", { name: "Папки" })).body
    .id;
  const invite = (await f.call("gm", "campaigns")).body[0].invite;
  await f.call("alice", "campaigns/join", "POST", { invite });
  await f.call("bob", "campaigns/join", "POST", { invite });
  await f.call("gm", `campaigns/${cid}/roles`, "PUT", {
    id: "investigator",
    name: "Следователь",
    permissions: ["view_materials", "write_shared_notes"],
  });
  await f.call("gm", `campaigns/${cid}/members/alice`, "PATCH", {
    roleId: "investigator",
  });
  const folder = (
    await f.call("gm", `campaigns/${cid}/folders`, "POST", {
      name: "Досье",
      roles: ["investigator"],
      recipients: [],
    })
  ).body.id;
  const child = (
    await f.call("gm", `campaigns/${cid}/folders`, "POST", {
      name: "Вложенная",
      parentId: folder,
      roles: [],
      recipients: [],
    })
  ).body.id;
  const clue = (
    await f.call("gm", "clues", "POST", {
      campaignId: cid,
      title: "Улика",
      body: "Секрет",
      kind: "map",
      revealed: true,
      recipients: [],
      roles: ["investigator"],
      folderId: child,
    })
  ).body.id;
  assert.equal((await f.call("alice", "clues?campaign=" + cid)).body.length, 1);
  assert.equal((await f.call("bob", "clues?campaign=" + cid)).body.length, 0);
  assert.equal(
    (await f.call("bob", `campaigns/${cid}/folders`)).body.length,
    0,
  );
  assert.equal(
    (
      await f.call("gm", `campaigns/${cid}/folders/${folder}`, "PATCH", {
        name: "Досье",
        parentId: child,
        roles: [],
        recipients: [],
      })
    ).status,
    400,
  );
  const foreign = (await f.call("gm", "campaigns", "POST", { name: "Другая" }))
    .body.id;
  assert.equal(
    (
      await f.call("gm", "clues", "POST", {
        campaignId: foreign,
        title: "Подмена",
        body: "",
        kind: "note",
        revealed: true,
        recipients: [],
        folderId: folder,
      })
    ).status,
    400,
  );
  const upload = await f.mf.dispatchFetch(
    `http://localhost/api/clues/${clue}/file`,
    {
      method: "PUT",
      headers: { "x-dev-user": "gm", "content-type": "text/plain" },
      body: "Содержимое",
    },
  );
  assert.equal(upload.status, 200);
  assert.equal(
    (
      await f.mf.dispatchFetch(`http://localhost/api/clues/${clue}/file`, {
        headers: { "x-dev-user": "bob" },
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await f.mf.dispatchFetch(`http://localhost/api/clues/${clue}/file`, {
        headers: { "x-dev-user": "alice" },
      })
    ).status,
    200,
  );
});

test("чаты: личная переписка двух игроков скрыта от мастера и третьего игрока", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.call("gm", "me");
  const cid = (await f.call("gm", "campaigns", "POST", { name: "Чаты" })).body
    .id;
  const invite = (await f.call("gm", "campaigns")).body[0].invite;
  for (const user of ["alice", "bob", "eve"])
    await f.call(user, "campaigns/join", "POST", { invite });
  assert.equal(
    (
      await f.call("alice", `campaigns/${cid}/chat?peer=bob`, "POST", {
        text: "Личный секрет",
        author_id: "gm",
      })
    ).status,
    201,
  );
  assert.equal(
    (await f.call("alice", `campaigns/${cid}/chat?peer=bob`)).body[0].author_id,
    "alice",
  );
  assert.equal(
    (await f.call("bob", `campaigns/${cid}/chat?peer=alice`)).body[0].text,
    "Личный секрет",
  );
  for (const user of ["gm", "eve"]) {
    assert.equal((await f.call(user, `campaigns/${cid}/chat`)).body.length, 0);
    assert.equal(
      (await f.call(user, `campaigns/${cid}/chat?peer=alice`)).body.length,
      0,
    );
  }
  assert.equal(
    (
      await f.call("alice", `campaigns/${cid}/chat?peer=outsider`, "POST", {
        text: "Вне игры",
      })
    ).status,
    404,
  );
  await f.call("alice", `campaigns/${cid}/chat`, "POST", {
    text: "Общее сообщение",
  });
  assert.equal(
    (await f.call("gm", `campaigns/${cid}/chat`)).body[0].text,
    "Общее сообщение",
  );
});

test("инструменты: секрет мастера удаляется из ответа игроку, личные документы и лог изолированы", async (t) => {
  const f = await fixture();
  t.after(f.close);
  await f.call("gm", "me");
  const cid = (await f.call("gm", "campaigns", "POST", { name: "Инструменты" }))
    .body.id;
  const invite = (await f.call("gm", "campaigns")).body[0].invite;
  await f.call("alice", "campaigns/join", "POST", { invite });
  const npc = {
    kind: "npc",
    title: "Трактирщик",
    data: { appearance: "Седой" },
    secret: "Он вампир",
    visibility: "shared",
    roles: [],
  };
  assert.equal(
    (await f.call("gm", `campaigns/${cid}/documents`, "POST", npc)).status,
    201,
  );
  const player = (await f.call("alice", `campaigns/${cid}/documents`)).body;
  assert.equal(player.length, 1);
  assert(!JSON.stringify(player).includes("вампир"));
  assert.equal(
    (await f.call("alice", `campaigns/${cid}/documents`, "POST", npc)).status,
    403,
  );
  await f.call("alice", `campaigns/${cid}/documents`, "POST", {
    kind: "inventory",
    title: "Личный мешок",
    data: { coins: 100 },
    visibility: "private",
    roles: [],
  });
  assert.equal(
    (await f.call("gm", `campaigns/${cid}/documents`)).body.length,
    1,
  );
  await f.call("alice", `campaigns/${cid}/log`, "POST", {
    kind: "roll",
    text: "Личный бросок",
    visibility: "private",
  });
  assert.equal((await f.call("gm", `campaigns/${cid}/log`)).body.length, 0);
  await f.call("alice", `campaigns/${cid}/log`, "POST", {
    kind: "event",
    text: "Общее событие",
    visibility: "shared",
  });
  assert.equal((await f.call("gm", `campaigns/${cid}/log`)).body.length, 1);
});

test("портрет: файл читает и меняет только владелец листа; поток сверх лимита отклоняется", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const sheet = (
    await f.call("alice", "characters", "POST", defaultCharacter())
  ).body;
  assert.equal(
    (
      await f.mf.dispatchFetch(
        `http://localhost/api/characters/${sheet.id}/portrait`,
        {
          method: "PUT",
          headers: { "x-dev-user": "alice", "content-type": "image/png" },
          body: new Uint8Array([137, 80, 78, 71]),
        },
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.mf.dispatchFetch(
        `http://localhost/api/characters/${sheet.id}/portrait`,
        { headers: { "x-dev-user": "bob" } },
      )
    ).status,
    404,
  );
  const response = await f.mf.dispatchFetch(
    `http://localhost/api/characters/${sheet.id}/portrait`,
    {
      method: "PUT",
      headers: { "x-dev-user": "alice", "content-type": "image/png" },
      body: new Uint8Array(5 * 1024 * 1024 + 1),
    },
  );
  assert.equal(response.status, 413);
});

test("нативный вход: bearer выдаётся только после проверки пароля; сброс пароля одноразовый", async (t) => {
  const f = await fixture({ AUTH_ENABLED: "true" });
  t.after(f.close);
  const registered = await f.call(
    "",
    "auth/register",
    "POST",
    {
      email: "native@example.com",
      password: "correct-password-1234",
      name: "Игрок",
    },
    { "x-neustroy-client": "native" },
  );
  assert.equal(registered.status, 200);
  assert(registered.body.token);
  assert.equal(
    (
      await f.call("", "me", "GET", undefined, {
        Authorization: "Bearer " + registered.body.token,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "",
        "auth/login",
        "POST",
        { email: "native@example.com", password: "wrong-password-1234" },
        { "x-neustroy-client": "native" },
      )
    ).status,
    401,
  );
  const { digest } = await import("../server/auth");
  const token = "a".repeat(64);
  await f.db
    .prepare("INSERT INTO password_resets(hash,user_id,expires) VALUES(?,?,?)")
    .bind(
      await digest(token),
      registered.body.user.id,
      new Date(Date.now() + 60000).toISOString(),
    )
    .run();
  const reset = await f.call("", "auth/reset-password", "POST", {
    token,
    password: "changed-password-5678",
  });
  assert.equal(reset.status, 200);
  assert.equal(
    (
      await f.call("", "auth/reset-password", "POST", {
        token,
        password: "changed-password-5678",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.call("", "me", "GET", undefined, {
        Authorization: "Bearer " + registered.body.token,
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call("", "auth/login", "POST", {
        email: "native@example.com",
        password: "correct-password-1234",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call("", "auth/login", "POST", {
        email: "native@example.com",
        password: "changed-password-5678",
      })
    ).status,
    200,
  );
});

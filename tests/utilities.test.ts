import assert from "node:assert/strict";
import test from "node:test";
import { fixture } from "./fixture";
import { commonTimes } from "../server/utilities";

test("гостевой QR: ограничение использований, серверная роль и отзыв уже выданного токена", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const { id } = (
    await f.call("gm", "campaigns", "POST", { name: "Партия с гостями" })
  ).body;
  const event = await f.call("gm", `campaigns/${id}/guest-links`, "POST", {
    hours: 2,
    maxUses: 1,
  });
  assert.equal(event.status, 201, event.body.error);
  assert.equal(event.body.qr.data.length, event.body.qr.size ** 2);
  const { code } = event.body;
  const entered = await f.call("unrelated", "auth/guest", "POST", {
    name: "Гость",
    code,
  });
  assert.equal(entered.status, 201, entered.body.error);
  const auth = { Authorization: "Bearer " + entered.body.token };
  assert.equal(
    (await f.call("unrelated", "campaigns", "GET", undefined, auth)).body[0]
      .role_id,
    "observer",
  );
  assert.equal(
    (await f.call("unrelated", "native-token", "POST", {}, auth)).status,
    403,
  );
  assert.equal(
    (await f.call("unrelated", "telegram/link", "POST", {}, auth)).status,
    403,
  );
  assert.equal(
    (await f.call("unrelated", "auth/guest", "POST", { name: "Другой", code }))
      .status,
    410,
  );
  const links = await f.call("gm", `campaigns/${id}/guest-links`);
  await f.call(
    "gm",
    `campaigns/${id}/guest-links/${links.body[0].hash}`,
    "DELETE",
  );
  assert.equal(
    (await f.call("unrelated", "me", "GET", undefined, auth)).status,
    401,
  );
});

test("копия: файлы и связанные записи восстанавливаются, закрытые материалы не находятся поиском", async (t) => {
  const f = await fixture();
  t.after(f.close);
  const { id } = (
    await f.call("gm", "campaigns", "POST", { name: "Расследование" })
  ).body;
  const games = await f.call("gm", "campaigns");
  await f.call("alice", "campaigns/join", "POST", {
    invite: games.body[0].invite,
  });
  await f.call("alice", `campaigns/${id}/notes`, "POST", {
    title: "Чужой секрет",
    body: "Секретная фраза",
    visibility: "private",
  });
  const folder = (
    await f.call("gm", `campaigns/${id}/folders`, "POST", {
      name: "Улики",
      roles: ["gm"],
    })
  ).body.id;
  const clue = (
    await f.call("gm", "clues", "POST", {
      campaignId: id,
      title: "Зашифрованное письмо",
      body: "",
      kind: "note",
      revealed: true,
      recipients: [],
      folderId: folder,
    })
  ).body.id;
  const uploaded = await f.mf.dispatchFetch(
    "http://localhost/api/clues/" + clue + "/file",
    {
      method: "PUT",
      headers: {
        "x-dev-user": "gm",
        "Content-Type": "text/plain",
        "X-File-Name": "letter.txt",
      },
      body: "Тайный маяк",
    },
  );
  assert.equal(uploaded.status, 200);
  await f.call("gm", `campaigns/${id}/notes`, "POST", {
    title: "Ссылка на письмо",
    body: "Моя запись",
    visibility: "private",
    links: [clue],
  });
  const q = encodeURIComponent("Тайный маяк");
  assert.equal(
    (await f.call("gm", `campaigns/${id}/search?q=${q}`)).body.length,
    1,
  );
  assert.deepEqual(
    (await f.call("alice", `campaigns/${id}/search?q=${q}`)).body,
    [],
  );
  const backup = await f.call("gm", `campaigns/${id}/backup`);
  assert.equal(backup.status, 200, backup.body.error);
  assert.equal(backup.body.notes.length, 1);
  assert(backup.body.clues[0].file);
  assert.equal((await f.call("alice", `campaigns/${id}/backup`)).status, 403);
  const restored = await f.call("gm", "campaigns/restore", "POST", backup.body);
  assert.equal(restored.status, 201, restored.body.error);
  assert.notEqual(restored.body.id, id);
  const materials = (await f.call("gm", "clues?campaign=" + restored.body.id))
    .body;
  const notes = (await f.call("gm", `campaigns/${restored.body.id}/notes`))
    .body;
  assert.deepEqual(notes[0].links, [materials[0].id]);
  const download = await f.mf.dispatchFetch(
    "http://localhost/api/clues/" + materials[0].id + "/file",
    { headers: { "x-dev-user": "gm" } },
  );
  assert.equal(await download.text(), "Тайный маяк");
});

test("подбор времени: смежные окна объединяются, результат исключает слишком короткие интервалы", () => {
  const slot = (user_id: string, start: string, end: string) => ({
    user_id,
    start: `2026-12-01T${start}:00Z`,
    end: `2026-12-01T${end}:00Z`,
  });
  const windows = [
    slot("a", "10:00", "13:00"),
    slot("a", "13:00", "17:00"),
    slot("b", "12:00", "15:00"),
    slot("b", "16:00", "17:00"),
  ];
  assert.deepEqual(commonTimes(windows, 120), [
    { start: "2026-12-01T12:00:00Z", end: "2026-12-01T15:00:00Z" },
  ]);
});

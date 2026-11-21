import test from "node:test";
import assert from "node:assert/strict";
import { migrate } from "./fixture";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { defaultCharacter } from "../src/domain";
test("сервер: права, скрытые вложения, конкуренция брони и мест, изоляция листов", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "dist/server/index.js",
      compatibilityDate: "2025-04-01",
      d1Databases: ["DB"],
      r2Buckets: ["BUCKET"],
      bindings: { LOCAL_DEV: "true" },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    await migrate(db);
    const req = async (
      user: string,
      path: string,
      method = "GET",
      data?: unknown,
    ) => {
      const r = await mf.dispatchFetch(`http://localhost/api/${path}`, {
        method,
        headers: {
          "x-dev-user": user,
          "x-dev-name": user,
          ...(data ? { "Content-Type": "application/json" } : {}),
        },
        body: data ? JSON.stringify(data) : undefined,
      });
      const b = (await r.json()) as any;
      return { status: r.status, ...b, body: b };
    };
    assert.equal((await req("gm", "me")).isAdmin, true);
    assert.equal((await req("alice", "me")).isAdmin, false);
    const c = await req("gm", "campaigns", "POST", { name: "Тайна маяка" });
    const campaigns = (await req("gm", "campaigns")).body;
    const invite = campaigns[0].invite;
    assert(invite);
    assert.equal((await req("alice", "clues?campaign=" + c.id)).status, 404);
    await req("alice", "campaigns/join", "POST", { invite });
    assert.equal((await req("alice", "campaigns")).body[0].invite, null);
    const clue = await req("gm", "clues", "POST", {
      campaignId: c.id,
      title: "Секрет",
      body: "Разгадка",
      kind: "note",
      revealed: false,
      recipients: [],
    });
    assert.equal((await req("alice", "clues?campaign=" + c.id)).body.length, 0);
    const fileUpload = await mf.dispatchFetch(
      `http://localhost/api/clues/${clue.id}/file`,
      {
        method: "PUT",
        headers: {
          "x-dev-user": "gm",
          "content-type": "text/plain",
          "x-file-name": "secret.txt",
        },
        body: "secret",
      },
    );
    assert.equal(fileUpload.status, 200);
    assert.equal(
      (
        await mf.dispatchFetch(`http://localhost/api/clues/${clue.id}/file`, {
          headers: { "x-dev-user": "alice" },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await req("alice", `clues/${clue.id}`, "PATCH", {
          revealed: true,
          recipients: [],
        })
      ).status,
      403,
    );
    await req("gm", `clues/${clue.id}`, "PATCH", {
      revealed: false,
      recipients: ["alice"],
    });
    assert.equal((await req("alice", "clues?campaign=" + c.id)).body.length, 1);
    assert.equal(
      (
        await mf.dispatchFetch(`http://localhost/api/clues/${clue.id}/file`, {
          headers: { "x-dev-user": "alice" },
        })
      ).status,
      200,
    );
    const sheet = await req("alice", "characters", "POST", defaultCharacter());
    assert.equal((await req("bob", "characters")).body.length, 0);
    assert.equal(
      (
        await req("bob", `characters/${sheet.id}`, "PUT", {
          data: sheet.data,
          revision: 1,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req("alice", `characters/${sheet.id}`, "PUT", {
          data: sheet.data,
          revision: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await req("alice", `characters/${sheet.id}`, "PUT", {
          data: sheet.data,
          revision: 1,
        })
      ).status,
      409,
    );
    const start = new Date(Date.now() + 7 * 86400000).toISOString(),
      end = new Date(Date.now() + 7 * 86400000 + 4 * 3600000).toISOString();
    const args = {
      campaignId: c.id,
      title: "Глава 1",
      start,
      end,
      public: true,
      capacity: 1,
      description: "",
    };
    const s1 = await req("gm", "sessions", "POST", args),
      s2 = await req("gm", "sessions", "POST", { ...args, title: "Глава 2" });
    const seats = await Promise.all([
      req("alice", `sessions/${s1.id}/join`, "POST"),
      req("bob", `sessions/${s1.id}/join`, "POST"),
    ]);
    assert.equal(seats.filter((r) => r.status === 200).length, 1);
    assert.equal(seats.filter((r) => r.status === 409).length, 1);
    assert.equal(
      (await req("alice", `sessions/${s1.id}/confirm`, "POST")).status,
      403,
    );
    const confirmations = await Promise.all([
      req("gm", `sessions/${s1.id}/confirm`, "POST"),
      req("gm", `sessions/${s2.id}/confirm`, "POST"),
    ]);
    assert.equal(confirmations.filter((r) => r.status === 200).length, 1);
    assert.equal(confirmations.filter((r) => r.status === 409).length, 1);
    const winner = confirmations[0].status === 200 ? s1 : s2;
    await req("gm", `sessions/${winner.id}/cancel`, "POST");
    assert.equal(
      (
        await req(
          "gm",
          `sessions/${confirmations[0].status === 200 ? s2.id : s1.id}/confirm`,
          "POST",
        )
      ).status,
      200,
    );
    const booking = {
      format: "online",
      players: 4,
      age: "adults",
      hours: 4,
      experience: "none",
      rules: "simple",
      characters: "ready",
      genres: [],
      mood: "Легко",
      settings: [],
      extras: [],
      wishes: "",
      start,
      name: "Игрок",
      channel: "email",
      contact: "a@example.com",
      consent: true,
      total: 1,
    };
    const b = await req("alice", "bookings", "POST", booking);
    assert.equal(b.total, 8000);
    assert.equal((await req("bob", "bookings")).body.length, 0);
    assert.equal(
      (await req("gm", `bookings/${b.id}/confirm`, "POST")).status,
      409,
    );
    const foreign = await mf.dispatchFetch("http://localhost/api/characters", {
      method: "POST",
      headers: {
        Origin: "https://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(defaultCharacter()),
    });
    assert.equal(foreign.status, 403);
    const noDev = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        scriptPath: "dist/server/index.js",
        compatibilityDate: "2025-04-01",
        d1Databases: ["DB"],
        r2Buckets: ["BUCKET"],
      }),
    );
    try {
      assert.equal(
        (await noDev.dispatchFetch("http://localhost/api/me")).status,
        401,
      );
    } finally {
      await noDev.dispose();
    }
  } finally {
    await mf.dispose();
  }
});

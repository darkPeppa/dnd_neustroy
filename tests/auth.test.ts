import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
test("самостоятельные аккаунты: пароль, cookie, права мастера, выход и изоляция MCP", async () => {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: "dist/server/index.js",
      compatibilityDate: "2025-04-01",
      d1Databases: ["DB"],
      r2Buckets: ["BUCKET"],
      bindings: {
        AUTH_ENABLED: "true",
        ADMIN_SETUP_SECRET: "test-owner-key-long-enough-for-setup",
      },
    }),
  );
  try {
    const db = await mf.getD1Database("DB");
    for (const file of (await readdir("migrations"))
      .filter((x) => x.endsWith(".sql"))
      .sort())
      await db.exec(
        (await readFile("migrations/" + file, "utf8")).replace(/\n/g, " "),
      );
    const call = async (
      path: string,
      body?: unknown,
      cookie?: string,
      method = body ? "POST" : "GET",
    ) => {
      const r = await mf.dispatchFetch("https://example.test" + path, {
        method,
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: r.status,
        body: (await r.json()) as any,
        cookie: r.headers.get("set-cookie")?.split(";")[0],
        headers: r.headers,
      };
    };
    assert.equal((await call("/api/me")).status, 401);
    const a = await call("/api/auth/register", {
      email: "owner@example.com",
      password: "long-password-12345",
      name: "Мастер",
    });
    assert.equal(a.status, 200);
    assert.match(a.headers.get("set-cookie")!, /HttpOnly/);
    assert.match(a.headers.get("set-cookie")!, /Secure/);
    assert(!a.body.token);
    assert.equal(
      (await call("/api/me", undefined, a.cookie)).body.isAdmin,
      false,
    );
    assert.equal(
      (
        await call(
          "/api/auth/claim-owner",
          { setupKey: "test-owner-key-long-enough-for-setup" },
          a.cookie,
        )
      ).status,
      200,
    );
    assert.equal(
      (await call("/api/me", undefined, a.cookie)).body.isAdmin,
      true,
    );
    const reused = await mf.dispatchFetch(
      "https://example.test/api/auth/claim-owner",
      {
        method: "POST",
        headers: {
          "oai-authenticated-user-id": "chatgpt:owner",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          setupKey: "test-owner-key-long-enough-for-setup",
        }),
      },
    );
    assert.equal(reused.status, 409); // Platform sign-in is accepted; the consumed owner key cannot be reused.

    const b = await call("/api/auth/register", {
      email: "player@example.com",
      password: "other-password-12345",
      name: "Игрок",
    });
    assert.equal(b.status, 200);
    assert.equal(
      (await call("/api/me", undefined, b.cookie)).body.isAdmin,
      false,
    );
    assert.equal(
      (
        await call(
          "/api/auth/claim-owner",
          { setupKey: "test-owner-key-long-enough-for-setup" },
          b.cookie,
        )
      ).status,
      409,
    );
    const character = await call(
      "/mcp",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "character_create",
          arguments: {
            name: "Личный герой",
            classId: "bard",
            edition: "srd-2024",
          },
        },
      },
      a.cookie,
    );
    assert(!character.body.result.isError);
    const own = await call("/api/characters", undefined, a.cookie);
    assert.equal(own.body.length, 1);
    assert.equal(own.body[0].data.classId, "bard");
    assert.equal(
      (await call("/api/characters", undefined, b.cookie)).body.length,
      0,
    );
    const invalid = await call("/api/auth/login", {
      email: "owner@example.com",
      password: "wrong-password-12345",
    });
    assert.equal(invalid.status, 401);
    const login = await call("/api/auth/login", {
      email: "owner@example.com",
      password: "long-password-12345",
    });
    assert.equal(login.status, 200);
    assert.equal(
      (await call("/api/auth/logout", {}, login.cookie)).status,
      200,
    );
    assert.equal((await call("/api/me", undefined, login.cookie)).status, 401);
    const malicious = await mf.dispatchFetch(
      "https://example.test/api/characters",
      {
        method: "POST",
        headers: {
          Origin: "https://evil.test",
          Cookie: a.cookie!,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(malicious.status, 403);
  } finally {
    await mf.dispose();
  }
});

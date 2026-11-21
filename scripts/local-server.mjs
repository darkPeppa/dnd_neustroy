import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import worker, { configuredEnv } from "../dist/local-api.mjs";
import { startTelegramPolling } from "./telegram-poll.mjs";

const lan = process.argv.includes("--lan");
const accounts =
  process.argv.includes("--accounts") ||
  process.env.NEUSTROY_ACCOUNT_AUTH === "true";
const port = Number(process.env.NEUSTROY_PORT || 8787);
const root = path.resolve(
  process.env.NEUSTROY_DATA_DIR || (accounts ? ".local/accounts" : ".local"),
);
await mkdir(path.join(root, "files"), { recursive: true });
let secret;
try {
  secret = await readFile(path.join(root, "session.key"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  secret = randomBytes(32);
  await writeFile(path.join(root, "session.key"), secret, { mode: 0o600 });
}
const sqlite = new DatabaseSync(path.join(root, "neustroy.sqlite"));
sqlite.exec(
  "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)",
);
for (const file of (await readdir("migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  if (sqlite.prepare("SELECT 1 FROM local_migrations WHERE name=?").get(file))
    continue;
  sqlite.exec("BEGIN");
  try {
    sqlite.exec(await readFile("migrations/" + file, "utf8"));
    sqlite.prepare("INSERT INTO local_migrations(name) VALUES(?)").run(file);
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }
}
sqlite
  .prepare("INSERT OR IGNORE INTO site_config(id,value) VALUES('owner',?)")
  .run(accounts ? "unclaimed" : "local-host");
class Statement {
  constructor(sql, params = []) {
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.sql, params);
  }
  async first(column) {
    const row = sqlite.prepare(this.sql).get(...this.params);
    return column ? row?.[column] : row || null;
  }
  async all() {
    return {
      success: true,
      results: sqlite.prepare(this.sql).all(...this.params),
    };
  }
  runSync() {
    const result = sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async run() {
    return this.runSync();
  }
}
const DB = {
  prepare: (sql) => new Statement(sql),
  async batch(statements) {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((s) => s.runSync());
      sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};
function storagePath(key) {
  if (!/^[a-z0-9/-]+$/i.test(key) || key.includes(".."))
    throw Error("Invalid file key");
  return path.join(root, "files", key);
}
const BUCKET = {
  async put(key, data) {
    const file = storagePath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(data));
  },
  async get(key) {
    try {
      return { body: await readFile(storagePath(key)) };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  },
  async delete(key) {
    try {
      await unlink(storagePath(key));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  },
};
const env = {
  DB,
  BUCKET,
  LOCAL_SERVER: "true",
  AUTH_ENABLED: accounts ? "true" : undefined,
  CONFIG_ENCRYPTION_KEY: secret.toString("hex"),
  TELEGRAM_WEBHOOK_SECRET: createHmac("sha256", secret)
    .update("telegram-webhook")
    .digest("hex"),
  ...Object.fromEntries(
    [
      "ADMIN_SETUP_SECRET",
      "ASSISTANT_BASE_URL",
      "ASSISTANT_API_KEY",
      "ASSISTANT_MODEL",
      "RESEND_API_KEY",
      "MAIL_FROM",
      "PUBLIC_APP_URL",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_BOT_USERNAME",
      "TELEGRAM_CHAT_ID",
      "TELEGRAM_WEBHOOK_SECRET",
      "INTEGRATION_URL",
      "INTEGRATION_SECRET",
      "PUSH_GATEWAY_URL",
      "PUSH_GATEWAY_SECRET",
      "CONFIG_ENCRYPTION_KEY",
      "GM_ACCESS_PRICE_RUB",
      "YOOKASSA_SHOP_ID",
      "YOOKASSA_SECRET",
    ]
      .filter((k) => process.env[k])
      .map((k) => [k, process.env[k]]),
  ),
};
if (accounts && !env.ADMIN_SETUP_SECRET) {
  const file = path.join(root, "admin-setup.txt");
  try {
    env.ADMIN_SETUP_SECRET = (await readFile(file, "utf8")).trim();
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    env.ADMIN_SETUP_SECRET = randomBytes(32).toString("hex");
    await writeFile(file, env.ADMIN_SETUP_SECRET + "\n", { mode: 0o600 });
  }
}
const addresses = Object.values(networkInterfaces())
  .flat()
  .filter((x) => x && x.family === "IPv4" && !x.internal)
  .map((x) => x.address);
const hosts = new Set(["localhost", "127.0.0.1", "[::1]", ...addresses]);
let publicOrigin;
if (env.PUBLIC_APP_URL) {
  publicOrigin = new URL(env.PUBLIC_APP_URL);
  if (
    !["https:", "http:"].includes(publicOrigin.protocol) ||
    publicOrigin.username ||
    publicOrigin.password
  )
    throw Error("Invalid PUBLIC_APP_URL");
  hosts.add(publicOrigin.hostname);
}
function privateAddress(value) {
  const ip = value.replace(/^::ffff:/, "").replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    return (
      p[0] === 127 ||
      p[0] === 10 ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    );
  }
  return (
    isIP(ip) === 6 && (ip === "::1" || /^f[cd]/i.test(ip) || /^fe80:/i.test(ip))
  );
}
const sign = (value) =>
  createHmac("sha256", secret).update(value).digest("hex");
function guest(cookie) {
  const [id, signature] = (cookie || "").split(".");
  if (!/^[a-f0-9]{32}$/.test(id || "") || !signature || signature.length !== 64)
    return null;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(sign(id)))
    ? id
    : null;
}
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};
const waits = new Set();
const context = {
  waitUntil(promise) {
    waits.add(promise);
    promise
      .catch(() => console.error("Background delivery failed"))
      .finally(() => waits.delete(promise));
  },
};
async function requestBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = Error("Request too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function serve(req, res) {
  try {
    const host = req.headers.host || "";
    let url;
    try {
      url = new URL("http://" + host + (req.url || "/"));
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (
      !(
        hosts.has(url.hostname) ||
        (accounts && privateAddress(url.hostname))
      ) ||
      !privateAddress(req.socket.remoteAddress || "")
    ) {
      res.writeHead(403).end("Host is not allowed");
      return;
    }
    if (publicOrigin && url.hostname === publicOrigin.hostname)
      url.protocol = publicOrigin.protocol;
    if (req.headers.origin && req.headers.origin !== url.origin) {
      res.writeHead(403).end("Origin is not allowed");
      return;
    }
    const address = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    const loopback = address === "::1" || address.startsWith("127.");
    let userId, name;
    if (!accounts) {
      let id = loopback
        ? "local-host"
        : guest(
            req.headers.cookie?.match(/(?:^|;\s*)neustroy_device=([^;]+)/)?.[1],
          );
      if (!id) {
        id = randomBytes(16).toString("hex");
        res.setHeader(
          "Set-Cookie",
          `neustroy_device=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
        );
      }
      userId = loopback ? "local-host" : "lan:" + id;
      name =
        sqlite
          .prepare("SELECT value FROM site_config WHERE id=?")
          .get("profile:" + userId)?.value ||
        (loopback ? "Мастер локальной партии" : "Игрок " + id.slice(0, 4));
    }
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname === "/mcp" ||
      url.pathname === "/telegram/webhook"
    ) {
      const data = await requestBody(
        req,
        url.pathname === "/api/campaigns/restore"
          ? 40 * 1024 * 1024
          : 8 * 1024 * 1024,
      );
      if (
        url.pathname === "/api/local/profile" &&
        req.method === "POST" &&
        !accounts
      ) {
        let body;
        try {
          body = JSON.parse(data);
        } catch {
          res.writeHead(400).end();
          return;
        }
        const next = String(body.name || "")
          .trim()
          .slice(0, 80);
        if (!next) {
          res.writeHead(400).end();
          return;
        }
        sqlite
          .prepare(
            "INSERT INTO site_config(id,value) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
          )
          .run("profile:" + userId, next);
        res
          .writeHead(200, { "Content-Type": "application/json" })
          .end('{"ok":true}');
        return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (
          !value ||
          key.startsWith("oai-") ||
          key.startsWith("x-dev-") ||
          key.startsWith("x-neustroy-loopback") ||
          ["host", "cf-connecting-ip"].includes(key) ||
          (!accounts && ["cookie", "authorization"].includes(key))
        )
          continue;
        headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      headers.set("cf-connecting-ip", address);
      if (
        accounts &&
        loopback &&
        !publicOrigin &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )
        headers.set("x-neustroy-loopback", "true");
      if (!accounts) {
        headers.set("oai-authenticated-user-id", userId);
        headers.set(
          "oai-authenticated-user-full-name",
          encodeURIComponent(name),
        );
        headers.set(
          "oai-authenticated-user-full-name-encoding",
          "percent-encoded-utf-8",
        );
      }
      const response = await worker.fetch(
        new Request(url, {
          method: req.method,
          headers,
          body: ["GET", "HEAD"].includes(req.method) ? undefined : data,
        }),
        env,
        context,
      );
      const responseHeaders = Object.fromEntries(response.headers);
      if (!accounts) delete responseHeaders["set-cookie"];
      res.writeHead(response.status, responseHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const clientRoot = path.resolve("dist/client");
    let file = path.resolve(clientRoot, "." + decoded);
    if (!file.startsWith(clientRoot + path.sep))
      file = path.join(clientRoot, "index.html");
    let data;
    try {
      data = await readFile(file);
    } catch (error) {
      if (!["ENOENT", "EISDIR"].includes(error.code)) throw error;
      if (path.extname(decoded)) {
        res.writeHead(404).end();
        return;
      }
      file = path.join(clientRoot, "index.html");
      data = await readFile(file);
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
      "Referrer-Policy": "same-origin",
    });
    res.end(data);
  } catch (error) {
    if (!res.headersSent)
      res.writeHead(error.status || 500, {
        "Content-Type": "application/json",
      });
    res.end(
      JSON.stringify({
        error:
          error.status === 413 ? "Слишком большой запрос" : "Ошибка сервера",
      }),
    );
    console.error("Server request failed:", error.status || 500);
  }
}
const server = http.createServer((req, res) => {
  void serve(req, res);
});
let polling;
server.listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
  const actualPort = server.address().port;
  console.log(`neustroy · http://127.0.0.1:${actualPort}`);
  if (lan)
    for (const address of addresses)
      console.log(`Для вашей сети: http://${address}:${actualPort}`);
  console.log(
    accounts
      ? "Вход по аккаунту. Администратор создаётся при первой регистрации с этого компьютера."
      : "Игра без аккаунтов в локальной сети.",
  );
  console.log("Данные: " + root);
  if (process.env.NEUSTROY_TELEGRAM_POLLING !== "false")
    polling = startTelegramPolling({
      configuration: () => configuredEnv(env),
      dispatch: (r) => worker.fetch(r, env, context),
      DB,
      port: actualPort,
    });
});
async function shutdown() {
  polling?.stop();
  server.close(async () => {
    await Promise.race([
      Promise.allSettled([...waits]),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    sqlite.close();
    process.exit(0);
  });
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

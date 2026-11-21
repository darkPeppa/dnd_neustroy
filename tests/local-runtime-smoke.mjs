import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const project = fileURLToPath(new URL("../", import.meta.url));
const root = await mkdtemp(path.join(tmpdir(), "neustroy-runtime-"));
const accounts = process.argv.includes("--accounts");
let child;

async function stop() {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const current = child;
  child = undefined;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      current.kill("SIGKILL");
      reject(Error("Local server did not stop"));
    }, 5000);
    current.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    current.kill("SIGTERM");
  });
}
async function start() {
  return new Promise((resolve, reject) => {
    child = spawn(
      process.execPath,
      [
        "scripts/node-runtime.mjs",
        "scripts/local-server.mjs",
        ...(accounts ? ["--accounts"] : []),
      ],
      {
        cwd: project,
        env: {
          ...process.env,
          NEUSTROY_PORT: "0",
          NEUSTROY_DATA_DIR: root,
          NEUSTROY_TELEGRAM_POLLING: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    const timeout = setTimeout(
      () => reject(Error("Local server did not start: " + output)),
      15000,
    );
    const receive = (data) => {
      output += data;
      const match = output.match(/neustroy · (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    };
    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(Error(`Local server exited (${code}): ${output}`));
    });
  });
}
try {
  let url = await start(),
    bearer = "";
  const request = (route, method = "GET", data) =>
    fetch(url + "/api/" + route, {
      method,
      headers: {
        "X-Neustroy-Client": "native",
        ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  assert.equal((await fetch(url)).status, 200);
  if (accounts) {
    assert.equal((await request("me")).status, 401);
    // The first direct registration claims the server owner once.
    const r = await request("auth/register", "POST", {
      name: "Мастер проверки",
      email: "owner@example.test",
      password: "test-persistence-password-001",
    });
    assert.equal(r.status, 200, await r.clone().text());
    bearer = (await r.json()).token;
    assert(bearer);
    assert.equal((await request("telegram")).status, 200);
  }
  const me = await (await request("me")).json();
  assert.equal(me.local, true);
  assert.equal(me.isAdmin, true);
  const created = await request("characters", "POST", {
    name: "Node startup regression",
    classId: "wizard",
    level: 1,
    scores: { str: 10, dex: 14, con: 14, int: 16, wis: 12, cha: 10 },
    hp: 8,
  });
  assert.equal(created.status, 201, await created.clone().text());
  const sheet = await created.json();
  await stop();
  url = await start();
  const sheets = await (await request("characters")).json();
  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].id, sheet.id);
  if (accounts) {
    await request("auth/logout", "POST");
    assert.equal((await request("me")).status, 401);
    bearer = "";
    const login = await request("auth/login", "POST", {
      email: "owner@example.test",
      password: "test-persistence-password-001",
      name: "",
    });
    assert.equal(login.status, 200, await login.clone().text());
    bearer = (await login.json()).token;
    assert.equal((await (await request("characters")).json())[0].id, sheet.id);
  }
  console.log(
    `Local server, ${accounts ? "account sessions and" : "and"} SQLite persistence passed (launched from ${process.version}).`,
  );
} finally {
  await stop();
  await rm(root, { recursive: true, force: true });
}

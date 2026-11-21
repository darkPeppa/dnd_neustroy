import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

const minimum = 24;
const executable = process.platform === "win32" ? "node.exe" : "node";
const home = homedir();
function version(file) {
  try {
    const value = execFileSync(file, ["--version"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^v\d+\.\d+\.\d+/.test(value) &&
      Number(value.slice(1).split(".")[0]) >= minimum
      ? value
      : null;
  } catch {
    return null;
  }
}
function installed(root, suffix) {
  try {
    return readdirSync(root)
      .filter((name) => /^v?\d/.test(name))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((name) => path.join(root, name, ...suffix));
  } catch {
    return [];
  }
}
function selectRuntime() {
  if (process.env.NEUSTROY_NODE) {
    const file = path.resolve(process.env.NEUSTROY_NODE),
      found = version(file);
    if (!found)
      throw Error(
        "NEUSTROY_NODE должен указывать на исполняемый файл Node.js 24 или новее.",
      );
    return { file, version: found };
  }
  if (Number(process.versions.node.split(".")[0]) >= minimum)
    return { file: process.execPath, version: process.version };
  const candidates = [
    ...String(process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean)
      .map((dir) => path.join(dir, executable)),
    path.join(
      home,
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "bin",
      executable,
    ),
    "/opt/homebrew/opt/node@24/bin/node",
    "/usr/local/opt/node@24/bin/node",
    ...installed(
      path.join(
        process.env.NVM_DIR || path.join(home, ".nvm"),
        "versions",
        "node",
      ),
      ["bin", executable],
    ),
    ...installed(path.join(home, ".volta", "tools", "image", "node"), [
      "bin",
      executable,
    ]),
    ...installed(
      path.join(home, ".local", "share", "mise", "installs", "node"),
      ["bin", executable],
    ),
    ...installed(path.join(home, ".asdf", "installs", "nodejs"), [
      "bin",
      executable,
    ]),
    ...installed(
      path.join(home, "Library", "Application Support", "fnm", "node-versions"),
      ["installation", "bin", executable],
    ),
    ...installed(path.join(home, ".local", "share", "fnm", "node-versions"), [
      "installation",
      "bin",
      executable,
    ]),
  ];
  for (const file of new Set(candidates)) {
    if (!existsSync(file)) continue;
    const found = version(file);
    if (found) return { file, version: found };
  }
  throw Error(
    `Для neustroy нужен Node.js 24 или новее, сейчас выбран ${process.version}.\nУстановите Node.js 24 LTS: https://nodejs.org/\nЕсли он уже установлен, задайте NEUSTROY_NODE=/полный/путь/к/node и повторите команду.`,
  );
}

try {
  const args = process.argv.slice(2);
  if (!args.length)
    throw Error(
      "Не указана команда запуска. Используйте npm run local или npm run lan.",
    );
  const runtime = selectRuntime();
  if (runtime.file !== process.execPath)
    console.error(
      `neustroy: запуск через Node.js ${runtime.version} вместо ${process.version}.`,
    );
  const child = spawn(runtime.file, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      PATH:
        path.dirname(runtime.file) + path.delimiter + (process.env.PATH || ""),
    },
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(`neustroy: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode =
      code ?? (signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1);
  });
} catch (error) {
  console.error(`neustroy: ${error.message}`);
  process.exitCode = 1;
}

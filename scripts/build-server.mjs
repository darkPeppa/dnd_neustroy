import { build } from "esbuild";
import {
  readdir,
  readFile,
  mkdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";
const assets = {};
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};
async function walk(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, file.name);
    if (file.isDirectory()) await walk(full);
    else
      assets[
        "/" + path.relative("dist/client", full).split(path.sep).join("/")
      ] = {
        data: gzipSync(await readFile(full), { level: 9 }).toString("base64"),
        type: mime[path.extname(full)] || "application/octet-stream",
        encoding: "gzip",
      };
  }
}
await walk("dist/client");
const precache = Object.keys(assets).filter((x) => x !== "/sw.js");
await writeFile(
  "dist/client/sw.js",
  `const CACHE='neustroy-'+${JSON.stringify(Date.now().toString())}; const FILES=${JSON.stringify(precache)};self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('neustroy-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(u.origin!==self.location.origin||e.request.method!=='GET'||u.pathname.startsWith('/api/')||u.pathname==='/mcp'||u.pathname.includes('signin-')||u.pathname.includes('callback'))return;if(e.request.mode==='navigate'){e.respondWith(fetch(e.request).catch(()=>caches.match('/index.html')));return;}e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request)));});`,
);
assets["/sw.js"] = {
  data: gzipSync(await readFile("dist/client/sw.js"), { level: 9 }).toString(
    "base64",
  ),
  type: "application/javascript",
  encoding: "gzip",
};
await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  plugins: [
    {
      name: "embedded-client",
      setup(b) {
        b.onLoad({ filter: /assets\.generated\.ts$/ }, () => ({
          contents: `export default ${JSON.stringify(assets)}`,
          loader: "ts",
        }));
      },
    },
  ],
});
await mkdir("dist/.openai", { recursive: true });
await copyFile(".openai/hosting.json", "dist/.openai/hosting.json");
await mkdir("drizzle/meta", { recursive: true });
// SQL is also kept in Wrangler migrations for standalone development.
const entries = [];
for (const [i, file] of (await readdir("migrations"))
  .filter((x) => x.endsWith(".sql"))
  .sort()
  .entries()) {
  const tag = file.replace(".sql", "");
  await writeFile(
    "drizzle/" + file,
    (await readFile("migrations/" + file, "utf8")).replace(
      /;\n(?=CREATE)/g,
      ";\n--> statement-breakpoint\n",
    ),
  );
  entries.push({
    idx: i,
    version: "6",
    when: 1795125600000 + i,
    tag,
    breakpoints: true,
  });
}
await writeFile(
  "drizzle/meta/_journal.json",
  JSON.stringify({ version: "7", dialect: "sqlite", entries }, null, 2),
);
console.log("Built client + API Worker with D1 migrations");

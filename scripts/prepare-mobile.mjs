import { readFile, writeFile, mkdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const dest = new URL(
  "mobile/shared/src/commonMain/composeResources/files/",
  root,
);
await mkdir(dest, { recursive: true });
for (const name of ["classes", "spells", "catalog", "srd-2014", "srd-2024"]) {
  const content = gunzipSync(
    await readFile(new URL(`data/vendored/${name}.json.gz`, root)),
  );
  JSON.parse(content.toString());
  await writeFile(new URL(`${name}.json`, dest), content);
}
await writeFile(
  new URL("SOURCES.txt", dest),
  await readFile(new URL("data/SOURCES.md", root)),
);
await writeFile(
  new URL("tool-modules.json", dest),
  await readFile(new URL("data/tool-modules.json", root)),
);
console.log(
  "Mobile: открытые SRD 2014/2024 подготовлены из локальных архивов.",
);

// Vendored open SRD data; refresh explicitly, never on normal builds.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
const get = (url) =>
  JSON.parse(
    execFileSync(
      "curl",
      [
        "--fail",
        "--location",
        "--retry",
        "2",
        "--max-time",
        "90",
        "--silent",
        "--show-error",
        url,
      ],
      { maxBuffer: 30 * 1024 * 1024 },
    ).toString(),
  );
const endpoints = [
  "classes",
  "species",
  "backgrounds",
  "feats",
  "spells",
  "weapons",
  "armor",
  "items",
  "magicitems",
  "creatures",
  "conditions",
  "rules",
];
await mkdir("public/rules", { recursive: true });
await mkdir("data/catalog", { recursive: true });
const catalog = [];
const counts = {};
for (const kind of endpoints) {
  let url = `https://api.open5e.com/v2/${kind}/?document__key__in=srd-2014,srd-2024&limit=100&format=json`;
  let rows = [];
  while (url) {
    const page = get(url);
    rows.push(...page.results);
    url = page.next;
  }
  rows = rows.filter((x) => ["srd-2014", "srd-2024"].includes(x.document?.key));
  await writeFile(`data/catalog/${kind}.json`, JSON.stringify(rows));
  for (const x of rows)
    catalog.push({
      id: x.key,
      edition: x.document.key,
      kind,
      name: x.name,
      level: x.level,
      classes: x.classes?.map((c) => c.key.split("_").pop()),
      text: x.desc || "",
      data: x,
    });
  counts[kind] = rows.length;
  console.log(`${kind}: ${rows.length}`);
}
await writeFile(
  "public/rules/catalog.json",
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: "https://api.open5e.com/v2/",
    license: "CC-BY-4.0 (SRD content)",
    counts,
    entries: catalog,
  }),
);
console.log("Vendored SRD records:", catalog.length);

// Run pack-rules after the official full-text snapshots are refreshed.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const [platform, source, destination] = process.argv.slice(2);
if (
  !platform ||
  !source ||
  !destination ||
  !(await stat(source).then(
    (s) => s.isFile(),
    () => false,
  ))
)
  throw new Error(
    "Usage: package-artifact <platform> <source-file> <output-directory>",
  );
const version = (await readFile("VERSION", "utf8")).trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid VERSION");
if (JSON.parse(await readFile("package.json", "utf8")).version !== version)
  throw new Error("package.json and VERSION disagree");

await mkdir(destination, { recursive: true });
const name = path.basename(source);
const file = path.join(destination, name);
if (path.resolve(source) !== path.resolve(file)) await copyFile(source, file);
const sum = createHash("sha256");
for await (const chunk of createReadStream(file)) sum.update(chunk);
const sha256 = sum.digest("hex");
await writeFile(
  path.join(destination, "SHA256SUMS.txt"),
  `${sha256}  ${name}\n`,
);
await writeFile(
  path.join(destination, "release.json"),
  JSON.stringify(
    {
      version,
      platform,
      commit: process.env.GITHUB_SHA || null,
      file: name,
      sha256,
    },
    null,
    2,
  ) + "\n",
);

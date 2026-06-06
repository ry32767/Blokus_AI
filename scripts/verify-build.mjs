import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");
const indexPath = join(dist, "index.html");
const mainPath = join(dist, "apps", "web", "src", "main.js");
const stylesPath = join(dist, "apps", "web", "src", "styles", "global.css");
const corePath = join(dist, "packages", "core", "src", "index.js");

await access(indexPath);
await access(mainPath);
await access(stylesPath);
await access(corePath);

const html = await readFile(indexPath, "utf8");
assert.match(html, /apps\/web\/src\/main\.js/);
assert.match(html, /apps\/web\/src\/styles\/global\.css/);

console.log("Build smoke check passed.");

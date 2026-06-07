import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "./sync-onnxruntime-assets.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, "index.html"), join(dist, "index.html"));
await cp(join(root, "apps"), join(dist, "apps"), { recursive: true });
await cp(join(root, "packages"), join(dist, "packages"), { recursive: true });
await writeFile(join(dist, ".nojekyll"), "");

console.log("Built static site to dist/");

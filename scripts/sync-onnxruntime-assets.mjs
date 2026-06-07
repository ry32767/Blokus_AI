import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "node_modules", "onnxruntime-web", "dist");
const target = join(root, "apps", "web", "public", "vendor", "onnxruntime-web");
const files = [
  "ort.min.mjs",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const file of files) {
  await cp(join(source, file), join(target, file), { force: true });
}
console.log(`Synced ONNX Runtime Web assets to ${target}`);

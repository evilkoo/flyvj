import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sync onnxruntime-web WASM/MJS worker assets from node_modules into public/ort/.
 * Keeps the git repository lean while ensuring offline production builds and clean
 * checkouts automatically populate public/ort/ on `npm install` and before `npm run build`.
 */
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webappRoot = path.resolve(scriptDir, "..");
const srcDir = path.join(webappRoot, "node_modules", "onnxruntime-web", "dist");
const destDir = path.join(webappRoot, "public", "ort");
const strict = process.argv.includes("--strict");
const ORT_WASM_FILE_RE = /^ort-wasm.*\.(wasm|mjs)$/;

if (!fs.existsSync(srcDir)) {
  const msg = `[sync-ort] warning: missing ${srcDir}; run npm install first.`;
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
  process.exit(0);
}

const files = fs.readdirSync(srcDir).filter((name) => ORT_WASM_FILE_RE.test(name)).sort();
if (files.length === 0) {
  const msg = `[sync-ort] warning: no ort-wasm*.{wasm,mjs} files found in ${srcDir}.`;
  if (strict) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(msg);
  process.exit(0);
}

fs.mkdirSync(destDir, { recursive: true });
for (const file of files) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}

console.log(`[sync-ort] copied ${files.length} files to ${destDir}`);

import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import {
  DIAG_ENDPOINTS,
  DIAG_MAX_AUDIO_BYTES,
  DIAG_MAX_JSONL_LINES,
  DIAG_MAX_META_BYTES,
  decodeDiagMetaHeader,
  isLoopbackAddress,
  trimJsonlContent,
} from "./src/diag.ts";

// M3 avatar page. Port 5200 (M2's server still holds 5199 on this machine).
// /api is proxied to Arena so browser REST calls (manifest sync: clip open/rename)
// avoid cross-origin issues; WS still connects directly to ws://127.0.0.1:8080/api/v1.
// Everything stays on localhost (SPEC §0.1 網絡硬約束).
const arenaPort = process.env.ARENA_PORT ?? "8080";

// Dev-only diagnostics sink (apply:"serve" + configureServer only, so none of
// this Node fs code ever reaches dist/). Loopback-only; writes to
// work/v2/m4/live-diag: telemetry.jsonl, latest.json, mic-clip-*.{webm,ogg}+meta.
const DIAG_DIR = path.resolve(__dirname, "../live-diag");
const TELEMETRY_MAX_BYTES = 256 * 1024;
const TELEMETRY_PRUNE_LINES = 2500;
const KEEP_TIMESTAMPED_CLIPS = 5;
const TIMESTAMPED_AUDIO_RE = /^mic-clip-(\d+)\.(webm|ogg)$/;
const TIMESTAMPED_META_RE = /^mic-clip-(\d+)\.meta\.json$/;

function respondJson(res: ServerResponse, code: number, body: unknown): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json");
  if (code >= 400) res.setHeader("Connection", "close");
  res.end(JSON.stringify(body));
}

/** Resolve Buffer or null when the body exceeded maxBytes (413) / socket error. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return; // still drains the socket while we bail out
      total += chunk.length;
      if (total > maxBytes) {
        done = true;
        chunks.length = 0;
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on("error", () => {
      if (!done) {
        done = true;
        resolve(null);
      }
    });
  });
}

function flyvjDiagPlugin(): Plugin {
  const telemetryPath = path.join(DIAG_DIR, "telemetry.jsonl");
  const latestPath = path.join(DIAG_DIR, "latest.json");
  let telemetryLines = -1; // counted from disk on first append

  const countJsonlLines = (): number => {
    try {
      let n = 0;
      for (const line of fs.readFileSync(telemetryPath, "utf8").split("\n")) {
        if (line.trim().length > 0) n++;
      }
      return n;
    } catch {
      return 0;
    }
  };

  const pruneTimestampedClips = (): void => {
    const stems = new Set<string>();
    try {
      for (const file of fs.readdirSync(DIAG_DIR)) {
        const audio = TIMESTAMPED_AUDIO_RE.exec(file);
        if (audio) {
          stems.add(audio[1]);
          continue;
        }
        const meta = TIMESTAMPED_META_RE.exec(file);
        if (meta) stems.add(meta[1]);
      }
    } catch {
      return;
    }
    const stale = [...stems].sort((a, b) => Number(b) - Number(a)).slice(KEEP_TIMESTAMPED_CLIPS);
    for (const stem of stale) {
      for (const suffix of [".webm", ".ogg", ".meta.json"]) {
        try {
          fs.rmSync(path.join(DIAG_DIR, `mic-clip-${stem}${suffix}`), { force: true });
        } catch {
          // best-effort prune only
        }
      }
    }
  };

  const handleTelemetry = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readBody(req, TELEMETRY_MAX_BYTES);
    if (body === null) {
      respondJson(res, 413, { error: "payload too large" });
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      respondJson(res, 400, { error: "invalid JSON" });
      return;
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      respondJson(res, 400, { error: "telemetry payload must be a JSON object" });
      return;
    }
    fs.mkdirSync(DIAG_DIR, { recursive: true });
    const line = JSON.stringify(payload);
    fs.appendFileSync(telemetryPath, line + "\n", "utf8");
    // countJsonlLines() runs AFTER the append, so it already includes this line
    telemetryLines = telemetryLines < 0 ? countJsonlLines() : telemetryLines + 1;
    if (telemetryLines > TELEMETRY_PRUNE_LINES) {
      fs.writeFileSync(telemetryPath, trimJsonlContent(fs.readFileSync(telemetryPath, "utf8"), DIAG_MAX_JSONL_LINES), "utf8");
      telemetryLines = DIAG_MAX_JSONL_LINES;
    }
    if ((payload as { kind?: unknown }).kind === "tick") {
      const tmp = latestPath + ".tmp";
      fs.writeFileSync(tmp, line, "utf8");
      fs.renameSync(tmp, latestPath);
    }
    respondJson(res, 200, { ok: true });
  };

  const handleAudio = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const buf = await readBody(req, DIAG_MAX_AUDIO_BYTES);
    if (buf === null) {
      respondJson(res, 413, { error: "audio too large" });
      return;
    }
    const contentType = req.headers["content-type"];
    const ext = typeof contentType === "string" && contentType.includes("ogg") ? "ogg" : "webm";
    const rawClipId = req.headers["x-diag-clip-id"];
    const clipIdStr = Array.isArray(rawClipId) ? rawClipId[0] : rawClipId;
    const clipId = clipIdStr && /^\d{10,16}$/.test(clipIdStr.trim()) ? clipIdStr.trim() : String(Date.now());
    const rawMeta = req.headers["x-diag-meta"];
    const metaHdr = Array.isArray(rawMeta) ? rawMeta[0] : rawMeta;
    let meta: Record<string, unknown> | null = null;
    if (metaHdr !== undefined) {
      meta = decodeDiagMetaHeader(metaHdr);
      if (meta === null) {
        respondJson(res, 400, { error: "corrupt x-diag-meta" });
        return;
      }
    }
    fs.mkdirSync(DIAG_DIR, { recursive: true });
    const latestAudioPath = path.join(DIAG_DIR, `mic-clip-latest.${ext}`);
    fs.writeFileSync(latestAudioPath, buf);
    fs.writeFileSync(path.join(DIAG_DIR, `mic-clip-${clipId}.${ext}`), buf);
    if (meta) {
      const metaJson = JSON.stringify(meta);
      fs.writeFileSync(path.join(DIAG_DIR, "mic-clip-latest.meta.json"), metaJson, "utf8");
      fs.writeFileSync(path.join(DIAG_DIR, `mic-clip-${clipId}.meta.json`), metaJson, "utf8");
    }
    pruneTimestampedClips();
    respondJson(res, 200, {
      ok: true,
      clipId,
      audioPath: latestAudioPath,
      ...(meta ? { metaPath: path.join(DIAG_DIR, "mic-clip-latest.meta.json") } : {}),
      bytes: buf.length,
    });
  };

  const handleAudioMeta = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const body = await readBody(req, DIAG_MAX_META_BYTES);
    if (body === null) {
      respondJson(res, 413, { error: "meta too large" });
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch {
      respondJson(res, 400, { error: "invalid or non-object JSON meta" });
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      respondJson(res, 400, { error: "invalid or non-object JSON meta" });
      return;
    }
    const rawClipId = req.headers["x-diag-clip-id"];
    const clipIdStr = Array.isArray(rawClipId) ? rawClipId[0] : rawClipId;
    const clipId = clipIdStr && /^\d{10,16}$/.test(clipIdStr.trim()) ? clipIdStr.trim() : String(Date.now());
    fs.mkdirSync(DIAG_DIR, { recursive: true });
    const metaJson = JSON.stringify(parsed);
    const latestMetaPath = path.join(DIAG_DIR, "mic-clip-latest.meta.json");
    fs.writeFileSync(latestMetaPath, metaJson, "utf8");
    fs.writeFileSync(path.join(DIAG_DIR, `mic-clip-${clipId}.meta.json`), metaJson, "utf8");
    pruneTimestampedClips();
    respondJson(res, 200, { ok: true, clipId, metaPath: latestMetaPath, bytes: body.length });
  };

  return {
    name: "flyvj-diag",
    apply: "serve",
    configureServer(server) {
      // Registered in configureServer body → runs before Vite's own middleware
      // stack (incl. the /api proxy), so /__diag is never proxied or 404'd.
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const isDiag =
          url === DIAG_ENDPOINTS.status || url === DIAG_ENDPOINTS.telemetry ||
          url === DIAG_ENDPOINTS.audio || url === DIAG_ENDPOINTS.audioMeta;
        if (!isDiag) {
          next();
          return;
        }
        if (!isLoopbackAddress(req.socket.remoteAddress)) {
          respondJson(res, 403, { error: "loopback only" });
          return;
        }
        if (req.method === "GET" && url === DIAG_ENDPOINTS.status) {
          fs.mkdirSync(DIAG_DIR, { recursive: true });
          respondJson(res, 200, { ok: true, devDiag: true, dir: DIAG_DIR });
          return;
        }
        if (req.method === "POST" && url === DIAG_ENDPOINTS.telemetry) {
          handleTelemetry(req, res).catch(() => respondJson(res, 500, { error: "diag telemetry failed" }));
          return;
        }
        if (req.method === "POST" && url === DIAG_ENDPOINTS.audio) {
          handleAudio(req, res).catch(() => respondJson(res, 500, { error: "diag audio failed" }));
          return;
        }
        if (req.method === "POST" && url === DIAG_ENDPOINTS.audioMeta) {
          handleAudioMeta(req, res).catch(() => respondJson(res, 500, { error: "diag audio meta failed" }));
          return;
        }
        respondJson(res, 405, { error: "method not allowed" });
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 5200,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${arenaPort}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [flyvjDiagPlugin()],
  // M4.7 C1 semantic worker: onnxruntime-web must NOT be pre-bundled — its feature-detect
  // dynamic imports of /ort/ort-wasm-*.mjs break under esbuild dep optimization. ES module
  // worker format keeps `{ type: "module" }` workers intact through vite build.
  optimizeDeps: { exclude: ["onnxruntime-web"] },
  worker: { format: "es" },
});

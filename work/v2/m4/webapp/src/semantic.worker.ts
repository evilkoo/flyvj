// M4.7 C1 semantic sidecar worker — offline YAMNet ONNX on the WASM CPU EP (0 MB VRAM,
// single-threaded → no SharedArrayBuffer / COOP-COEP requirement, zero CDN fetches:
// wasm runtime comes from /ort/, model + class map from /models/, all same-origin).
// Messages IN:
//   { type: "init" }  → fetch class map + create InferenceSession, post status ready/error
//   { type: "pcm16k"; tMs; samples: Float32Array } — one 7680-sample (0.48 s) hop @16 kHz
//   { type: "reset" } → clear the PCM window + embedding ring (session stays warm)
// Messages OUT:
//   { kind: "status"; status: "loading" | "ready" | "error"; initMs?; error? }
//   { kind: "semantic"; frame: SemanticFrame }
import * as ort from "onnxruntime-web";
import { cosineDistance, type SemanticFrame } from "./content.ts";

ort.env.wasm.wasmPaths = import.meta.env.DEV
  // dev: public-dir .mjs breaks under Vite's transform middleware (?import → 500);
  // node_modules serves the same files fine. Both paths are localhost-only.
  ? "/node_modules/onnxruntime-web/dist/"
  : "/ort/";
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const PCM_WIN = 15600; // 0.975 s @16 kHz — verified to produce exactly 1 YAMNet patch
const EMB_RING_MAX = 16; // ~7.7 s of 1024-d embeddings
const NUM_CLASSES = 521;

interface ClassRow { index: number; name: string }

const w = self as unknown as Worker;

let session: ort.InferenceSession | null = null;
let classIdx: number[][] = [];      // music / bass_electronic / vocals_speech / drums / quiet
let classNames: string[] = [];      // full 521 rows, index-aligned with model scores
let initMs = 0;

let pcmBuf = new Float32Array(PCM_WIN);
let pcmFilled = 0;
let embRing: Float32Array[] = [];

let running = false;   // re-entrancy guard: only ONE InferenceSession.run in flight
let queued = 0;        // hops that arrived while running (coalesced to the newest buffer)
let lastPcmTMs = 0;

interface InMsgInit { type: "init" }
interface InMsgPcm { type: "pcm16k"; tMs: number; samples: Float32Array }
interface InMsgReset { type: "reset" }
type InMsg = InMsgInit | InMsgPcm | InMsgReset;

type OutMsg =
  | { kind: "status"; status: "ready"; initMs: number }
  | { kind: "status"; status: "error"; error: string }
  | { kind: "semantic"; frame: SemanticFrame };

function post(msg: OutMsg): void { w.postMessage(msg); }

// ── AudioSet class map (same quote-safe CSV parser as the verified POC) ─────
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadClassMap(csv: string): { rows: ClassRow[]; groups: { music: number[]; drums: number[]; electronic: number[]; vocalChant: number[]; silence: number[] } } {
  const parsed = parseCsv(csv);
  const header = parsed[0];
  if (header[0] !== "index" || header[2] !== "display_name") {
    throw new Error("unexpected CSV header: " + header.join(","));
  }
  const rows: ClassRow[] = [];
  const groups: { music: number[]; drums: number[]; electronic: number[]; vocalChant: number[]; silence: number[] } = {
    music: [], drums: [], electronic: [], vocalChant: [], silence: [],
  };
  const byName = new Map<string, number>();
  for (let r = 1; r < parsed.length; r++) {
    const p = parsed[r];
    if (p.length < 3) continue;
    const idx = parseInt(p[0], 10);
    if (!Number.isInteger(idx)) continue;
    const name = p[2];
    rows.push({ index: idx, name });
    byName.set(name.toLowerCase(), idx);
  }
  for (const c of rows) {
    const n = c.name.toLowerCase();
    if (n === "music" || n.includes("music")) groups.music.push(c.index);
    if (/(drum|cymbal|percussion|hi-hat)/.test(n)) groups.drums.push(c.index);
    if (/(speech|singing|vocal|\brap(ping)?\b|choir|chant|mantra)/.test(n)) groups.vocalChant.push(c.index);
    if (["silence", "noise", "environmental noise", "quiet"].includes(n)) groups.silence.push(c.index);
  }
  // exact-name spec from the POC (matched set only)
  const bassSpec = ["synthesizer", "electronic music", "techno", "house music", "trance music", "dubstep", "bass guitar", "electronic dance music"];
  for (const spec of bassSpec) {
    const idx = byName.get(spec);
    if (idx !== undefined) groups.electronic.push(idx);
  }
  return { rows, groups };
}

// ── embedding-ring novelty (causal): mean of the two 4-vector edges of the ring ──
function meanVecs(vecs: Float32Array[], lo: number, hi: number): Float32Array | null {
  if (hi <= lo) return null;
  const dim = vecs[0].length;
  const m = new Float32Array(dim);
  for (let i = lo; i < hi; i++) {
    const v = vecs[i];
    for (let j = 0; j < dim; j++) m[j] += v[j];
  }
  for (let j = 0; j < dim; j++) m[j] /= hi - lo;
  return m;
}

function pushEmb(emb: Float32Array): number {
  embRing.push(emb);
  if (embRing.length > EMB_RING_MAX) embRing.shift();
  const len = embRing.length;
  if (len < 8) return 0;
  const past = meanVecs(embRing, Math.max(0, len - 12), len - 4);
  const now = meanVecs(embRing, len - 4, len);
  if (!past || !now) return 0;
  return cosineDistance(past, now);
}

async function initSession(): Promise<void> {
  const t0 = performance.now();
  try {
    const csvRes = await fetch("/models/yamnet_class_map.csv", { cache: "no-store" });
    if (!csvRes.ok) throw new Error(`class map HTTP ${csvRes.status}`);
    const { rows, groups } = loadClassMap(await csvRes.text());
    if (rows.length !== NUM_CLASSES) throw new Error(`class map rows ${rows.length} != ${NUM_CLASSES}`);
    classNames = rows.map((r) => r.name);
    classIdx = [groups.music, groups.electronic, groups.vocalChant, groups.drums, groups.silence]
      .map((g) => (g.length > 0 ? g : [-1])); // -1 sentinel keeps groupMax total-safe

    session = await ort.InferenceSession.create("/models/yamnet.onnx", { executionProviders: ["wasm"] });
    initMs = performance.now() - t0;
    post({ kind: "status", status: "ready", initMs });
  } catch (err) {
    session = null;
    post({ kind: "status", status: "error", error: String((err as Error).message ?? err) });
  }
}

function groupMax(scores: Float32Array, memberIdx: number[]): number {
  let mx = 0;
  for (const i of memberIdx) {
    if (i < 0) continue;
    const p = scores[i];
    if (p > mx) mx = p;
  }
  return mx;
}

function argmaxClass(scores: Float32Array): string {
  let mi = 0;
  for (let k = 1; k < Math.min(NUM_CLASSES, scores.length); k++) {
    if (scores[k] > scores[mi]) mi = k;
  }
  return classNames[mi] ?? "?";
}

async function pump(): Promise<void> {
  while (queued > 0) {
    queued = 0;
    const sessionOk = session !== null && pcmFilled >= PCM_WIN;
    if (!sessionOk || session === null) continue;
    const snap = Float32Array.from(pcmBuf); // stable snapshot; run() never races the ring
    const tMs = lastPcmTMs;
    const ti = performance.now();
    try {
      const res = await session.run({ waveform: new ort.Tensor("float32", snap, [PCM_WIN]) });
      const inferMs = performance.now() - ti;
      const scores = res.output_0.data as Float32Array;
      const emb = Float32Array.from(res.output_1.data as Float32Array);
      const frame: SemanticFrame = {
        tMs,
        ready: true,
        music: groupMax(scores, classIdx[0]),
        electronic: groupMax(scores, classIdx[1]),
        vocalChant: groupMax(scores, classIdx[2]),
        drums: groupMax(scores, classIdx[3]),
        silence: groupMax(scores, classIdx[4]),
        yamnetNovelty: pushEmb(emb),
        topClass: argmaxClass(scores),
        inferMs,
      };
      post({ kind: "semantic", frame });
    } catch (err) {
      // one failed hop must not kill the worker: report an unready frame and keep going
      const frame: SemanticFrame = {
        tMs, ready: false, music: 0, electronic: 0, vocalChant: 0, drums: 0, silence: 0,
        yamnetNovelty: 0, topClass: `error: ${String((err as Error).message ?? err)}`, inferMs: performance.now() - ti,
      };
      post({ kind: "semantic", frame });
    }
  }
  running = false;
}

function enqueueRun(): void {
  queued++;
  if (running) return;
  running = true;
  void pump();
}

w.onmessage = (e: MessageEvent<InMsg>) => {
  const m = e.data;
  if (m.type === "init") {
    void initSession();
    return;
  }
  if (m.type === "reset") {
    pcmBuf.fill(0);
    pcmFilled = 0;
    embRing.length = 0;
    return;
  }
  if (m.type === "pcm16k") {
    const samples = m.samples;
    const n = Math.min(samples.length, PCM_WIN);
    if (n <= 0) return;
    pcmBuf.copyWithin(0, n);
    for (let i = 0; i < n; i++) {
      const v = samples[i];
      pcmBuf[PCM_WIN - n + i] = Number.isFinite(v) ? v : 0;
    }
    pcmFilled = Math.min(PCM_WIN, pcmFilled + n);
    lastPcmTMs = m.tMs;
    if (session !== null && pcmFilled >= PCM_WIN) enqueueRun();
  }
};

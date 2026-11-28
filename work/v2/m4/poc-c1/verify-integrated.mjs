// verify-integrated.mjs — M4.8 dual-source offline replay comparing
//   (A) Baseline  — StructureDetector + AmbientGate + BandSmoother + decideOnEvent
//                   (the decision-worker math as it was BEFORE M4.7: rebalanceBands +
//                   GRID_FLOOR_BALANCED + M4.5.1 bandRef tracking, NO ContentAnalyzer,
//                   BUILD-UP stays hold/candidates-only)
//   (B) M4.8 Integrated C1 — same structure stack + ContentAnalyzer (adaptive relative
//                   density → getEffectiveDensity()) + hihat-lift cues + the M4.8 BUILD-UP
//                   Col 3 auto-trigger + real YAMNet SemanticFrames every 0.48 s (real
//                   yamnet.onnx via onnxruntime-node CPU EP) — mirroring decision.worker.ts's
//                   sample/semantic handlers 1:1 — plus a resolveSemanticToPhysical Auto-Pool
//                   replay on a 5×11 Arena (L1:[1,2,3,4], L2:[1,2,3,4,5], L3:[1,2,3,4,5,6]).
// Sources (BOTH, full dual-source comparison):
//   1. Clean original WAV  C:\Users\evilkoo\Documents\烏蠅VJ\Bakari_DJ_intro_edit_no_voice.mp3.wav
//      (266.98 s — cue/false-window timelines shifted +1.2 s vs the mic-clip base: the clean
//      file's start sits ~1.2 s off the recorded mic clip; ALL B triggers are printed too so
//      the alignment can be eyeballed directly)
//   2. Real 4m17s mic clip work/v2/m4/live-diag/mic-clip-latest.webm (257.76 s, 8 verified
//      cues + 4 false-drop windows on its own timeline)
// Audio is decoded by C:\ffmpeg\bin\ffmpeg.exe to 16 kHz + 48 kHz mono WAV in os.tmpdir()
// (temp WAVs deleted in `finally`).
// Per-source evaluation: 8 cue hits (±3.0 s), 4 false-drop windows (±3.0 s, want 0), total
// triggers, semantic Col 1/2/3 distribution, BUILD-UP and HI-HAT trigger counts, and the
// Auto-Pool physical column histogram (C1..C6).
import { InferenceSession, Tensor } from "onnxruntime-node";
import { bandEnergies, AmbientGate, BandSmoother } from "../webapp/src/dsp.ts";
import { StructureDetector } from "../webapp/src/detector.ts";
import {
  decideOnEvent, MushroomBody, rebalanceBands, BAND_REF_FLOOR, GRID_FLOOR_BALANCED,
} from "../webapp/src/decision.ts";
import { ContentAnalyzer, extractChroma12, cosineDistance } from "../webapp/src/content.ts";
import { createDefaultMapping, resolveSemanticToPhysical } from "../webapp/src/mapping.ts";
import { execFile as execFileCb } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIC_WEBM = path.resolve(HERE, "..", "live-diag", "mic-clip-latest.webm");
const CLEAN_WAV = "C:\\Users\\evilkoo\\Documents\\烏蠅VJ\\Bakari_DJ_intro_edit_no_voice.mp3.wav";
const CLEAN_OFFSET_S = 1.2; // clean-WAV timeline vs the mic-clip cue base (start offset)
const FFMPEG = "C:\\ffmpeg\\bin\\ffmpeg.exe";
const MODEL = path.join(HERE, "models", "yamnet.onnx");
const CSV = path.join(HERE, "models", "yamnet_class_map.csv");

// Cue/false-window base timeline — VERIFIED on the mic clip; the clean WAV shifts it +1.2 s.
const BASE_CUES = [41.5, 71.5, 101.5, 118.0, 153.8, 161.5, 169.3, 200.0];
const BASE_FALSE_WINDOWS = [10.6, 54.9, 130.8, 138.6];
const TOL_S = 3.0;
const TICK = 16;          // ms — 16ms sample cadence (matches main.ts setInterval)
const FFT_N = 2048;       // AnalyserNode fftSize (webapp)
const MIN_DB = -100, MAX_DB = -30;
const PCM_WIN = 15600;    // 0.975 s @16 kHz (1 YAMNet patch)
const PCM_HOP = 7680;     // 0.48 s @16 kHz
const SR16 = 16000;

// M4.8 Auto-Pool replay target: 5×11 Arena, live non-empty columns per layer (same tier
// pools as the mapping Auto-Pool unit test).
const ARENA_DIMS = { rows: 5, cols: 11 };
const AUTO_POOL_COLS = new Map([
  [1, [1, 2, 3, 4]],
  [2, [1, 2, 3, 4, 5]],
  [3, [1, 2, 3, 4, 5, 6]],
]);

const log = (...a) => console.log(...a);

// ── FFT (radix-2) + Blackman AnalyserNode emulation — copied from the verified POC ──
class FFT {
  constructor(n) {
    this.n = n;
    this.levels = Math.log2(n) | 0;
    this.cosp = new Float64Array(n / 2);
    this.sinp = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cosp[i] = Math.cos((2 * Math.PI * i) / n);
      this.sinp[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < this.levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }
  run() {
    const { n, re, im, rev, cosp, sinp } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cosp[k] + im[l] * sinp[k];
          const tim = -re[l] * sinp[k] + im[l] * cosp[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  }
}
function blackmanWindow(N) {
  const alpha = 0.16, a0 = (1 - alpha) / 2, a1 = 0.5, a2 = alpha / 2;
  const w = new Float64Array(N);
  for (let n = 0; n < N; n++) w[n] = a0 - a1 * Math.cos((2 * Math.PI * n) / N) + a2 * Math.cos((4 * Math.PI * n) / N);
  return w;
}
function parseWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("not a RIFF/WAVE file");
  let off = 12, fmt = null, dataOff = -1, dataLen = -1;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === "fmt " && size >= 16) {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new Error("missing fmt/data chunk");
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) throw new Error(`unsupported WAV format: ${JSON.stringify(fmt)}`);
  const ch = fmt.channels;
  const nFrames = Math.floor(dataLen / (ch * 2));
  const s16 = new Int16Array(buf.buffer, buf.byteOffset + dataOff, nFrames * ch);
  const mono = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let acc = 0;
    for (let c = 0; c < ch; c++) acc += s16[i * ch + c];
    mono[i] = (acc / ch) / 32768;
  }
  return { mono, sampleRate: fmt.sampleRate };
}

// ── YAMNet class map + groups (same rules as the verified POC / semantic.worker.ts) ──
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
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
function loadClassMap(csvPath) {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const header = rows[0];
  if (header[0] !== "index" || header[2] !== "display_name") throw new Error("unexpected CSV header");
  const classes = rows.slice(1).map((r) => ({ index: parseInt(r[0], 10), name: r[2] }));
  const groups = { music: [], drums: [], electronic: [], vocalChant: [], silence: [] };
  const byName = new Map(classes.map((c) => [c.name.toLowerCase(), c.index]));
  for (const c of classes) {
    const n = c.name.toLowerCase();
    if (n === "music" || n.includes("music")) groups.music.push(c.index);
    if (/(drum|cymbal|percussion|hi-hat)/.test(n)) groups.drums.push(c.index);
    if (/(speech|singing|vocal|\brap(ping)?\b|choir|chant|mantra)/.test(n)) groups.vocalChant.push(c.index);
    if (["silence", "noise", "environmental noise", "quiet"].includes(n)) groups.silence.push(c.index);
  }
  const bassSpec = ["synthesizer", "electronic music", "techno", "house music", "trance music", "dubstep", "bass guitar", "electronic dance music"];
  for (const spec of bassSpec) {
    const idx = byName.get(spec);
    if (idx !== undefined) groups.electronic.push(idx);
  }
  return { classes, groups };
}
function groupMax(scores, members) {
  let mx = 0;
  for (const i of members) { const p = scores[i]; if (p > mx) mx = p; }
  return mx;
}
function meanVecs(vecs, lo, hi) {
  if (hi <= lo) return null;
  const m = new Float64Array(vecs[0].length);
  for (let i = lo; i < hi; i++) { const v = vecs[i]; for (let j = 0; j < m.length; j++) m[j] += v[j]; }
  for (let j = 0; j < m.length; j++) m[j] /= hi - lo;
  return m;
}

/** Real YAMNet over the whole 16 kHz clip → SemanticFrame[] fed at end-of-hop times,
 * exactly mirroring semantic.worker.ts (sliding 15600 window, group max, 16-vector
 * embedding ring with causal novelty). */
async function runYamnetFrames(x16k, session, classes, groups) {
  const frames = [];
  const embRing = [];
  const nHops = Math.floor(x16k.length / PCM_HOP);
  const t0 = performance.now();
  for (let i = 0; i < nHops; i++) {
    const end = (i + 1) * PCM_HOP;
    if (end < PCM_WIN) continue; // pcmFilled < PCM_WIN — the worker would not run yet
    const wf = x16k.slice(end - PCM_WIN, end);
    const ti = performance.now();
    const out = await session.run({ waveform: new Tensor("float32", wf, [PCM_WIN]) });
    const inferMs = performance.now() - ti;
    const scores = out.output_0.data;             // [1,521]
    const emb = Float32Array.from(out.output_1.data); // [1,1024]
    embRing.push(emb);
    if (embRing.length > 16) embRing.shift();
    const len = embRing.length;
    let nov = 0;
    if (len >= 8) {
      const past = meanVecs(embRing, Math.max(0, len - 12), len - 4);
      const now = meanVecs(embRing, len - 4, len);
      if (past && now) nov = cosineDistance(past, now);
    }
    let mi = 0;
    for (let k = 1; k < 521; k++) if (scores[k] > scores[mi]) mi = k;
    frames.push({
      tMs: (end / SR16) * 1000,
      ready: true,
      music: groupMax(scores, groups.music),
      electronic: groupMax(scores, groups.electronic),
      vocalChant: groupMax(scores, groups.vocalChant),
      drums: groupMax(scores, groups.drums),
      silence: groupMax(scores, groups.silence),
      yamnetNovelty: nov,
      topClass: classes[mi].name,
      inferMs,
    });
  }
  const lat = frames.map((f) => f.inferMs).slice(5).sort((a, b) => a - b);
  const meanMs = lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length);
  log(`  yamnet: ${frames.length} frames, warm mean ${meanMs.toFixed(1)} ms/hop, wall ${(performance.now() - t0).toFixed(0)} ms`);
  return { frames, meanMs };
}

/** One full 16ms-tick pipeline run. `withContent=false` → baseline (before M4.7).
 *  `cues` / `falseWindows` come from the source's own timeline. */
function runPipeline({ label, y48, sr48, withContent, semanticFrames, cues, falseWindows }) {
  const hopSamples = Math.round((sr48 * TICK) / 1000);
  const fft = new FFT(FFT_N);
  const win = blackmanWindow(FFT_N);
  const bytes = new Uint8Array(FFT_N / 2);
  const frame = new Float64Array(FFT_N);
  const gate = new AmbientGate(1200);
  const smoother = new BandSmoother();
  const det = new StructureDetector();
  const content = withContent ? new ContentAnalyzer() : null;
  const mb = new MushroomBody();
  let bandRef = { ...BAND_REF_FLOOR };
  let lastRefT = 0;
  let lastAutoCell = null;
  let lastBands = { low: 0, mid: 0, high: 0 };
  let lastSampleT = 0;
  let semIdx = 0;
  const triggers = [];
  const nTicks = Math.floor(y48.length / hopSamples);

  const dispatch = (ev, balanced, density, tMs, cellBias) => {
    const decision = decideOnEvent(
      ev, balanced, density,
      { lastAutoCell, kc: null, mb, bandFloor: GRID_FLOOR_BALANCED, cellBias }, tMs, "auto",
    );
    if (decision.kind === "trigger") {
      lastAutoCell = decision.cell;
      if (content) content.noteAutoTrigger(tMs, ev.type === "drop");
      triggers.push({
        tMs, cell: decision.cell, conf: +decision.confidence.toFixed(2),
        reason: decision.reason, eventType: ev.type,
        cueKind: ev.cueKind ?? null,
      });
    }
  };

  for (let i = 0; i < nTicks; i++) {
    const tMs = i * TICK;
    const end = (i + 1) * hopSamples;
    for (let k = 0; k < FFT_N; k++) {
      const idx = end - FFT_N + k;
      frame[k] = idx >= 0 ? y48[idx] : 0;
    }
    for (let k = 0; k < FFT_N; k++) { fft.re[k] = frame[k] * win[k]; fft.im[k] = 0; }
    fft.run();
    for (let k = 0; k < FFT_N / 2; k++) {
      const mag = Math.sqrt(fft.re[k] * fft.re[k] + fft.im[k] * fft.im[k]) / FFT_N;
      let db = 20 * Math.log10(Math.max(mag, 1e-300));
      if (db < MIN_DB) db = MIN_DB; else if (db > MAX_DB) db = MAX_DB;
      let b = Math.round((255 * (db - MIN_DB)) / (MAX_DB - MIN_DB));
      if (b < 0) b = 0; else if (b > 255) b = 255;
      bytes[k] = b;
    }
    const raw = bandEnergies(bytes, sr48, FFT_N);
    const gated = gate.apply(raw, TICK);
    const bands = smoother.update(gated, TICK);
    lastSampleT = tMs;
    lastBands = bands;

    // C1 semantic frames whose chunk-end time has passed (worker "semantic" message case)
    if (content) {
      while (semIdx < semanticFrames.length && semanticFrames[semIdx].tMs <= tMs) {
        const cue = content.updateSemantic(semanticFrames[semIdx]);
        semIdx++;
        if (cue && lastSampleT > 0) {
          let semBalanced = lastBands;
          let semDensity = 0;
          try {
            const s = det.state(lastSampleT);
            semDensity = s.density;
            const ss = { low: s.signature.low * s.total, mid: s.signature.mid * s.total, high: s.signature.high * s.total };
            semBalanced = rebalanceBands(ss.low + ss.mid + ss.high > 0 ? ss : lastBands, bandRef);
          } catch { /* pre-warmup */ }
          dispatch(cue.event, semBalanced, semDensity, cue.event.tMs, cue.cellBias);
        }
      }
    }

    const ev = det.update(tMs, bands, raw);
    const st = det.state(tMs);
    const dtRef = Math.max(1, Math.min(250, tMs - lastRefT));
    lastRefT = tMs;
    if (st.total > 0.04) {
      const aRef = 1 - Math.exp(-dtRef / 15000);
      bandRef.low += (bands.low - bandRef.low) * aRef;
      bandRef.mid += (bands.mid - bandRef.mid) * aRef;
      bandRef.high += (bands.high - bandRef.high) * aRef;
    }
    const ss = { low: st.signature.low * st.total, mid: st.signature.mid * st.total, high: st.signature.high * st.total };
    const liveBalanced = rebalanceBands(ss.low + ss.mid + ss.high > 0 ? ss : bands, bandRef);
    const dropBalanced = rebalanceBands(bands, bandRef);
    // M4.8 worker mirror: motion tier comes from the RELATIVE effective density when the
    // content layer is live (falls back to absolute density in legacy band-only mode).
    const effDensity = content ? content.getEffectiveDensity() : st.density;

    const c1SampleCue = content
      ? content.updateSample({
          tMs, raw, density: st.density, regularity: st.regularity,
          novLow: st.novLow, chroma: extractChroma12(bytes, sr48, FFT_N),
          bpm: st.bpm, cell: st.cell,
        })
      : null;
    const dropCue = c1SampleCue !== null && c1SampleCue.cueKind === "drop-return" ? c1SampleCue : null;
    const baselineDrop = ev !== null && ev.type === "drop" && content !== null
      ? content.shouldAllowBaselineDrop(raw, st.density, tMs)
      : ev !== null && ev.type === "drop"; // no content layer → every baseline drop allowed

    if (baselineDrop || dropCue !== null) {
      if (baselineDrop) {
        dispatch(ev, dropBalanced, effDensity, tMs, dropCue !== null ? dropCue.cellBias : undefined);
      } else if (dropCue !== null) {
        dispatch(dropCue.event, dropBalanced, effDensity, tMs, dropCue.cellBias);
      }
    } else if (c1SampleCue !== null) {
      dispatch(c1SampleCue.event, liveBalanced, effDensity, tMs, c1SampleCue.cellBias);
    } else if (ev !== null && ev.type === "section") {
      if (!content || content.canAutoTrigger(tMs, false)) dispatch(ev, liveBalanced, effDensity, tMs);
    } else if (ev !== null && ev.type === "buildup") {
      if (content && content.canAutoTrigger(tMs, false)) {
        // M4.8 worker mirror: BUILD-UP now TRIGGERS when cooled down — forced into the
        // ACTIVE (Col 3) tier so the riser visibly moves the nine-grid.
        dispatch(
          { ...ev, confidence: Math.max(ev.confidence, 0.65) },
          liveBalanced, Math.max(effDensity, 6.5), tMs,
          [0, 0, 0.40, 0, 0, 0.55, 0, 0, 0.65],
        );
      }
      // cooled down (or baseline) → hold, candidates only — never a trigger
    } else if (ev !== null && ev.type === "drop" && !content) {
      dispatch(ev, dropBalanced, effDensity, tMs);
    }
  }

  // evaluation against THIS source's cue timeline
  const trigS = triggers.map((t) => t.tMs / 1000);
  const cueHits = cues.map((c) => {
    let best = null;
    for (const t of trigS) {
      const d = Math.abs(t - c);
      if (d <= TOL_S && (best === null || d < best.d)) best = { d, t };
    }
    if (best === null) return { cue: c, hit: false };
    const trig = triggers.find((x) => x.tMs / 1000 === best.t);
    return { cue: c, hit: true, triggerT: best.t, delta: +(best.t - c).toFixed(2), reason: trig.reason, cell: trig.cell, eventType: trig.eventType, cueKind: trig.cueKind };
  });
  const falseCounts = falseWindows.map((w) => ({
    window: w,
    triggers: triggers.filter((t) => Math.abs(t.tMs / 1000 - w) <= TOL_S).map((t) => ({ t: +(t.tMs / 1000).toFixed(2), reason: t.reason })),
  }));
  return {
    label,
    nTicks,
    triggers,
    hits: cueHits.filter((h) => h.hit).length,
    cueHits,
    falseCounts,
    falseTotal: falseCounts.reduce((a, f) => a + f.triggers.length, 0),
    totalTriggers: triggers.length,
  };
}

// ── M4.8 Auto-Pool replay: semantic trigger cells → 5×11 physical columns ────
function replayAutoPool(triggers) {
  const cfg = createDefaultMapping(5, 11);
  const lastBySlot = new Map();
  const hist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  let mapped = 0;
  let unmapped = 0;
  for (const t of triggers) {
    if (!t.cell) { unmapped++; continue; }
    const slot = (t.cell.row - 1) * 3 + (t.cell.col - 1);
    const phys = resolveSemanticToPhysical(slot, cfg, lastBySlot, ARENA_DIMS, AUTO_POOL_COLS);
    if (!phys) { unmapped++; continue; }
    lastBySlot.set(slot, `${phys.layer}:${phys.col}`);
    mapped++;
    hist[phys.col] = (hist[phys.col] ?? 0) + 1;
  }
  return { hist, mapped, unmapped };
}

function colDist(triggers) {
  const d = { 1: 0, 2: 0, 3: 0 };
  for (const t of triggers) {
    if (t.cell) d[t.cell.col] = (d[t.cell.col] ?? 0) + 1;
  }
  return d;
}

function fmtHist(hist) {
  return Object.entries(hist).map(([c, n]) => `C${c}:${n}`).join(" ");
}

async function evaluateSource(src, session, classes, groups) {
  log("");
  log(`═══ SOURCE ${src.no}: ${src.label} ═══`);
  log(`file: ${src.path}`);
  if (!fs.existsSync(src.path)) throw new Error(`source file not found: ${src.path}`);
  const tmp16 = path.join(os.tmpdir(), `flyvj-verify-${src.id}-16k-${process.pid}.wav`);
  const tmp48 = path.join(os.tmpdir(), `flyvj-verify-${src.id}-48k-${process.pid}.wav`);
  try {
    log("[decode] ffmpeg → 16k + 48k mono WAV…");
    await execFile(FFMPEG, ["-y", "-i", src.path, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp16]);
    await execFile(FFMPEG, ["-y", "-i", src.path, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", tmp48]);
    const wav16 = parseWav(tmp16);
    const wav48 = parseWav(tmp48);
    const durS = wav48.mono.length / wav48.sampleRate;
    log(`  duration ${durS.toFixed(2)} s · 48k frames ${wav48.mono.length} · 16k frames ${wav16.mono.length}`);
    const cues = BASE_CUES.map((c) => +(c + src.cueOffsetS).toFixed(2));
    const falseWindows = BASE_FALSE_WINDOWS.map((w) => +(w + src.cueOffsetS).toFixed(2));
    if (src.cueOffsetS !== 0) {
      log(`  cue timeline shifted ${src.cueOffsetS >= 0 ? "+" : ""}${src.cueOffsetS}s vs mic-clip base:`);
      log(`    cues  ${cues.join(", ")}`);
      log(`    false ${falseWindows.join(", ")}`);
    }
    if (durS < cues[cues.length - 1]) log(`  ⚠ clip shorter than the last cue (${cues[cues.length - 1]} s) — late cues will be misses`);
    log("[yamnet] real inference (0.48 s hops, onnxruntime-node CPU EP)…");
    const yam = await runYamnetFrames(wav16.mono, session, classes, groups);
    log("[pipeline] A (baseline) vs B (M4.8 integrated C1) @16ms ticks…");
    const A = runPipeline({ label: "A baseline (no C1)", y48: wav48.mono, sr48: wav48.sampleRate, withContent: false, semanticFrames: [], cues, falseWindows });
    const B = runPipeline({ label: "B M4.8 integrated C1", y48: wav48.mono, sr48: wav48.sampleRate, withContent: true, semanticFrames: yam.frames, cues, falseWindows });
    return { src, durS, cues, falseWindows, yamFrames: yam.frames.length, A, B };
  } finally {
    for (const f of [tmp16, tmp48]) {
      try { fs.rmSync(f, { force: true }); } catch { /* best-effort cleanup */ }
    }
  }
}

function printSourceReport({ src, durS, cues, falseWindows, yamFrames, A, B }) {
  const colA = colDist(A.triggers);
  const colB = colDist(B.triggers);
  const poolA = replayAutoPool(A.triggers);
  const poolB = replayAutoPool(B.triggers);
  const buildupA = A.triggers.filter((t) => t.eventType === "buildup").length;
  const buildupB = B.triggers.filter((t) => t.eventType === "buildup").length;
  const hihatA = A.triggers.filter((t) => t.cueKind === "hihat-lift").length;
  const hihatB = B.triggers.filter((t) => t.cueKind === "hihat-lift").length;

  log("");
  log(`┌─ ${src.label} — cue hit table (±${TOL_S} s) ─────────────────────────────────`);
  log("│  cue(s)  │ A baseline              │ B M4.8 integrated C1");
  for (let i = 0; i < cues.length; i++) {
    const ha = A.cueHits[i];
    const hb = B.cueHits[i];
    const fa = ha.hit ? `t=${ha.triggerT.toFixed(2)} (${ha.delta >= 0 ? "+" : ""}${ha.delta}s) ${ha.eventType}${ha.cueKind ? "/" + ha.cueKind : ""}` : "MISS";
    const fb = hb.hit ? `t=${hb.triggerT.toFixed(2)} (${hb.delta >= 0 ? "+" : ""}${hb.delta}s) ${hb.eventType}${hb.cueKind ? "/" + hb.cueKind : ""}` : "MISS";
    log(`│  ${String(cues[i]).padStart(6)}  │ ${fa.padEnd(24)}│ ${fb}`);
    if (hb.hit) log(`│          │   B reason: ${hb.reason}`);
  }
  log("├─ false-drop windows (±3.0 s, want 0) ────────────────────────────────────");
  for (let i = 0; i < falseWindows.length; i++) {
    const fa = A.falseCounts[i].triggers.length;
    const fb = B.falseCounts[i].triggers.length;
    log(`│  ${String(falseWindows[i]).padStart(6)}  │ A: ${fa} trigger(s)${fa ? " — " + A.falseCounts[i].triggers.map((t) => `${t.t}s "${t.reason}"`).join("; ") : ""} │ B: ${fb} trigger(s)${fb ? " — " + B.falseCounts[i].triggers.map((t) => `${t.t}s "${t.reason}"`).join("; ") : ""}`);
  }
  if (src.id === "clean") {
    log("├─ ALL triggered events on the Clean WAV (B, M4.8) ────────────────────────");
    for (const t of B.triggers) {
      const cell = t.cell ? `L${t.cell.row}C${t.cell.col}` : "—";
      log(`│  t=${(t.tMs / 1000).toFixed(2).padStart(7)}s  cell=${cell}  ${t.eventType}${t.cueKind ? "/" + t.cueKind : ""}  conf ${t.conf}  "${t.reason}"`);
    }
    if (B.triggers.length === 0) log("│  (no triggers)");
  }
  log("├─ M4.8 summary ───────────────────────────────────────────────────────────");
  log(`│  hits / 8            A: ${A.hits}/8   B: ${B.hits}/8`);
  log(`│  false-window fires  A: ${A.falseTotal}   B: ${B.falseTotal}`);
  log(`│  total triggers      A: ${A.totalTriggers}   B: ${B.totalTriggers}  (duration ${durS.toFixed(2)}s · yamnet frames ${yamFrames})`);
  log(`│  semantic Col 1/2/3  A: ${colA[1]}/${colA[2]}/${colA[3]}   B: ${colB[1]}/${colB[2]}/${colB[3]}`);
  log(`│  BUILD-UP triggers   A: ${buildupA}   B: ${buildupB}`);
  log(`│  HI-HAT triggers     A: ${hihatA}   B: ${hihatB}`);
  log(`│  auto-pool C1..C6    A: ${fmtHist(poolA.hist)} (mapped ${poolA.mapped}, unmapped ${poolA.unmapped})`);
  log(`│                      B: ${fmtHist(poolB.hist)} (mapped ${poolB.mapped}, unmapped ${poolB.unmapped})`);
  log("└──────────────────────────────────────────────────────────────────────────");
  return { colA, colB, poolA, poolB, buildupA, buildupB, hihatA, hihatB };
}

async function main() {
  const tStart = performance.now();
  log("═══ FlyVJ M4.8 — dual-source integrated replay: Clean WAV + real mic clip ═══");
  log(`yamnet model: ${MODEL}`);
  log(`auto-pool target: ${ARENA_DIMS.rows}×${ARENA_DIMS.cols} · L1:[1,2,3,4] L2:[1,2,3,4,5] L3:[1,2,3,4,5,6]`);

  const sources = [
    { no: 1, id: "clean", label: "Clean original WAV (Bakari DJ intro edit)", path: CLEAN_WAV, cueOffsetS: CLEAN_OFFSET_S },
    { no: 2, id: "mic", label: "Real 4m17s mic clip (live-diag/mic-clip-latest.webm)", path: MIC_WEBM, cueOffsetS: 0 },
  ];

  log("");
  log("[init] YAMNet session (onnxruntime-node CPU EP, real yamnet.onnx)…");
  const { classes, groups } = loadClassMap(CSV);
  const initT = performance.now();
  const session = await InferenceSession.create(MODEL, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
  log(`  session init ${(performance.now() - initT).toFixed(0)} ms · EP=cpu · 0 MB VRAM`);

  const runs = [];
  for (const src of sources) runs.push(await evaluateSource(src, session, classes, groups));

  const extras = runs.map((r) => printSourceReport(r));

  log("");
  log("┌─ DUAL-SOURCE comparison ─────────────────────────────────────────────────");
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const x = extras[i];
    log(`│  ${r.src.label}`);
    log(`│    hits / 8            A: ${r.A.hits}/8   B: ${r.B.hits}/8`);
    log(`│    false-window fires  A: ${r.A.falseTotal}   B: ${r.B.falseTotal}`);
    log(`│    semantic Col 1/2/3  A: ${x.colA[1]}/${x.colA[2]}/${x.colA[3]}   B: ${x.colB[1]}/${x.colB[2]}/${x.colB[3]}`);
    log(`│    BUILD-UP triggers   A: ${x.buildupA}   B: ${x.buildupB}   ·   HI-HAT triggers  A: ${x.hihatA}   B: ${x.hihatB}`);
    log(`│    auto-pool C1..C6    A: ${fmtHist(x.poolA.hist)}   B: ${fmtHist(x.poolB.hist)}`);
  }
  log("└──────────────────────────────────────────────────────────────────────────");

  const summary = {
    version: "M4.8 dual-source",
    autoPool: { dims: ARENA_DIMS, colsByLayer: Object.fromEntries(AUTO_POOL_COLS) },
    sources: runs.map((r, i) => {
      const x = extras[i];
      return {
        id: r.src.id,
        file: r.src.path,
        cueOffsetS: r.src.cueOffsetS,
        durationS: +r.durS.toFixed(2),
        cues: r.cues,
        falseWindows: r.falseWindows,
        yamnetFrames: r.yamFrames,
        A: {
          label: r.A.label, hits: r.A.hits, cueHits: r.A.cueHits,
          falseTotal: r.A.falseTotal, falseCounts: r.A.falseCounts,
          totalTriggers: r.A.totalTriggers, colDist: x.colA,
          buildupTriggers: x.buildupA, hihatTriggers: x.hihatA,
          autoPoolHist: x.poolA.hist,
        },
        B: {
          label: r.B.label, hits: r.B.hits, cueHits: r.B.cueHits,
          falseTotal: r.B.falseTotal, falseCounts: r.B.falseCounts,
          totalTriggers: r.B.totalTriggers, colDist: x.colB,
          buildupTriggers: x.buildupB, hihatTriggers: x.hihatB,
          autoPoolHist: x.poolB.hist,
          triggers: r.src.id === "clean" ? r.B.triggers : undefined,
        },
      };
    }),
  };
  log("");
  log(JSON.stringify(summary, null, 1));
  log("");
  log(`total wall ${(performance.now() - tStart).toFixed(0)} ms`);
  await session.close?.();
}

main().catch((e) => { console.error(e); process.exit(1); });

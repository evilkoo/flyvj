/// <reference types="vite/client" />
// FlyVJ M4.6 — Adaptive M×N Semantic-Physical Mapping, Safe Attach,
// Zero-Rebuild Grid, Imitation Capture & External Arena Launch Detection.

import {
  isParamMsg, isComposition, connectedValue, columnConnectPath, clipConnectPath, layerClearPath, paramByIdPath,
  type WsComposition, type WsColumn, type WsLayer, type WsParamMsg,
} from "./src/protocol.ts";
import { parseManifest, planSync, manifestClipAt, ENERGIES, MOTIONS, type Manifest } from "./src/manifest.ts";
import {
  MAPPING_STORAGE_KEY, createDefaultMapping, cycleLayerRole, ensureLayerRoles, getLayerRole,
  layersToClearForTarget, physicalToSemantic, resolveSemanticToPhysical, sanitizeMappingConfig,
  slotsForPhysical, toggleSlotBinding,
  type LayerRole, type MappingConfig, type PhysicalClipRef,
} from "./src/mapping.ts";
import { sanitizeSession, type BatchTrainResult, type CapturePair } from "./src/capture.ts";
import { ExternalLaunchDetector } from "./src/external-detect.ts";
import { Watchdog } from "./src/watchdog.ts";
import { startMicPipeline, startSystemAudioPipeline, stopMicPipeline, BandSampler, type AudioPipeline } from "./src/audio.ts";
import { bandEnergies as bandEnergiesRaw, FFT_SIZE } from "./src/dsp.ts";
import {
  DIAG_ENDPOINTS, DIAG_AUDIO_MAX_MS, DIAG_MAX_BAND_SAMPLES, chooseAudioMimeType,
  type DiagEvent, type DiagAudioMeta,
} from "./src/diag.ts";
import { FlyViewport, CANVAS_MAX_W, CANVAS_MAX_H } from "./src/renderer.ts";
import { cartoonFlySource } from "./src/flyrig.ts";
import { cellIdx, idxCell, type Decision, type MasterMode, type TriggerMode, type CellCandidate } from "./src/decision.ts";
import { cellLabel, type DetectorState, type GridCell } from "./src/detector.ts";
import type { WorkerInMsg } from "./src/decision.worker.ts";
import type { SemanticFrame, ContentState } from "./src/content.ts";

const HOST = "127.0.0.1";
const PORT_OVERRIDE = new URLSearchParams(location.search).get("port");

const BRAIN_STORAGE_KEY = "flyvj.mb.v1";
const DEMO_STORAGE_KEY = "flyvj.demo.v1";
const CAPTURE_STORAGE_KEY = "flyvj.capture.v1";

const statusEl = document.getElementById("status")!;
const gridEl = document.getElementById("grid")!;
const logEl = document.getElementById("log")!;
const wdEl = document.getElementById("watchdog")!;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const micStateEl = document.getElementById("mic-state")!;
const agcBoxEl = document.getElementById("agc-box")!;
const rendererInfoEl = document.getElementById("renderer-info")!;
const canvasEl = document.getElementById("fly-canvas") as HTMLCanvasElement;

// Safe Attach elements
const attachBadgeEl = document.getElementById("attach-badge")!;
const btnSyncArena = document.getElementById("btn-sync-arena") as HTMLButtonElement;

// M4 cockpit elements
const masterModeEl = document.getElementById("master-mode")!;
const btnAuto = document.getElementById("btn-auto") as HTMLButtonElement;
const btnHold = document.getElementById("btn-hold") as HTMLButtonElement;
const btnTMode = document.getElementById("btn-tmode") as HTMLButtonElement;
const btnExportBrain = document.getElementById("btn-export-brain") as HTMLButtonElement;
const btnResetBrain = document.getElementById("btn-reset-brain") as HTMLButtonElement;
const recalBtn = document.getElementById("recal-btn") as HTMLButtonElement;
const sysAudioBtn = document.getElementById("sys-audio-btn") as HTMLButtonElement;
const tickerEl = document.getElementById("ticker")!;
const historyEl = document.getElementById("history")!;
const detStateEl = document.getElementById("det-state")!;
const perfLineEl = document.getElementById("perf-line")!;
const c1DotEl = document.getElementById("c1-dot")!;
const c1TextEl = document.getElementById("c1-text")!;
const c1TagEl = document.getElementById("c1-tag")!;
const btnDiagAudio = document.getElementById("btn-diag-audio") as HTMLButtonElement;
const diagStatusEl = document.getElementById("diag-status")!;

// Phase 1 bind controls
const btnBindMode = document.getElementById("btn-bind-mode") as HTMLButtonElement;
const bindSlotSelect = document.getElementById("bind-slot-select") as HTMLSelectElement;

// Phase 2 M4.6 Capture Bar elements
const btnRec = document.getElementById("btn-rec") as HTMLButtonElement;
const btnTrain = document.getElementById("btn-train") as HTMLButtonElement;
const btnRollback = document.getElementById("btn-rollback") as HTMLButtonElement;
const btnClearRec = document.getElementById("btn-clear-rec") as HTMLButtonElement;
const recStatusEl = document.getElementById("rec-status")!;

type ParamTarget =
  | { kind: "clip"; layer: number; col: number }
  | { kind: "column"; col: number };

const live = new Map<number, unknown>();
const paramIdToTarget = new Map<number, ParamTarget>();
const clipCellEls = new Map<string, HTMLElement>();
const colCellEls = new Map<number, HTMLElement[]>();
const lastPhysicalBySlot = new Map<number, string>();
const externalDetector = new ExternalLaunchDetector(1500);

let composition: WsComposition | null = null;
let manifest: Manifest | null = null;
let arenaRows = 3;
let arenaCols = 3;
let ws: WebSocket | null = null;
let retryCount = 0;
let closedByUs = false;
let wsPort = PORT_OVERRIDE ?? "8080";
let syncInFlight = false;
let syncRounds = 0;
const SYNC_ROUNDS_MAX = 3;
let liveRenderQueued = false;

let bindMode = false;
let selectedBindSlot = 0;

function loadMappingFromStorage(): MappingConfig {
  try {
    const raw = localStorage.getItem(MAPPING_STORAGE_KEY);
    if (raw) return sanitizeMappingConfig(JSON.parse(raw), arenaRows, arenaCols);
  } catch { /* corrupt mapping — fallback to default */ }
  return createDefaultMapping(arenaRows, arenaCols);
}

function saveMappingToStorage(cfg: MappingConfig): void {
  try {
    localStorage.setItem(MAPPING_STORAGE_KEY, JSON.stringify(cfg));
  } catch (err) {
    logLine(`mapping persist FAILED: ${(err as Error).message}`, true);
  }
}

let mappingConfig: MappingConfig = loadMappingFromStorage();

function wsUrl() { return `ws://${HOST}:${wsPort}/api/v1`; }
function restBase() { return `/api/v1`; }

function logLine(msg: string, isErr = false) {
  const line = document.createElement("div");
  if (isErr) line.className = "err";
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logEl.prepend(line);
  while (logEl.childElementCount > 300) logEl.lastElementChild!.remove();
  console.log(msg);
}

function setStatus(cls: "ok" | "bad" | "wait", text: string) {
  statusEl.className = cls;
  statusEl.textContent = text;
}

function setWatchdogBar(text: string, bad = false) {
  wdEl.textContent = `watchdog: ${text}`;
  wdEl.className = bad ? "bad" : "";
}

function updateAttachBadge(): void {
  if (!composition) {
    attachBadgeEl.textContent = "Safe Attach 只讀連線 — 未連線 Arena（唔會自動覆寫）";
    btnSyncArena.disabled = true;
    return;
  }
  const pendingOps = manifest ? planSync(manifest, composition).length : 0;
  attachBadgeEl.textContent = `Safe Attach 只讀連線 — 唔會自動覆寫 Arena · manifest 差異 ${pendingOps} 項`;
  btnSyncArena.disabled = syncInFlight || !manifest;
}

// ── Viewport (M3) ───────────────────────────────────────────────────────────
const viewport = new FlyViewport(canvasEl, cartoonFlySource);
viewport.start();
window.addEventListener("resize", () => viewport.resize());
window.addEventListener("flyvj:contextlost", () => {
  rendererInfoEl.textContent = "renderer: CONTEXT LOST — disposed, waiting for restore…";
  logLine("WebGL context lost → scene disposed (contract (e))", true);
});
window.addEventListener("flyvj:contextrestored", (e) => {
  const n = (e as CustomEvent<{ rebuilds: number }>).detail?.rebuilds ?? 0;
  rendererInfoEl.textContent = `renderer: REBUILT after context loss (#${n})`;
  logLine(`WebGL context restored → full rebuild #${n} (contract (e))`);
});
function updateRendererInfo() {
  const s = viewport.getState();
  rendererInfoEl.textContent = `renderer: ${s.running ? "running" : "idle"} · backing ${s.canvasW}×${s.canvasH} (cap ${CANVAS_MAX_W}×${CANVAS_MAX_H}) · rebuilds ${s.rebuilds}`;
}

// ── Audio (M3) ──────────────────────────────────────────────────────────────
let pipeline: AudioPipeline | null = null;
let sampler: BandSampler | null = null;
let bands = { low: 0, mid: 0, high: 0 };

function renderAgc() {
  if (!pipeline) { agcBoxEl.innerHTML = "AGC/echo/NS 實際狀態：未開始"; return; }
  const s = pipeline.settings;
  if (pipeline.sourceKind === "system") {
    agcBoxEl.innerHTML =
      `來源：<b>系統原音（getDisplayMedia）</b> — 未經 AGC/echo/NS 處理 · track: ${s.label} · sampleRate ${s.sampleRate ?? "?"}<br>` +
      `requested: AGC=false echo=false NS=false · getSettings() 實讀（contract (d)）`;
    return;
  }
  const fmt = (v: boolean | null, badWhenTrue: boolean) => {
    if (v === null) return "<span class='warn'>未知</span>";
    const bad = badWhenTrue ? v : !v;
    return bad ? `<span class='warn'>${v ? "ON" : "OFF"} ⚠</span>` : `${v ? "ON" : "OFF"} ✓`;
  };
  const agcWarn = s.autoGainControl === true;
  agcBoxEl.innerHTML =
    `AGC 實際：<b>${fmt(s.autoGainControl, true)}</b> · echo：<b>${fmt(s.echoCancellation, true)}</b> · NS：<b>${fmt(s.noiseSuppression, true)}</b><br>` +
    `requested: AGC=false echo=false NS=false · getSettings() 實讀（contract (d)）<br>` +
    `track: ${s.label} · sampleRate ${s.sampleRate ?? "?"}` +
    (agcWarn ? "<br><span class='warn'>AGC 仍然開 — 三頻分析可信度受限（firmware/OS 層，唔係 bug）</span>" : "");
}

async function startAudio() {
  startBtn.disabled = true;
  micStateEl.textContent = "mic: starting…（等用戶批 mic 權限）";
  try {
    pipeline = await startMicPipeline((samples) => {
      semanticWorker?.postMessage({ type: "pcm16k", tMs: songNow(), samples }, [samples.buffer]);
    });
    sampler = new BandSampler(pipeline.analyser, pipeline.context.sampleRate);
    startWallAnchor = Date.now();
    songEpoch = performance.now();
    postWorker({ type: "reset" });
    perf.mainSampleMaxMs = 0; perf.mainSampleSumMs = 0; perf.mainSampleCount = 0;
    perf.longTasks = 0; perf.longTaskMaxMs = 0; perf.workerComputeMaxMs = 0;
    decisionJournal.length = 0;
    historyEl.innerHTML = "";
    startSampling();
    const s = pipeline.settings;
    micStateEl.textContent = `mic: RUNNING · ${s.label}`;
    logLine(`mic started: AGC=${s.autoGainControl} echo=${s.echoCancellation} NS=${s.noiseSuppression} rate=${s.sampleRate} (getSettings 實讀) · decision worker armed · anchor ${startWallAnchor}`);
    renderAgc();
  } catch (e) {
    micStateEl.textContent = `mic: ERROR — ${(e as Error).message}`;
    logLine(`mic FAILED: ${(e as Error).message}`, true);
    startBtn.disabled = false;
    return;
  }
  startBtn.textContent = "■ Stop";
  startBtn.disabled = false;
  startBtn.onclick = stopAudio;
}

function stopAudio() {
  if (diagAudioRec?.state === "recording") stopAudioDiag();
  if (pipeline) { stopMicPipeline(pipeline); pipeline = null; }
  semanticWorker?.postMessage({ type: "reset" });
  stopSampling();
  sampler = null;
  bands = { low: 0, mid: 0, high: 0 };
  viewport.setBands(bands);
  updateBandMeters();
  micStateEl.textContent = "mic: stopped（2 秒內歸零 contract）";
  renderAgc();
  startBtn.textContent = "▶ Start（開 mic 分析）";
  startBtn.onclick = startAudio;
  sysAudioBtn.disabled = false;
}
startBtn.onclick = startAudio;

/** M4.8: capture the system/Resolume audio feed directly (getDisplayMedia) instead of a mic. */
async function startSystemAudio() {
  if (pipeline) stopAudio();
  startBtn.disabled = true;
  sysAudioBtn.disabled = true;
  micStateEl.textContent = "audio: waiting…（彈窗揀「整個畫面」並剔選「同時分享系統音訊」）";
  try {
    pipeline = await startSystemAudioPipeline((samples) => {
      semanticWorker?.postMessage({ type: "pcm16k", tMs: songNow(), samples }, [samples.buffer]);
    }, () => stopAudio());
    sampler = new BandSampler(pipeline.analyser, pipeline.context.sampleRate);
    startWallAnchor = Date.now();
    songEpoch = performance.now();
    postWorker({ type: "reset" });
    perf.mainSampleMaxMs = 0; perf.mainSampleSumMs = 0; perf.mainSampleCount = 0;
    perf.longTasks = 0; perf.longTaskMaxMs = 0; perf.workerComputeMaxMs = 0;
    decisionJournal.length = 0;
    historyEl.innerHTML = "";
    startSampling();
    micStateEl.textContent = `audio: RUNNING [系統原音] · ${pipeline.settings.label}`;
    logLine(`system audio started: track=${pipeline.settings.label} rate=${pipeline.settings.sampleRate} (getSettings 實讀) · decision worker armed · anchor ${startWallAnchor}`);
    renderAgc();
  } catch (e) {
    micStateEl.textContent = `audio: ERROR — ${(e as Error).message}`;
    logLine(`system audio FAILED: ${(e as Error).message}`, true);
    renderAgc();
  } finally {
    startBtn.textContent = pipeline ? "■ Stop" : "▶ Start（開 mic 分析）";
    startBtn.disabled = false;
    startBtn.onclick = pipeline ? stopAudio : startAudio;
    sysAudioBtn.disabled = false;
  }
}
sysAudioBtn.onclick = () => { void startSystemAudio(); };

function updateBandMeters() {
  for (const k of ["low", "mid", "high"] as const) {
    const v = bands[k];
    (document.getElementById(`fill-${k}`) as HTMLElement).style.width = `${Math.min(100, v * 140).toFixed(1)}%`;
    (document.getElementById(`num-${k}`) as HTMLElement).textContent = v.toFixed(3);
  }
}

let sampleTimer: number | null = null;
function startSampling() {
  if (sampleTimer !== null) return;
  sampleTimer = window.setInterval(() => {
    if (!sampler) return;
    const c0 = performance.now();
    bands = sampler.sample(c0);
    viewport.setBands(bands);
    const tSong = c0 - (songEpoch ?? pageLoadPerf);
    const raw = sampler.lastRaw();
    postWorker({ type: "sample", tMs: tSong, bands, raw, chroma: sampler.lastChroma() });
    if (bandLog !== null) {
      bandLog.push([+tSong.toFixed(1), +bands.low.toFixed(4), +bands.mid.toFixed(4), +bands.high.toFixed(4),
        +raw.low.toFixed(4), +raw.mid.toFixed(4), +raw.high.toFixed(4)]);
      if (bandLog.length > 5000) bandLog.shift();
    }
    if (diagAudioRec?.state === "recording" && diagAudioBands.length < DIAG_MAX_BAND_SAMPLES) {
      diagAudioBands.push([+tSong.toFixed(1), +bands.low.toFixed(4), +bands.mid.toFixed(4), +bands.high.toFixed(4),
        +raw.low.toFixed(4), +raw.mid.toFixed(4), +raw.high.toFixed(4)]);
    }
    const dt = performance.now() - c0;
    if (dt > perf.mainSampleMaxMs) perf.mainSampleMaxMs = dt;
    perf.mainSampleSumMs += dt;
    perf.mainSampleCount++;
  }, 16);
}
function stopSampling() {
  if (sampleTimer !== null) { window.clearInterval(sampleTimer); sampleTimer = null; }
}

// ── Dev diag: raw mic capture + 16ms band/decision log for AI analysis ──────
const DIAG_BTN_IDLE_TEXT = "🎙 錄 5m 診斷音訊";

function setDiagAudioBtn(recording: boolean, remSec = 0): void {
  btnDiagAudio.classList.toggle("recording", recording);
  const remLabel = remSec >= 60 ? `${Math.floor(remSec / 60)}:${String(remSec % 60).padStart(2, "0")}` : `${remSec}s`;
  btnDiagAudio.textContent = recording ? `⏹ 停止診斷錄音 (${remLabel})` : DIAG_BTN_IDLE_TEXT;
}

function clearDiagAudioTimers(): void {
  if (diagAudioCountdown !== null) { window.clearInterval(diagAudioCountdown); diagAudioCountdown = null; }
  if (diagAudioTimer !== null) { window.clearTimeout(diagAudioTimer); diagAudioTimer = null; }
}

function downloadDiagAudio(blob: Blob): void {
  const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `flyvj-diag-${Date.now()}.${ext}`;
  a.click();
  URL.revokeObjectURL(a.href);
  diagStatusEl.textContent = `已本機下載診斷音檔（${Math.round(blob.size / 1024)} KB）— 非 dev server，改為保存到 Downloads`;
  logLine(`🎙 diag audio downloaded locally (${Math.round(blob.size / 1024)}KB) — dev diag off`);
}

function startAudioDiag(maxMs = DIAG_AUDIO_MAX_MS): boolean {
  if (diagAudioRec && diagAudioRec.state === "recording") { stopAudioDiag(); return true; }
  if (!pipeline?.stream) {
    diagStatusEl.textContent = "請先撳 ▶ Start 開 mic 再錄診斷音訊";
    return false;
  }
  if (typeof MediaRecorder === "undefined") {
    diagStatusEl.textContent = "此瀏覽器唔支援 MediaRecorder";
    return false;
  }
  const mime = chooseAudioMimeType((m: string) => MediaRecorder.isTypeSupported(m));
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(pipeline.stream, mime ? { mimeType: mime } : undefined);
  } catch (e) {
    diagStatusEl.textContent = `診斷錄音啟動失敗：${(e as Error).message}`;
    logLine(`diag audio recorder FAILED: ${(e as Error).message}`, true);
    return false;
  }
  const limitMs = Math.min(Math.max(1000, maxMs), DIAG_AUDIO_MAX_MS);
  const startWall = Date.now();
  const startSongMs = songNow();
  const chunks: Blob[] = [];
  const bandRows: number[][] = [];

  diagAudioRec = rec;
  diagAudioChunks = chunks;
  diagAudioBands = bandRows;
  diagAudioStartWall = startWall;
  diagAudioStartSongMs = startSongMs;

  rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) chunks.push(ev.data); };
  rec.onstop = () => {
    clearDiagAudioTimers();
    setDiagAudioBtn(false);
    const blob = new Blob(chunks, { type: mime || "audio/webm" });
    if (blob.size === 0) {
      diagStatusEl.textContent = "診斷錄音冇收到音訊（mic 未出聲？）";
      logLine("diag audio empty — no data captured", true);
      return;
    }
    const decisions = decisionJournal
      .filter((j) => j.wall >= startWall - 1000)
      .map((j) => ({
        wall: j.wall, tMs: +j.tMs.toFixed(1), kind: j.kind,
        cell: j.cell ? cellLabel(j.cell) : null,
        column: j.column, confidence: j.confidence, reason: j.reason,
        mode: j.mode, source: j.source,
      }));
    const meta: DiagAudioMeta = {
      startWall,
      endWall: Date.now(),
      startSongMs: +startSongMs.toFixed(1),
      endSongMs: +songNow().toFixed(1),
      mimeType: blob.type || "audio/webm",
      agc: pipeline?.settings ?? null,
      bandSampleCount: bandRows.length,
      bandSamples: bandRows,
      decisions,
      perf: { ...perf },
    };
    if (import.meta.env.DEV && diagEnabled) {
      const clipId = String(Date.now());
      void fetch(DIAG_ENDPOINTS.audio, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm", "X-Diag-Clip-Id": clipId },
        body: blob,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`audio HTTP ${res.status}`);
          const j = (await res.json().catch(() => ({}))) as { audioPath?: string; clipId?: string; bytes?: number };
          const metaRes = await fetch(DIAG_ENDPOINTS.audioMeta, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Diag-Clip-Id": clipId },
            body: JSON.stringify(meta),
          });
          if (!metaRes.ok) throw new Error(`meta HTTP ${metaRes.status}`);
          diagLastUpload = { audioPath: j.audioPath ?? DIAG_ENDPOINTS.audio, bytes: j.bytes ?? blob.size, wall: Date.now() };
          diagStatusEl.textContent = `✓ 診斷音檔已保存（${Math.round(blob.size / 1024)} KB）— 可叫 AI 聽聲分析`;
          logLine(`🎙 diag audio saved: ${diagLastUpload.audioPath} · ${Math.round(blob.size / 1024)}KB · ${bandRows.length} band rows · ${decisions.length} decisions`);
        })
        .catch((err) => {
          diagStatusEl.textContent = `診斷音檔上傳失敗：${(err as Error).message}`;
          logLine(`diag audio upload FAILED: ${(err as Error).message}`, true);
        });
    } else {
      downloadDiagAudio(blob);
    }
  };

  const tickCountdown = () => {
    const rem = Math.max(0, Math.ceil((limitMs - (Date.now() - startWall)) / 1000));
    setDiagAudioBtn(true, rem);
  };
  tickCountdown();
  diagAudioCountdown = window.setInterval(tickCountdown, 200);
  diagAudioTimer = window.setTimeout(() => stopAudioDiag(), limitMs);
  rec.start(500);
  const limitLabel = limitMs >= 60_000 ? `${Math.round(limitMs / 60_000)} 分鐘` : `${Math.round(limitMs / 1000)}s`;
  diagStatusEl.textContent = `診斷錄音中… 最多 ${limitLabel}（可隨時按停止提前上傳 · 同步記錄 16ms 頻段＋決策）`;
  logLine(`🎙 diag audio recording started (${mime || "default mime"} · max ${limitMs}ms)`);
  return true;
}

function stopAudioDiag(): void {
  clearDiagAudioTimers();
  const rec = diagAudioRec;
  if (rec && rec.state === "recording") {
    try { rec.stop(); } catch { /* noop */ }
  } else {
    setDiagAudioBtn(false);
  }
}

// ── M4 Decision worker + cockpit ────────────────────────────────────────────
const worker: Worker | null = new Worker(new URL("./src/decision.worker.ts", import.meta.url), { type: "module" });
function postWorker(msg: WorkerInMsg): void { worker?.postMessage(msg); }

// ── M4.7 C1 semantic sidecar (offline YAMNet WASM, 0 MB VRAM) ───────────────
type SemanticWorkerOutMsg =
  | { kind: "status"; status: "ready"; initMs: number }
  | { kind: "status"; status: "error"; error: string }
  | { kind: "semantic"; frame: SemanticFrame };

let yamnetStatus: "loading" | "ready" | "error" = "loading";
let yamnetError: string | null = null;
let lastSemantic: SemanticFrame | null = null;
let lastContent: ContentState | null = null;
let semanticWorker: Worker | null = null;

function renderC1Strip(): void {
  c1DotEl.className = yamnetStatus === "ready" ? "ready" : yamnetStatus === "error" ? "error" : "";
  if (yamnetStatus === "loading") {
    c1TextEl.textContent = "C1 語義: 載入 YAMNet WASM…";
  } else if (yamnetStatus === "error") {
    c1TextEl.textContent = `C1 語義: ERROR — ${yamnetError ?? "unknown"}`;
  } else {
    const sem = lastSemantic;
    const ms = sem ? `${sem.inferMs.toFixed(1)}ms` : "—";
    const music = sem ? sem.music.toFixed(2) : "—";
    const vocal = sem ? sem.vocalChant.toFixed(2) : "—";
    const harmony = lastContent ? lastContent.chromaNovelty.toFixed(2) : "—";
    const semanticNov = lastContent ? lastContent.yamnetNovelty.toFixed(2) : "—";
    let text = `C1 語義: YAMNet WASM (0 MB VRAM · ${ms}) · 和聲 ${harmony} · 語義 ${semanticNov} · Music ${music} · Vocal ${vocal}`;
    const tags: string[] = [];
    if (lastContent?.inBreakdown) tags.push("BREAKDOWN");
    if (lastContent?.hiHatActive) tags.push("HI-HAT");
    if (lastContent?.vocalActive) tags.push("VOCAL");
    if (lastContent) {
      // M4.8: effective RELATIVE density → motion tier, same thresholds as decision.ts
      // priorScores (≥6 ACTIVE / ≥2.5 MEDIUM / else STATIC).
      const effD = lastContent.effectiveDensity;
      const motionCol = effD >= 6 ? 3 : effD >= 2.5 ? 2 : 1;
      text += ` · effD ${effD.toFixed(1)}→C${motionCol}`;
    }
    text += tags.length ? ` · ${tags.join(" ")}` : "";
    c1TextEl.textContent = text;
  }
  if (lastContent && (lastContent.inBreakdown || lastContent.hiHatActive || lastContent.vocalActive) && yamnetStatus === "ready") {
    c1TagEl.textContent = [lastContent.inBreakdown ? "BREAKDOWN" : "", lastContent.hiHatActive ? "HI-HAT" : "", lastContent.vocalActive ? "VOCAL" : ""].filter(Boolean).join(" ");
    c1TagEl.className = "active";
  } else {
    c1TagEl.textContent = "";
    c1TagEl.className = "";
  }
}

function spawnSemanticWorker(): void {
  semanticWorker = new Worker(new URL("./src/semantic.worker.ts", import.meta.url), { type: "module" });
  semanticWorker.onmessage = (e: MessageEvent<SemanticWorkerOutMsg>) => {
    const m = e.data;
    if (m.kind === "status") {
      if (m.status === "ready") {
        yamnetStatus = "ready";
        yamnetError = null;
        logLine(`YAMNet WASM ready (0 MB VRAM · init ${m.initMs.toFixed(0)}ms)`);
      } else {
        yamnetStatus = "error";
        yamnetError = m.error;
        logLine(`YAMNet WASM init FAILED: ${m.error}`, true);
      }
      renderC1Strip();
      return;
    }
    if (m.kind === "semantic") {
      lastSemantic = m.frame;
      postWorker({ type: "semantic", frame: m.frame });
      renderC1Strip();
    }
  };
  semanticWorker.onerror = (e) => {
    yamnetStatus = "error";
    yamnetError = e.message;
    renderC1Strip();
  };
  semanticWorker.postMessage({ type: "init" });
}
spawnSemanticWorker();
let songEpoch: number | null = null;
const pageLoadPerf = performance.now();
function songNow(): number { return performance.now() - (songEpoch ?? pageLoadPerf); }

const perf = { mainSampleMaxMs: 0, mainSampleSumMs: 0, mainSampleCount: 0, longTasks: 0, longTaskMaxMs: 0, workerComputeMaxMs: 0 };
if ("PerformanceObserver" in window) {
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        perf.longTasks++;
        if (e.duration > perf.longTaskMaxMs) perf.longTaskMaxMs = e.duration;
      }
    });
    po.observe({ entryTypes: ["longtask"] });
  } catch { /* longtask unsupported */ }
}

// ── Dev diagnostics (Vite dev server only; static dist silently disables) ────
let diagEnabled = false;
let diagTickTimer: number | null = null;
let diagAudioRec: MediaRecorder | null = null;
let diagAudioChunks: Blob[] = [];
let diagAudioStartWall = 0;
let diagAudioStartSongMs = 0;
let diagAudioBands: number[][] = [];
let diagAudioTimer: number | null = null;
let diagAudioCountdown: number | null = null;
let diagLastUpload: { audioPath: string; bytes: number; wall: number } | null = null;
let latestLiveTopCand: { cell: string; prob: number } | null = null;

function sendDiagEvent(ev: DiagEvent): void {
  if (!import.meta.env.DEV || !diagEnabled) return;
  void fetch(DIAG_ENDPOINTS.telemetry, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ev),
  }).catch(() => undefined);
}

// interval-driven (not rAF) so background/occluded tabs keep streaming
function emitDiagTick(): void {
  // DiagTickEvent (diag.ts) predates the C1 layer; the telemetry sink accepts any JSON
  // object, so the extra `content` field rides along via a widening cast.
  const tick = {
    kind: "tick",
    wall: Date.now(),
    tMs: +songNow().toFixed(1),
    mode: masterMode,
    triggerMode,
    wsOpen: ws !== null && ws.readyState === WebSocket.OPEN,
    compName: composition?.name?.value ?? null,
    dims: { rows: arenaRows, cols: arenaCols },
    micRunning: pipeline !== null,
    agc: pipeline?.settings ?? null,
    ambient: sampler ? sampler.ambient() : null,
    bands: { ...bands },
    raw: sampler ? sampler.lastRaw() : null,
    detector: detectorState,
    content: lastContent,
    topCand: latestLiveTopCand,
    perf: { ...perf },
  };
  sendDiagEvent(tick as DiagEvent);
}

async function initDevDiag(): Promise<void> {
  if (!import.meta.env.DEV) return;
  try {
    const res = await fetch(DIAG_ENDPOINTS.status, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { devDiag?: boolean } | null;
    if (data?.devDiag !== true) throw new Error("devDiag off");
    diagEnabled = true;
    diagStatusEl.textContent = "Dev 監控：已連線（即時同步中）";
    logLine(`dev diag connected → ${DIAG_ENDPOINTS.telemetry} · tick 250ms`);
    if (diagTickTimer === null) diagTickTimer = window.setInterval(emitDiagTick, 250);
  } catch {
    diagEnabled = false;
    diagStatusEl.textContent = "Dev 監控：關閉（非 dev server）";
  }
}

let masterMode: MasterMode = "AUTO";
let triggerMode: TriggerMode = "clip";
let learnCount = 0;

interface HumanDemoEntry {
  wall: number; tMs: number; cell: string; row: number; col: number;
  bands: { low: number; mid: number; high: number };
  raw: { low: number; mid: number; high: number } | null;
  detector: { phase: string; bpm: number | null; density: number; novLow: number; regularity: number; buildupScore: number; signature: { low: number; mid: number; high: number } } | null;
}
const humanDemoLog: HumanDemoEntry[] = [];
try {
  const rawDemo = localStorage.getItem(DEMO_STORAGE_KEY);
  if (rawDemo) { const parsed = JSON.parse(rawDemo); if (Array.isArray(parsed)) humanDemoLog.push(...parsed); }
} catch { /* corrupt demo log */ }

// M4.6 Capture Bar state
let isRecording = false;
let captureCanRollback = false;
let captureTotal = 0;
let captureTrainableCount = 0;
let captureUnmappedCount = 0;
let captureTrainedCount = 0;
let captureSessionCache: CapturePair[] = [];

function recomputeCaptureCounts(session: CapturePair[]): void {
  captureSessionCache = session;
  captureTotal = session.length;
  let trainable = 0;
  let unmapped = 0;
  let trained = 0;
  for (const p of session) {
    if (p.trained) trained++;
    else if (!p.cell) unmapped++;
    else trainable++;
  }
  captureTrainableCount = trainable;
  captureUnmappedCount = unmapped;
  captureTrainedCount = trained;
}

function saveCaptureToStorage(session: CapturePair[]): void {
  try {
    if (session.length > 0) {
      localStorage.setItem(CAPTURE_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(CAPTURE_STORAGE_KEY);
    }
  } catch (err) {
    logLine(`capture persist FAILED: ${(err as Error).message}`, true);
  }
}

function renderCaptureBar(customStatus?: string): void {
  btnRec.textContent = isRecording ? "⏹ 停止錄製" : "⏺ 錄製表演";
  btnRec.classList.toggle("recording", isRecording);
  btnRollback.disabled = !captureCanRollback;
  if (customStatus) {
    recStatusEl.textContent = customStatus;
    return;
  }
  const prefix = isRecording ? "錄製中" : "未錄製";
  recStatusEl.textContent =
    `${prefix} · 已錄 ${captureTotal} 條（可訓練 ${captureTrainableCount} · 未綁定 ${captureUnmappedCount} · 已訓練 ${captureTrainedCount}）`;
}

function startCaptureRec(): boolean {
  isRecording = true;
  postWorker({ type: "setRecording", enabled: true });
  renderCaptureBar();
  logLine("⏺ 開始錄製表演（捕捉 Arena 外部換片＋cockpit override）");
  return isRecording;
}

function stopCaptureRec(): boolean {
  isRecording = false;
  postWorker({ type: "setRecording", enabled: false });
  renderCaptureBar();
  logLine("⏹ 停止錄製表演");
  return isRecording;
}

function trainCapture(): string {
  postWorker({ type: "trainCapture" });
  return "train-sent";
}

function rollbackCapture(): string {
  postWorker({ type: "rollbackTrain" });
  return "rollback-sent";
}

function clearCapture(): string {
  captureSessionCache = [];
  captureTotal = 0;
  captureTrainableCount = 0;
  captureUnmappedCount = 0;
  captureTrainedCount = 0;
  captureCanRollback = false;
  try { localStorage.removeItem(CAPTURE_STORAGE_KEY); } catch { /* noop */ }
  postWorker({ type: "clearCapture" });
  renderCaptureBar();
  logLine("🧹 已清空錄製紀錄");
  return "clear-sent";
}

function renderLearnBadge(): void {
  const badge = document.getElementById("learn-badge");
  if (badge) badge.textContent = `已學習: ${learnCount} 次`;
}

let detectorState: DetectorState | null = null;
let lastDecision: Decision | null = null;
const decisionJournal: { wall: number; tMs: number; kind: string; column: number | null; cell: GridCell | null; confidence: number; reason: string; mode: MasterMode; source: string }[] = [];
let bandLog: number[][] | null = null;
let startWallAnchor: number | null = null;

function confBucket(c: number): "HIGH" | "MED" | "LOW" {
  if (c >= 0.7) return "HIGH";
  if (c >= 0.4) return "MED";
  return "LOW";
}

function journal(d: Decision) {
  const wall = Date.now();
  decisionJournal.push({
    wall, tMs: d.tMs, kind: d.kind, column: d.column, cell: d.cell, confidence: +d.confidence.toFixed(3),
    reason: d.reason, mode: masterMode, source: d.source ?? "auto",
  });
  while (decisionJournal.length > 200) decisionJournal.shift();
  const el = document.createElement("div");
  el.className = d.kind === "trigger" ? "h-trig" : "h-hold";
  el.textContent = `[${new Date(wall).toLocaleTimeString()}] ${d.kind === "trigger" ? `TRIGGER L${d.layer}C${d.column}` : "HOLD"} · conf ${d.confidence.toFixed(2)} · ${d.reason}`;
  historyEl.prepend(el);
  while (historyEl.childElementCount > 40) historyEl.lastElementChild!.remove();
  sendDiagEvent({
    kind: "decision", wall, tMs: d.tMs, decisionKind: d.kind,
    cell: d.cell ? cellLabel(d.cell) : null,
    physical: d.layer && d.column ? { layer: d.layer, col: d.column } : null,
    confidence: +d.confidence.toFixed(3), reason: d.reason,
    source: d.source ?? "auto", mode: masterMode,
  });
}

function renderTicker(d: Decision) {
  lastDecision = d;
  tickerEl.className = d.kind === "trigger" ? "trigger" : "hold";
  tickerEl.textContent = d.kind === "trigger" ? `▶ L${d.layer}C${d.column} · ${d.reason}` : d.reason;
}

function cellIdxOf(cell: GridCell | null | undefined): number {
  return cell ? cellIdx(cell) : -1;
}

function renderCandidates(d: Decision) {
  if (!d.candidates || d.candidates.length === 0) return;
  paintProbs(d.candidates);
  if (d.kind === "trigger" && d.cell) {
    const topIdx = cellIdxOf(d.cell);
    for (let i = 0; i < 9; i++) document.getElementById(`cand-${i + 1}`)!.classList.toggle("top", i === topIdx);
  }
}

function paintProbs(cands: CellCandidate[]): void {
  if (!cands || cands.length === 0) return;
  const top = cands.reduce((a, b) => (b.prob > a.prob ? b : a), cands[0]);
  latestLiveTopCand = { cell: cellLabel(top.cell), prob: +top.prob.toFixed(3) };
  for (let i = 0; i < 9; i++) {
    const c = cands.find((x) => x.idx === i);
    if (!c) continue;
    const confEl = document.getElementById(`conf-${i + 1}`)!;
    const barEl = document.getElementById(`bar-${i + 1}`)!;
    confEl.innerHTML = `<span class="conf-chip conf-${confBucket(c.prob)}">${confBucket(c.prob)}</span> ${(c.prob * 100).toFixed(0)}%`;
    barEl.style.width = `${Math.min(100, c.prob * 100 * 3).toFixed(0)}%`;
  }
}

function renderMaster() {
  masterModeEl.textContent = masterMode;
  masterModeEl.className = masterMode;
  btnAuto.className = masterMode === "AUTO" ? "active-auto" : "";
  btnHold.className = masterMode === "HOLD" ? "active-hold" : "";
  btnTMode.textContent = triggerMode === "clip" ? "TRIGGER: CLIP（9 選 1）" : "TRIGGER: COLUMN（舊）";
}

function renderDetectorState(s: DetectorState) {
  detectorState = s;
  const phase = s.warm ? s.phase : "warmup";
  detStateEl.innerHTML =
    `detector: <span class="phase ${s.phase}">${phase}</span>` +
    ` · bpm ${s.bpm ? Math.round(s.bpm) : "—"}${s.tempoFrozen ? "❄" : ""} · dens ${s.density.toFixed(1)}/s` +
    ` · novLow ${s.novLow.toFixed(1)} · reg ${s.regularity.toFixed(2)} · bu ${s.buildupScore.toFixed(1)}/3` +
    ` · sig ${cellLabel(s.cell)}`;
}

type WorkerOutMsg =
  | { kind: "decision"; decision: Decision; triggerMode: TriggerMode }
  | { kind: "state"; state: DetectorState; mode: MasterMode; overrideCell: GridCell | null; overrideColumn: number | null; computeMaxMs: number; triggerMode: TriggerMode; learnCount: number; lastAutoCell: GridCell | null; liveCandidates?: CellCandidate[]; content?: ContentState }
  | { kind: "dropPulse"; tMs: number }
  | { kind: "weights"; weights: number[]; learnCount: number }
  | { kind: "weights-loaded"; ok: boolean; learnCount: number }
  | { kind: "capture-state"; recording: boolean; total: number; trainableCount: number; unmappedCount: number; trainedCount: number; canRollback: boolean; session: CapturePair[] }
  | { kind: "capture-warning"; reason: string }
  | { kind: "train-result"; result: BatchTrainResult; canRollback: boolean; session: CapturePair[] }
  | { kind: "train-rollback"; ok: boolean; session: CapturePair[] };

if (worker) {
  worker.onmessage = (e: MessageEvent<WorkerOutMsg>) => {
    const m = e.data;
    if (m.kind === "dropPulse") {
      viewport.fireDropPulse();
      return;
    }
    if (m.kind === "weights") {
      try {
        if (m.learnCount > 0) {
          localStorage.setItem(BRAIN_STORAGE_KEY, JSON.stringify({ weights: m.weights, learnCount: m.learnCount, updatedAt: Date.now() }));
        } else {
          localStorage.removeItem(BRAIN_STORAGE_KEY);
        }
      } catch (err) { logLine(`brain persist FAILED: ${(err as Error).message}`, true); }
      learnCount = m.learnCount;
      renderLearnBadge();
      return;
    }
    if (m.kind === "weights-loaded") {
      logLine(m.ok ? `果蠅腦記憶已載入（學咗 ${m.learnCount} 次）` : "腦記憶格式不符，用新腦開始");
      learnCount = m.learnCount;
      renderLearnBadge();
      return;
    }
    if (m.kind === "capture-state") {
      isRecording = m.recording;
      captureTotal = m.total;
      captureTrainableCount = m.trainableCount;
      captureUnmappedCount = m.unmappedCount;
      captureTrainedCount = m.trainedCount;
      captureCanRollback = m.canRollback;
      if (Array.isArray(m.session)) {
        captureSessionCache = m.session;
        saveCaptureToStorage(captureSessionCache);
      }
      renderCaptureBar();
      return;
    }
    if (m.kind === "capture-warning") {
      logLine(`錄製警告：${m.reason}`, true);
      return;
    }
    if (m.kind === "train-result") {
      captureCanRollback = m.canRollback;
      if (Array.isArray(m.session)) {
        recomputeCaptureCounts(m.session);
        saveCaptureToStorage(captureSessionCache);
      }
      const fitText = `訓練完成：已訓練 ${m.result.trainedCount} 條 · 覆核一致率 ${m.result.beforeMatchCount}→${m.result.afterMatchCount} / ${m.result.trainedCount}`;
      renderCaptureBar(fitText);
      tickerEl.className = "trigger";
      tickerEl.textContent = fitText;
      logLine(fitText);
      return;
    }
    if (m.kind === "train-rollback") {
      captureCanRollback = false;
      if (Array.isArray(m.session)) {
        recomputeCaptureCounts(m.session);
        saveCaptureToStorage(captureSessionCache);
      }
      renderCaptureBar();
      logLine(m.ok ? "↩ 已還原上一批訓練權重" : "↩ 無可還原的訓練紀錄", !m.ok);
      return;
    }
    if (m.kind === "state") {
      masterMode = m.mode;
      triggerMode = m.triggerMode;
      perf.workerComputeMaxMs = m.computeMaxMs;
      learnCount = m.learnCount;
      lastContent = m.content ?? null;
      renderMaster();
      renderDetectorState(m.state);
      renderC1Strip();
      if (m.liveCandidates) paintProbs(m.liveCandidates);
      return;
    }
    if (m.kind === "decision") {
      triggerMode = m.triggerMode;
      const d = m.decision;
      renderTicker(d);
      renderCandidates(d);
      journal(d);
      if (d.kind === "trigger" && d.cell) {
        fireDecision(d.cell, "auto");
      }
    }
  };
  worker.onerror = (e) => logLine(`decision worker error: ${e.message}`, true);
}

// Boot-time restore of persisted brain weights + capture session
try {
  const rawBrain = localStorage.getItem(BRAIN_STORAGE_KEY);
  if (rawBrain) {
    const saved = JSON.parse(rawBrain) as { weights: number[]; learnCount: number };
    if (Array.isArray(saved.weights)) postWorker({ type: "loadWeights", weights: saved.weights, learnCount: saved.learnCount ?? 0 });
  }
} catch { /* corrupt brain storage */ }

try {
  const rawCap = localStorage.getItem(CAPTURE_STORAGE_KEY);
  if (rawCap) {
    const pairs = sanitizeSession(JSON.parse(rawCap));
    if (pairs.length > 0) {
      recomputeCaptureCounts(pairs);
      postWorker({ type: "loadCapture", pairs });
    }
  }
} catch { /* corrupt capture storage */ }
renderCaptureBar();

// ── Semantic → Physical Dispatch & Triggering ───────────────────────────────
/**
 * M4.8 Auto-Pool input: layer → live non-empty Arena clip columns. Same predicate as
 * buildGridDom's "(no state)" placeholder test — a slot only counts when Arena reports a
 * real clip name for it, so auto-pooled triggers never land on empty slots.
 */
function nonEmptyColsByLayer(): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (!composition) return out;
  for (let r = 1; r <= arenaRows; r++) {
    const clips = composition.layers?.[r - 1]?.clips ?? [];
    const cols: number[] = [];
    for (let c = 1; c <= arenaCols; c++) {
      const name = clips[c - 1]?.name?.value?.trim() ?? "";
      if (name && name !== "(no state)") cols.push(c);
    }
    if (cols.length > 0) out.set(r, cols);
  }
  return out;
}

function fireDecision(cell: GridCell, source: "auto" | "override"): PhysicalClipRef | null {
  const slot = cellIdx(cell);
  const phys = resolveSemanticToPhysical(
    slot, mappingConfig, lastPhysicalBySlot,
    { rows: arenaRows, cols: arenaCols }, nonEmptyColsByLayer(),
  );
  if (!phys) {
    logLine(`${source} decision ${cellLabel(cell)} — no physical clip in ${arenaRows}×${arenaCols}`, true);
    return null;
  }
  lastPhysicalBySlot.set(slot, `${phys.layer}:${phys.col}`);

  if (triggerMode === "clip") {
    if (composition?.layers?.[phys.layer - 1]?.clips?.[phys.col - 1]) {
      triggerPhysicalClip(phys, source);
    } else {
      logLine(`${source} decision ${cellLabel(cell)} → L${phys.layer}C${phys.col} — Arena state offline; trigger skipped`, true);
    }
  } else {
    const col = composition?.columns?.[phys.col - 1];
    if (col) triggerColumn(col.id, phys.col, source);
    else logLine(`${source} decision col ${phys.col} — Arena not connected; trigger skipped`, true);
  }
  return phys;
}

function triggerPhysicalClip(phys: PhysicalClipRef, source: "auto" | "override" | "manual" = "manual"): void {
  externalDetector.markSelfFiredClip(phys.layer, phys.col, performance.now());
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    logLine(`cannot trigger clip L${phys.layer}C${phys.col} (${source}): socket not open`, true);
    return;
  }
  const toClear = layersToClearForTarget(phys.layer, arenaRows, mappingConfig);
  for (const r of toClear) {
    ws.send(JSON.stringify({ action: "trigger", parameter: layerClearPath(r) }));
  }
  ws.send(JSON.stringify({ action: "trigger", parameter: clipConnectPath(phys.layer, phys.col) }));
  sendDiagEvent({ kind: "arena-exec", wall: Date.now(), tMs: +songNow().toFixed(1), physical: phys, source, stage: "fired" });
  logLine(`TRIGGER clip L${phys.layer}C${phys.col} (${source}) · cleared layers [${toClear.join(",")}]`);
  watchdog.expectEcho();

  window.setTimeout(() => {
    void (async () => {
      try {
        const res = await fetch(`${restBase()}/composition`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as WsComposition;
        const target = j.layers?.[phys.layer - 1]?.clips?.[phys.col - 1];
        if (connectedValue(target?.connected?.value)) {
          sendDiagEvent({ kind: "arena-exec", wall: Date.now(), tMs: +songNow().toFixed(1), physical: phys, source, stage: "verified-latched" });
          return;
        }
        let hasOverlay = false;
        for (let r = 1; r <= arenaRows; r++) {
          if (getLayerRole(mappingConfig, r) === "overlay") { hasOverlay = true; break; }
        }
        if (hasOverlay) {
          logLine(`skip column fallback for L${phys.layer}C${phys.col} — overlay layer active (protecting overlay/audio)`);
          return;
        }
        if (composition && phys.col <= composition.columns.length) {
          const col = composition.columns[phys.col - 1];
          if (col && ws && ws.readyState === WebSocket.OPEN) {
            externalDetector.markSelfFiredColumn(phys.col, performance.now());
            ws.send(JSON.stringify({ action: "trigger", parameter: columnConnectPath(col.id) }));
            sendDiagEvent({ kind: "arena-exec", wall: Date.now(), tMs: +songNow().toFixed(1), physical: phys, source, stage: "verified-fallback" });
            logLine(`clip trigger L${phys.layer}C${phys.col} NOT latched → fallback column trigger col ${phys.col}`);
            watchdog.expectEcho();
          }
        }
      } catch { /* Arena offline */ }
    })();
  }, 900);
}

function recordDemoEntry(cell: GridCell, phys: PhysicalClipRef): void {
  humanDemoLog.push({
    wall: Date.now(),
    tMs: +songNow().toFixed(1),
    cell: cellLabel(cell),
    row: phys.layer,
    col: phys.col,
    bands: { ...bands },
    raw: sampler ? sampler.lastRaw() : null,
    detector: detectorState ? {
      phase: detectorState.phase,
      bpm: detectorState.bpm,
      density: +detectorState.density.toFixed(2),
      novLow: +detectorState.novLow.toFixed(2),
      regularity: +detectorState.regularity.toFixed(3),
      buildupScore: +detectorState.buildupScore.toFixed(2),
      signature: detectorState.signature,
    } : null,
  });
  try { localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(humanDemoLog.slice(-500))); }
  catch { /* demo log persistence is best-effort */ }
}

/** Semantic 3×3 candidate cell override (clicks on #cand-1..9 or m4.overrideCell). */
function userOverrideCell(cell: GridCell): number {
  const t0 = performance.now();
  masterMode = "OVERRIDE";
  renderMaster();
  const denied = lastDecision?.kind === "trigger" ? lastDecision.cell : null;
  const phys = fireDecision(cell, "override");
  const targetPhys: PhysicalClipRef = phys ?? { layer: cell.row, col: cell.col };
  postWorker({ type: "override", cell, physical: targetPhys, denied, tMs: songNow() });
  recordDemoEntry(cell, targetPhys);
  tickerEl.className = "trigger";
  tickerEl.textContent = `OVERRIDE → ${cellLabel(cell)} (L${targetPhys.layer}C${targetPhys.col})（自動決定讓位＋在線學習；撳 AUTO 還畀）`;
  journal({
    kind: "trigger", cell, layer: targetPhys.layer, column: targetPhys.col, candidates: [], confidence: 1,
    reason: `user override → ${cellLabel(cell)} (L${targetPhys.layer}C${targetPhys.col})`, event: null, tMs: songNow(), source: "override",
  });
  const elapsed = performance.now() - t0;
  logLine(`override → ${cellLabel(cell)} (L${targetPhys.layer}C${targetPhys.col}) in ${elapsed.toFixed(1)}ms`);
  return elapsed;
}

/** Physical M×N grid cell click (when Bind Mode is OFF). */
function overridePhysicalCell(phys: PhysicalClipRef): number {
  const t0 = performance.now();
  masterMode = "OVERRIDE";
  renderMaster();
  const denied = lastDecision?.kind === "trigger" ? lastDecision.cell : null;
  const mapped = physicalToSemantic(phys, mappingConfig);
  triggerPhysicalClip(phys, "override");
  if (mapped) {
    lastPhysicalBySlot.set(cellIdx(mapped.cell), `${phys.layer}:${phys.col}`);
    postWorker({
      type: "override",
      cell: mapped.cell,
      physical: { layer: phys.layer, col: phys.col },
      denied,
      tMs: songNow(),
    });
    recordDemoEntry(mapped.cell, phys);
    tickerEl.className = "trigger";
    tickerEl.textContent = `OVERRIDE → ${cellLabel(mapped.cell)} (L${phys.layer}C${phys.col})（自動決定讓位＋在線學習；撳 AUTO 還畀）`;
    journal({
      kind: "trigger", cell: mapped.cell, layer: phys.layer, column: phys.col, candidates: [], confidence: 1,
      reason: `physical override L${phys.layer}C${phys.col} → ${cellLabel(mapped.cell)}`, event: null, tMs: songNow(), source: "override",
    });
  } else {
    tickerEl.className = "trigger";
    tickerEl.textContent = `OVERRIDE → L${phys.layer}C${phys.col}（未綁定語義槽 · 僅觸發 Arena）`;
    journal({
      kind: "trigger", cell: null, layer: phys.layer, column: phys.col, candidates: [], confidence: 1,
      reason: `unmapped physical trigger L${phys.layer}C${phys.col}`, event: null, tMs: songNow(), source: "override",
    });
  }
  const elapsed = performance.now() - t0;
  logLine(`physical click L${phys.layer}C${phys.col} (${mapped ? cellLabel(mapped.cell) : "unmapped"}) in ${elapsed.toFixed(1)}ms`);
  return elapsed;
}

function userOverride(column: number): number {
  const row = dominantRow();
  return userOverrideCell({ row, col: Math.min(3, Math.max(1, column)) as 1 | 2 | 3 });
}

function dominantRow(): 1 | 2 | 3 {
  const { low, mid, high } = bands;
  if (mid >= low && mid >= high) return 2;
  if (high >= low && high >= mid) return 3;
  return 1;
}

for (let i = 1; i <= 9; i++) {
  document.getElementById(`cand-${i}`)!.onclick = () => {
    const cell: GridCell = { row: (Math.floor((i - 1) / 3) + 1) as 1 | 2 | 3, col: (((i - 1) % 3) + 1) as 1 | 2 | 3 };
    userOverrideCell(cell);
  };
}

btnTMode.onclick = () => {
  triggerMode = triggerMode === "clip" ? "column" : "clip";
  postWorker({ type: "setTriggerMode", mode: triggerMode });
  renderMaster();
  logLine(`trigger mode → ${triggerMode}`);
};
btnAuto.onclick = () => {
  masterMode = "AUTO";
  postWorker({ type: "auto", tMs: songNow() });
  renderMaster();
  tickerEl.className = "hold";
  tickerEl.textContent = "AUTO 已還畀 — 自動決定恢復";
  logLine("master → AUTO");
};
btnHold.onclick = () => {
  masterMode = "HOLD";
  postWorker({ type: "hold", tMs: songNow() });
  renderMaster();
  tickerEl.className = "hold";
  tickerEl.textContent = "HOLD — 決策凍結（panic freeze）";
  logLine("master → HOLD");
};
recalBtn.onclick = () => {
  if (!sampler) { logLine("recalibrate: no sampler (Start first)", true); return; }
  sampler.recalibrate();
  postWorker({ type: "reset" });
  semanticWorker?.postMessage({ type: "reset" });
  lastSemantic = null;
  renderC1Strip();
  logLine("ambient recalibration started (1.2s window)");
};

function performResetBrain(): void {
  postWorker({ type: "resetWeights" });
  try { localStorage.removeItem(BRAIN_STORAGE_KEY); } catch { /* noop */ }
  logLine("果蠅腦學習權重已重置（示範與錄製紀錄保留）");
}

btnExportBrain.onclick = () => {
  let weights: number[] = [];
  try {
    const saved = JSON.parse(localStorage.getItem(BRAIN_STORAGE_KEY) ?? "{}") as { weights?: number[]; learnCount?: number };
    weights = saved.weights ?? [];
  } catch { /* fresh brain */ }
  const dump = {
    exportedAt: new Date().toISOString(),
    weights,
    learnCount,
    humanDemoLog,
    mapping: mappingConfig,
    capturePairs: captureSessionCache,
  };
  const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `flyvj-brain-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  logLine(`匯出經驗：weights ${weights.length} 項 · 示範 ${humanDemoLog.length} 條 · 錄製 ${captureSessionCache.length} 條`);
};

btnResetBrain.onclick = () => {
  if (!window.confirm("確定清空果蠅腦所有學習權重？（示範與錄製紀錄會保留）")) return;
  performResetBrain();
};

btnSyncArena.onclick = () => {
  if (!window.confirm("確定要將 manifest.json 同步寫入 Arena？（會覆寫對應格位 clip 同改名）")) return;
  void syncManifestToArena();
};

btnBindMode.onclick = () => {
  bindMode = !bindMode;
  btnBindMode.textContent = bindMode ? "綁定語義槽：開" : "綁定語義槽：關";
  btnBindMode.classList.toggle("active-bind", bindMode);
  buildGridDom();
};

bindSlotSelect.onchange = () => {
  selectedBindSlot = Math.max(0, Math.min(8, Number(bindSlotSelect.value) || 0));
  if (bindMode) buildGridDom();
};

btnRec.onclick = () => {
  if (isRecording) stopCaptureRec();
  else startCaptureRec();
};
btnTrain.onclick = () => { trainCapture(); };
btnRollback.onclick = () => { rollbackCapture(); };
btnClearRec.onclick = () => { clearCapture(); };
btnDiagAudio.onclick = () => {
  if (diagAudioRec?.state === "recording") stopAudioDiag();
  else startAudioDiag();
};

// HUD loop (rAF)
let lastSampleT = performance.now();
function hudTick() {
  const now = performance.now();
  if (sampler) {
    updateBandMeters();
    const isSys = pipeline?.sourceKind === "system";
    if (sampler.isCalibrating()) {
      micStateEl.textContent = `${isSys ? "audio" : "mic"}: calibrating ambient noise floor (1.2s)…`;
    } else {
      const amb = sampler.ambient();
      const srcLabel = `${isSys ? "audio: RUNNING [系統原音]" : "mic: RUNNING"} · ${pipeline?.settings.label ?? ""}`;
      micStateEl.textContent = `${srcLabel} · ambient L${amb.low.toFixed(2)}/M${amb.mid.toFixed(2)}/H${amb.high.toFixed(2)}`;
    }
  }
  if (now - lastSampleT > 250) {
    lastSampleT = now;
    updateRendererInfo();
    const avg = perf.mainSampleCount ? perf.mainSampleSumMs / perf.mainSampleCount : 0;
    perfLineEl.textContent =
      `main-frame sample max ${perf.mainSampleMaxMs.toFixed(2)}ms · avg ${avg.toFixed(3)}ms (n=${perf.mainSampleCount})` +
      ` · worker compute max ${perf.workerComputeMaxMs.toFixed(2)}ms · longtasks ${perf.longTasks} (max ${perf.longTaskMaxMs.toFixed(0)}ms)`;
  }
  requestAnimationFrame(hudTick);
}
requestAnimationFrame(hudTick);

// ── Watchdog (M2, kept) ─────────────────────────────────────────────────────
const watchdog = new Watchdog({
  triggerEchoTimeoutMs: 2000,
  heartbeatMs: 30000,
  maxStrikes: 3,
  onRecover: (reason) => {
    logLine(`WATCHDOG strike: ${reason} → forcing reconnect+resubscribe`, true);
    setWatchdogBar(`strike — ${reason}`, true);
    forceReconnect();
  },
  onError: (reason) => {
    logLine(`WATCHDOG ERROR: ${reason}`, true);
    setWatchdogBar(`CHANNEL DEAD — ${reason} (recovery attempts continue)`, true);
    setStatus("bad", `CHANNEL DEAD — ${reason}. Auto-recovery continues.`);
  },
  onHeartbeat: () => {
    const col = composition?.columns?.[0];
    const pid = col?.connected?.id;
    if (ws && ws.readyState === WebSocket.OPEN && pid !== undefined) {
      ws.send(JSON.stringify({ action: "subscribe", parameter: paramByIdPath(pid) }));
    } else {
      watchdog.markLiveness("echo");
    }
  },
});

function forceReconnect() {
  if (!ws) return;
  closedByUs = false;
  try { ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.onopen = null; } catch { /* noop */ }
  try { ws.close(); } catch { /* noop */ }
  ws = null;
  composition = null;
  arenaRows = 3;
  arenaCols = 3;
  live.clear();
  paramIdToTarget.clear();
  externalDetector.reset();
  updateAttachBadge();
  buildGridDom();
  connect();
}

// ── Manifest (M2, kept) ─────────────────────────────────────────────────────
async function loadManifest(): Promise<Manifest | null> {
  try {
    const res = await fetch("/manifest.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseManifest(await res.json());
  } catch (e) {
    logLine(`manifest load/parse FAILED: ${(e as Error).message}`, true);
    setStatus("bad", `MANIFEST ERROR — ${(e as Error).message}`);
    return null;
  }
}

async function syncManifestToArena() {
  if (!manifest || !composition || syncInFlight) return;
  const ops = planSync(manifest, composition);
  if (ops.length === 0) { syncRounds = 0; logLine("manifest sync: Arena already matches (0 ops)"); updateAttachBadge(); return; }
  if (syncRounds >= SYNC_ROUNDS_MAX) {
    logLine(`manifest sync: giving up after ${SYNC_ROUNDS_MAX} rounds`, true);
    setStatus("bad", `MANIFEST SYNC FAILED — Arena did not converge after ${SYNC_ROUNDS_MAX} attempts.`);
    return;
  }
  syncRounds++;
  syncInFlight = true;
  updateAttachBadge();
  logLine(`manifest sync: ${ops.length} op(s) needed`);
  try {
    for (const op of ops) {
      if (op.kind === "open") {
        const res = await fetch(`${restBase()}/composition/layers/${op.layer}/clips/${op.column}/open`, {
          method: "POST", headers: { "Content-Type": "text/plain" }, body: op.source,
        });
        if (!res.ok) throw new Error(`open L${op.layer}C${op.column} → HTTP ${res.status}`);
        logLine(`sync: open L${op.layer}C${op.column} ← ${op.source}`);
      } else {
        const res = await fetch(`${restBase()}/composition/layers/${op.layer}/clips/${op.column}`, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: { value: op.name } }),
        });
        if (!res.ok) throw new Error(`rename L${op.layer}C${op.column} → HTTP ${res.status}`);
        logLine(`sync: rename L${op.layer}C${op.column} → "${op.name}"`);
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    logLine("manifest sync: ops done → reconnecting for fresh state");
    syncInFlight = false;
    updateAttachBadge();
    forceReconnect();
  } catch (e) {
    logLine(`manifest sync FAILED: ${(e as Error).message}`, true);
    syncInFlight = false;
    updateAttachBadge();
  }
}

// ── Dynamic M×N Grid DOM + Zero-Rebuild Live Updates ────────────────────────
function columnConnected(col: WsColumn): boolean {
  const pid = col.connected?.id;
  const v = (pid !== undefined && live.has(pid)) ? live.get(pid) : col.connected?.value;
  return connectedValue(v);
}

function clipConnected(layer: WsLayer, colIdx: number): boolean {
  const clip = (layer.clips ?? [])[colIdx];
  const pid = clip?.connected?.id;
  const v = (pid !== undefined && live.has(pid)) ? live.get(pid) : clip?.connected?.value;
  return connectedValue(v);
}

function slotShortLabel(slotIdx: number): string {
  const c = idxCell(slotIdx);
  return `L${c.row}·${MOTIONS[c.col - 1][0]}`;
}

function roleShortLabel(role: LayerRole): string {
  if (role === "exclusive") return "EXCL";
  if (role === "overlay") return "OVLY";
  return "IGN";
}

function mkHead(text: string): HTMLElement {
  const d = document.createElement("div");
  d.className = "head";
  d.textContent = text;
  d.title = text;
  return d;
}

function scheduleLiveGridUpdate(): void {
  if (liveRenderQueued) return;
  liveRenderQueued = true;
  requestAnimationFrame(() => {
    liveRenderQueued = false;
    updateGridLiveState();
  });
}

function updateGridLiveState(): void {
  if (!composition) {
    for (const el of clipCellEls.values()) {
      el.classList.remove("connected", "col-on");
    }
    return;
  }
  for (let c = 1; c <= arenaCols; c++) {
    const col = composition.columns[c - 1];
    const colOn = !!col && columnConnected(col);
    const els = colCellEls.get(c);
    if (els) {
      for (const el of els) el.classList.toggle("col-on", colOn);
    }
  }
  for (let r = 1; r <= arenaRows; r++) {
    const layer = composition.layers[r - 1];
    for (let c = 1; c <= arenaCols; c++) {
      const el = clipCellEls.get(`${r}:${c}`);
      if (!el) continue;
      const liveOn = !!layer && clipConnected(layer, c - 1);
      el.classList.toggle("connected", liveOn);
    }
  }
}

function buildGridDom(): void {
  gridEl.innerHTML = "";
  clipCellEls.clear();
  colCellEls.clear();
  gridEl.style.setProperty("--arena-cols", String(arenaCols));

  gridEl.appendChild(mkHead(`L${arenaRows}..1 × C${arenaCols}`));
  for (let c = 1; c <= arenaCols; c++) {
    const col = composition?.columns?.[c - 1];
    const colName = col?.name?.value?.trim() || (c <= MOTIONS.length ? MOTIONS[c - 1] : `C${c}`);
    gridEl.appendChild(mkHead(colName));
    colCellEls.set(c, []);
  }

  // Stack top-down (r = arenaRows down to 1, matching Resolume's layer visual order)
  for (let r = arenaRows; r >= 1; r--) {
    const layer = composition?.layers?.[r - 1];
    const layerName = layer?.name?.value?.trim() || (r <= ENERGIES.length ? `${ENERGIES[r - 1]} (L${r})` : `L${r}`);
    const role = getLayerRole(mappingConfig, r);

    const rowHead = document.createElement("div");
    rowHead.className = "row-head";
    const nameSpan = document.createElement("span");
    nameSpan.className = "layer-name";
    nameSpan.textContent = layerName;
    nameSpan.title = `${layerName} (Layer ${r})`;
    const roleBtn = document.createElement("button");
    roleBtn.type = "button";
    roleBtn.className = `role-pill role-${role}`;
    roleBtn.textContent = roleShortLabel(role);
    roleBtn.title = `Layer ${r} role: ${role}（點擊切換 EXCL / OVLY / IGN）`;
    roleBtn.onclick = (e) => {
      e.stopPropagation();
      const nextRole = cycleLayerRole(getLayerRole(mappingConfig, r));
      mappingConfig = {
        ...mappingConfig,
        layerRoles: { ...mappingConfig.layerRoles, [r]: nextRole },
      };
      saveMappingToStorage(mappingConfig);
      logLine(`Layer ${r} role → ${nextRole}`);
      buildGridDom();
    };
    rowHead.appendChild(nameSpan);
    rowHead.appendChild(roleBtn);
    gridEl.appendChild(rowHead);

    for (let c = 1; c <= arenaCols; c++) {
      const phys: PhysicalClipRef = { layer: r, col: c };
      const mClip = manifestClipAt(manifest, r, c);
      const arenaName = layer?.clips?.[c - 1]?.name?.value ?? "(no state)";
      const nameMismatch = mClip && arenaName !== mClip.name && arenaName !== "(no state)";
      const explicitSlots = slotsForPhysical(mappingConfig, phys);
      const isSelectedTarget = bindMode && explicitSlots.includes(selectedBindSlot);

      const cellEl = document.createElement("div");
      cellEl.className = "cell" + (isSelectedTarget ? " bind-target" : "");
      cellEl.dataset.layer = String(r);
      cellEl.dataset.col = String(c);

      const primaryName = mClip?.name ?? (arenaName !== "(no state)" ? arenaName : `L${r}C${c}`);
      const subName = mClip ? `arena: ${arenaName}${nameMismatch ? " ⚠" : ""}` : `L${r}C${c}`;

      const nameEl = document.createElement("span");
      nameEl.className = "cell-name";
      nameEl.textContent = primaryName;
      const dimEl = document.createElement("span");
      dimEl.className = "dim";
      dimEl.textContent = subName;
      cellEl.appendChild(nameEl);
      cellEl.appendChild(dimEl);

      const badgesWrap = document.createElement("div");
      badgesWrap.className = "slot-badges";
      if (explicitSlots.length > 0) {
        for (const s of explicitSlots) {
          const b = document.createElement("span");
          b.className = "slot-badge";
          b.textContent = slotShortLabel(s);
          badgesWrap.appendChild(b);
        }
      } else {
        const implicit = physicalToSemantic(phys, mappingConfig);
        if (implicit) {
          const b = document.createElement("span");
          b.className = "slot-badge implicit";
          b.textContent = `~${slotShortLabel(cellIdx(implicit.cell))}`;
          badgesWrap.appendChild(b);
        }
      }
      if (badgesWrap.childElementCount > 0) cellEl.appendChild(badgesWrap);

      cellEl.title = mClip
        ? `L${r}×C${c} · ${mClip.source}`
        : `L${r}×C${c} (${arenaName})`;

      cellEl.onclick = () => {
        if (bindMode) {
          mappingConfig = toggleSlotBinding(mappingConfig, selectedBindSlot, phys);
          saveMappingToStorage(mappingConfig);
          logLine(`綁定 ${slotShortLabel(selectedBindSlot)} ↔ L${r}C${c}`);
          buildGridDom();
          return;
        }
        overridePhysicalCell(phys);
      };

      clipCellEls.set(`${r}:${c}`, cellEl);
      colCellEls.get(c)!.push(cellEl);
      gridEl.appendChild(cellEl);
    }
  }

  updateGridLiveState();
}

function triggerColumn(colId: number, n: number, source: "manual" | "auto" | "override" = "manual") {
  externalDetector.markSelfFiredColumn(n, performance.now());
  if (!ws || ws.readyState !== WebSocket.OPEN) { logLine(`cannot trigger col ${n} (${source}): socket not open`, true); return; }
  ws.send(JSON.stringify({ action: "trigger", parameter: columnConnectPath(colId) }));
  logLine(`TRIGGER column ${n} (${source})`);
  watchdog.expectEcho();
}

function subscribeAll(comp: WsComposition) {
  paramIdToTarget.clear();
  const ids: number[] = [];
  for (let c = 0; c < comp.columns.length; c++) {
    const col = comp.columns[c];
    const pid = col.connected?.id;
    if (pid !== undefined) {
      paramIdToTarget.set(pid, { kind: "column", col: c + 1 });
      ids.push(pid);
    }
  }
  for (let r = 0; r < comp.layers.length; r++) {
    const clips = comp.layers[r].clips ?? [];
    for (let c = 0; c < clips.length; c++) {
      const clip = clips[c];
      const pid = clip.connected?.id;
      if (pid !== undefined) {
        paramIdToTarget.set(pid, { kind: "clip", layer: r + 1, col: c + 1 });
        externalDetector.hydrate(pid, connectedValue(clip.connected?.value));
        ids.push(pid);
      }
    }
  }
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  for (const id of ids) ws.send(JSON.stringify({ action: "subscribe", parameter: paramByIdPath(id) }));
  logLine(`subscribed ${ids.length} params (${comp.columns.length} cols + ${comp.layers.length} layers)`);
}

function handleParamMessage(m: WsParamMsg): { external: boolean; risingEdge: boolean } {
  live.set(m.id, m.value);
  if (m.type === "parameter_update") { watchdog.markLiveness("push"); }
  else { watchdog.markLiveness("echo"); }

  let detectResult = { external: false, risingEdge: false };
  if (m.type === "parameter_subscribed") {
    externalDetector.hydrate(m.id, connectedValue(m.value));
  } else if (m.type === "parameter_update") {
    const target = paramIdToTarget.get(m.id);
    if (target && target.kind === "clip") {
      detectResult = externalDetector.onClipParamUpdate(
        m.id, target.layer, target.col, connectedValue(m.value), performance.now(),
      );
      if (detectResult.external) {
        logLine(`偵測到 Arena 外部換片 L${target.layer}C${target.col}`);
        if (isRecording) {
          const mapped = physicalToSemantic({ layer: target.layer, col: target.col }, mappingConfig);
          postWorker({
            type: "captureExternal",
            physical: { layer: target.layer, col: target.col },
            semanticCell: mapped?.cell ?? null,
            tMs: songNow(),
            wall: Date.now(),
          });
        }
      }
    }
  }

  scheduleLiveGridUpdate();
  return detectResult;
}

// ── WS lifecycle (M2, kept + Safe Attach) ───────────────────────────────────
function connect() {
  setStatus("wait", retryCount === 0 ? "connecting…" : `reconnecting (attempt ${retryCount + 1})…`);
  watchdog.stop();
  ws = new WebSocket(wsUrl());

  ws.onopen = () => {
    retryCount = 0;
    logLine(`WS open ${wsUrl()}`);
    setStatus("wait", "CONNECTED — waiting for composition state…");
  };

  ws.onmessage = (e) => {
    let m: unknown;
    try { m = JSON.parse(e.data as string); } catch { return; }
    if (isParamMsg(m)) {
      handleParamMessage(m);
      return;
    }
    if (isComposition(m)) {
      composition = m;
      arenaRows = m.layers.length || 3;
      arenaCols = m.columns.length || 3;
      mappingConfig = ensureLayerRoles(mappingConfig, arenaRows);
      saveMappingToStorage(mappingConfig);
      watchdog.markLiveness("state");
      logLine(`STATE: comp="${m.name?.value ?? "?"}" layers=${m.layers.length} columns=${m.columns.length}`);
      subscribeAll(m);
      watchdog.start();
      setWatchdogBar(`armed (echo 2s / heartbeat 30s / strikes ${watchdog.getState().strikes})`);
      setStatus("ok", `CONNECTED — comp "${m.name?.value}" ${m.layers.length}L×${m.columns.length}C`);
      updateAttachBadge();
      buildGridDom();
      return;
    }
  };

  ws.onerror = () => logLine(`WS error — Arena running with webserver enabled on ${HOST}:${wsPort}?`, true);

  ws.onclose = (e) => {
    logLine(`WS close code=${e.code} reason="${e.reason}"`);
    watchdog.stop();
    composition = null;
    arenaRows = 3;
    arenaCols = 3;
    live.clear();
    paramIdToTarget.clear();
    externalDetector.reset();
    updateAttachBadge();
    buildGridDom();
    if (closedByUs) return;
    setStatus("bad", `CONNECTION FAILED — Arena webserver not reachable at ${wsUrl()}. Auto-retrying…`);
    setWatchdogBar("stopped (socket closed)", true);
    retryCount++;
    setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(retryCount, 5)));
  };
}

// ── Test helpers for deterministic QC without Arena ─────────────────────────
function setMockCompositionForTest(rows: number, cols: number): { rows: number; cols: number; paramCount: number } {
  const safeRows = Math.max(1, Math.floor(rows));
  const safeCols = Math.max(1, Math.floor(cols));
  const columns: WsColumn[] = [];
  for (let c = 1; c <= safeCols; c++) {
    columns.push({
      id: 1000 + c,
      name: { value: c <= MOTIONS.length ? MOTIONS[c - 1] : `Col ${c}` },
      connected: { id: 2000 + c, value: "Disconnected" },
    });
  }
  const layers: WsLayer[] = [];
  for (let r = 1; r <= safeRows; r++) {
    const clips = [];
    for (let c = 1; c <= safeCols; c++) {
      clips.push({
        id: 10000 + r * 100 + c,
        name: { value: `Mock L${r}C${c}` },
        connected: { id: 20000 + r * 100 + c, value: "Disconnected" },
      });
    }
    layers.push({
      id: 3000 + r,
      name: { value: r <= ENERGIES.length ? ENERGIES[r - 1] : `Layer ${r}` },
      clips,
    });
  }
  const mockComp: WsComposition = {
    name: { value: `Mock ${safeRows}×${safeCols}` },
    layers,
    columns,
  };
  composition = mockComp;
  arenaRows = safeRows;
  arenaCols = safeCols;
  live.clear();
  externalDetector.reset();
  mappingConfig = ensureLayerRoles(mappingConfig, arenaRows);
  saveMappingToStorage(mappingConfig);
  subscribeAll(mockComp);
  updateAttachBadge();
  buildGridDom();
  setStatus("ok", `MOCK — comp "${mockComp.name?.value}" ${safeRows}L×${safeCols}C`);
  return { rows: arenaRows, cols: arenaCols, paramCount: paramIdToTarget.size };
}

function simulateExternalLaunch(layer: number, col: number): { ok: boolean; external?: boolean; risingEdge?: boolean; id?: number; reason?: string } {
  const clip = composition?.layers?.[layer - 1]?.clips?.[col - 1];
  const pid = clip?.connected?.id;
  if (pid === undefined) return { ok: false, reason: "no-clip-param" };
  const res = handleParamMessage({ type: "parameter_update", id: pid, value: "Connected" });
  return { ok: true, id: pid, ...res };
}

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot() {
  if (import.meta.env.DEV) {
    void initDevDiag();
  } else {
    diagStatusEl.textContent = "Dev 監控：關閉（正式版）";
  }
  manifest = await loadManifest();
  if (manifest && !PORT_OVERRIDE && manifest.arenaPort) wsPort = String(manifest.arenaPort);
  updateAttachBadge();
  buildGridDom();
  connect();
}

(window as unknown as Record<string, unknown>).__flyvj = {
  boot, triggerColumn, forceReconnect, lastPhysicalBySlot,
  simulateDrop: () => { closedByUs = false; watchdog.stop(); try { ws?.close(); } catch { /* noop */ } },
  getState: () => ({ composition: !!composition, manifest, live: [...live], watchdog: watchdog.getState() }),
  close: () => { closedByUs = true; watchdog.stop(); ws?.close(); },
  diag: {
    isEnabled: () => diagEnabled,
    startAudioDiag,
    stopAudioDiag,
    getState: () => ({
      diagEnabled,
      recording: diagAudioRec?.state === "recording",
      samples: diagAudioBands.length,
      lastUpload: diagLastUpload,
    }),
  },
  m3: {
    startAudio, stopAudio,
    getBands: () => ({ ...bands }),
    getAmbient: () => (sampler ? sampler.ambient() : null),
    isCalibrating: () => (sampler ? sampler.isCalibrating() : null),
    getRawBands: () => {
      if (!pipeline) return null;
      const buf = new Uint8Array(pipeline.analyser.frequencyBinCount);
      pipeline.analyser.getByteFrequencyData(buf as Uint8Array<ArrayBuffer>);
      return bandEnergiesRaw(buf, pipeline.context.sampleRate, FFT_SIZE);
    },
    micSettings: () => (pipeline ? pipeline.settings : null),
    rendererState: () => viewport.getState(),
    canvasBacking: () => ({ w: canvasEl.width, h: canvasEl.height }),
    setBandsForTest: (b: { low: number; mid: number; high: number }) => { bands = b; viewport.setBands(b); updateBandMeters(); },
    disposeViewport: () => viewport.dispose(),
    loseContextForTest: () => {
      const gl = canvasEl.getContext("webgl2") ?? canvasEl.getContext("webgl");
      const ext = gl?.getExtension("WEBGL_lose_context");
      if (!ext) return "NO_EXT";
      ext.loseContext();
      setTimeout(() => ext.restoreContext(), 800);
      return "LOST";
    },
  },
  m4: {
    getAnchor: () => startWallAnchor,
    getJournal: () => decisionJournal.map((j) => ({ ...j })),
    getDecision: () => ({ decision: lastDecision, state: detectorState, mode: masterMode }),
    override: (column: number) => userOverride(column),
    overrideCell: (cell: GridCell) => userOverrideCell(cell),
    handBack: () => { btnAuto.click(); return masterMode; },
    hold: () => { btnHold.click(); return masterMode; },
    getMode: () => masterMode,
    getTriggerMode: () => triggerMode,
    setTriggerMode: (_mode: TriggerMode) => { btnTMode.click(); return triggerMode; },
    getLearnCount: () => learnCount,
    recalibrate: () => { recalBtn.click(); return sampler ? sampler.isCalibrating() : null; },
    getPerf: () => ({ ...perf }),
    getDropPulse: () => viewport.getDropPulse(),
    feedBands: (tMs: number, b: { low: number; mid: number; high: number }) => {
      postWorker({ type: "sample", tMs, bands: b });
    },
    resetDetector: () => { postWorker({ type: "reset" }); decisionJournal.length = 0; },
    wsOpen: () => ws !== null && ws.readyState === WebSocket.OPEN,
    startBandLog: () => { bandLog = []; return "recording"; },
    stopBandLog: () => { const out = bandLog; bandLog = null; return out; },
    bandLogLen: () => (bandLog ? bandLog.length : -1),
    getHumanDemoLog: () => humanDemoLog.map((h) => ({ ...h })),
    exportBrain: () => { btnExportBrain.click(); return { learnCount, demos: humanDemoLog.length }; },
    resetBrain: () => { performResetBrain(); return "reset-sent"; },
    getBrainStorage: () => localStorage.getItem(BRAIN_STORAGE_KEY)?.length ?? 0,
  },
  c1: {
    status: () => yamnetStatus,
    error: () => yamnetError,
    lastSemantic: () => lastSemantic,
    lastContent: () => lastContent,
  },
  m46: {
    startRec: startCaptureRec,
    stopRec: stopCaptureRec,
    train: trainCapture,
    rollback: rollbackCapture,
    clearRec: clearCapture,
    getCaptureState: () => ({
      recording: isRecording,
      total: captureTotal,
      trainableCount: captureTrainableCount,
      unmappedCount: captureUnmappedCount,
      trainedCount: captureTrainedCount,
      canRollback: captureCanRollback,
      session: captureSessionCache.map((p) => ({ ...p })),
    }),
    getMapping: () => JSON.parse(JSON.stringify(mappingConfig)) as MappingConfig,
    setLayerRole: (layer: number, role: LayerRole) => {
      mappingConfig = {
        ...mappingConfig,
        layerRoles: { ...mappingConfig.layerRoles, [layer]: role },
      };
      saveMappingToStorage(mappingConfig);
      buildGridDom();
      return getLayerRole(mappingConfig, layer);
    },
    toggleSlotBinding: (slotIdx: number, phys: PhysicalClipRef) => {
      mappingConfig = toggleSlotBinding(mappingConfig, slotIdx, phys);
      saveMappingToStorage(mappingConfig);
      buildGridDom();
      return slotsForPhysical(mappingConfig, phys);
    },
    simulateExternalLaunch,
    setMockCompositionForTest,
    syncManifestToArena,
  },
};

void boot();

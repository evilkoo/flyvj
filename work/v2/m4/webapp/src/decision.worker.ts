// M4.5.1 decision worker — ALL structure detection + fly-brain decision math runs HERE, off
// the main frame (contract (d): zero sidecar, main frame never BLOCKed). The main thread
// posts gated band samples (~16ms cadence, BandSampler — M3 contract: gate 後嘅 bands) plus
// raw bands (onset envelope source, M4 finding); this worker runs StructureDetector, builds
// the 14-dim feature vector, projects it through the Mushroom Body (fixed random
// projection → top-5% k-WTA), and turns drop/section events into nine-grid Decisions.
// Messages out:
//   { kind:"decision", decision, triggerMode } — trigger/hold + 9 candidates + confidence
//   { kind:"state", state, …, liveCandidates }  — detector state + master mode + live 9-grid
//   { kind:"dropPulse", tMs }                   — avatar full-body pulse (M3 預留位)
//   { kind:"weights", weights, learnCount }     — MB weight export (main → localStorage)
//   { kind:"capture-state", …, session }        — M4.6 REC/session bookkeeping
//   { kind:"capture-warning" | "train-result" | "train-rollback" } — M4.6 capture feedback
// Messages in: sample / semantic{frame} / override{cell,denied} / handback / hold / auto /
//   reset / setTriggerMode / loadWeights / resetWeights / setRecording / captureExternal /
//   trainCapture / rollbackTrain / clearCapture / loadCapture.
// Pure modules only (detector.ts / decision.ts) so the same math is unit-tested in node.

import { StructureDetector, type DetectorState, type GridCell, type StructureEvent } from "./detector.ts";
import {
  decideOnEvent, MasterSwitch, MushroomBody, rebalanceBands, BAND_REF_FLOOR, GRID_FLOOR_BALANCED,
  type CellCandidate, type Decision, type TriggerMode,
} from "./decision.ts";
import { ContentAnalyzer, type SemanticFrame } from "./content.ts";
import {
  argmaxCellFromTrace, batchTrainMB, sanitizeSession, windowedTrace,
  type CapturePair, type TracePoint,
} from "./capture.ts";
import type { BandEnergy } from "./dsp.ts";

const detector = new StructureDetector();
const master = new MasterSwitch();
const mb = new MushroomBody();
const content = new ContentAnalyzer();

let triggerMode: TriggerMode = "clip";   // M4.5 default: precision 9-choose-1 clip trigger
let lastAutoCell: GridCell | null = null; // anti-repeat bag
let lastHadRaw = false;                   // M4.8: effectiveDensity needs raw bands
let lastStatePost = -1e9;
let lastSampleT = 0;
let computeMaxMs = 0;   // contract (d) evidence: worst per-sample compute time IN THE WORKER
let lastX: number[] | null = null;        // last real feature vector (override-time learning)
let lastKC: Float64Array | null = null;   // its sparse code
let prevSig: BandEnergy | null = null;
let slopeLow = 0, slopeHigh = 0;

// M4.6 performance capture: rolling trace of per-sample snapshots (~2s at 16ms cadence) so
// an external Arena launch / cockpit override can be attributed to the salient audio
// moment even when the message and the audio frame are slightly offset.
const TRACE_RING_MAX = 120;
let traceRing: TracePoint[] = [];

// M4.6 capture session state. Cockpit overrides recorded while REC is on are pushed with
// trained:true (their mb.learn already ran live) so trainCapture never double-trains them.
let recording = false;
let captureSession: CapturePair[] = [];
let preTrainSnapshot: { weights: number[]; learnCount: number } | null = null;
let lastTrainedIndices: number[] = [];

// M4.5.1: slow running absolute-band reference (tau 15s) for rebalanceBands — tracks the
// room/mic spectral tilt so MID/HIGH rows can win when they rise ABOVE their own history.
let bandRef: BandEnergy = { ...BAND_REF_FLOOR };
let lastRefT = 0;

interface SampleMsg { type: "sample"; tMs: number; bands: BandEnergy; raw?: BandEnergy; chroma?: number[]; }
interface SemanticMsg { type: "semantic"; frame: SemanticFrame; }
interface OverrideMsg {
  type: "override"; cell: GridCell; tMs: number; denied?: GridCell | null;
  physical?: { layer: number; col: number };
}
interface HandBackMsg { type: "handback"; tMs: number; }
interface HoldMsg { type: "hold"; tMs: number; }
interface AutoMsg { type: "auto"; tMs: number; }
interface ResetMsg { type: "reset"; }
interface ModeMsg { type: "setTriggerMode"; mode: TriggerMode; }
interface LoadWeightsMsg { type: "loadWeights"; weights: number[]; learnCount: number; }
interface ResetWeightsMsg { type: "resetWeights"; }
interface SetRecordingMsg { type: "setRecording"; enabled: boolean; }
interface CaptureExternalMsg {
  type: "captureExternal";
  physical: { layer: number; col: number };
  semanticCell: GridCell | null;
  tMs: number;
  wall: number;
}
interface TrainCaptureMsg { type: "trainCapture"; }
interface RollbackTrainMsg { type: "rollbackTrain"; }
interface ClearCaptureMsg { type: "clearCapture"; }
interface LoadCaptureMsg { type: "loadCapture"; pairs: CapturePair[]; }
type InMsg = SampleMsg | SemanticMsg | OverrideMsg | HandBackMsg | HoldMsg | AutoMsg | ResetMsg | ModeMsg
  | LoadWeightsMsg | ResetWeightsMsg | SetRecordingMsg | CaptureExternalMsg
  | TrainCaptureMsg | RollbackTrainMsg | ClearCaptureMsg | LoadCaptureMsg;

// Erasable pure type export — main.ts routes every postMessage through this so tsc
// catches message-shape drift at compile time. Zero runtime footprint.
export type WorkerInMsg = InMsg;

const w = self as unknown as Worker;

function postDecision(d: Decision): void {
  w.postMessage({ kind: "decision", decision: d, triggerMode });
}
/** Shared C1 → decision dispatch: same band floor + master suppression as baseline events;
 *  cellBias steers the prior toward the cue's signature motion tier. */
function dispatchCue(
  ev: StructureEvent, liveBalanced: BandEnergy, density: number, tMs: number, cellBias?: readonly number[],
): void {
  const decision = decideOnEvent(
    ev, liveBalanced, density,
    { lastAutoCell, kc: lastKC, mb, bandFloor: GRID_FLOOR_BALANCED, cellBias }, tMs, "auto",
  );
  if (decision.kind === "trigger" && !master.allowsAuto()) {
    postDecision({ ...decision, kind: "hold", cell: null, layer: null, column: null, reason: `SUPPRESSED (${master.getMode()}) — would be ${decision.reason}` });
  } else {
    if (decision.kind === "trigger") {
      lastAutoCell = decision.cell;
      content.noteAutoTrigger(tMs, ev.type === "drop");
    }
    postDecision(decision);
  }
}
function postWeights(): void {
  w.postMessage({ kind: "weights", ...mb.exportWeights() });
}
function postCaptureState(): void {
  let trainableCount = 0, unmappedCount = 0, trainedCount = 0;
  for (const p of captureSession) {
    if (p.trained) trainedCount++;
    else if (p.cell !== null) trainableCount++;
    else unmappedCount++;
  }
  w.postMessage({
    kind: "capture-state", recording, total: captureSession.length,
    trainableCount, unmappedCount, trainedCount,
    canRollback: preTrainSnapshot !== null, session: captureSession,
  });
}
function postState(tMs: number): void {
  const s: DetectorState = detector.state(tMs);
  // M4.5.1: live 9-grid candidates on EVERY state tick (10Hz) so the cockpit bars keep
  // moving even without events (uses the same rebalanced bands as decisions).
  let liveCandidates: CellCandidate[] = [];
  try {
    const sigScaled: BandEnergy = {
      low: s.signature.low * s.total,
      mid: s.signature.mid * s.total,
      high: s.signature.high * s.total,
    };
    const balanced = rebalanceBands(sigScaled.low + sigScaled.mid + sigScaled.high > 0 ? sigScaled : lastBands, bandRef);
    const effDensity = lastHadRaw ? content.getEffectiveDensity() : s.density;
    const probe = decideOnEvent(
      { type: "section", tMs, confidence: 0.9, reason: "live", novLow: s.novLow, density: s.density, bpm: s.bpm },
      balanced, effDensity, { lastAutoCell, kc: lastKC, mb, bandFloor: GRID_FLOOR_BALANCED }, tMs, "auto",
    );
    liveCandidates = probe.candidates;
  } catch { /* pre-warmup — keep empty, main.ts never clears the grid on empty */ }
  w.postMessage({
    kind: "state", state: s, mode: master.getMode(), overrideCell: master.getOverrideCell(),
    overrideColumn: master.getOverrideColumn(), computeMaxMs, triggerMode,
    learnCount: mb.learnCount, lastAutoCell, liveCandidates, content: content.state(),
  });
}

let lastBands: BandEnergy = { low: 0, mid: 0, high: 0 };

/** 14-dim feature vector (M4.5 consensus): instant ×3, 3s signature ×3 (≈4s scale),
 * slopes ×2, novLow, density, regularity, buildupScore/3, total, bpm-known flag. */
function featureVector(bands: BandEnergy, st: DetectorState): number[] {
  const sig = st.signature;
  return [
    bands.low, bands.mid, bands.high,
    sig.low, sig.mid, sig.high,
    slopeLow, slopeHigh,
    st.novLow, st.density, st.regularity,
    st.buildupScore / 3, st.total, st.bpm !== null ? 1 : 0,
  ];
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const m = e.data;
  switch (m.type) {
    case "sample": {
      const c0 = performance.now();
      lastSampleT = m.tMs;
      lastBands = m.bands;
      lastHadRaw = Boolean(m.raw);
      const ev = detector.update(m.tMs, m.bands, m.raw);
      const st = detector.state(m.tMs);
      if (prevSig) {
        slopeLow = st.signature.low - prevSig.low;
        slopeHigh = st.signature.high - prevSig.high;
      }
      prevSig = st.signature;
      // M4.5.1: slow-track the absolute band reference while sound is present
      const dtRef = Math.max(1, Math.min(250, m.tMs - lastRefT));
      lastRefT = m.tMs;
      if (st.total > 0.04) {
        const aRef = 1 - Math.exp(-dtRef / 15000);
        bandRef.low += (m.bands.low - bandRef.low) * aRef;
        bandRef.mid += (m.bands.mid - bandRef.mid) * aRef;
        bandRef.high += (m.bands.high - bandRef.high) * aRef;
      }
      const x = featureVector(m.bands, st);
      const kc = mb.project(x);
      lastX = x; lastKC = kc;
      // M4.5.1 decision bands:
      //  - drop: instantaneous rebalanced bands (keeps the LOW burst of the drop itself)
      //  - section/buildup: the 3s signature scaled back to current total energy FIRST
      //    (avoids a single kick-peak frame skewing the section decision), then rebalanced.
      // Computed on every sample — also feeds the M4.6 trace-ring snapshot below.
      const sigScaled: BandEnergy = {
        low: st.signature.low * st.total,
        mid: st.signature.mid * st.total,
        high: st.signature.high * st.total,
      };
      const liveBalanced = rebalanceBands(sigScaled.low + sigScaled.mid + sigScaled.high > 0 ? sigScaled : m.bands, bandRef);
      traceRing.push({ tMs: m.tMs, x, balancedBands: liveBalanced, density: st.density });
      if (traceRing.length > TRACE_RING_MAX) traceRing.shift();
      const dt = performance.now() - c0;
      if (dt > computeMaxMs) computeMaxMs = dt;
      const c1SampleCue = content.updateSample({
        tMs: m.tMs, raw: m.raw, density: st.density, regularity: st.regularity,
        novLow: st.novLow, chroma: m.chroma, bpm: st.bpm, cell: st.cell,
      });
      // M4.8: motion tier comes from the RELATIVE density so Col 2/3 unlock on room mics
      // and clean feeds alike (falls back to absolute density in legacy band-only mode).
      const effDensity = m.raw ? content.getEffectiveDensity() : st.density;
      const dropCue = c1SampleCue !== null && c1SampleCue.cueKind === "drop-return" ? c1SampleCue : null;
      const baselineDrop = ev !== null && ev.type === "drop" && content.shouldAllowBaselineDrop(m.raw, st.density, m.tMs);
      if (baselineDrop || dropCue !== null) {
        // avatar full-body pulse fires with a real drop (baseline or C1 kick-return)
        w.postMessage({ kind: "dropPulse", tMs: m.tMs });
        const dropBalanced = rebalanceBands(m.bands, bandRef);
        if (baselineDrop && ev !== null) {
          // prefer the baseline drop; its cue bias only comes from a co-fired kick-return
          dispatchCue(ev, dropBalanced, effDensity, m.tMs, dropCue !== null ? dropCue.cellBias : undefined);
        } else if (dropCue !== null) {
          dispatchCue(dropCue.event, dropBalanced, effDensity, m.tMs, dropCue.cellBias);
        }
      } else if (c1SampleCue !== null) {
        // breakdown / arrangement from the C1 content layer
        dispatchCue(c1SampleCue.event, liveBalanced, effDensity, m.tMs, c1SampleCue.cellBias);
      } else if (ev !== null && ev.type === "section") {
        // shared cooldown: never chatter back-to-back with C1 cues
        if (content.canAutoTrigger(m.tMs, false)) dispatchCue(ev, liveBalanced, effDensity, m.tMs);
      } else if (ev !== null && ev.type === "buildup") {
        if (content.canAutoTrigger(m.tMs, false)) {
          // M4.8: BUILD-UP now TRIGGERS when cooled down — forced into the ACTIVE (Col 3)
          // tier so the riser visibly moves the nine-grid.
          dispatchCue(
            { ...ev, confidence: Math.max(ev.confidence, 0.65) },
            liveBalanced, Math.max(effDensity, 6.5), m.tMs, [0, 0, 0.40, 0, 0, 0.55, 0, 0, 0.65],
          );
        } else {
          // M4.5.1 BUGFIX 1: build-up no longer posts candidates: [] (that blanked the
          // nine-grid to "—"). Fill live candidates so the grid keeps showing probabilities.
          postDecision({
            kind: "hold", cell: null, layer: null, column: null,
            candidates: decideOnEvent(ev, liveBalanced, st.density, { lastAutoCell, kc, mb, bandFloor: GRID_FLOOR_BALANCED }, m.tMs, "auto").candidates,
            confidence: ev.confidence,
            reason: ev.reason, event: ev, tMs: m.tMs, source: "auto",
          });
        }
      }
      if (m.tMs - lastStatePost >= 100) {
        lastStatePost = m.tMs;
        postState(m.tMs);
      }
      break;
    }
    case "semantic": {
      // C1 content frame from the main-thread YAMNet sidecar: vocal-entry/exit hysteresis
      // and the fused arrangement-shift cue. Decisions reuse the current detector bands.
      const c1SemCue = content.updateSemantic(m.frame);
      if (c1SemCue !== null && lastSampleT > 0) {
        let semBalanced: BandEnergy = lastBands;
        let semDensity = 0;
        try {
          const s = detector.state(lastSampleT);
          semDensity = s.density;
          const sigScaled: BandEnergy = {
            low: s.signature.low * s.total,
            mid: s.signature.mid * s.total,
            high: s.signature.high * s.total,
          };
          semBalanced = rebalanceBands(sigScaled.low + sigScaled.mid + sigScaled.high > 0 ? sigScaled : lastBands, bandRef);
        } catch { /* pre-warmup — fall back to the last gated bands */ }
        dispatchCue(c1SemCue.event, semBalanced, semDensity, c1SemCue.event.tMs, c1SemCue.cellBias);
        postState(lastSampleT);
      }
      break;
    }
    case "override": {
      master.overrideTo(m.cell, m.tMs);
      // Dopamine RPE online learning: reinforce the overridden-to cell on the KC code that
      // was active when the user clicked; suppress the vetoed auto choice (or the last
      // auto cell when the message carries no explicit denial).
      if (lastKC) mb.learn(lastKC, m.cell, m.denied ?? lastAutoCell);
      // M4.6: while REC is on, also record the live override as a session pair. trained:true
      // because mb.learn above already applied it live — trainCapture must not re-train it.
      if (recording && traceRing.length > 0) {
        const tp = windowedTrace(traceRing, m.tMs) ?? traceRing[traceRing.length - 1];
        let denied: GridCell | null = m.denied ?? argmaxCellFromTrace(tp, mb);
        if (denied && denied.row === m.cell.row && denied.col === m.cell.col) denied = null;
        captureSession.push({
          tMs: tp.tMs, wall: performance.now(), cell: m.cell,
          physical: m.physical ?? { layer: m.cell.row, col: m.cell.col },
          x: [...tp.x], balancedBands: { ...tp.balancedBands }, density: tp.density,
          denied, source: "cockpit-override", approx: false, trained: true,
        });
        postCaptureState();
      }
      lastAutoCell = null; // user took over: the bag restarts when AUTO returns
      postWeights();       // M4.5.1: main thread persists to localStorage
      postState(m.tMs);
      break;
    }
    case "handback":
      master.handBack(m.tMs);
      postState(m.tMs);
      break;
    case "hold":
      master.hold(m.tMs);
      postState(m.tMs);
      break;
    case "auto":
      master.handBack(m.tMs);
      postState(m.tMs);
      break;
    case "setTriggerMode":
      triggerMode = m.mode;
      postState(lastSampleT);
      break;
    case "loadWeights": {
      // M4.5.1: restore persisted experience (boot-time localStorage → worker).
      const ok = mb.loadWeights(m.weights, m.learnCount);
      w.postMessage({ kind: "weights-loaded", ok, learnCount: mb.learnCount });
      postState(lastSampleT);
      break;
    }
    case "resetWeights":
      mb.resetWeights();
      postWeights();
      postState(lastSampleT);
      break;
    case "setRecording":
      recording = m.enabled;
      postCaptureState();
      break;
    case "captureExternal": {
      if (!recording) return;
      const tp = windowedTrace(traceRing, m.tMs);
      if (!tp) {
        w.postMessage({ kind: "capture-warning", reason: "mic未啟動或無近期音訊特徵，略過錄製" });
        return;
      }
      // Record what the fly brain WOULD have picked right now (RPE− denial target); drop it
      // when it agrees with the operator's semantic cell (nothing to suppress).
      let denied = m.semanticCell ? argmaxCellFromTrace(tp, mb) : null;
      if (denied && m.semanticCell && denied.row === m.semanticCell.row && denied.col === m.semanticCell.col) denied = null;
      captureSession.push({
        tMs: tp.tMs, wall: m.wall, cell: m.semanticCell, physical: m.physical,
        x: [...tp.x], balancedBands: { ...tp.balancedBands }, density: tp.density,
        denied, source: "arena-external", approx: false, trained: false,
      });
      postCaptureState();
      break;
    }
    case "trainCapture": {
      preTrainSnapshot = mb.exportWeights();
      const result = batchTrainMB(mb, captureSession);
      lastTrainedIndices = result.trainedIndices;
      postWeights();
      postState(lastSampleT);
      w.postMessage({ kind: "train-result", result, canRollback: result.trainedCount > 0, session: captureSession });
      break;
    }
    case "rollbackTrain": {
      if (!preTrainSnapshot) {
        w.postMessage({ kind: "train-rollback", ok: false, session: captureSession });
        break;
      }
      mb.loadWeights(preTrainSnapshot.weights, preTrainSnapshot.learnCount);
      for (const idx of lastTrainedIndices) {
        if (captureSession[idx]) captureSession[idx].trained = false;
      }
      preTrainSnapshot = null;
      lastTrainedIndices = [];
      postWeights();
      postState(lastSampleT);
      w.postMessage({ kind: "train-rollback", ok: true, session: captureSession });
      break;
    }
    case "clearCapture":
      captureSession = [];
      preTrainSnapshot = null;
      lastTrainedIndices = [];
      postCaptureState();
      break;
    case "loadCapture":
      captureSession = sanitizeSession(m.pairs);
      preTrainSnapshot = null;
      lastTrainedIndices = [];
      postCaptureState();
      break;
    case "reset":
      detector.reset();
      content.reset();
      prevSig = null; slopeLow = 0; slopeHigh = 0;
      lastHadRaw = false;
      traceRing.length = 0;
      // Song clock restarts from 0: clear time/throttle state so the 100ms state
      // throttle and 15s bandRef tau don't compare against a pre-reset clock.
      lastStatePost = -1e9;
      lastRefT = 0;
      lastSampleT = 0;
      lastX = null;
      lastKC = null;
      lastAutoCell = null;
      break;
  }
};

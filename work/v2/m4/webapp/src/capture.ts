// M4.6 / Phase 2 Performance Capture — PURE helpers for "record my own live set, then
// train the fly brain by imitation". The worker calls these; unit-tested in node (no DOM/WS).
// Flow: while REC is on, the worker keeps a short ring of TracePoint snapshots (14-dim
// feature vector x, live rebalanced bands, and onset density). When an external Arena launch
// or cockpit override happens, we pick the salient trace snapshot via windowedTrace, record
// what the AI itself would have picked (argmaxCellFromTrace → denied target for RPE−), and
// store a CapturePair. batchTrainMB replays untrained mapped pairs with per-cell inverse-sqrt
// gain scaling and gentle weight decay to improve session fit without saturating single cells.
// Erasable-syntax-only for node --test.

import type { BandEnergy } from "./dsp.ts";
import type { GridCell } from "./detector.ts";
import { idxCell, cellIdx, priorScores, LEARN, MB, type MushroomBody } from "./decision.ts";

export interface CapturePhysicalRef {
  layer: number;
  col: number;
}

export interface TracePoint {
  tMs: number;
  x: number[];
  balancedBands: BandEnergy;
  density: number;
}

export interface CapturePair {
  tMs: number;
  wall: number;
  cell: GridCell | null;          // null = unmapped physical clip (recorded, skipped during MB train until bound)
  physical: CapturePhysicalRef;   // actual Arena 1-based { layer, col }
  x: number[];                    // 14-dim feature vector
  balancedBands: BandEnergy;      // exact rebalanced bands matching live worker inference
  density: number;
  denied: GridCell | null;
  source: "arena-external" | "cockpit-override";
  approx: boolean;
  trained: boolean;
}

export interface BatchTrainResult {
  trainedCount: number;
  skippedUnmapped: number;
  skippedAlreadyTrained: number;
  perCellCounts: number[];     // length 9
  beforeMatchCount: number;
  afterMatchCount: number;
  trainedIndices: number[];    // indices inside `pairs` marked trained in this batch (for rollback!)
}

/** Nearest trace snapshot to tMs within maxDeltaMs (null = no audio features that fresh —
 * capture without a running sampler must NOT fabricate pairs). */
export function nearestTrace(trace: TracePoint[], tMs: number, maxDeltaMs = 500): TracePoint | null {
  let best: TracePoint | null = null;
  let bestD = Infinity;
  for (let i = trace.length - 1; i >= 0; i--) {
    const d = Math.abs(trace[i].tMs - tMs);
    if (d > maxDeltaMs) {
      // trace is time-ordered; once we are past the window going backwards, stop early
      if (trace[i].tMs < tMs - maxDeltaMs && best) break;
      continue;
    }
    if (d < bestD) { bestD = d; best = trace[i]; }
    if (trace[i].tMs < tMs) break; // nearest-older found (newer ones only exist if clock skew)
  }
  return best;
}

/** Structural salience of a trace point: novLow (x[8]) + 0.5 * (buildupScore / 3) (x[11]). */
function traceSalience(tp: TracePoint): number {
  return (tp.x[8] ?? 0) + 0.5 * (tp.x[11] ?? 0);
}

/**
 * Find the trace point in [tMs - lookbackMs, tMs + lookaheadMs] maximizing structural salience
 * (tie-break by smallest |tp.tMs - tMs|), returning it only if max salience > 0.25;
 * otherwise falls back to nearestTrace(trace, tMs, Math.max(lookbackMs, 500)).
 */
export function windowedTrace(
  trace: TracePoint[],
  tMs: number,
  lookbackMs = 400,
  lookaheadMs = 100,
): TracePoint | null {
  const minT = tMs - lookbackMs;
  const maxT = tMs + lookaheadMs;
  let best: TracePoint | null = null;
  let bestSal = -Infinity;
  let bestDt = Infinity;

  for (let i = 0; i < trace.length; i++) {
    const tp = trace[i];
    if (tp.tMs < minT || tp.tMs > maxT) continue;
    const sal = traceSalience(tp);
    if (!Number.isFinite(sal)) continue;
    const dt = Math.abs(tp.tMs - tMs);
    if (sal > bestSal || (sal === bestSal && dt < bestDt)) {
      best = tp;
      bestSal = sal;
      bestDt = dt;
    }
  }

  if (best && bestSal > 0.25) return best;
  return nearestTrace(trace, tMs, Math.max(lookbackMs, 500));
}

/**
 * What the fly brain WOULD choose for a trace snapshot right now:
 * argmax(priorScores(balancedBands, density) + learnGain * W * kc),
 * matching live worker inference. Used as the denial target for RPE−.
 */
export function argmaxCellFromTrace(tp: TracePoint, mb: MushroomBody): GridCell {
  const prior = priorScores(tp.balancedBands, tp.density);
  const learned = mb.learnedScores(mb.project(tp.x));
  let bi = 0;
  let bv = -Infinity;
  for (let i = 0; i < 9; i++) {
    const v = prior[i] + LEARN.learnGain * learned[i];
    if (v > bv) { bv = v; bi = i; }
  }
  return idxCell(bi);
}

/** Legacy helper: infer from raw 14-dim feature vector x (index 9 = st.density). */
export function argmaxCellFromX(x: number[], mb: MushroomBody): GridCell {
  return argmaxCellFromTrace({
    tMs: 0,
    x,
    balancedBands: { low: x[0] ?? 0, mid: x[1] ?? 0, high: x[2] ?? 0 },
    density: x[9] ?? 0,
  }, mb);
}

function clampW(v: number): number {
  return Math.max(-LEARN.wMax, Math.min(LEARN.wMax, v));
}

function pairToTrace(p: CapturePair): TracePoint {
  return {
    tMs: p.tMs,
    x: p.x,
    balancedBands: p.balancedBands,
    density: p.density,
  };
}

function countSessionMatches(mb: MushroomBody, items: readonly { idx: number; pair: CapturePair }[]): number {
  let matches = 0;
  for (let i = 0; i < items.length; i++) {
    const p = items[i].pair;
    if (p.cell && cellIdx(argmaxCellFromTrace(pairToTrace(p), mb)) === cellIdx(p.cell)) {
      matches++;
    }
  }
  return matches;
}

/**
 * Replay untrained mapped pairs through the Mushroom Body in one batch.
 * Applies gentle weight decay across existing weights when mb.learnCount > 0, scales
 * learning rate per cell by clamp(1 / sqrt(count), 0.25, 1.0) * batchGain to avoid
 * single-cell saturation, marks trained pairs in place, and returns session fit counts
 * plus trainedIndices for caller rollback support.
 */
export function batchTrainMB(
  mb: MushroomBody,
  pairs: CapturePair[],
  opts?: { batchGain?: number; decay?: number },
): BatchTrainResult {
  let skippedUnmapped = 0;
  let skippedAlreadyTrained = 0;
  const trainable: { idx: number; pair: CapturePair }[] = [];

  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (p.trained) {
      skippedAlreadyTrained++;
    } else if (!p.cell) {
      skippedUnmapped++;
    } else {
      trainable.push({ idx: i, pair: p });
    }
  }

  const perCellCounts = new Array<number>(9).fill(0);
  const trainedIndices: number[] = [];
  const beforeMatchCount = countSessionMatches(mb, trainable);

  if (trainable.length > 0) {
    const decay = opts?.decay ?? 0.98;
    if (mb.learnCount > 0) {
      for (let i = 0; i < mb.W.length; i++) mb.W[i] *= decay;
    }

    for (let i = 0; i < trainable.length; i++) {
      perCellCounts[cellIdx(trainable[i].pair.cell!)]++;
    }

    const batchGain = opts?.batchGain ?? 0.65;
    for (let i = 0; i < trainable.length; i++) {
      const { idx, pair: p } = trainable[i];
      const ci = cellIdx(p.cell!);
      const di = p.denied ? cellIdx(p.denied) : -1;
      const etaScale = Math.max(0.25, Math.min(1.0, 1 / Math.sqrt(perCellCounts[ci]))) * batchGain;
      const kc = mb.project(p.x);
      const ciRow = ci * MB.KC;
      const diRow = di >= 0 && di !== ci ? di * MB.KC : -1;

      for (let j = 0; j < MB.KC; j++) {
        const v = kc[j];
        if (v === 0) continue;
        mb.W[ciRow + j] = clampW(mb.W[ciRow + j] + LEARN.etaPos * etaScale * v);
        if (diRow >= 0) {
          mb.W[diRow + j] = clampW(mb.W[diRow + j] - LEARN.etaNeg * etaScale * v);
        }
      }
      mb.learnCount++;
      p.trained = true;
      trainedIndices.push(idx);
    }
  }

  const afterMatchCount = countSessionMatches(mb, trainable);
  return {
    trainedCount: trainable.length,
    skippedUnmapped,
    skippedAlreadyTrained,
    perCellCounts,
    beforeMatchCount,
    afterMatchCount,
    trainedIndices,
  };
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function parseGridCell(v: unknown): GridCell | null {
  if (!v || typeof v !== "object") return null;
  const c = v as { row?: unknown; col?: unknown };
  if ((c.row === 1 || c.row === 2 || c.row === 3) && (c.col === 1 || c.col === 2 || c.col === 3)) {
    return { row: c.row, col: c.col };
  }
  return null;
}

function parsePhysicalRef(v: unknown): CapturePhysicalRef | null {
  if (!v || typeof v !== "object") return null;
  const p = v as { layer?: unknown; col?: unknown };
  if (
    typeof p.layer === "number" && Number.isInteger(p.layer) && p.layer >= 1 &&
    typeof p.col === "number" && Number.isInteger(p.col) && p.col >= 1
  ) {
    return { layer: p.layer, col: p.col };
  }
  return null;
}

function parseBandEnergy(v: unknown): BandEnergy | null {
  if (!v || typeof v !== "object") return null;
  const b = v as { low?: unknown; mid?: unknown; high?: unknown };
  if (isFiniteNum(b.low) && isFiniteNum(b.mid) && isFiniteNum(b.high)) {
    return { low: b.low, mid: b.mid, high: b.high };
  }
  return null;
}

/** Validate a session restored from localStorage / sent across the worker boundary.
 * Supports both Phase 2 full entries (including unmapped cell: null with physical ref)
 * and legacy entries (backfilling physical, wall, balancedBands, density, source).
 * Anything malformed is dropped (never partially trusted — same policy as loadWeights). */
export function sanitizeSession(arr: unknown): CapturePair[] {
  if (!Array.isArray(arr)) return [];
  const out: CapturePair[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;

    if (!isFiniteNum(p.tMs)) continue;
    if (!Array.isArray(p.x) || p.x.length !== 14) continue;
    const x: number[] = [];
    let validX = true;
    for (let i = 0; i < 14; i++) {
      const v = p.x[i];
      if (!isFiniteNum(v)) { validX = false; break; }
      x.push(v);
    }
    if (!validX) continue;

    let cell: GridCell | null;
    if (p.cell === null) {
      cell = null;
    } else {
      const parsedCell = parseGridCell(p.cell);
      if (!parsedCell) continue;
      cell = parsedCell;
    }

    let physical: CapturePhysicalRef | null;
    if (p.physical !== undefined) {
      physical = parsePhysicalRef(p.physical);
      if (!physical) continue;
    } else if (cell !== null) {
      physical = { layer: cell.row, col: cell.col };
    } else {
      continue;
    }

    let wall: number;
    if (p.wall !== undefined) {
      if (!isFiniteNum(p.wall)) continue;
      wall = p.wall;
    } else {
      wall = 0;
    }

    let balancedBands: BandEnergy;
    if (p.balancedBands !== undefined) {
      const parsedBands = parseBandEnergy(p.balancedBands);
      if (!parsedBands) continue;
      balancedBands = parsedBands;
    } else {
      balancedBands = { low: x[0], mid: x[1], high: x[2] };
    }

    let density: number;
    if (p.density !== undefined) {
      if (!isFiniteNum(p.density)) continue;
      density = p.density;
    } else {
      density = x[9];
    }

    let source: "arena-external" | "cockpit-override";
    if (p.source === undefined) {
      source = "arena-external";
    } else if (p.source === "arena-external" || p.source === "cockpit-override") {
      source = p.source;
    } else {
      continue;
    }

    const parsedDenied = parseGridCell(p.denied);
    const denied = parsedDenied && (cell === null || cellIdx(parsedDenied) !== cellIdx(cell))
      ? parsedDenied
      : null;

    out.push({
      tMs: p.tMs,
      wall,
      cell,
      physical,
      x,
      balancedBands,
      density,
      denied,
      source,
      approx: p.approx === true,
      trained: p.trained === true,
    });
  }
  return out;
}

// Phase 2 unit tests — Capture helpers (windowedTrace, argmaxCellFromTrace, batchTrainMB,
// sanitizeSession) and ExternalLaunchDetector (rising-edge detection + self-fire suppression).
// Pure Node tests; zero DOM globals; measures session fit via match counts only.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nearestTrace,
  windowedTrace,
  argmaxCellFromTrace,
  argmaxCellFromX,
  batchTrainMB,
  sanitizeSession,
  type TracePoint,
  type CapturePair,
} from "../src/capture.ts";
import { ExternalLaunchDetector } from "../src/external-detect.ts";
import { MushroomBody, LEARN, cellIdx } from "../src/decision.ts";
import type { BandEnergy } from "../src/dsp.ts";
import type { GridCell } from "../src/detector.ts";

function makeX(opts: {
  low?: number;
  mid?: number;
  high?: number;
  novLow?: number;
  density?: number;
  buildupNorm?: number;
} = {}): number[] {
  const low = opts.low ?? 0.5;
  const mid = opts.mid ?? 0.2;
  const high = opts.high ?? 0.1;
  return [
    low, mid, high,
    low, mid, high,
    0, 0,
    opts.novLow ?? 0,
    opts.density ?? 1,
    0.5,
    opts.buildupNorm ?? 0,
    low + mid + high,
    1,
  ];
}

function makeTrace(
  tMs: number,
  opts: Parameters<typeof makeX>[0] & { balancedBands?: BandEnergy } = {},
): TracePoint {
  const x = makeX(opts);
  return {
    tMs,
    x,
    balancedBands: opts.balancedBands ?? { low: x[0], mid: x[1], high: x[2] },
    density: opts.density ?? x[9],
  };
}

function makePair(overrides: Partial<CapturePair> = {}): CapturePair {
  const x = overrides.x ?? makeX();
  const balancedBands = overrides.balancedBands ?? { low: x[0], mid: x[1], high: x[2] };
  return {
    tMs: 1000,
    wall: 1700000001000,
    cell: { row: 1, col: 1 },
    physical: { layer: 1, col: 1 },
    x,
    balancedBands,
    density: x[9],
    denied: null,
    source: "arena-external",
    approx: false,
    trained: false,
    ...overrides,
  };
}

// ── windowedTrace ─────────────────────────────────────────────────────────────

test("windowedTrace selects peak structural salience frame 250ms before click", () => {
  const peak = makeTrace(1750, { novLow: 0.9, buildupNorm: 0.4, low: 0.8, mid: 0.1, high: 0.1 });
  const quietAtClick = makeTrace(2000, { novLow: 0.05, buildupNorm: 0.0, low: 0.2, mid: 0.5, high: 0.3 });
  const trace: TracePoint[] = [
    makeTrace(1500, { novLow: 0.1 }),
    peak,
    makeTrace(1900, { novLow: 0.12 }),
    quietAtClick,
  ];

  const picked = windowedTrace(trace, 2000);
  assert.equal(picked, peak);
});

test("windowedTrace includes 0.5 * buildupNorm (x[11]) in salience and ties break by smallest |dt|", () => {
  // salience = x[8] + 0.5 * x[11]: 0.1 + 0.5 * 0.4 = 0.30 (> 0.25)
  const earlier = makeTrace(1750, { novLow: 0.1, buildupNorm: 0.4 });
  const closer = makeTrace(1950, { novLow: 0.1, buildupNorm: 0.4 });
  const picked = windowedTrace([earlier, closer], 2000);
  assert.equal(picked, closer);
});

test("windowedTrace falls back to nearestTrace when max salience <= 0.25 or window empty", () => {
  // Exact boundary salience: 0.2 + 0.5 * 0.1 = 0.25 (not > 0.25) -> falls back to nearest
  const lowSalPeak = makeTrace(1750, { novLow: 0.2, buildupNorm: 0.1 });
  const closerQuiet = makeTrace(1990, { novLow: 0.02, buildupNorm: 0.0 });
  assert.equal(windowedTrace([lowSalPeak, closerQuiet], 2000), closerQuiet);

  // Empty [1600, 2100] window falls back to nearestTrace within Math.max(lookbackMs, 500)
  const outsideWindowButIn500 = makeTrace(1550, { novLow: 0.9 });
  assert.equal(windowedTrace([outsideWindowButIn500], 2000, 400, 100), outsideWindowButIn500);
  assert.equal(nearestTrace([outsideWindowButIn500], 2000, 500), outsideWindowButIn500);

  // Beyond fallback range -> null
  assert.equal(windowedTrace([makeTrace(1000, { novLow: 2.0 })], 2000), null);
});

// ── argmaxCellFromTrace ───────────────────────────────────────────────────────

test("argmaxCellFromTrace uses balancedBands (MID-dominant beats LOW-dominant raw x[0..2])", () => {
  const mb = new MushroomBody();
  const tp = makeTrace(1000, {
    low: 0.9,
    mid: 0.05,
    high: 0.05,
    density: 1.0, // STATIC -> col 1
    balancedBands: { low: 0.1, mid: 0.7, high: 0.2 }, // MID-dominant -> row 2
  });

  const fromTrace = argmaxCellFromTrace(tp, mb);
  const fromRawX = argmaxCellFromX(tp.x, mb);
  assert.deepEqual(fromTrace, { row: 2, col: 1 });
  assert.deepEqual(fromRawX, { row: 1, col: 1 });
});

test("argmaxCellFromX reads density from x[9] (not x[8] novLow)", () => {
  const mb = new MushroomBody();
  const x = makeX({ low: 0.8, mid: 0.1, high: 0.1, novLow: 0.0, density: 7.5 }); // ACTIVE -> col 3
  assert.deepEqual(argmaxCellFromX(x, mb), { row: 1, col: 3 });
});

// ── batchTrainMB ──────────────────────────────────────────────────────────────

test("batchTrainMB trains only untrained mapped pairs and skips cell:null and trained:true", () => {
  const mb = new MushroomBody();
  const unmapped = makePair({ cell: null, physical: { layer: 4, col: 2 }, trained: false });
  const alreadyTrained = makePair({ cell: { row: 2, col: 2 }, physical: { layer: 2, col: 2 }, trained: true });
  const freshA = makePair({ cell: { row: 3, col: 2 }, physical: { layer: 3, col: 2 }, trained: false });
  const freshB = makePair({ cell: { row: 1, col: 3 }, physical: { layer: 1, col: 3 }, trained: false });
  const pairs = [unmapped, alreadyTrained, freshA, freshB];

  const res = batchTrainMB(mb, pairs);
  assert.equal(res.trainedCount, 2);
  assert.equal(res.skippedUnmapped, 1);
  assert.equal(res.skippedAlreadyTrained, 1);
  assert.deepEqual(res.trainedIndices, [2, 3]);
  assert.equal(unmapped.trained, false);
  assert.equal(alreadyTrained.trained, true);
  assert.equal(freshA.trained, true);
  assert.equal(freshB.trained, true);
  assert.equal(res.perCellCounts.length, 9);
  assert.equal(res.perCellCounts[cellIdx({ row: 3, col: 2 })], 1);
  assert.equal(res.perCellCounts[cellIdx({ row: 1, col: 3 })], 1);
  assert.equal(res.perCellCounts[cellIdx({ row: 2, col: 2 })], 0);
  assert.equal(mb.learnCount, 2);
});

test("batchTrainMB avoids single-cell saturation over 20 repeated clicks and improves session fit", () => {
  const mb = new MushroomBody();
  const target: GridCell = { row: 2, col: 2 };
  const priorWinner: GridCell = { row: 1, col: 2 }; // LOW-dominant + MEDIUM density=3.5

  const pairs: CapturePair[] = [];
  for (let i = 0; i < 20; i++) {
    pairs.push(makePair({
      tMs: 1000 + i * 100,
      cell: target,
      physical: { layer: 2, col: 2 },
      x: makeX({ low: 0.36, mid: 0.33, high: 0.31, density: 3.5, novLow: 0.6 }),
      balancedBands: { low: 0.36, mid: 0.33, high: 0.31 },
      density: 3.5,
      denied: priorWinner,
      trained: false,
    }));
  }

  const res = batchTrainMB(mb, pairs);
  assert.equal(res.trainedCount, 20);
  assert.equal(res.beforeMatchCount, 0);
  assert.equal(res.afterMatchCount, 20);
  assert.ok(res.afterMatchCount > res.beforeMatchCount, `expected session fit improvement (${res.beforeMatchCount} -> ${res.afterMatchCount})`);
  assert.equal(res.perCellCounts[cellIdx(target)], 20);

  let maxAbsW = 0;
  for (let i = 0; i < mb.W.length; i++) {
    const a = Math.abs(mb.W[i]);
    if (a > maxAbsW) maxAbsW = a;
  }
  assert.ok(maxAbsW < LEARN.wMax, `expected max |W| (${maxAbsW}) strictly below wMax (${LEARN.wMax})`);
});

test("batchTrainMB applies gentle weight decay when mb.learnCount > 0 and supports exact rollback", () => {
  const mb = new MushroomBody();
  const seedX = makeX({ low: 0.2, mid: 0.6, high: 0.2, density: 3.5 });
  mb.learn(mb.project(seedX), { row: 2, col: 2 }, { row: 1, col: 1 });
  const beforeSnap = mb.exportWeights();

  const pair = makePair({
    cell: { row: 3, col: 1 },
    physical: { layer: 3, col: 1 },
    x: makeX({ low: 0.8, mid: 0.1, high: 0.1, density: 1.0 }),
    balancedBands: { low: 0.8, mid: 0.1, high: 0.1 },
    density: 1.0,
    denied: { row: 1, col: 1 },
  });
  const pairs = [pair];
  const res = batchTrainMB(mb, pairs, { decay: 0.9 });

  assert.equal(res.trainedCount, 1);
  assert.equal(mb.learnCount, beforeSnap.learnCount + 1);
  assert.notDeepEqual(mb.exportWeights(), beforeSnap);

  // Rollback via loadWeights + unmarking trainedIndices
  assert.equal(mb.loadWeights(beforeSnap.weights, beforeSnap.learnCount), true);
  for (const idx of res.trainedIndices) pairs[idx].trained = false;
  assert.deepEqual(mb.exportWeights(), beforeSnap);
  assert.equal(mb.learnCount, beforeSnap.learnCount);
  assert.equal(pair.trained, false);
});

// ── sanitizeSession ───────────────────────────────────────────────────────────

test("sanitizeSession accepts valid new & legacy entries and drops malformed entries", () => {
  const validX = makeX({ low: 0.4, mid: 0.35, high: 0.25, density: 4.2 });
  const input: unknown[] = [
    // 1. Valid new full entry (physical differs from mapped grid cell)
    {
      tMs: 1200,
      wall: 1700000001200,
      cell: { row: 2, col: 3 },
      physical: { layer: 5, col: 7 },
      x: validX,
      balancedBands: { low: 0.2, mid: 0.5, high: 0.3 },
      density: 4.2,
      denied: { row: 1, col: 1 },
      source: "cockpit-override",
      approx: false,
      trained: true,
    },
    // 2. Valid unmapped physical clip (cell: null)
    {
      tMs: 1500,
      wall: 1700000001500,
      cell: null,
      physical: { layer: 4, col: 9 },
      x: validX,
      balancedBands: { low: 0.3, mid: 0.4, high: 0.3 },
      density: 4.2,
      denied: { row: 1, col: 2 },
      source: "arena-external",
      approx: false,
      trained: false,
    },
    // 3. Valid legacy entry (missing physical, wall, balancedBands, density, source)
    {
      tMs: 2000,
      cell: { row: 3, col: 1 },
      x: validX,
      denied: { row: 3, col: 1 }, // equals cell -> normalized to null
      approx: true,
      trained: false,
    },
    // Malformed entries (all must be dropped):
    null,
    { tMs: NaN, cell: { row: 1, col: 1 }, physical: { layer: 1, col: 1 }, x: validX, balancedBands: { low: 0.1, mid: 0.2, high: 0.3 }, density: 1 },
    { tMs: 3000, cell: { row: 1, col: 1 }, physical: { layer: 1, col: 1 }, x: validX.slice(0, 13) },
    { tMs: 3000, cell: { row: 1, col: 1 }, physical: { layer: 1, col: 1 }, x: [NaN, ...validX.slice(1)] },
    { tMs: 3000, cell: { row: 4, col: 1 }, physical: { layer: 1, col: 1 }, x: validX },
    { tMs: 3000, cell: null, x: validX }, // unmapped without physical
    { tMs: 3000, cell: { row: 1, col: 1 }, physical: { layer: 0, col: 1 }, x: validX },
    { tMs: 3000, cell: { row: 1, col: 1 }, physical: { layer: 1.5, col: 2 }, x: validX },
    { tMs: 3000, cell: { row: 1, col: 1 }, physical: { layer: 1, col: 1 }, x: validX, balancedBands: { low: 0.2, mid: NaN, high: 0.3 }, density: 1 },
    { tMs: 3000, cell: { row: 1, col: 1 }, physical: { layer: 1, col: 1 }, x: validX, balancedBands: { low: 0.2, mid: 0.5, high: 0.3 }, density: Infinity },
    { tMs: 3000, cell: { row: 1, col: 1 }, physical: { layer: 1, col: 1 }, x: validX, source: "unknown-source" },
  ];

  const out = sanitizeSession(input);
  assert.equal(out.length, 3);

  assert.deepEqual(out[0].cell, { row: 2, col: 3 });
  assert.deepEqual(out[0].physical, { layer: 5, col: 7 });
  assert.equal(out[0].source, "cockpit-override");
  assert.deepEqual(out[0].denied, { row: 1, col: 1 });
  assert.equal(out[0].trained, true);

  assert.equal(out[1].cell, null);
  assert.deepEqual(out[1].physical, { layer: 4, col: 9 });
  assert.deepEqual(out[1].denied, { row: 1, col: 2 });

  // Legacy backfill checks
  assert.deepEqual(out[2].physical, { layer: 3, col: 1 });
  assert.deepEqual(out[2].balancedBands, { low: validX[0], mid: validX[1], high: validX[2] });
  assert.equal(out[2].density, validX[9]);
  assert.equal(out[2].source, "arena-external");
  assert.equal(out[2].denied, null);
  assert.equal(out[2].approx, true);
  assert.equal(Number.isFinite(out[2].wall), true);

  assert.deepEqual(sanitizeSession("not-an-array"), []);
});

// ── ExternalLaunchDetector ────────────────────────────────────────────────────

test("ExternalLaunchDetector: hydration never triggers and repeated true->true / falling edges are ignored", () => {
  const det = new ExternalLaunchDetector(1500);
  det.hydrate(101, true);
  det.hydrate(102, false);

  // Hydrated true -> update true is NOT a rising edge
  assert.deepEqual(det.onClipParamUpdate(101, 1, 1, true, 1000), { external: false, risingEdge: false });
  // Falling edge true -> false is ignored
  assert.deepEqual(det.onClipParamUpdate(101, 1, 1, false, 1100), { external: false, risingEdge: false });
  // Genuine rising edge after falling edge
  assert.deepEqual(det.onClipParamUpdate(101, 1, 1, true, 1200), { external: true, risingEdge: true });
  // Repeated true -> true ignored
  assert.deepEqual(det.onClipParamUpdate(101, 1, 1, true, 1300), { external: false, risingEdge: false });
  // Hydrated false -> true is a genuine external rising edge
  assert.deepEqual(det.onClipParamUpdate(102, 1, 2, true, 1400), { external: true, risingEdge: true });
});

test("ExternalLaunchDetector: self-fired clip suppressed inside 1500ms window and allowed after expiry", () => {
  const det = new ExternalLaunchDetector(1500);
  det.hydrate(201, false);
  det.hydrate(202, false);

  det.markSelfFiredClip(2, 3, 1000);
  // Boundary nowMs === 2500 is still suppressed
  assert.deepEqual(det.onClipParamUpdate(201, 2, 3, true, 2500), { external: false, risingEdge: true });
  // Unrelated clip still fires externally
  assert.deepEqual(det.onClipParamUpdate(202, 2, 4, true, 1200), { external: true, risingEdge: true });

  // Reset clip 201 to false, then trigger after 2500ms expiry -> external
  assert.deepEqual(det.onClipParamUpdate(201, 2, 3, false, 2500), { external: false, risingEdge: false });
  assert.deepEqual(det.onClipParamUpdate(201, 2, 3, true, 2501), { external: true, risingEdge: true });
});

test("ExternalLaunchDetector: self-fired column suppresses all layers in that column and reset() clears state", () => {
  const det = new ExternalLaunchDetector(1500);
  det.markSelfFiredColumn(4, 1000);

  // Multiple layers in column 4 are suppressed
  assert.deepEqual(det.onClipParamUpdate(301, 1, 4, true, 1100), { external: false, risingEdge: true });
  assert.deepEqual(det.onClipParamUpdate(302, 2, 4, true, 1200), { external: false, risingEdge: true });
  assert.deepEqual(det.onClipParamUpdate(303, 5, 4, true, 2500), { external: false, risingEdge: true });
  // Different column is NOT suppressed
  assert.deepEqual(det.onClipParamUpdate(304, 1, 5, true, 1300), { external: true, risingEdge: true });

  // reset() clears both prevConnected and active suppression windows
  det.reset();
  assert.deepEqual(det.onClipParamUpdate(301, 1, 4, true, 1400), { external: true, risingEdge: true });
  assert.deepEqual(det.onClipParamUpdate(304, 1, 5, true, 1500), { external: true, risingEdge: true });
});

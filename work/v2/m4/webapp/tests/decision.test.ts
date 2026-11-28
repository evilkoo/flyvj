// M4.5 unit tests — fly-brain MB-WTA decision model, dopamine online learning, nine-grid
// 9-choose-1 selection, anti-repeat bag, section events, drop timing, speech/silence HOLD.
// Synthetic band timelines emulate: EDM (groove → build-up → drop), silence, speech-like
// irregular MID-dominant swells, and a breakdown section shift. CONTRACT-LEVEL behaviour
// tests (SPEC §0.2) — no accuracy percentage claims (M4_TICKET 禁止).

import { test } from "node:test";
import assert from "node:assert/strict";
import { StructureDetector, DET, cellLabel, type GridCell } from "../src/detector.ts";
import {
  softmax, jevConfidence, MushroomBody, MB, priorScores, decideOnEvent, MasterSwitch,
  cellIdx, idxCell, mulberry32, HOLD_FLOOR, CONF_FLOOR, rebalanceBands, BAND_REF_FLOOR,
} from "../src/decision.ts";
import { bandsToPose } from "../src/model.ts";
import type { BandEnergy } from "../src/dsp.ts";
import type { StructureEvent } from "../src/detector.ts";

const STEP = 16; // ms — same cadence as BandSampler

interface SimCtx { rollPhase: number; }

/** Run a band timeline through the detector; collect events. */
function run(det: StructureDetector, durMs: number, fn: (t: number, ctx: SimCtx) => BandEnergy): StructureEvent[] {
  const events: StructureEvent[] = [];
  const ctx: SimCtx = { rollPhase: 0 };
  for (let t = 0; t <= durMs; t += STEP) {
    const ev = det.update(t, fn(t, ctx));
    if (ev) events.push(ev);
  }
  return events;
}

const BEAT = 60000 / 128; // 468.75ms @128BPM
// Realistic POST-SMOOTHER bands (what BandSampler actually outputs — M4 cue traces):
// the 50ms attack / 220ms release smoother turns kick transients into a smooth ~0.3–0.6
// envelope, NOT raw spikes. Feeding raw spikes here would make every kick a novLow peak
// (the M4.5 test-regression lesson: unit sims must mirror the real gated pipeline).
function kickEnv(t: number, amp: number): number {
  const phase = (t % BEAT) / BEAT;
  return amp * (0.55 + 0.45 * Math.exp(-phase * 5)); // smooth pulsing floor, no impulse
}
function hatEnv(t: number, amp: number): number {
  const phase = (t % (BEAT / 2)) / (BEAT / 2);
  return amp * (0.5 + 0.5 * Math.exp(-phase * 4));
}

/** EDM sim: groove 0–6s → build-up 6–13s (bass cut + riser + accelerating roll) → drop 13s. */
function edmBands(t: number, ctx: SimCtx): BandEnergy {
  if (t < 6000) {
    return { low: kickEnv(t, 0.45), mid: 0.12 + 0.05 * Math.sin(t / 300), high: 0.03 + hatEnv(t, 0.10) };
  }
  if (t < 13000) {
    const p = (t - 6000) / 7000;
    const rollFreq = 4 + 12 * p;
    ctx.rollPhase += (2 * Math.PI * rollFreq * STEP) / 1000;
    const roll = 0.55 + 0.45 * Math.max(0, Math.sin(ctx.rollPhase));
    const riser = 0.05 + 0.40 * p;
    return { low: 0.015, mid: 0.05 + 0.10 * p, high: riser * roll };
  }
  return { low: kickEnv(t, 0.55), mid: 0.30, high: 0.10 + hatEnv(t, 0.22) };
}

// ── detector: drop / build-up / section ─────────────────────────────────────

test("detector: EDM sim → build-up then drop within ±0.5s of the marked 13s drop", () => {
  const det = new StructureDetector();
  const events = run(det, 20000, edmBands);
  const buildups = events.filter((e) => e.type === "buildup");
  const drops = events.filter((e) => e.type === "drop");
  assert.ok(buildups.length >= 1, "build-up fired");
  assert.ok(buildups[0].tMs >= 6000 && buildups[0].tMs < 13000, `build-up in build section (t=${buildups[0].tMs})`);
  assert.equal(drops.length >= 1, true, "a drop event fired");
  const err = drops[0].tMs - 13000;
  assert.ok(Math.abs(err) <= 500, `drop error ${err}ms within ±0.5s (contract (a) unit-level)`);
  assert.ok(drops[0].confidence >= CONF_FLOOR);
  assert.ok(drops[0].cell, "drop carries a nine-grid cell");
});

test("detector: no drop during the pure groove section (kicks are not drops)", () => {
  const det = new StructureDetector();
  const events = run(det, 6000, edmBands);
  assert.equal(events.filter((e) => e.type === "drop").length, 0);
});

test("detector: silence → zero events (contract (b))", () => {
  const det = new StructureDetector();
  const events = run(det, 25000, () => ({ low: 0, mid: 0, high: 0 }));
  assert.equal(events.length, 0);
  assert.equal(det.state(25000).phase, "idle");
});

test("detector: speech-like irregular MID-dominant swells → no drop (LOW-dominance gate)", () => {
  const gaps = [1700, 3100, 1900, 2900, 2300, 1750, 3050, 2150, 2650, 1850];
  const marks: number[] = [];
  let acc = 1500;
  for (const g of gaps) { acc += g; marks.push(acc); }
  const swell = (t: number): number => {
    for (const m of marks) { const d = t - m; if (d >= 0 && d < 800) return Math.sin((d / 800) * Math.PI); }
    return 0;
  };
  const det = new StructureDetector();
  const events = run(det, 40000, (t) => {
    const s = swell(t);
    return { low: 0.01 + 0.25 * s, mid: 0.02 + 0.30 * s, high: 0.01 + 0.10 * s * 0.5 };
  });
  assert.equal(events.filter((e) => e.type === "drop").length, 0);
  // contract (b) unit-level: the silence→speech onset is a signature shift too, but the
  // music gate (regularity + onset density) must keep section events off speech as well.
  assert.equal(events.filter((e) => e.type === "section").length, 0, "no section events on speech");
});

test("detector: section event fires on a sustained dominance shift (breakdown → groove)", () => {
  const det = new StructureDetector();
  // 12s MID-dominant breakdown (quiet, mid motion) then 12s LOW-dominant groove
  const events = run(det, 30000, (t) => (
    t < 12000
      ? { low: 0.03, mid: 0.25 + 0.05 * Math.sin(t / 400), high: 0.05 }
      : { low: 0.05 + kickEnv(t, 0.5), mid: 0.10, high: 0.04 + hatEnv(t, 0.08) }
  ));
  const sections = events.filter((e) => e.type === "section");
  assert.ok(sections.length >= 1, `section event fired (${JSON.stringify(events.map((e) => e.type))})`);
  assert.ok(sections[0].tMs > 12000, `section after the shift (t=${sections[0].tMs})`);
  assert.ok(sections[0].cell, "section carries a cell");
  // cooldown: no two section events within 4s
  for (let i = 1; i < sections.length; i++) {
    assert.ok(sections[i].tMs - sections[i - 1].tMs >= DET.sectionCooldownMs - 1, "section cooldown respected");
  }
});

test("detector: groove lock — tempo frozen during build-up (bpm kept from the groove)", () => {
  const det = new StructureDetector();
  // groove 0–8s (125 BPM grid), then build-up (roll) 8–14s
  run(det, 10000, (t) => ({ low: 0.02 + ((t % 480) < 200 ? 0.5 * Math.exp(-((t % 480)) / 50) : 0), mid: 0.05, high: 0.02 }));
  const locked = det.state(10000).bpm;
  assert.ok(locked !== null, "bpm locked during groove");
  // enter build-up: bass cut + roll → tempoFrozen true and bpm unchanged
  for (let t = 10000; t < 14000; t += STEP) {
    const p = (t - 10000) / 4000;
    det.update(t, { low: 0.01, mid: 0.05, high: (0.05 + 0.3 * p) * (0.55 + 0.45 * Math.sin(t / 40)) });
  }
  const st = det.state(14000);
  assert.equal(st.tempoFrozen, true, "tempo frozen during build-up");
  assert.equal(st.bpm, locked, "locked bpm preserved through the build-up");
});

test("detector: bar-phase bonus — nearBarPhase true at bar boundaries of a locked bpm", () => {
  const det = new StructureDetector();
  run(det, 12000, (t) => ({ low: 0.02 + ((t % 500) < 200 ? 0.5 * Math.exp(-((t % 500)) / 50) : 0), mid: 0.05, high: 0.02 }));
  const bpm = det.state(12000).bpm;
  assert.ok(bpm !== null);
  const barMs = (60000 / bpm!) * 4;
  assert.equal(det.nearBarPhase(Math.round(barMs * 3)), true, "exactly on a bar boundary");
  assert.equal(det.nearBarPhase(Math.round(barMs * 3 + barMs * 0.5)), false, "mid-bar = not near phase");
});

// ── Mushroom Body: sparse coding + learning ─────────────────────────────────

const feat = (over: Partial<Record<string, number>> = {}): number[] => {
  const base = [0.4, 0.1, 0.1, 0.5, 0.15, 0.15, 0.01, 0, 3.0, 4.0, 0.4, 0.5, 0.6, 1];
  return base.map((v, i) => over[String(i)] ?? v);
};

test("MB: projection is deterministic (same seed → same code) and sparse (exactly K active)", () => {
  const a = new MushroomBody(42);
  const b = new MushroomBody(42);
  const ka = a.project(feat());
  const kb = b.project(feat());
  assert.deepEqual(Array.from(ka), Array.from(kb), "deterministic projection");
  const nz = Array.from(ka).filter((v) => v !== 0).length;
  assert.equal(nz, MB.K, `exactly K=${MB.K} Kenyon cells active (top-5%)`);
  const sum = Array.from(ka).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, "code is unit-sum");
});

test("MB: different seeds give different codes; different features give different codes", () => {
  const a = new MushroomBody(1);
  const b = new MushroomBody(2);
  const ka = a.project(feat());
  const kb = b.project(feat());
  assert.notDeepEqual(Array.from(ka.slice(0, 50)), Array.from(kb.slice(0, 50)));
  const k2 = a.project(feat({ "0": 0.05, "3": 0.1, "8": -2 }));
  assert.notDeepEqual(Array.from(ka), Array.from(k2), "feature change changes the code");
});

test("MB: W starts zero → learnedScores all zero (pure prior at boot)", () => {
  const mb = new MushroomBody(7);
  const scores = mb.learnedScores(mb.project(feat()));
  assert.ok(scores.every((s) => s === 0), "no learned bias before any override");
});

test("MB: dopamine learning raises the overridden-to cell and lowers the vetoed cell", () => {
  const mb = new MushroomBody(7);
  const kc = mb.project(feat());
  const target: GridCell = { row: 1, col: 1 };
  const denied: GridCell = { row: 3, col: 3 };
  mb.learn(kc, target, denied);
  const s = mb.learnedScores(kc);
  assert.ok(s[cellIdx(target)] > 0, "rewarded cell score up");
  assert.ok(s[cellIdx(denied)] < 0, "vetoed cell score down");
  assert.equal(mb.learnCount, 1);
  // repeated learning saturates at the clamp, never diverges
  for (let i = 0; i < 500; i++) mb.learn(kc, target, denied);
  const s2 = mb.learnedScores(kc);
  assert.ok(Math.abs(s2[cellIdx(target)]) <= 9 * 4.0 + 1, "weights stay bounded");
  assert.ok(Number.isFinite(s2[cellIdx(target)]));
});

test("MB: mulberry32 is reproducible", () => {
  const r1 = mulberry32(99); const r2 = mulberry32(99);
  for (let i = 0; i < 10; i++) assert.equal(r1(), r2());
});

function naiveProject(mb: MushroomBody, x: number[]): Float64Array {
  const a = new Float64Array(MB.KC);
  for (let j = 0; j < MB.KC; j++) {
    let s = mb.bias[j];
    const row = j * MB.DIM;
    for (let i = 0; i < MB.DIM; i++) s += mb.P[row + i] * (x[i] ?? 0);
    a[j] = s > 0 ? s : 0;
  }
  const order = Array.from(a.keys()).sort((p, q) => a[q] - a[p]);
  const kc = new Float64Array(MB.KC);
  let sum = 0;
  for (let n = 0; n < MB.K; n++) { const j = order[n]; kc[j] = a[j]; sum += a[j]; }
  if (sum > 0) for (let j = 0; j < MB.KC; j++) kc[j] /= sum;
  return kc;
}

function assertBitIdentical(got: Float64Array, ref: Float64Array, label: string): void {
  assert.equal(got.length, ref.length, `${label}: length`);
  const gotBits = new BigUint64Array(got.buffer, got.byteOffset, got.length);
  const refBits = new BigUint64Array(ref.buffer, ref.byteOffset, ref.length);
  for (let i = 0; i < got.length; i++) {
    assert.equal(gotBits[i], refBits[i], `${label}: bit mismatch at index ${i} (${got[i]} vs ${ref[i]})`);
  }
}

test("MB: min-heap project(x) is bit-for-bit identical to naive sort across random vectors", () => {
  const mb = new MushroomBody();
  const rnd = mulberry32(20261127);
  const firstRef = naiveProject(mb, feat());
  const firstGot = mb.project(feat());
  assertBitIdentical(firstGot, firstRef, "baseline feat()");

  let prev = firstGot;
  for (let trial = 0; trial < 25; trial++) {
    const len = trial === 24 ? 5 : MB.DIM; // also exercise short x (x[i] ?? 0)
    const scale = trial % 3 === 0 ? 0.2 : trial % 3 === 1 ? 1.5 : 8.0;
    const x = Array.from({ length: len }, () => (rnd() * 2 - 1) * scale);
    const got = mb.project(x);
    const ref = naiveProject(mb, x);
    assert.notEqual(got, prev, `trial ${trial}: returns a fresh Float64Array`);
    assertBitIdentical(got, ref, `random trial ${trial}`);
    let nz = 0;
    let sum = 0;
    for (let j = 0; j < MB.KC; j++) {
      if (got[j] !== 0) nz++;
      sum += got[j];
    }
    if (sum > 0) {
      assert.ok(nz <= MB.K && nz > 0, `trial ${trial}: active count ${nz} within 1..${MB.K}`);
      assert.ok(Math.abs(sum - 1) < 1e-12, `trial ${trial}: unit-sum (sum=${sum})`);
    }
    prev = got;
  }
  // Prior reference returned by project() remains immutable across later calls
  assertBitIdentical(firstGot, firstRef, "earlier kc buffer not overwritten");
});

test("MB: min-heap project(x) matches naive tie-breaking on all-zeros and repeated values", () => {
  const zeros = new Array<number>(MB.DIM).fill(0);

  // 1) All-zeros feature vector on default MB (negative bias → all ReLU outputs zero)
  const mbDefault = new MushroomBody(42);
  const zeroGot = mbDefault.project(zeros);
  const zeroRef = naiveProject(mbDefault, zeros);
  assertBitIdentical(zeroGot, zeroRef, "all-zeros vector on default MB");
  assert.equal(zeroGot.reduce((a, b) => a + b, 0), 0);

  // 2) All 2048 activations identical and positive (tie-breaker must pick indices 0..MB.K-1)
  const mbAllEqual = new MushroomBody(42);
  mbAllEqual.P.fill(0);
  mbAllEqual.bias.fill(0.5);
  const eqGot = mbAllEqual.project(zeros);
  const eqRef = naiveProject(mbAllEqual, zeros);
  assertBitIdentical(eqGot, eqRef, "all-equal positive activations");
  let eqNz = 0;
  for (let j = 0; j < MB.KC; j++) {
    if (j < MB.K) assert.ok(eqGot[j] > 0, `index ${j} < K must survive tie`);
    else assert.equal(eqGot[j], 0, `index ${j} >= K must be zeroed`);
    if (eqGot[j] !== 0) eqNz++;
  }
  assert.equal(eqNz, MB.K);
  assert.ok(Math.abs(eqGot.reduce((a, b) => a + b, 0) - 1) < 1e-12);

  // 3) Multi-level repeated plateaus straddling the K=102 cutoff
  const mbPlateau = new MushroomBody(42);
  mbPlateau.P.fill(0);
  const rnd = mulberry32(777);
  for (let j = 0; j < MB.KC; j++) {
    // 4 discrete quantized activation levels so dozens/hundreds tie at every boundary
    mbPlateau.bias[j] = Math.floor(rnd() * 4) * 0.35 - 0.1;
  }
  // Also plant a tight boundary tie around scattered indices: 40 cells at 1.5, 120 at 0.8
  for (let k = 0; k < 40; k++) mbPlateau.bias[(k * 47 + 13) % MB.KC] = 1.5;
  for (let k = 0; k < 120; k++) {
    const idx = (k * 17 + 5) % MB.KC;
    if (mbPlateau.bias[idx] !== 1.5) mbPlateau.bias[idx] = 0.8;
  }
  const platGot = mbPlateau.project(zeros);
  const platRef = naiveProject(mbPlateau, zeros);
  assertBitIdentical(platGot, platRef, "quantized plateau ties straddling K cutoff");
  assert.equal(Array.from(platGot).filter((v) => v !== 0).length, MB.K);
  assert.ok(Math.abs(platGot.reduce((a, b) => a + b, 0) - 1) < 1e-12);

  // 4) Identical feature values across all 14 dimensions with real random projection
  const repX = new Array<number>(MB.DIM).fill(0.37);
  assertBitIdentical(mbDefault.project(repX), naiveProject(mbDefault, repX), "repeated identical feature values");
});

// ── nine-grid decision ──────────────────────────────────────────────────────

test("priorScores: LOW-dominant + high density ranks L-ACTIVE top (nine-grid v0 taste)", () => {
  const p = priorScores({ low: 0.7, mid: 0.1, high: 0.1 }, 8);
  const idx = p.indexOf(Math.max(...p));
  assert.deepEqual(idxCell(idx), { row: 1, col: 3 }, "LOW + ACTIVE");
});

test("priorScores: MID-dominant + low density ranks M-STATIC top", () => {
  const p = priorScores({ low: 0.1, mid: 0.7, high: 0.1 }, 1);
  const idx = p.indexOf(Math.max(...p));
  assert.deepEqual(idxCell(idx), { row: 2, col: 1 });
});

const dropEv = (conf = 0.8): StructureEvent => ({
  type: "drop", tMs: 13000, confidence: conf, reason: "test", novLow: 5, density: 4, bpm: 128,
});
const mkCtx = (mb: MushroomBody, kc: Float64Array | null, lastAutoCell: GridCell | null = null) =>
  ({ lastAutoCell, kc, mb });

test("decideOnEvent: confident drop + LOW-dominant bands → trigger L1 cell (9-choose-1)", () => {
  const mb = new MushroomBody(3);
  const kc = mb.project(feat());
  const d = decideOnEvent(dropEv(), { low: 0.6, mid: 0.1, high: 0.08 }, 4, mkCtx(mb, kc), 13000);
  assert.equal(d.kind, "trigger");
  assert.equal(d.cell?.row, 1, "LOW row");
  assert.equal(d.layer, d.cell?.row);
  assert.equal(d.column, d.cell?.col);
  assert.equal(d.candidates.length, 9, "full nine-grid candidate list");
  assert.ok(d.confidence > CONF_FLOOR);
});

test("decideOnEvent: energy ≤ HOLD floor → hold (CONTEXT Column 規則)", () => {
  const mb = new MushroomBody(3);
  const d = decideOnEvent(dropEv(), { low: 0.005, mid: 0.005, high: 0.005 }, 0, mkCtx(mb, null), 13000);
  assert.equal(d.kind, "hold");
  assert.equal(d.cell, null);
  assert.ok(HOLD_FLOOR === 0.02);
});

test("decideOnEvent: low event confidence → hold (HAX G10)", () => {
  const mb = new MushroomBody(3);
  const d = decideOnEvent(dropEv(0.2), { low: 0.6, mid: 0.1, high: 0.1 }, 4, mkCtx(mb, null), 13000);
  assert.equal(d.kind, "hold");
});

test("anti-repeat bag: auto never fires the same cell twice in a row when a runner-up clears", () => {
  const mb = new MushroomBody(3);
  const kc = mb.project(feat());
  const first = decideOnEvent(dropEv(), { low: 0.6, mid: 0.25, high: 0.25 }, 4, mkCtx(mb, kc, null), 13000);
  assert.equal(first.kind, "trigger");
  const second = decideOnEvent(dropEv(), { low: 0.6, mid: 0.25, high: 0.25 }, 4, mkCtx(mb, kc, first.cell), 14000);
  assert.equal(second.kind, "trigger");
  assert.notDeepEqual(second.cell, first.cell, "bag pushed the auto pick to another cell");
  // override picks ignore the bag
  const ov = decideOnEvent(dropEv(), { low: 0.6, mid: 0.25, high: 0.25 }, 4, mkCtx(mb, kc, first.cell), 15000, "override");
  assert.deepEqual(ov.cell, first.cell, "override不受 bag 限制");
});

test("online learning shifts later auto picks toward the user's overridden cell", () => {
  const mb = new MushroomBody(3);
  const kc = mb.project(feat());
  // (3,3) HIGH-ACTIVE is NOT the prior's pick for near-uniform bands (prior wants MID-MEDIUM)
  const userCell: GridCell = { row: 3, col: 3 };
  const before = decideOnEvent(dropEv(), { low: 0.34, mid: 0.33, high: 0.33 }, 4, mkCtx(mb, kc, null), 13000);
  assert.notDeepEqual(before.cell, userCell, "prior does not already pick the user cell");
  // user overrides to (3,3) many times on the same feature context
  for (let i = 0; i < 40; i++) mb.learn(kc, userCell, before.cell);
  const after = decideOnEvent(dropEv(), { low: 0.34, mid: 0.33, high: 0.33 }, 4, mkCtx(mb, kc, null), 20000);
  assert.equal(after.kind, "trigger");
  assert.deepEqual(after.cell, userCell, `learned taste wins (got ${after.cell ? cellLabel(after.cell) : "null"})`);
});

test("MasterSwitch: AUTO → override suppresses auto → handback restores (HAX G17)", () => {
  const m = new MasterSwitch();
  assert.ok(m.allowsAuto());
  m.overrideTo({ row: 2, col: 2 }, 100);
  assert.equal(m.getMode(), "OVERRIDE");
  assert.deepEqual(m.getOverrideCell(), { row: 2, col: 2 });
  assert.ok(!m.allowsAuto());
  m.hold(200);
  assert.equal(m.getMode(), "HOLD");
  m.handBack(300);
  assert.equal(m.getMode(), "AUTO");
  assert.ok(m.allowsAuto());
});

test("softmax/jevConfidence: peaked=1, uniform=0, sums to 1", () => {
  const p = softmax([0.6, 0.1, 0.1]);
  assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(jevConfidence([1, 0, 0]) - 1) < 1e-9);
  assert.ok(Math.abs(jevConfidence([1 / 3, 1 / 3, 1 / 3])) < 1e-9);
});

// ── dropPulse pose (M3 預留位 → M4 做#4) ───────────────────────────────────

test("bandsToPose: dropPulse=1 on silence → full-body big motion (all parts engaged)", () => {
  const p = bandsToPose({ low: 0, mid: 0, high: 0 }, 0.5, 1);
  assert.equal(p.dropPulse, 1);
  assert.equal(p.body, 1);
  assert.equal(p.wingL, 1);
  assert.ok(Object.values(p.legs).every((v) => v >= 0.6), "legs spread on drop");
});

test("bandsToPose: dropPulse=0 → identical to the M3 rest/reaction behaviour", () => {
  const a = bandsToPose({ low: 0.4, mid: 0.3, high: 0.2 }, 1.23, 0);
  const b = bandsToPose({ low: 0.4, mid: 0.3, high: 0.2 }, 1.23);
  assert.deepEqual(a, b);
  assert.equal(a.dropPulse, 0);
});

// ── M4.5.1 regression tests (docs/M45_1_RECIPE.md §2) ───────────────────────

test("detector: no spurious section event within sectionCooldownMs right after a drop", () => {
  const det = new StructureDetector();
  // groove 0–6s → build-up 6–13s → drop @13s → groove 13–20s (energy settles back down:
  // the OLD code re-anchored sigBase on the drop PEAK, so the settle read as a SECTION
  // 1–3s later — the live-set ping-pong bug).
  const events = run(det, 20000, edmBands);
  const drops = events.filter((e) => e.type === "drop");
  assert.ok(drops.length >= 1, "a drop fired");
  const dropT = drops[0].tMs;
  const sections = events.filter((e) => e.type === "section");
  for (const s of sections) {
    assert.ok(s.tMs - dropT >= DET.sectionCooldownMs, `section @${(s.tMs / 1000).toFixed(2)}s within 5s of drop @${(dropT / 1000).toFixed(2)}s — ping-pong regression`);
    assert.ok(!(s.tMs >= 6000 && s.tMs < 13000), `section must not fire during build-up (t=${(s.tMs / 1000).toFixed(2)}s)`);
  }
});

test("rebalanceBands: acoustic bass-heavy tilt unlocks MID and HIGH rows when they rise above reference", () => {
  const ref = { low: 0.24, mid: 0.04, high: 0.02 }; // measured Kinect-room means
  // MID rises to 0.09 (2.25× its reference) while LOW sits at 0.18 (0.75×) → row 2 wins
  const midBands = { low: 0.18, mid: 0.09, high: 0.02 };
  const midPrior = priorScores(rebalanceBands(midBands, ref), 3);
  assert.equal(idxCell(midPrior.indexOf(Math.max(...midPrior))).row, 2, "MID row unlocked");
  // HIGH rises to 0.06 (3× its reference) → row 3 wins
  const highBands = { low: 0.15, mid: 0.03, high: 0.06 };
  const highPrior = priorScores(rebalanceBands(highBands, ref), 3);
  assert.equal(idxCell(highPrior.indexOf(Math.max(...highPrior))).row, 3, "HIGH row unlocked");
  // Loud bass drop (LOW=0.85, MID=0.12, HIGH=0.11 against a high-bass ref) STILL picks row 1 (LOW)
  const dropBands = { low: 0.85, mid: 0.12, high: 0.11 };
  const dropPrior = priorScores(rebalanceBands(dropBands, { low: 0.35, mid: 0.04, high: 0.015 }), 4);
  assert.equal(idxCell(dropPrior.indexOf(Math.max(...dropPrior))).row, 1, "Bass drop still picks LOW row");
  // total energy is preserved EXACTLY (HOLD_FLOOR semantics unaffected)
  for (const b of [midBands, highBands]) {
    const r = rebalanceBands(b, ref);
    const err = Math.abs(r.low + r.mid + r.high - (b.low + b.mid + b.high));
    assert.ok(err < 1e-9, `total preserved (err=${err})`);
  }
  // zero input → zero output, never NaN
  const z = rebalanceBands({ low: 0, mid: 0, high: 0 }, ref);
  assert.deepEqual(z, { low: 0, mid: 0, high: 0 });
  void BAND_REF_FLOOR;
});

test("MB: exportWeights and loadWeights round-trip preserves learned preferences", () => {
  const mb1 = new MushroomBody(11);
  const kc = mb1.project(feat());
  const cell: GridCell = { row: 2, col: 3 };
  for (let i = 0; i < 5; i++) mb1.learn(kc, cell, null);
  const dump = mb1.exportWeights();
  assert.equal(dump.weights.length, 9 * MB.KC);
  assert.equal(dump.learnCount, 5);
  const mb2 = new MushroomBody(11);
  assert.equal(mb2.loadWeights(dump.weights, dump.learnCount), true);
  const s1 = mb1.learnedScores(kc), s2 = mb2.learnedScores(kc);
  // export serializes with toFixed(5) (JSON-friendly), so compare within that quantization
  for (let i = 0; i < 9; i++) assert.ok(Math.abs(s1[i] - s2[i]) < 1e-3, `cell ${i} score round-trips (Δ=${Math.abs(s1[i] - s2[i])})`);
  assert.equal(mb2.learnCount, 5);
  // invalid payloads are rejected, never half-applied
  assert.equal(mb2.loadWeights([1, 2, 3], 0), false);
});

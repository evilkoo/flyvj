// M4.5 unit tests — AmbientGate = ASYMMETRIC per-band DC removal (architecture consensus):
//   raw < slow → fast DOWN tracking (tauDown 1500ms): floor re-anchors quickly after music
//     stops / breakdowns / mid-song recalibration;
//   raw > slow → very slow UP drift (tauUp 25000ms): 8–16s risers and sustained bass are
//     NOT absorbed (M4 finding: symmetric tau=6s ate long risers on real WAVs).
// Effective = max(0, raw − slow − ε); silence still clamps to 0 at once (M3 contract kept).

import { test } from "node:test";
import assert from "node:assert/strict";
import { AmbientGate } from "../src/dsp.ts";

const DT = 16;
const run = (g: AmbientGate, raw: { low: number; mid: number; high: number }, ms: number) => {
  let out = { low: 0, mid: 0, high: 0 };
  for (let t = 0; t < ms; t += DT) out = g.apply(raw, DT);
  return out;
};

test("gate: calibration window outputs zero, then pre-seeds the baseline", () => {
  const g = new AmbientGate(1200);
  const during = run(g, { low: 0.35, mid: 0.1, high: 0 }, 1100);
  assert.deepEqual(during, { low: 0, mid: 0, high: 0 }, "idle during calibration");
  assert.ok(g.isCalibrating());
  run(g, { low: 0.35, mid: 0.1, high: 0 }, 200);
  assert.ok(!g.isCalibrating());
  const amb = g.ambientNow();
  assert.ok(Math.abs(amb.low - 0.35) < 0.02, `baseline seeded (${amb.low})`);
  const after = run(g, { low: 0.35, mid: 0.1, high: 0 }, 100);
  assert.deepEqual(after, { low: 0, mid: 0, high: 0 }, "room floor alone → 0");
});

test("gate: beat dynamics survive (kick bursts over the floor)", () => {
  const g = new AmbientGate(1200);
  run(g, { low: 0.35, mid: 0.1, high: 0 }, 1400);
  let peak = 0;
  for (let t = 0; t < 4000; t += DT) {
    const phase = (t % 250) / 250;
    const raw = { low: 0.35 + (phase < 0.3 ? 0.45 : 0), mid: 0.1, high: 0 };
    const out = g.apply(raw, DT);
    peak = Math.max(peak, out.low);
  }
  assert.ok(peak > 0.1, `kick peaks ride above the slow baseline (peak=${peak})`);
});

test("gate: music stop → effective 0 immediately (raw < slow clamps at once)", () => {
  const g = new AmbientGate(1200);
  run(g, { low: 0.35, mid: 0.1, high: 0 }, 1400);
  run(g, { low: 0.8, mid: 0.4, high: 0.3 }, 3000);
  const after = run(g, { low: 0.35, mid: 0.1, high: 0 }, 60);
  assert.deepEqual(after, { low: 0, mid: 0, high: 0 }, "raw < slow → clamped 0 at once");
});

test("gate ASYMMETRIC: after music stops the baseline falls FAST (tauDown 1.5s)", () => {
  const g = new AmbientGate(1200);
  run(g, { low: 0.05, mid: 0.05, high: 0 }, 1400);
  run(g, { low: 0.8, mid: 0.4, high: 0.3 }, 6000);       // loud section lifts slow a bit
  const lifted = g.ambientNow().low;
  assert.ok(lifted > 0.05, `baseline lifted by music (${lifted})`);
  run(g, { low: 0.05, mid: 0.05, high: 0 }, 6000);       // silence: fast down-tracking
  const after = g.ambientNow().low;
  assert.ok(after < lifted * 0.35 && after < 0.08, `baseline re-anchored down fast (${after} from ${lifted})`);
});

test("gate ASYMMETRIC: a 12s riser is NOT absorbed (tauUp 25s keeps it above the floor)", () => {
  const g = new AmbientGate(1200);
  run(g, { low: 0.05, mid: 0.05, high: 0.05 }, 1400);
  // riser: HIGH ramps 0.05 → 0.5 over 12s (the M4 case the symmetric gate ate)
  let late = { low: 0, mid: 0, high: 0 };
  for (let t = 0; t < 12000; t += DT) {
    const p = t / 12000;
    late = g.apply({ low: 0.05, mid: 0.05, high: 0.05 + 0.45 * p }, DT);
  }
  assert.ok(late.high > 0.2, `riser still audible at its end (effective=${late.high})`);
  // sustained bass likewise survives a 10s hold
  const g2 = new AmbientGate(1200);
  run(g2, { low: 0.05, mid: 0.05, high: 0.05 }, 1400);
  const held = run(g2, { low: 0.6, mid: 0.2, high: 0.1 }, 10000);
  assert.ok(held.low > 0.3, `sustained bass not absorbed (effective=${held.low})`);
});

test("gate: slow UPWARD fan drift is tracked, just slowly (tauUp semantics, documented tradeoff)", () => {
  const g = new AmbientGate(1200);
  run(g, { low: 0.2, mid: 0.05, high: 0 }, 1400);
  // floor ramps 0.2 → 0.4 over 10s then HOLDS 60s (fans settle): the slow up-tracker
  // eventually re-anchors, but deliberately not within riser timescales.
  let out = { low: 0, mid: 0, high: 0 };
  for (let t = 0; t < 10_000; t += DT) {
    const floor = 0.2 + (t / 10_000) * 0.2;
    out = g.apply({ low: floor, mid: 0.05, high: 0 }, DT);
  }
  const duringRamp = out.low;
  assert.ok(duringRamp > 0.02, "during a fast ramp the floor is NOT instantly eaten (riser-safe)");
  for (let t = 0; t < 60_000; t += DT) out = g.apply({ low: 0.4, mid: 0.05, high: 0 }, DT);
  assert.ok(out.low < 0.05, `settled drift subtracted in the long run (effective=${out.low})`);
  assert.ok(g.ambientNow().low > 0.3, `baseline followed the drift (${g.ambientNow().low})`);
});

test("gate: recalibrate() re-runs the calibration window (mid-song floor correction)", () => {
  const g = new AmbientGate(1200);
  run(g, { low: 0.35, mid: 0.1, high: 0 }, 1400);
  run(g, { low: 0.8, mid: 0.5, high: 0.4 }, 5000);   // music lifts the baseline
  assert.ok(g.ambientNow().low > 0.3, "baseline polluted by music");
  g.recalibrate();
  assert.ok(g.isCalibrating(), "recalibrate re-arms the window");
  const during = run(g, { low: 0.1, mid: 0.05, high: 0 }, 1100); // quiet moment mid-song
  assert.deepEqual(during, { low: 0, mid: 0, high: 0 }, "idle during re-calibration");
  run(g, { low: 0.1, mid: 0.05, high: 0 }, 300);
  assert.ok(!g.isCalibrating());
  assert.ok(Math.abs(g.ambientNow().low - 0.1) < 0.03, `re-anchored to the new floor (${g.ambientNow().low})`);
  const after = run(g, { low: 0.1, mid: 0.05, high: 0 }, 100);
  assert.deepEqual(after, { low: 0, mid: 0, high: 0 }, "new floor subtracted → 0");
});

test("gate: constant tone now persists far longer than the old 6s tau (documented improvement)", () => {
  const g = new AmbientGate(1200);
  run(g, { low: 0.35, mid: 0.1, high: 0 }, 1400);
  const early = run(g, { low: 0.8, mid: 0.1, high: 0 }, 500);
  assert.ok(early.low > 0.3, "tone reacts at first");
  const late = run(g, { low: 0.8, mid: 0.1, high: 0 }, 15_000);
  assert.ok(late.low > 0.2, `constant tone survives 15s now (late=${late.low}) — risers/bass safe`);
});

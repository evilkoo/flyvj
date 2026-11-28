// M3 unit tests — rig mapping (Band-Body Mapping, CONTEXT「三頻身體映射」) + canvas cap math.
// buildCartoonFly creates pure Three.js objects (no WebGL/DOM needed) so it runs under node --test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { bandsToPose } from "../src/model.ts";
import { buildCartoonFly } from "../src/flyrig.ts";
import { computeBackingSize, CANVAS_MAX_W, CANVAS_MAX_H } from "../src/renderer.ts";

const zero = { low: 0, mid: 0, high: 0 };

test("bandsToPose: silence → all pose values 0 (avatar at rest)", () => {
  const p = bandsToPose(zero, 1.0);
  assert.equal(p.body, 0);
  assert.equal(p.head, 0);
  assert.equal(p.wingL, 0);
  assert.equal(p.wingR, 0);
  for (const v of Object.values(p.legs)) assert.equal(v, 0);
});

test("bandsToPose: LOW only drives body+legs; MID/HIGH parts stay 0", () => {
  const p = bandsToPose({ low: 0.9, mid: 0, high: 0 }, 1.0);
  assert.ok(p.body > 0.8, "body driven by LOW");
  assert.ok(Object.values(p.legs).some((v) => v > 0.1), "legs driven by LOW");
  assert.equal(p.head, 0);
  assert.equal(p.wingL, 0);
});

test("bandsToPose: MID only drives head+antennae", () => {
  const p = bandsToPose({ low: 0, mid: 0.9, high: 0 }, 1.0);
  assert.ok(p.head > 0, "head driven by MID");
  assert.ok(p.antennaL + p.antennaR > 0, "antennae driven by MID");
  assert.equal(p.body, 0);
  assert.equal(p.wingL, 0);
});

test("bandsToPose: HIGH only drives wings", () => {
  const p = bandsToPose({ low: 0, mid: 0, high: 0.9 }, 1.0);
  assert.equal(p.wingL, 0.9);
  assert.equal(p.wingR, 0.9);
  assert.equal(p.body, 0);
  assert.equal(p.head, 0);
});

test("bandsToPose: leg taps alternate (phase offsets) at a fixed time", () => {
  const p = bandsToPose({ low: 1, mid: 0, high: 0 }, 0.5);
  const vals = Object.values(p.legs);
  const distinct = new Set(vals.map((v) => v.toFixed(2)));
  assert.ok(distinct.size >= 3, `legs not uniform (distinct=${distinct.size})`);
});

test("rig: cartoon fly exposes every contracted part", () => {
  const { rig } = buildCartoonFly();
  for (const name of ["body", "head", "antennaL", "antennaR", "wingL", "wingR",
    "legFL", "legFR", "legML", "legMR", "legBL", "legBR"] as const) {
    assert.ok(rig.part(name), `part ${name} exists`);
  }
});

test("rig: apply(silence pose) → rest; apply(LOUD pose) → parts visibly move", () => {
  const { rig } = buildCartoonFly();
  const rest = rig.pose(zero, 0);
  rig.apply(rest);
  const wingL = rig.part("wingL")!;
  const body = rig.part("body")!;
  const head = rig.part("head")!;
  const restWingZ = wingL.rotation.z;
  const restBodyY = body.position.y;
  const loud = rig.pose({ low: 1, mid: 1, high: 1 }, 0.37);
  rig.apply(loud);
  assert.notEqual(body.position.y, restBodyY, "body moved (LOW bob)");
  assert.ok(Math.abs(head.rotation.x) + Math.abs(head.rotation.z) > 0.01, "head moved (MID)");
  assert.notEqual(wingL.rotation.z, restWingZ, "wing moved (HIGH flap)");
  rig.dispose(); // must not throw
});

test("rig: dispose() empties the disposal registry (no leak on rebuild)", () => {
  const { rig, disposal } = buildCartoonFly();
  assert.ok(disposal.geometries.size > 20, "geometries tracked");
  assert.ok(disposal.materials.size > 5, "materials tracked");
  rig.dispose();
  assert.equal(disposal.geometries.size, 0);
  assert.equal(disposal.materials.size, 0);
});

test("canvas cap (b): backing store never exceeds 1280×720 for any CSS/DPR combo", () => {
  const cases: [number, number, number][] = [
    [960, 540, 1], [960, 540, 2], [1920, 1080, 2], [3840, 2160, 3],
    [1280, 720, 1], [640, 360, 1], [100, 100, 4], [1281, 721, 1],
  ];
  for (const [w, h, dpr] of cases) {
    const r = computeBackingSize(w, h, dpr);
    assert.ok(r.w <= CANVAS_MAX_W && r.h <= CANVAS_MAX_H, `${w}×${h}@${dpr} → ${r.w}×${r.h} exceeds cap`);
    assert.ok(r.w >= 1 && r.h >= 1, "non-degenerate");
  }
});

test("canvas cap (b): aspect ratio preserved when clamping", () => {
  const r = computeBackingSize(1920, 1080, 2);
  const ratio = r.w / r.h;
  assert.ok(Math.abs(ratio - 16 / 9) < 0.02, `16:9 preserved (got ${ratio})`);
});

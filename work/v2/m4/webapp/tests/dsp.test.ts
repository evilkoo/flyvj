// M3 unit tests — DSP contracts (SPEC §M3 驗收契約 (a) 嘅數學部分).
// Runs directly on the .ts source via `node --test` (erasable syntax only).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FFT_SIZE, ATTACK_MS, RELEASE_MS, BAND_DEFS, binRange, bandEnergies, BandSmoother,
  ZERO_EPS,
} from "../src/dsp.ts";

const RATE = 48000; // typical; bin math must also hold at 44100

test("binRange: LOW/MID/HIGH cover the contracted Hz ranges at 48k", () => {
  const [l0, l1] = binRange(RATE, FFT_SIZE, BAND_DEFS.LOW.min, BAND_DEFS.LOW.max);
  const [m0, m1] = binRange(RATE, FFT_SIZE, BAND_DEFS.MID.min, BAND_DEFS.MID.max);
  const [h0, h1] = binRange(RATE, FFT_SIZE, BAND_DEFS.HIGH.min, BAND_DEFS.HIGH.max);
  const binHz = RATE / FFT_SIZE; // 23.4375
  // boundaries contiguous, no gaps/overlaps beyond bin quantisation
  assert.ok(l0 >= 1, "LOW starts above DC");
  assert.ok(l1 <= m0, "LOW ends before/at MID start");
  assert.ok(m1 <= h0, "MID ends before/at HIGH start");
  assert.ok(Math.abs(l0 * binHz - 30) < binHz * 1.5, "LOW starts ~30Hz");
  assert.ok(Math.abs(h1 * binHz - 8000) < binHz * 2, "HIGH ends ~8000Hz");
});

test("binRange: HIGH upper bound clamps to Nyquist (44.1k → 22050)", () => {
  const [, h1] = binRange(44100, FFT_SIZE, 2500, 8000);
  assert.ok(h1 * (44100 / FFT_SIZE) <= 8000 + 44100 / FFT_SIZE, "never above min(8000, Nyquist)");
  const [, h1Low] = binRange(12000, FFT_SIZE, 2500, 8000); // Nyquist 6000 < 8000
  assert.ok(h1Low * (12000 / FFT_SIZE) <= 6000 + 2 * (12000 / FFT_SIZE), "clamped to Nyquist when Nyquist < 8000");
});

test("bandEnergies: synthetic spectra land in the right band only", () => {
  const bins = FFT_SIZE / 2;
  const binHz = RATE / FFT_SIZE;
  const mk = (hz: number) => {
    const buf = new Uint8Array(bins);
    const idx = Math.round(hz / binHz);
    for (let i = Math.max(0, idx - 2); i <= Math.min(bins - 1, idx + 2); i++) buf[i] = 255;
    return buf;
  };
  const low = bandEnergies(mk(100), RATE, FFT_SIZE);
  assert.ok(low.low > low.mid && low.low > low.high, "100Hz tone → LOW dominant");
  const mid = bandEnergies(mk(1000), RATE, FFT_SIZE);
  assert.ok(mid.mid > mid.low && mid.mid > mid.high, "1kHz tone → MID dominant");
  const high = bandEnergies(mk(5000), RATE, FFT_SIZE);
  assert.ok(high.high > high.low && high.high > high.mid, "5kHz tone → HIGH dominant");
  const silence = bandEnergies(new Uint8Array(bins), RATE, FFT_SIZE);
  assert.deepEqual(silence, { low: 0, mid: 0, high: 0 });
});

test("smoother: attack is faster than release (50ms vs 220ms time constants)", () => {
  const s = new BandSmoother();
  const hot = { low: 1, mid: 1, high: 1 };
  const cold = { low: 0, mid: 0, high: 0 };
  // 50ms of attack in 10ms steps
  let v = s.update(hot, 10);
  for (let i = 0; i < 4; i++) v = s.update(hot, 10);
  const afterAttack50 = v.low;
  assert.ok(afterAttack50 > 0.6, `50ms attack reaches >60% (got ${afterAttack50})`);
  // now release: 50ms of decay from that level
  let r = s.update(cold, 10);
  for (let i = 0; i < 4; i++) r = s.update(cold, 10);
  const dropped = afterAttack50 - r.low;
  assert.ok(dropped < afterAttack50 * 0.35, `50ms release drops <35% (dropped ${dropped})`);
  assert.ok(ATTACK_MS < RELEASE_MS, "contract constants: attack < release");
});

test("smoother: full-scale → exactly 0 within 2s of silence (contract (a))", () => {
  const s = new BandSmoother();
  const hot = { low: 1, mid: 1, high: 1 };
  for (let i = 0; i < 20; i++) s.update(hot, 50); // saturate ~1s
  assert.ok(s.current().low > 0.99, "saturated");
  const cold = { low: 0, mid: 0, high: 0 };
  let t = 0;
  let zeroAt = -1;
  while (t < 4000) {
    const v = s.update(cold, 20); // 50fps
    t += 20;
    if (v.low === 0 && v.mid === 0 && v.high === 0) { zeroAt = t; break; }
  }
  assert.ok(zeroAt > 0, "reaches zero");
  assert.ok(zeroAt <= 2000, `zero within 2s contract (took ${zeroAt}ms)`);
});

test("smoother: raw under silence gate is treated as 0 (room noise floor)", () => {
  const s = new BandSmoother();
  for (let i = 0; i < 40; i++) s.update({ low: 1, mid: 1, high: 1 }, 25);
  const noisy = { low: 0.004, mid: 0.002, high: 0.006 }; // under SILENCE_GATE 0.008
  let t = 0;
  let v = s.current();
  while (t < 4000 && !(v.low === 0 && v.mid === 0 && v.high === 0)) {
    v = s.update(noisy, 20);
    t += 20;
  }
  assert.ok(t <= 2000, `noise-floor input still zeroes within 2s (took ${t}ms)`);
  assert.ok(ZERO_EPS > 0);
});

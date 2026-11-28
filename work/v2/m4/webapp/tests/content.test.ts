// M4.7 C1 content-layer unit tests — chroma extraction/cosine novelty, raw groove +
// anti-drop breakdown, kick-return drop, false-drop suppression, YAMNet vocal hysteresis,
// fused arrangement shift with shared cooldowns, and the decision-layer cellBias /
// precision-floor hooks. CONTRACT-LEVEL behaviour only (no accuracy claims).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ContentAnalyzer, cosineDistance, extractChroma12,
  type ContentCue, type SemanticFrame,
} from "../src/content.ts";
import { decideOnEvent, MushroomBody } from "../src/decision.ts";
import type { BandEnergy } from "../src/dsp.ts";
import type { GridCell, StructureEvent } from "../src/detector.ts";

const cell = (row: 1 | 2 | 3, col: 1 | 2 | 3): GridCell => ({ row, col });

const frame = (tMs: number, over: Partial<SemanticFrame> = {}): SemanticFrame => ({
  tMs, ready: true, music: 0.9, electronic: 0.1, vocalChant: 0.05, drums: 0.1,
  silence: 0.02, yamnetNovelty: 0.05, topClass: "Music", inferMs: 25, ...over,
});

// ── chroma extraction / cosine novelty ──────────────────────────────────────

test("extractChroma12: L1-normalised 12 bins, A4=440Hz peaks in bin 0, silence → zeros", () => {
  const sr = 48000;
  const fft = 2048;
  const freq = new Uint8Array(fft / 2);
  freq[19] = 255; // 19 × 23.44Hz ≈ 445Hz ≈ A4
  const chroma = extractChroma12(freq, sr, fft);
  assert.equal(chroma.length, 12);
  const sum = chroma.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `L1 norm (got ${sum})`);
  assert.equal(chroma.indexOf(Math.max(...chroma)), 0, "A pitch class");
  assert.ok(chroma[0] > 0.99);

  const silence = extractChroma12(new Uint8Array(fft / 2), sr, fft);
  assert.deepEqual(silence, new Array<number>(12).fill(0));
});

test("cosineDistance: identical → 0, orthogonal → 1, zero vector → 0, clamped", () => {
  assert.equal(cosineDistance([1, 0, 0], [1, 0, 0]), 0);
  assert.equal(cosineDistance([1, 0], [0, 1]), 1);
  assert.equal(cosineDistance([0, 0], [1, 0]), 0);
  assert.equal(cosineDistance([1, 0], [-1, 0]), 1, "clamped to 1");
  const d = cosineDistance([1, 0], [1, 1]);
  assert.ok(Math.abs(d - (1 - 1 / Math.sqrt(2))) < 1e-12);
});

// ── raw groove / breakdown / kick-return ────────────────────────────────────

test("ContentAnalyzer: bass collapse after a groove → breakdown cue with STATIC col-1 bias", () => {
  const c = new ContentAnalyzer();
  const cues: ContentCue[] = [];
  const pushLocal = (q: ContentCue | null): void => { if (q) cues.push(q); };
  const rawGroove: BandEnergy = { low: 0.6, mid: 0.2, high: 0.1 };
  const grooveParams = { density: 3.5, regularity: 0.6, novLow: 0.5, bpm: 128, cell: { row: 1 as const, col: 1 as const } };

  for (let t = 0; t <= 5000; t += 50) {
    pushLocal(c.updateSample({ tMs: t, raw: rawGroove, ...grooveParams }));
  }
  assert.equal(cues.length, 0, "steady groove emits nothing");

  const rawBroken: BandEnergy = { low: 0.05, mid: 0.15, high: 0.08 };
  const brokenParams = { density: 1.2, regularity: 0.3, novLow: 0.4, bpm: 128 as number | null, cell: cell(2, 1) };
  let t = 5050;
  for (; t <= 8400; t += 50) {
    pushLocal(c.updateSample({ tMs: t, raw: rawBroken, ...brokenParams }));
  }
  const bd = cues.find((q) => q.cueKind === "breakdown");
  assert.ok(bd, "expected a breakdown cue");
  assert.deepEqual(bd.cellBias, [0.55, 0, 0, 0.55, 0, 0, 0.55, 0, 0], "STATIC col 1 bias");
  assert.equal(bd.event.type, "section");
  assert.equal(bd.event.reason, "C1 BREAKDOWN anti-drop");
  assert.ok(Math.abs(bd.event.confidence - 0.72) < 1e-9);
  assert.equal(c.inBreakdown, true);
  assert.equal(cues.filter((q) => q.cueKind === "breakdown").length, 1, "breakdown fires once");

  const kick: BandEnergy = { low: 0.6, mid: 0.2, high: 0.1 };
  pushLocal(c.updateSample({ tMs: t, raw: kick, ...grooveParams }));
  const dr = cues.find((q) => q.cueKind === "drop-return");
  assert.ok(dr, "kick return after the dip must emit drop-return");
  assert.deepEqual(dr.cellBias, [0, 0.55, 0.55, 0, 0, 0, 0, 0, 0], "LOW-MEDIUM / LOW-ACTIVE bias");
  assert.equal(dr.event.type, "drop");
  assert.equal(dr.event.reason, "C1 DROP kick-return");
  assert.equal(c.inBreakdown, false, "drop-return clears the breakdown");
  assert.equal(c.state().lastCue, "drop-return");
});

test("shouldAllowBaselineDrop: ambient swells / breakdown bumps / speech rejected; legacy allowed", () => {
  const c = new ContentAnalyzer();
  assert.equal(c.shouldAllowBaselineDrop(undefined, 0, 1000), true, "legacy band-only mode passes");
  assert.equal(
    c.shouldAllowBaselineDrop({ low: 0.2, mid: 0.15, high: 0.1 }, 1.0, 1000), false,
    "ambient low-density intro swell",
  );

  for (let t = 0; t <= 5000; t += 50) {
    c.updateSample({ tMs: t, raw: { low: 0.6, mid: 0.2, high: 0.1 }, density: 3.5, regularity: 0.6, novLow: 0.5, bpm: 128, cell: cell(1, 1) });
  }
  assert.equal(
    c.shouldAllowBaselineDrop({ low: 0.3, mid: 0.2, high: 0.1 }, 3.5, 6000), false,
    "mid-breakdown bump below the groove reference",
  );
  assert.equal(
    c.shouldAllowBaselineDrop({ low: 0.55, mid: 0.2, high: 0.1 }, 3.5, 6000), true,
    "genuine bass return passes",
  );

  const speech = new ContentAnalyzer();
  speech.updateSemantic(frame(1000, { music: 0.1, vocalChant: 0.1, topClass: "Speech", silence: 0.6 }));
  assert.equal(
    speech.shouldAllowBaselineDrop({ low: 0.5, mid: 0.4, high: 0.2 }, 3.5, 1200), false,
    "YAMNet non-music frame (speech/crowd)",
  );
});

test("vocal entry cooldown: high salience (≥0.70) bypasses to 2.5s, moderate waits without latching", () => {
  const c = new ContentAnalyzer();
  c.noteAutoTrigger(10000, false);
  const hot = c.updateSemantic(frame(13000, { vocalChant: 0.85, topClass: "Singing" }));
  assert.ok(hot, "high-salience vocal entry 3s after a section must fire");
  assert.equal(hot.cueKind, "vocal-entry");
  assert.equal(hot.event.type, "section");
  assert.deepEqual(hot.cellBias, [0, 0, 0, 0.55, 0, 0, 0.55, 0.55, 0]);
  assert.equal(c.state().vocalActive, true);

  const c2 = new ContentAnalyzer();
  c2.noteAutoTrigger(20000, false);
  assert.equal(
    c2.updateSemantic(frame(22000, { vocalChant: 0.58 })), null,
    "moderate entry inside the 4.5s cooldown does not fire",
  );
  assert.equal(c2.state().vocalActive, false, "moderate entry must not silently latch vocalActive");
  const fired = c2.updateSemantic(frame(25000, { vocalChant: 0.58 }));
  assert.ok(fired, "the same moderate entry fires once the cooldown clears");
  assert.equal(fired.cueKind, "vocal-entry");
  assert.equal(c2.state().vocalActive, true);
});

// ── YAMNet vocal hysteresis ─────────────────────────────────────────────────

test("vocal hysteresis: entry ≥0.55, exit <0.20 sustained 3s", () => {
  const c = new ContentAnalyzer();
  c.updateSample({ tMs: 500, raw: { low: 0.3, mid: 0.2, high: 0.1 }, density: 3, regularity: 0.5, novLow: 0.6, bpm: 128, cell: cell(2, 2) });

  const entry = c.updateSemantic(frame(1000, { vocalChant: 0.6, topClass: "Singing" }));
  assert.ok(entry, "vocal entry cue");
  assert.equal(entry.cueKind, "vocal-entry");
  assert.deepEqual(entry.cellBias, [0, 0, 0, 0.55, 0, 0, 0.55, 0.55, 0]);
  assert.equal(entry.event.type, "section");
  assert.match(entry.event.reason, /C1 VOCAL\/CHANT entry \(Singing\)/);
  assert.equal(c.state().vocalActive, true);

  assert.equal(c.updateSemantic(frame(1500, { vocalChant: 0.3 })), null, "mid band holds state");
  assert.equal(c.updateSemantic(frame(2000, { vocalChant: 0.1 })), null, "exit needs 3s sustain");
  assert.equal(c.updateSemantic(frame(3000, { vocalChant: 0.1 })), null);

  const exit = c.updateSemantic(frame(5600, { vocalChant: 0.1 }));
  assert.ok(exit, "sustained vocal loss emits exit");
  assert.equal(exit.cueKind, "vocal-exit");
  assert.deepEqual(exit.cellBias, [0, 0.48, 0, 0, 0.48, 0.48, 0, 0, 0]);
  assert.equal(exit.event.reason, "C1 VOCAL/CHANT exit");
  assert.equal(c.state().vocalActive, false);
});

test("vocal exit shortcut: YAMNet novelty ≥0.38 exits before the 3s sustain", () => {
  const c = new ContentAnalyzer();
  assert.ok(c.updateSemantic(frame(1000, { vocalChant: 0.6 })));
  assert.equal(c.updateSemantic(frame(3000, { vocalChant: 0.1 })), null, "novelty still low");
  const exit = c.updateSemantic(frame(5600, { vocalChant: 0.1, yamnetNovelty: 0.5 }));
  assert.ok(exit, "novelty jump exits early");
  assert.equal(exit.cueKind, "vocal-exit");
  assert.equal(c.state().vocalActive, false);
});

// ── fused arrangement shift + shared cooldown ───────────────────────────────

test("arrangement shift: YAMNet novelty fires with 4.5s cooldown; chroma drives it in updateSample", () => {
  const c = new ContentAnalyzer();
  const first = c.updateSemantic(frame(1000, { yamnetNovelty: 0.5 }));
  assert.ok(first, "strong YAMNet novelty emits arrangement");
  assert.equal(first.cueKind, "arrangement");
  assert.match(first.event.reason, /^C1 ARRANGEMENT shift \(\d\.\d{2}\)/);
  assert.deepEqual(first.cellBias, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.ok(first.event.confidence >= 0.55 && first.event.confidence <= 0.88);
  assert.equal(c.updateSemantic(frame(2000, { yamnetNovelty: 0.5 })), null, "shared 4.5s cooldown");
  assert.ok(c.updateSemantic(frame(5600, { yamnetNovelty: 0.5 })), "cooldown cleared after 4.6s");

  const c2 = new ContentAnalyzer();
  const cues: ContentCue[] = [];
  const a = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const b = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let t = 0; t <= 3450; t += 50) {
    const q = c2.updateSample({ tMs: t, density: 3, regularity: 0.6, novLow: 0.5, chroma: a, bpm: 128, cell: cell(1, 1) });
    if (q) cues.push(q);
  }
  for (let t = 3500; t <= 5400; t += 50) {
    const q = c2.updateSample({ tMs: t, density: 3, regularity: 0.6, novLow: 0.5, chroma: b, bpm: 128, cell: cell(1, 1) });
    if (q) cues.push(q);
  }
  assert.ok(cues.some((q) => q.cueKind === "arrangement"), "chroma pivot emits arrangement without YAMNet");
  assert.ok(c2.chromaNovelty > 0.2, `chroma novelty tracked (${c2.chromaNovelty})`);
});

test("canAutoTrigger: 4.5s section cooldown, 2.5s post-section drop allowance, 4.5s drop cooldown", () => {
  const c = new ContentAnalyzer();
  c.noteAutoTrigger(10000, false);
  assert.equal(c.canAutoTrigger(12000, true), false, "drop within 2.5s of a section is blocked");
  assert.equal(c.canAutoTrigger(12500, true), true, "drop ≥2.5s after a section is allowed");
  assert.equal(c.canAutoTrigger(14000, false), false);
  assert.equal(c.canAutoTrigger(14500, false), true);

  c.noteAutoTrigger(20000, true);
  assert.equal(c.canAutoTrigger(24499, true), false, "4.5s drop cooldown");
  assert.equal(c.canAutoTrigger(24500, true), true);
  assert.equal(c.canAutoTrigger(23000, false), false, "drops also arm the section cooldown");
});

// ── M4.8 adaptive relative density + independent hi-hat lift ────────────────

const PULSE_PERIOD = 192; // 12 samples @16ms → ~5.2 HIGH pulses/s
const PULSE_ON = 64;      // 4 samples on (64ms hat ring)

/** Steady low groove + a HIGH hat layer that is either flat (floor) or pulsing (lift). */
const hiHatRaw = (tMs: number, base: number, peak: number, pulsing: boolean): BandEnergy => ({
  low: 0.45,
  mid: 0.12,
  high: pulsing && tMs % PULSE_PERIOD < PULSE_ON ? peak : base,
});

function driveHats(
  c: ContentAnalyzer, from: number, to: number, base: number, peak: number, pulsing: boolean, density = 2.0,
): ContentCue[] {
  const out: ContentCue[] = [];
  for (let t = from; t <= to; t += 16) {
    const q = c.updateSample({
      tMs: t, raw: hiHatRaw(t, base, peak, pulsing), density,
      regularity: 0.5, novLow: 0.5, bpm: 128, cell: cell(1, 1),
    });
    if (q) out.push(q);
  }
  return out;
}

test("M4.8 hihat-lift: clean-level HIGH pulses (0.20→0.45) latch, force Col 3, release after 2s", () => {
  const c = new ContentAnalyzer();
  driveHats(c, 0, 8000, 0.20, 0.20, false); // settle fast/slow at the clean floor
  const cues = driveHats(c, 8016, 10400, 0.20, 0.45, true);

  const lift = cues.find((q) => q.cueKind === "hihat-lift");
  assert.ok(lift, "clean-level hi-hat lift cue");
  assert.equal(lift.event.type, "section");
  assert.equal(lift.event.reason, "C1 HI-HAT lift (high pulse)");
  assert.ok(Math.abs(lift.event.confidence - 0.74) < 1e-9);
  assert.deepEqual(lift.cellBias, [0, 0.20, 0.45, 0, 0.35, 0.55, 0, 0.40, 0.65]);
  assert.equal(c.state().hiHatActive, true);
  assert.equal(c.state().lastCue, "hihat-lift");
  assert.ok(c.getEffectiveDensity() >= 6.0, `ACTIVE Col 3 tier while lifted (${c.getEffectiveDensity()})`);

  // Hats stop → fast falls back under slow*1.10 and the onset window empties → 2s release
  driveHats(c, 10416, 15600, 0.20, 0.45, false);
  assert.equal(c.state().hiHatActive, false, "hi-hat lift releases after the 2s low hysteresis");
  const back = c.getEffectiveDensity();
  assert.ok(back >= 2.5 && back < 6.0, `returns to Col 2 MEDIUM (${back})`);
});

test("M4.8 hihat-lift: quieter room-mic HIGH pulses (0.04→0.11) lift at density ~2/s", () => {
  const c = new ContentAnalyzer();
  driveHats(c, 0, 8000, 0.04, 0.04, false); // room-mic floor, no hats
  assert.equal(c.state().hiHatActive, false);
  const cues = driveHats(c, 8016, 10400, 0.04, 0.11, true);

  assert.ok(cues.some((q) => q.cueKind === "hihat-lift"), "mic-level hi-hat lift cue");
  assert.equal(c.state().hiHatActive, true);
  assert.ok(
    c.getEffectiveDensity() >= 6.0,
    `mic density ~2/s still reaches Col 3 (${c.getEffectiveDensity()})`,
  );
});

test("M4.8 effectiveDensity: steady groove (density ~2/s) sits in Col 2 MEDIUM", () => {
  const c = new ContentAnalyzer();
  for (let t = 0; t <= 3000; t += 16) {
    c.updateSample({
      tMs: t, raw: { low: 0.45, mid: 0.12, high: 0.04 }, density: 2.0,
      regularity: 0.5, novLow: 0.4, bpm: 128, cell: cell(1, 1),
    });
  }
  const d = c.getEffectiveDensity();
  assert.ok(d >= 2.5 && d < 6.0, `Col 2 MEDIUM tier (${d})`);
  const st = c.state();
  assert.equal(st.effectiveDensity, d);
  assert.equal(st.hiHatActive, false);
});

// ── decision-layer hooks ────────────────────────────────────────────────────

const bands: BandEnergy = { low: 0.6, mid: 0.25, high: 0.25 };
const ev = (confidence: number): StructureEvent => ({
  type: "section", tMs: 5000, confidence, reason: "C1 BREAKDOWN anti-drop", novLow: 1, density: 4, bpm: 128,
});

test("decideOnEvent: cellBias steers the prior pick (C1 cue signature)", () => {
  const mb = new MushroomBody(3);
  const plain = decideOnEvent(ev(0.72), bands, 4, { lastAutoCell: null, kc: null, mb }, 5000);
  assert.equal(plain.kind, "trigger");
  assert.deepEqual(plain.cell, { row: 1, col: 2 }, "prior pick without a bias");

  const bias = [0, 0, 0, 0, 0, 0, 0, 0, 2.5];
  const biased = decideOnEvent(ev(0.72), bands, 4, { lastAutoCell: null, kc: null, mb, cellBias: bias }, 5000);
  assert.equal(biased.kind, "trigger");
  assert.deepEqual(biased.cell, { row: 3, col: 3 });
  assert.deepEqual(biased.candidates[0].cell, { row: 3, col: 3 });
});

test("decideOnEvent: strong event (≥0.70) may fire at the 0.15 precision floor", () => {
  const mb = new MushroomBody(3);
  const strong = decideOnEvent(ev(0.75), bands, 4, { lastAutoCell: null, kc: null, mb, bandFloor: 0.9 }, 5000);
  assert.equal(strong.kind, "trigger", "eff floor drops to 0.15 for strong events");
  const weak = decideOnEvent(ev(0.69), bands, 4, { lastAutoCell: null, kc: null, mb, bandFloor: 0.9 }, 5000);
  assert.equal(weak.kind, "hold", "below 0.70 the full 0.9 floor still applies");
});

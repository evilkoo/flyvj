// M4.5 decision layer — fly-brain-inspired Mushroom Body (MB) sparse coding → nine-grid
// (9-choose-1) clip selection (PURE module; runs in the Web Worker, contract (d)).
// Architecture (docs/research/flybrain-decision-models.md + CONTEXT「昆蟲腦啟發架構」):
//   feature vector x (14 dims: LOW/MID/HIGH instant, 1s EMA ×3, 4s EMA ×3, slopes ×2,
//     novLow, density, regularity)
//   → FIXED random projection P [2048 × 14] (seeded, deterministic — no training data)
//   → ReLU → k-WTA top-5% (102 Kenyon Cells) → sparse code kc
//   → logits = priorScores(cell) + learnGain · (W[9 × 2048] · kc) → softmax → Jev confidence
// W starts at ZERO: behaviour = the M4-tuned prior (band dominance × motion tier).
// Dopamine-RPE online learning: a user override to cell c strengthens W[c] along the KC
// code active at that moment and suppresses the cell the auto system had just chosen
// (the vetoed one) — the AI drifts toward the user's taste with use.
// Anti-repeat bag (Resolume Autopilot "Bag" philosophy, HAX G12): auto never fires the
// same cell twice in a row when another candidate clears the floor.
// HAX G10: low confidence → HOLD. HAX G17: AUTO/OVERRIDE/HOLD master states.
// Erasable-syntax-only for node --test.

import type { BandEnergy } from "./dsp.ts";
import type { GridCell, StructureEvent } from "./detector.ts";
import { cellLabel } from "./detector.ts";

export const HOLD_FLOOR = 0.02;      // CONTEXT Column 規則: total ≤0.02 → HOLD
export const CONF_FLOOR = 0.40;      // below this an EVENT does not auto-fire (G10)
/** M4.5.1: band-distribution floor for REBALANCED decisions. rebalanceBands deliberately
 * compresses the share spread (it compensates the mic's spectral tilt), so Jev confidence
 * on rebalanced bands sits naturally ~0.25–0.45 where raw bands gave 0.45–0.8. The EVENT
 * floor (CONF_FLOOR) still guards "is this a real structural moment" (G10); this floor
 * only decides "may we auto-pick a cell". Tuned on the M4.5.1 acceptance regression
 * (rebalanced drop: event 0.80 / grid 0.27 → must fire, not HOLD). */
export const GRID_FLOOR_BALANCED = 0.20;
export const CANDIDATE_N = 9;        // nine-grid: full candidate list (n-best display)

export const MB = {
  KC: 2048,            // Kenyon cells
  K: 102,              // top-5% k-WTA survivors
  DIM: 14,             // feature vector length
  SEED: 1597463809,    // fixed seed → reproducible random projection (no training data)
} as const;

export const LEARN = {
  etaPos: 3.0,         // dopamine reward: strengthen the overridden-to cell (per override
                       //   ≈ +0.03 logit on the active KC code — ~10 overrides = noticeable)
  etaNeg: 1.2,         // RPE negative: suppress the vetoed auto choice
  wMax: 4.0,           // weight clamp (keeps the learned term from drowning the prior)
  learnGain: 1.0,      // scale of W·kc in the logits
} as const;

export type MasterMode = "AUTO" | "OVERRIDE" | "HOLD";
export type TriggerMode = "clip" | "column";   // M4.5: precision clip trigger (default) vs legacy column

export interface CellCandidate {
  cell: GridCell;
  idx: number;         // 0..8 (row-1)*3 + (col-1)
  score: number;       // logit
  prob: number;        // softmax probability
}

export interface Decision {
  kind: "trigger" | "hold";
  cell: GridCell | null;           // chosen nine-grid cell or null when holding
  layer: number | null;            // = cell.row (Resolume layer 1..3)
  column: number | null;           // = cell.col (legacy compat / column mode)
  candidates: CellCandidate[];     // n-best sorted desc (cockpit 3×3 display)
  confidence: number;              // Jev formula over candidate probs
  reason: string;                  // one-line ticker text (HAX G11)
  event: StructureEvent | null;    // originating structure event
  tMs: number;
  source: "auto" | "override";
}

/** Softmax over scores with temperature; pure helper (unit-tested).
 * M4.5: the nine-grid logits are ENGINEERED prior scores (share×2.2 + colScore), not raw
 * band energies, so the M4 0.15 tuning no longer applies. 0.35 keeps the n-best list
 * readable (runner-up probs ≥5% so the anti-repeat bag can act) while a genuinely
 * dominant signature still yields Jev confidence ≥ CONF_FLOOR. */
export function softmax(scores: number[], temperature = 0.35): number[] {
  const t = Math.max(1e-6, temperature);
  const m = Math.max(...scores);
  const ex = scores.map((s) => Math.exp((s - m) / t));
  const sum = ex.reduce((a, b) => a + b, 0) || 1;
  return ex.map((e) => e / sum);
}

/** Jev confidence formula: (p_max − 1/n)/(1 − 1/n). n=1 or uniform → 0. */
export function jevConfidence(probs: number[]): number {
  const n = probs.length;
  if (n <= 1) return 0;
  const pMax = Math.max(...probs);
  return (pMax - 1 / n) / (1 - 1 / n);
}

/** Deterministic PRNG (mulberry32) so the random projection is reproducible across runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const cellIdx = (c: GridCell): number => (c.row - 1) * 3 + (c.col - 1);
export const idxCell = (i: number): GridCell => ({ row: (Math.floor(i / 3) + 1) as 1 | 2 | 3, col: ((i % 3) + 1) as 1 | 2 | 3 });

/**
 * Mushroom Body: fixed random projection → ReLU → top-5% k-WTA sparse code, plus the
 * 9×2048 plastic weight matrix W (dopamine-RPE online learning).
 */
export class MushroomBody {
  readonly P: Float64Array;   // KC × DIM
  readonly bias: Float64Array;
  W: Float64Array;            // 9 × KC (starts zero = pure prior behaviour)
  learnCount = 0;
  private readonly actBuf = new Float64Array(MB.KC);
  private readonly topVal = new Float64Array(MB.K);
  private readonly topIdx = new Int32Array(MB.K);

  constructor(seed: number = MB.SEED) {
    const rnd = mulberry32(seed);
    this.P = new Float64Array(MB.KC * MB.DIM);
    this.bias = new Float64Array(MB.KC);
    for (let i = 0; i < this.P.length; i++) this.P[i] = (rnd() * 2 - 1);
    for (let j = 0; j < MB.KC; j++) this.bias[j] = -0.15; // sparsify pre-WTA
    this.W = new Float64Array(9 * MB.KC);
  }

  /** Sift node `i` down within a min-heap of length `size` (root 0 = worst of top-K). */
  private siftDown(i: number, size: number): void {
    const tv = this.topVal;
    const ti = this.topIdx;
    const v = tv[i];
    const idx = ti[i];
    const half = size >> 1;
    while (i < half) {
      let child = (i << 1) + 1;
      const right = child + 1;
      if (right < size) {
        const rv = tv[right];
        const cv = tv[child];
        if (rv < cv || (rv === cv && ti[right] > ti[child])) child = right;
      }
      const wv = tv[child];
      if (v < wv || (v === wv && idx > ti[child])) break;
      tv[i] = wv;
      ti[i] = ti[child];
      i = child;
    }
    tv[i] = v;
    ti[i] = idx;
  }

  /** Project features → sparse Kenyon-cell code (unit-sum, exactly MB.K nonzero). */
  project(x: number[]): Float64Array {
    const a = this.actBuf;
    const tv = this.topVal;
    const ti = this.topIdx;
    for (let j = 0; j < MB.KC; j++) {
      let s = this.bias[j];
      const row = j * MB.DIM;
      for (let i = 0; i < MB.DIM; i++) s += this.P[row + i] * (x[i] ?? 0);
      a[j] = s > 0 ? s : 0; // ReLU
    }
    // k-WTA: O(KC · log K) fixed-size min-heap with exact tie-breaking parity to stable sort
    for (let j = 0; j < MB.K; j++) {
      tv[j] = a[j];
      ti[j] = j;
    }
    for (let i = (MB.K >> 1) - 1; i >= 0; i--) this.siftDown(i, MB.K);
    for (let j = MB.K; j < MB.KC; j++) {
      const v = a[j];
      if (v > tv[0] || (v === tv[0] && j < ti[0])) {
        tv[0] = v;
        ti[0] = j;
        this.siftDown(0, MB.K);
      }
    }
    // Extract in descending order so sum accumulation matches stable descending sort bit-for-bit
    for (let end = MB.K - 1; end > 0; end--) {
      const v0 = tv[0];
      const i0 = ti[0];
      tv[0] = tv[end];
      ti[0] = ti[end];
      tv[end] = v0;
      ti[end] = i0;
      this.siftDown(0, end);
    }
    const kc = new Float64Array(MB.KC);
    let sum = 0;
    for (let n = 0; n < MB.K; n++) {
      const v = tv[n];
      kc[ti[n]] = v;
      sum += v;
    }
    if (sum > 0) for (let n = 0; n < MB.K; n++) kc[ti[n]] /= sum;
    return kc;
  }

  /** Learned logit adjustment per cell = W[cell] · kc. */
  learnedScores(kc: Float64Array): number[] {
    const out = new Array<number>(9).fill(0);
    for (let c = 0; c < 9; c++) {
      let s = 0;
      const row = c * MB.KC;
      for (let j = 0; j < MB.KC; j++) if (kc[j] !== 0) s += this.W[row + j] * kc[j];
      out[c] = s;
    }
    return out;
  }

  /** Dopamine RPE: reward the overridden-to cell, suppress the vetoed auto choice. */
  learn(kc: Float64Array, cell: GridCell, denied: GridCell | null): void {
    const ci = cellIdx(cell);
    const di = denied ? cellIdx(denied) : -1;
    for (let j = 0; j < MB.KC; j++) {
      const v = kc[j];
      if (v === 0) continue;
      this.W[ci * MB.KC + j] = clampW(this.W[ci * MB.KC + j] + LEARN.etaPos * v);
      if (di >= 0) this.W[di * MB.KC + j] = clampW(this.W[di * MB.KC + j] - LEARN.etaNeg * v);
    }
    this.learnCount++;
  }

  resetWeights(): void { this.W.fill(0); this.learnCount = 0; }

  /** M4.5.1: serialize learned weights for localStorage persistence / JSON export. */
  exportWeights(): { weights: number[]; learnCount: number } {
    return { weights: Array.from(this.W, (v) => +v.toFixed(5)), learnCount: this.learnCount };
  }

  /** M4.5.1: restore weights (validated: length + finiteness; bad entries → 0). */
  loadWeights(weights: ArrayLike<number>, learnCount = 0): boolean {
    if (!weights || weights.length !== 9 * MB.KC) return false;
    for (let i = 0; i < this.W.length; i++) {
      const v = Number(weights[i]);
      this.W[i] = Number.isFinite(v) ? clampW(v) : 0;
    }
    this.learnCount = Math.max(0, Math.floor(learnCount));
    return true;
  }
}

function clampW(v: number): number { return Math.max(-LEARN.wMax, Math.min(LEARN.wMax, v)); }

/** M4.5.1 acoustic-tilt reference floors (measured on room/Kinect mic: LOW ~0.24,
 * MID ~0.04, HIGH ~0.02 absolute gated means — the FFT band widths are asymmetric and
 * high frequencies attenuate over distance, so raw shares lock ~96% onto Row 1). */
export const BAND_REF_FLOOR: BandEnergy = { low: 0.08, mid: 0.03, high: 0.015 };

/**
 * Rebalance raw/gated band shares against a slow running reference so acoustic spectral
 * tilt (LOW ~0.24 vs HIGH ~0.02 on room mics) does not lock 96% probability onto Row 1.
 * Preserves exact total energy (low + mid + high) so HOLD_FLOOR is unaffected.
 * (M4.5.1 recipe Step 1.2 — unlocks L2/L3 rows on real live sets.)
 */
export function rebalanceBands(bands: BandEnergy, ref: BandEnergy = BAND_REF_FLOOR): BandEnergy {
  const total = bands.low + bands.mid + bands.high;
  if (total <= 0) return { low: 0, mid: 0, high: 0 };
  const effLow = Math.max(ref.low, BAND_REF_FLOOR.low);
  // Cap tilt compensation ratios (MID ≤ 3.5× LOW, HIGH ≤ 6× LOW) so a loud bass drop
  // with minor cymbal splash (e.g. LOW=0.85, HIGH=0.11) still lands on L1 while genuine
  // MID/HIGH sections cleanly win L2/L3.
  const effMid = Math.max(ref.mid, effLow / 3.5, BAND_REF_FLOOR.mid);
  const effHigh = Math.max(ref.high, effLow / 6.0, BAND_REF_FLOOR.high);
  const rl = bands.low / effLow;
  const rm = bands.mid / effMid;
  const rh = bands.high / effHigh;
  const rSum = rl + rm + rh;
  if (rSum <= 0) return { ...bands };
  return {
    low: total * (rl / rSum),
    mid: total * (rm / rSum),
    high: total * (rh / rSum),
  };
}

/**
 * Prior logits (the M4-tuned taste, kept as the W=0 baseline):
 * row score = gated band dominance share; col score = motion-tier match from onset density
 * (STATIC <2.5/s, MEDIUM 2.5–6, ACTIVE >6 — nine-grid motion axis, design judgment).
 */
export function priorScores(bands: BandEnergy, density: number): number[] {
  const total = bands.low + bands.mid + bands.high;
  const share = total > 0 ? [bands.low / total, bands.mid / total, bands.high / total] : [1 / 3, 1 / 3, 1 / 3];
  const motion = density >= 6 ? 2 : density >= 2.5 ? 1 : 0; // ACTIVE / MEDIUM / STATIC
  const colScore = [0, 1, 2].map((c) => (c === motion ? 0.9 : Math.abs(c - motion) === 1 ? 0.35 : 0.05));
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(share[r] * 2.2 + colScore[c]);
  return out;
}

export interface DecideCtx {
  /** anti-repeat bag: last AUTO-triggered cell (avoid firing it twice in a row). */
  lastAutoCell: GridCell | null;
  /** MB sparse code for this frame (worker supplies; tests may pass null → prior only). */
  kc: Float64Array | null;
  mb: MushroomBody;
  /** M4.5.1: band-distribution floor. Omitted = CONF_FLOOR (raw-band semantics, unit
   * tests). The worker passes GRID_FLOOR_BALANCED because it feeds rebalanceBands()
   * output, whose Jev confidence is naturally compressed by the tilt compensation. */
  bandFloor?: number;
  /** M4.7 C1 content layer: static nine-grid bias added to the prior logits (per cell
   * index 0..8). Strong content cues steer the pick toward their signature motion tier. */
  cellBias?: readonly number[];
}

/**
 * Turn a structure event (drop/section) + bands + features into a nine-grid Decision.
 * HOLD when: total ≤ floor, event confidence < CONF_FLOOR (G10), or band-distribution
 * confidence < ctx.bandFloor. Auto pick = top candidate EXCLUDING the anti-repeat bag
 * cell when a runner-up clears a modest floor (bag semantics); override picks are never
 * bag-restricted.
 */
export function decideOnEvent(
  ev: StructureEvent, bands: BandEnergy, density: number, ctx: DecideCtx, tMs: number,
  source: "auto" | "override" = "auto",
): Decision {
  const bandFloor = ctx.bandFloor ?? CONF_FLOOR;
  // M4.7: a strong structure event (C1 breakdown/drop cues ≥0.70) may fire at the precision
  // floor even when rebalanced-band Jev confidence sits slightly below the full grid floor.
  const effBandFloor = (ctx.bandFloor !== undefined && ev.confidence >= 0.70) ? Math.min(bandFloor, 0.15) : bandFloor;
  const total = bands.low + bands.mid + bands.high;
  const prior = priorScores(bands, density);
  const learned = ctx.kc ? ctx.mb.learnedScores(ctx.kc) : new Array<number>(9).fill(0);
  const logits = prior.map((p, i) => p + LEARN.learnGain * learned[i] + (ctx.cellBias?.[i] ?? 0));
  const probs = softmax(logits);
  const candidates: CellCandidate[] = logits
    .map((score, idx) => ({ cell: idxCell(idx), idx, score, prob: probs[idx] }))
    .sort((a, b) => b.prob - a.prob || a.idx - b.idx);
  const confidence = jevConfidence(probs);

  if (total <= HOLD_FLOOR) {
    return {
      kind: "hold", cell: null, layer: null, column: null, candidates, confidence: 0,
      reason: `HOLD — energy ${(total * 100).toFixed(0)}% ≤ floor (G10)`, event: ev, tMs, source,
    };
  }
  if (ev.confidence < CONF_FLOOR || confidence < effBandFloor) {
    return {
      kind: "hold", cell: null, layer: null, column: null, candidates, confidence,
      reason: `HOLD — conf event ${ev.confidence.toFixed(2)} / grid ${confidence.toFixed(2)} < ${effBandFloor} [${ev.reason}]`,
      event: ev, tMs, source,
    };
  }
  let pick = candidates[0];
  if (source === "auto" && ctx.lastAutoCell && cellIdx(ctx.lastAutoCell) === pick.idx) {
    const runner = candidates.find((c) => c.idx !== pick.idx && c.prob >= 0.05);
    if (runner) pick = runner; // anti-repeat bag: try another cell first
  }
  return {
    kind: "trigger", cell: pick.cell, layer: pick.cell.row, column: pick.cell.col,
    candidates, confidence,
    reason: `${cellLabel(pick.cell)} → L${pick.cell.row}C${pick.cell.col} · conf ${confidence.toFixed(2)} · ${ev.reason}`,
    event: ev, tMs, source,
  };
}

/**
 * Master-state machine (HAX G17 global switch).
 * AUTO   — decisions auto-fire.
 * OVERRIDE — user picked a cell; auto decisions are suppressed until handed back.
 *            Contract (c): the flip is synchronous (≤100ms, event-loop bounded).
 * HOLD   — panic freeze (PAIR manual failsafe).
 */
export class MasterSwitch {
  private mode: MasterMode = "AUTO";
  private overrideCell: GridCell | null = null;
  private since = 0;

  getMode(): MasterMode { return this.mode; }
  getOverrideCell(): GridCell | null { return this.overrideCell; }
  getOverrideColumn(): number | null { return this.overrideCell ? this.overrideCell.col : null; }

  overrideTo(cell: GridCell, tMs: number): void {
    this.mode = "OVERRIDE";
    this.overrideCell = cell;
    this.since = tMs;
  }

  handBack(tMs: number): void {
    this.mode = "AUTO";
    this.overrideCell = null;
    this.since = tMs;
  }

  hold(tMs: number): void {
    this.mode = "HOLD";
    this.since = tMs;
  }

  allowsAuto(): boolean { return this.mode === "AUTO"; }
}

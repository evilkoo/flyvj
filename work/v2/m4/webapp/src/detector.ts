// M4 structure detector — streaming DSP heuristic (PURE module, runs inside the Web Worker;
// contract (d): zero sidecar, main frame never blocked by this math).
// Research base: docs/research/edm-structure-detection.md —
//   drop    = LOW novelty peak + energy rebound (Zehren 2024: energy novelty is the strongest
//             switch-point cue; EDMFormer: sections defined by energy/rhythm/timbre change)
//   buildup = bass cut + HIGH riser + onset density acceleration (ticket 做#1)
//   tempo   = onset-envelope autocorrelation → coarse BPM, snapped to a bar grid
//             (CUE-DETR: EDM cues cluster on 8/16-bar multiples — snap is informational)
//   low confidence → no event emitted; the decision layer HOLDs (HAX G10).
// EVERY threshold here is a DESIGN JUDGMENT — no public accuracy baseline exists for
// streaming mic-condition drop detection (SPEC risk #2). Acceptance = ±0.5s behaviour on
// marked test songs; we never claim an accuracy percentage.
// Erasable-syntax-only (no enums / parameter properties) so `node --test` runs it directly.

import type { BandEnergy } from "./dsp.ts";

export type StructurePhase = "idle" | "buildup" | "drop";

/** Nine-grid axes (CONTEXT「九格分類」): row = energy band dominance, col = motion tier. */
export interface GridCell {
  row: 1 | 2 | 3;   // LOW / MID / HIGH dominant
  col: 1 | 2 | 3;   // STATIC / MEDIUM / ACTIVE
}

export interface StructureEvent {
  type: "drop" | "buildup" | "section";
  /** Detector-run time (ms since first update). */
  tMs: number;
  /** 0..1 — cue-agreement based (design judgment, NOT a verified probability). */
  confidence: number;
  /** One-line reason for the cockpit ticker (HAX G11). */
  reason: string;
  novLow: number;
  density: number;
  bpm: number | null;
  /** Suggested nine-grid cell (section/drop carry the current signature). */
  cell?: GridCell;
  /** True when the drop landed near a bar boundary (phase bonus applied). */
  onBar?: boolean;
}

export interface DetectorState {
  phase: StructurePhase;
  bpm: number | null;
  /** onsets/second over the last 2s window. */
  density: number;
  novLow: number;
  /** 0..3 = bassCut + riser + densityAccel cue votes. */
  buildupScore: number;
  /** env autocorrelation peak ratio 0..1 (music-vs-speech gate, design judgment). */
  regularity: number;
  total: number;
  warm: boolean;
  tMs: number;
  /**
   * Song-time anchor: run-time (ms) of the first sample whose gated total exceeded
   * FIRST_SOUND_GATE after reset. Test songs start with 1.5s of digital silence (the
   * AmbientGate calibration window) then a loud crash — acceptance compares
   * firstSoundT against the marked 1500ms to cancel capture-start latency
   * (contract (a) timecode table).
   */
  firstSoundT: number | null;
  /** M4.5: 3s-EMA of gated band shares (the section signature). */
  signature: BandEnergy;
  /** M4.5 groove lock: true while runTempo is frozen (bass-cut / build-up). */
  tempoFrozen: boolean;
  /** M4.5: current nine-grid signature cell. */
  cell: GridCell;
}

// ── tuning constants (ALL design judgment; see header) ──────────────────────
export const DET = {
  firstSoundGate: 0.06,    // gated total above this = "sound has started" (anchor)
  warmupMs: 5000,          // stats priming — no events before this
  onsetLookbackTicks: 3,   // band-diff over ~48ms sharpens the transient vs 50ms attack
  onsetFloor: 0.012,       // absolute env floor for an onset
  // Adaptive onset threshold (M4 tuning finding): the classic mean+k·std peak-pick with
  // k=2.6 SWALLOWS steady periodic rolls — a constant-rate snare roll has stationary env
  // stats, so mean+2.6·std sits above every peak and density reads 0.0 for the whole
  // build-up. A mixed criterion (ratio of the running mean + a gentler std term) keeps
  // impulsive peaks while still tracking the local energy scale.
  onsetMeanRatio: 1.6,     // env > mean·ratio + …
  onsetK: 1.2,             // … + std·k  (was 2.6)
  onsetRefractMs: 110,
  densityWinMs: 2000,
  novStdFloor: 0.012,      // prevents z blowing up when std ≈ 0 (silence/constant)
  dropNovLow: 2.0,         // LOW z-score threshold (real WAV via AmbientGate peaks ~2.2;
                           //   idealized unit-sim is higher — tuned to the gated pipeline)
  dropLowAbs: 0.10,        // gated LOW must be audibly present at the drop
  dropLowJump: 1.9,        // low ≥ jump × running mean
  dropTotalAbs: 0.18,      // overall energy rebound floor
  dropEnvAbs: 0.02,        // a real transient must be in the env
  // LOW-dominance discriminator (M4 tuning finding): an EDM drop = the BASS returns, so
  // gated LOW must dominate the frame. Speech/voice is MID-dominant (formants 300–3000Hz)
  // and never satisfies this even when it produces a big LOW novelty spike. Measured:
  // song-a drop low/mid ≈ 2.3, speech low/mid ≈ 1.2. This is the primary music-vs-voice
  // gate; envelope regularity (regGate) is a secondary rhythm check.
  dropLowDomRatio: 1.6,    // low ≥ ratio × mid at the candidate frame
  dropLowMinShare: 0.45,   // low ≥ share × (low+mid+high) — drop energy is bass-weighted
  dropCooldownMs: 6000,    // min spacing between emitted drops
  dropCandRefractMs: 500,
  regGate: 0.22,           // standalone drops (no build-up context) need rhythm regularity
  // Bass-cut memory (M4 tuning finding): the BandSmoother (release 220ms) erases the
  // snare-roll ripple so onset density under-reads rolls, and the riser is absorbed by
  // AmbientGate (M3 documented limitation: slow changes fade) — so build-up cues are
  // weak in the real gated pipeline. But a drop is physically "the bass RETURNS after a
  // bass cut": remembering that a bass-cut was active within the last N seconds is a
  // reliable music-context substitute for the pending-build-up flag (same effect: the
  // drop needs no standalone regularity proof and gets the context confidence bonus).
  bassCutMemoryMs: 8000,
  dropPhaseMs: 3000,
  pendingDropMs: 20000,    // after a build-up fires, a drop within this window gets +conf
  bassCutFrac: 0.70,       // lowEma1s < frac × longMean = bass cut. M4.5 tuning: the byte-
                           //   spectrum band mean carries snare-roll splatter into LOW
                           //   (measured build-up gated LOW ≈ 0.35–0.45 vs longMean ≈ 0.5),
                           //   so the old 0.45 never fired; 0.70 matches the real pipeline
                           //   while still requiring a genuine ≥30% bass dip.
  bassCutLongMin: 0.05,    // long-mean floor for bass-cut to make sense
  bassCutHoldMs: 1200,
  riserMinRise: 0.02,      // highEma1s must rise by at least this over ~3s
  riserMinAbs: 0.03,
  accelDensityMin: 3.5,    // roll must reach ≥3.5 onsets/s AND accelerate vs the 2s-prior
                           //   window (ratio below). M4 tuning finding: a pure density
                           //   floor fires spuriously in the groove section (kick+hat ≈2.5/s)
                           //   because the density window lags the roll start; the RATIO vs
                           //   the previous window is what "acceleration" actually means.
  accelRatio: 1.3,
  buildupScoreEma: 1.5,    // smoothed score ≥ this counts as "in build-up" (real WAV peaks ~1.77)
  buildupFireMs: 1800,     // … sustained this long → emit build-up event
  ringMs: 8000,
  tempoStepMs: 16,         // M4.5: 16ms tempo grid (was 32) — finer BPM resolution
  tempoEveryMs: 1000,
  tempoMinBpm: 60,
  tempoMaxBpm: 208,
  tempoPeakMin: 0.12,      // ACF peak below this → tempo untrusted (null)
  regLagMinMs: 288,        // regularity ACF lag range ≈ 60/0.288..208 BPM
  regLagMaxMs: 1000,
  regWinMs: 4000,
  // ── section events (M4.5): sustained dominance/energy-tier shifts = structural moves
  // (breakdown = MID/HIGH quiet-mid, build-up = HIGH mid-active, groove = LOW …).
  sectionWinMs: 3000,      // signature must persist this long to count as a section
  sectionCooldownMs: 5000, // 4–6s protection between section events (ticket: 4–6s)
  sectionSigDelta: 0.10,   // min change in the smoothed signature to call it a shift
  sectionDensityMin: 2.0,  // music gate: sections need medium-tier onset density, sustained
                           //   across the whole confirmation window (measured: groove 2.0–4.5,
                           //   speech ≤1.5 with inter-sentence gaps)
  sectionRegMin: 0.35,     // …and PERIODIC rhythm: measured groove reg 0.4–0.8, speech ≤0.3
  // CONFIRMATION (M4.5 regression fix): the 3s signature EMA needs ~1 tau to converge, so
  // anchoring right after warmup made the ramp itself read as a "shift" (spurious sections
  // mid-groove). Anchor later, and require a detected shift to PERSIST sectionConfirmMs
  // before firing — speech envelope wobble never persists, musical sections always do.
  sectionAnchorRunMs: 8000,
  sectionConfirmMs: 1500,
  barPhaseBonus: 0.05,     // drop within ±12% of a bar boundary → confidence bonus
} as const;

/** Exponential mean/variance tracker (Welford-style EMA). tau in ms.
 * SEED FIX (M4.5): the old version seeded `m` with the FIRST sample, so a track that
 * starts on a kick peak biased the slow tracker for ~tau (a spurious bass-cut followed).
 * Now the first `seedMs` (default 1s) is averaged into a proper seed before EMA starts. */
class ExpStats {
  private tauMs: number;
  private seedMs: number;
  private m = 0;
  private v = 0;
  private started = false;
  private seedT = 0;
  private seedSum = 0;

  constructor(tauMs: number, seedMs = 1000) {
    this.tauMs = tauMs;
    this.seedMs = seedMs;
  }

  update(x: number, dtMs: number): void {
    const dt = Math.max(1, Math.min(dtMs, 250));
    if (!this.started) {
      this.seedT += dt;
      this.seedSum += x;
      if (this.seedT >= this.seedMs) {
        this.m = this.seedSum / Math.max(1, Math.round(this.seedT / 16));
        this.v = 0;
        this.started = true;
      }
      return;
    }
    const a = 1 - Math.exp(-dt / this.tauMs);
    const d = x - this.m;
    this.m += a * d;
    this.v = (1 - a) * (this.v + a * d * d);
  }

  get mean(): number { return this.started ? this.m : 0; }
  get std(): number { return this.started ? Math.sqrt(Math.max(0, this.v)) : 0; }

  reset(): void { this.m = 0; this.v = 0; this.started = false; this.seedT = 0; this.seedSum = 0; }
}

interface RingSample {
  t: number;
  low: number;
  mid: number;
  high: number;
  total: number;
  env: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

/** Nine-grid labels (row = energy dominance, col = motion tier) — CONTEXT「九格分類」. */
export const ROW_LABELS = ["LOW", "MID", "HIGH"] as const;
export const COL_LABELS = ["STATIC", "MEDIUM", "ACTIVE"] as const;
export function cellLabel(c: GridCell): string { return `${ROW_LABELS[c.row - 1]}-${COL_LABELS[c.col - 1]}`; }
/** Human-readable section names for the ticker (design judgment, taste-tunable). */
export const SECTION_LABELS: Record<string, string> = {
  "LOW-STATIC": "breakdown-low", "LOW-MEDIUM": "groove-low", "LOW-ACTIVE": "drive-low",
  "MID-STATIC": "breakdown-mid", "MID-MEDIUM": "break-mid", "MID-ACTIVE": "build-mid",
  "HIGH-STATIC": "air-high", "HIGH-MEDIUM": "build-up-high", "HIGH-ACTIVE": "riser-high",
};

export class StructureDetector {
  private t0: number | null = null;
  private lastT = 0;
  private firstSoundT: number | null = null;
  private ring: RingSample[] = [];
  private hist: BandEnergy[] = [];          // last (lookback+1) band snapshots
  private onsets: number[] = [];            // onset timestamps (kept 4s)
  private lastOnsetT = -1e9;
  private onsetStats = new ExpStats(2000);
  private lowStats = new ExpStats(4000);    // novelty baseline (fast-ish)
  private lowLong = new ExpStats(9000);     // bass-cut reference (slow)
  private lowEma1s = 0;
  private highEma1s = 0;
  private emaHist: { t: number; low: number; high: number }[] = []; // every 250ms, 4s
  private lastEmaPush = -1e9;
  private bassCutSince = 0;
  private lastBassCutT = -1e9;   // bass-cut memory (see DET.bassCutMemoryMs)
  private buildupScoreEma = 0;
  private buildupSince = 0;
  private buildupFired = false;
  private pendingDropUntil = -1e9;
  private phase: StructurePhase = "idle";
  private phaseUntil = 0;
  private lastDropT = -1e9;
  private lastCandT = -1e9;
  private tempoBuf: { t: number; env: number }[] = [];
  private lastGridT = -1;                 // uniform 16ms tempo-grid slot cursor
  private lastTempoPush = -1e9;
  private lastTempoRun = -1e9;
  private bpmHist: number[] = [];
  private bpm: number | null = null;
  private lastReg = 0;
  // ── section signature (M4.5): 3s-EMA of the gated band SHARES; a sustained shift of the
  // signature = a structural move (breakdown/build-up/groove change) → section event.
  private sigEma: BandEnergy = { low: 0, mid: 0, high: 0 };
  private sigBase: BandEnergy | null = null;   // signature at last section event / baseline
  private lastSectionT = -1e9;
  private sectionPendingSince = 0;             // confirmation timer (see DET.sectionConfirmMs)
  private sectionPendDensMin = 1e9;            // min onset density across the confirmation window
  private tempoFrozen = false;                 // groove lock: freeze runTempo during build-up
  // last-tick feature echoes for state()
  private f: { novLow: number; density: number; total: number; buildup: number } =
    { novLow: 0, density: 0, total: 0, buildup: 0 };
  /** DEBUG/QC: last-computed build-up cue flags (tuning evidence, no runtime cost). */
  private cues: { bassCut: boolean; riser: boolean; accel: boolean; lowEma1s: number; highEma1s: number; lowLongMean: number; env: number } =
    { bassCut: false, riser: false, accel: false, lowEma1s: 0, highEma1s: 0, lowLongMean: 0, env: 0 };

  debugCues(): { bassCut: boolean; riser: boolean; accel: boolean; lowEma1s: number; highEma1s: number; lowLongMean: number; env: number } {
    return { ...this.cues };
  }

  reset(): void {
    this.t0 = null; this.lastT = 0; this.firstSoundT = null; this.ring = []; this.hist = []; this.onsets = [];
    this.lastOnsetT = -1e9; this.onsetStats.reset(); this.lowStats.reset(); this.lowLong.reset();
    this.lowEma1s = 0; this.highEma1s = 0; this.emaHist = []; this.lastEmaPush = -1e9;
    this.bassCutSince = 0; this.lastBassCutT = -1e9; this.buildupScoreEma = 0; this.buildupSince = 0; this.buildupFired = false;
    this.pendingDropUntil = -1e9; this.phase = "idle"; this.phaseUntil = 0;
    this.lastDropT = -1e9; this.lastCandT = -1e9;
    this.tempoBuf = []; this.lastGridT = -1; this.lastTempoPush = -1e9; this.lastTempoRun = -1e9;
    this.bpmHist = []; this.bpm = null; this.lastReg = 0;
    this.sigEma = { low: 0, mid: 0, high: 0 }; this.sigBase = null; this.lastSectionT = -1e9;
    this.sectionPendingSince = 0;
    this.sectionPendDensMin = 1e9;
    this.tempoFrozen = false;
    this.f = { novLow: 0, density: 0, total: 0, buildup: 0 };
    this.cues = { bassCut: false, riser: false, accel: false, lowEma1s: 0, highEma1s: 0, lowLongMean: 0, env: 0 };
  }

  /**
   * Feed one sample. `bands` = gated+smoothed (M3 contract: gate 後嘅 bands) — used for the
   * ENERGY features (novelty, bass-cut, riser, LOW-dominance). `raw` = optional pre-gate band
   * means — used for the ONSET envelope. M4 tuning finding: the BandSmoother (release 220ms)
   * blurs fast snare-roll transients, so onset density read ~0 on gated bands and the
   * build-up accel cue never fired. Onset/rhythm must read the RAW band-diff; energy
   * features stay on the gated bands (ticket: 決策食 gate 後嘅 bands).
   */
  update(tMs: number, bands: BandEnergy, raw?: BandEnergy): StructureEvent | null {
    if (this.t0 === null) { this.t0 = tMs; this.lastT = tMs; }
    const t = tMs;
    const run = t - this.t0;
    const dt = clamp(t - this.lastT, 1, 250);
    this.lastT = t;
    const { low, mid, high } = bands;
    const total = low + mid + high;
    if (this.firstSoundT === null && total >= DET.firstSoundGate) this.firstSoundT = run;
    // onset source: raw bands when available (transients preserved), else gated.
    const ob = raw ?? bands;

    // ── onset envelope = summed positive band-diff over ~48ms lookback (RAW bands) ──
    this.hist.push({ low: ob.low, mid: ob.mid, high: ob.high });
    while (this.hist.length > DET.onsetLookbackTicks + 1) this.hist.shift();
    const ref = this.hist[0];
    const env = Math.max(0, ob.low - ref.low) + Math.max(0, ob.mid - ref.mid) + Math.max(0, ob.high - ref.high);

    // ── onset detection → density ──
    this.onsetStats.update(env, dt);
    const onsetTh = Math.max(DET.onsetFloor, DET.onsetMeanRatio * this.onsetStats.mean + DET.onsetK * this.onsetStats.std);
    if (run > DET.warmupMs * 0.4 && env > onsetTh && t - this.lastOnsetT > DET.onsetRefractMs) {
      this.lastOnsetT = t;
      this.onsets.push(t);
    }
    while (this.onsets.length && this.onsets[0] < t - 4000) this.onsets.shift();
    let densWin = 0, densPrev = 0;
    for (const o of this.onsets) {
      if (o >= t - DET.densityWinMs) densWin++;
      else if (o >= t - 2 * DET.densityWinMs) densPrev++;
    }
    const density = densWin / (DET.densityWinMs / 1000);
    const densityPrev = densPrev / (DET.densityWinMs / 1000);

    // ── LOW novelty (energy-novelty cue, Zehren 2024) ──
    this.lowStats.update(low, dt);
    this.lowLong.update(low, dt);
    const novLow = (low - this.lowStats.mean) / Math.max(this.lowStats.std, DET.novStdFloor);

    // ── 1s EMAs for bass-cut / riser, sampled every 250ms ──
    const ea = 1 - Math.exp(-dt / 1000);
    this.lowEma1s += (low - this.lowEma1s) * ea;
    this.highEma1s += (high - this.highEma1s) * ea;
    if (t - this.lastEmaPush >= 250) {
      this.lastEmaPush = t;
      this.emaHist.push({ t, low: this.lowEma1s, high: this.highEma1s });
      while (this.emaHist.length && this.emaHist[0].t < t - 4000) this.emaHist.shift();
    }

    // ── bass-cut cue (computed BEFORE the tempo block: it gates the groove lock) ──
    const bassCut = this.lowLong.mean > DET.bassCutLongMin && this.lowEma1s < DET.bassCutFrac * this.lowLong.mean;
    if (bassCut) { if (this.bassCutSince === 0) this.bassCutSince = t; this.lastBassCutT = t; } else { this.bassCutSince = 0; }
    const bassCutActive = this.bassCutSince !== 0 && t - this.bassCutSince >= DET.bassCutHoldMs;

    // ── feature ring (regularity + diagnostics) ──
    this.ring.push({ t, low, mid, high, total, env });
    while (this.ring.length && this.ring[0].t < t - DET.ringMs) this.ring.shift();

    // ── tempo buffer + ~1Hz autocorrelation ──
    // GROOVE LOCK (M4.5): during bass-cut / build-up the onset envelope is a snare ROLL,
    // not the groove — feeding it into the ACF would corrupt the locked BPM. Freeze both
    // the buffer and the estimate; the drop still fires zero-latency (it never waits on
    // tempo), and bar phase only adds a confidence bonus when bpm is known.
    // UNIFORM GRID (M4.5 regression fix): at tempoStepMs=16 the raw sample jitter (15.8 /
    // 16.3ms) made push intervals alternate 16/32ms — a NON-uniform grid on which the ACF
    // collapses (regularity fell 0.5→0.16). Resample env onto exact 16ms slots: max-env
    // per slot, zero-fill skipped slots.
    this.tempoFrozen = bassCutActive || this.phase === "buildup";
    if (!this.tempoFrozen) {
      const g = Math.floor(t / DET.tempoStepMs) * DET.tempoStepMs;
      if (this.lastGridT >= 0 && g > this.lastGridT) {
        for (let gt = this.lastGridT + DET.tempoStepMs; gt < g; gt += DET.tempoStepMs) {
          this.tempoBuf.push({ t: gt, env: 0 });
        }
      }
      if (g !== this.lastGridT) {
        this.lastGridT = g;
        this.tempoBuf.push({ t: g, env });
      } else if (this.tempoBuf.length) {
        const last = this.tempoBuf[this.tempoBuf.length - 1];
        if (env > last.env) last.env = env;
      }
      while (this.tempoBuf.length && this.tempoBuf[0].t < t - DET.ringMs) this.tempoBuf.shift();
      if (t - this.lastTempoRun >= DET.tempoEveryMs && this.tempoBuf.length > 100) {
        this.lastTempoRun = t;
        this.runTempo(); // also refreshes this.lastReg (regularity) every ~1Hz
      }
    }

    let riser = false;
    const h0 = this.emaHist.length ? this.emaHist[0] : null;
    const h1 = this.emaHist.length ? this.emaHist[this.emaHist.length - 1] : null;
    // WARMUP GATE (M4 tuning finding): highEma1s ramps from 0 during the first seconds,
    // which reads as a fake "riser" once warmup ends. Require the 4s comparison window to
    // lie entirely AFTER warmup before trusting the rise.
    if (h0 && h1 && h1.t - h0.t >= 2500 && this.t0 !== null && h0.t - this.t0 >= DET.warmupMs) {
      riser = h1.high > h0.high + DET.riserMinRise && h1.high > DET.riserMinAbs;
    }

    const accel = density >= DET.accelDensityMin && density >= DET.accelRatio * Math.max(densityPrev, 0.5);

    this.cues = { bassCut: bassCutActive, riser, accel, lowEma1s: this.lowEma1s, highEma1s: this.highEma1s, lowLongMean: this.lowLong.mean, env };

    const scoreNow = (bassCutActive ? 1 : 0) + (riser ? 1 : 0) + (accel ? 1 : 0);
    const sa = 1 - Math.exp(-dt / 500);
    this.buildupScoreEma += (scoreNow - this.buildupScoreEma) * sa;

    let event: StructureEvent | null = null;

    // ── build-up fire (latched, once per pending cycle) ──
    // LATCH semantics (M4 tuning finding): once scoreEma crosses the threshold the
    // build-up is armed; it fires after buildupFireMs even if the score eases back toward
    // threshold×0.6 — because the accelerating snare roll gets ABSORBED into the onset
    // baseline (mean rises, std falls) so the accel cue naturally decays mid-build-up.
    // Disarm only when the score collapses below threshold×0.6 (build-up aborted).
    if (run > DET.warmupMs && this.buildupScoreEma >= DET.buildupScoreEma && this.buildupSince === 0) {
      this.buildupSince = t;
    } else if (this.buildupScoreEma < DET.buildupScoreEma * 0.6) {
      this.buildupSince = 0;
    }
    if (this.buildupSince !== 0 && !this.buildupFired && t - this.buildupSince >= DET.buildupFireMs) {
      this.buildupFired = true;
      this.pendingDropUntil = t + DET.pendingDropMs;
      this.phase = "buildup";
      const cues = [bassCutActive ? "bass-cut" : null, riser ? "riser" : null, accel ? "roll-accel" : null]
        .filter(Boolean).join("+") || "latched";
      event = {
        type: "buildup", tMs: t, confidence: clamp(0.3 + 0.18 * Math.round(this.buildupScoreEma * 2) / 2, 0, 0.85),
        reason: `BUILD-UP ${cues} (dens ${density.toFixed(1)}/s)`,
        novLow, density, bpm: this.bpm,
        cell: this.currentCell(total, density),
      };
    }

    // ── drop candidate ──
    const warm = run > DET.warmupMs;
    if (warm && this.phase !== "drop" && t - this.lastCandT > DET.dropCandRefractMs && t - this.lastDropT > DET.dropCooldownMs) {
      const zOk = novLow >= DET.dropNovLow;
      const lowJump = low >= Math.max(DET.dropLowAbs, DET.dropLowJump * this.lowStats.mean);
      const actOk = total >= DET.dropTotalAbs;
      const transient = env >= DET.dropEnvAbs;
      // LOW-dominance: an EDM drop is the BASS returning; voice is MID-dominant. Primary
      // music-vs-speech gate (see DET comment) — regGate below is the secondary rhythm check.
      const lowShare = total > 0 ? low / total : 0;
      const lowDom = low >= DET.dropLowDomRatio * Math.max(mid, 1e-6) && lowShare >= DET.dropLowMinShare;
      if (zOk && lowJump && actOk && transient && lowDom) {
        this.lastCandT = t;
        // music context = pending build-up fired OR a bass-cut within the memory window
        // (see DET.bassCutMemoryMs — the drop IS the bass returning after that cut).
        const pending = t <= this.pendingDropUntil || t - this.lastBassCutT <= DET.bassCutMemoryMs;
        // music-vs-speech gate: contextual drops (build-up fired / recent bass-cut) are
        // already proven music; standalone drops must show rhythmic regularity.
        const reg = pending ? Math.max(this.regularity(), 0.5) : this.regularity();
        this.lastReg = reg;
        const regOk = reg >= DET.regGate;
        if (regOk) {
          // bar-phase bonus (M4.5): drops that land near a bar boundary of the LOCKED
          // groove grid get a small confidence bonus; the trigger itself never waits
          // for tempo (zero-latency contract).
          const onBar = this.nearBarPhase(t);
          const conf = clamp(
            0.4 + Math.min(0.25, novLow * 0.04) + (pending ? 0.2 : 0) + Math.min(0.1, reg * 0.25) + (onBar ? DET.barPhaseBonus : 0),
            0, 0.95,
          );
          if (conf >= 0.6) {
            this.lastDropT = t;
            this.lastSectionT = t; // M4.5.1 共用換片冷卻：Drop 後 5s 內唔准即刻觸發 Section
            this.phase = "drop";
            this.phaseUntil = t + DET.dropPhaseMs;
            this.buildupFired = false;
            this.buildupSince = 0;
            this.pendingDropUntil = -1e9;
            this.sectionPendingSince = 0;
            // M4.5.1 BUGFIX（乒乓連跳）：唔再設 sigBase = null — 那會令下一 tick 喺 Drop
            // 瞬態最高峰重新 anchor，3s 後能量回落即誤觸發 SECTION（實戰影片 3:33:31→32）。
            // 改由 phase bookkeeping 喺 Drop 瞬態結束後先 re-anchor（見下面 bookkeeping）。
            event = {
              type: "drop", tMs: t, confidence: conf,
              reason: `DROP novLow ${novLow.toFixed(1)}${pending ? " post-build-up" : " standalone"} reg ${reg.toFixed(2)}${onBar ? " on-bar" : ""}${this.bpm ? ` bpm≈${Math.round(this.bpm)}` : ""}`,
              novLow, density, bpm: this.bpm,
              cell: this.currentCell(total, density), onBar,
            };
          }
        }
      }
    }

    // ── section events (M4.5): sustained shift of the band-share signature ──
    // Signature = 3s-EMA of gated band SHARES (who dominates) — a structural move
    // (breakdown: MID/HIGH quiet-mid · build-up: HIGH mid-active · groove change) shows up
    // as a persistent shift. Cooldown 5s (ticket 4–6s) prevents chatter.
    if (total > DET.firstSoundGate) {
      const share: BandEnergy = { low: low / total, mid: mid / total, high: high / total };
      const sa2 = 1 - Math.exp(-dt / DET.sectionWinMs);
      this.sigEma.low += (share.low - this.sigEma.low) * sa2;
      this.sigEma.mid += (share.mid - this.sigEma.mid) * sa2;
      this.sigEma.high += (share.high - this.sigEma.high) * sa2;
      if (this.sigBase === null && run > (this.firstSoundT ?? 0) + DET.sectionAnchorRunMs) this.sigBase = { ...this.sigEma };
      if (
        warm && this.sigBase !== null &&
        t - this.lastSectionT >= DET.sectionCooldownMs &&
        t - this.lastDropT >= DET.sectionCooldownMs &&   // M4.5.1: drop/section 共用冷卻
        this.phase === "idle" && !bassCutActive          // M4.5.1: build-up / bass-cut 期間唔准搶閘
      ) {
        const dSig = Math.max(
          Math.abs(this.sigEma.low - this.sigBase.low),
          Math.abs(this.sigEma.mid - this.sigBase.mid),
          Math.abs(this.sigEma.high - this.sigBase.high),
        );
        // MUSIC GATE for section events (contract (b)): a silence→speech onset is also a
        // signature shift, so sections additionally require rhythmic regularity AND an
        // onset density in the medium/active tiers — voice swells fail both on real data.
        // SUSTAINED form (M4.5 regression fix): the gate must hold on EVERY tick of the
        // confirmation window — speech has inter-sentence pauses that drop density below
        // the floor, while musical sections keep a continuous onset stream.
        const musicLike = this.lastReg >= DET.sectionRegMin && density >= DET.sectionDensityMin;
        if (dSig >= DET.sectionSigDelta && musicLike) {
          // CONFIRMATION: the shift must persist sectionConfirmMs before firing.
          if (this.sectionPendingSince === 0) { this.sectionPendingSince = t; this.sectionPendDensMin = density; }
          else this.sectionPendDensMin = Math.min(this.sectionPendDensMin, density);
          if (t - this.sectionPendingSince >= DET.sectionConfirmMs && this.sectionPendDensMin >= DET.sectionDensityMin) {
            this.sectionPendingSince = 0;
            this.lastSectionT = t;
            this.sigBase = { ...this.sigEma };
            const cell = this.currentCell(total, density);
            const label = SECTION_LABELS[cellLabel(cell)];
            event = {
              type: "section", tMs: t, confidence: clamp(0.45 + dSig, 0, 0.8),
              reason: `SECTION ${label} (Δsig ${dSig.toFixed(2)}${this.bpm ? ` bpm≈${Math.round(this.bpm)}` : ""})`,
              novLow, density, bpm: this.bpm, cell,
            };
          }
        } else {
          this.sectionPendingSince = 0;
          this.sectionPendDensMin = 1e9;
        }
      }
    }

    // ── phase bookkeeping ──
    if (this.phase === "drop" && t > this.phaseUntil) {
      this.phase = this.buildupScoreEma >= DET.buildupScoreEma ? "buildup" : "idle";
      this.sigBase = { ...this.sigEma }; // M4.5.1: Drop 瞬態結束後先 re-anchor 新段落基準
      this.sectionPendingSince = 0;
    }
    if (this.phase === "buildup" && t > this.pendingDropUntil && !this.buildupFired) {
      this.phase = "idle";
    }

    this.f = { novLow, density, total, buildup: this.buildupScoreEma };
    return event;
  }

  /** Onset-envelope autocorrelation → coarse BPM (ticket 做#1; ACF design per research). */
  private runTempo(): void {
    // refresh regularity every tempo pass so state()/diagnostics always show a live value
    // (BUGFIX: lastReg was only set inside the drop-candidate branch, so it read 0.00
    // whenever no drop fired — made the music-vs-speech gate impossible to observe).
    this.regularity();
    const xs = this.tempoBuf.map((s) => s.env);
    const n = xs.length;
    if (n < 100) return;
    let mean = 0;
    for (const x of xs) mean += x;
    mean /= n;
    const ac = xs.map((x) => x - mean);
    let denom = 0;
    for (const x of ac) denom += x * x;
    if (denom <= 1e-9) return;
    const step = DET.tempoStepMs;
    const kMin = Math.max(1, Math.floor(60000 / DET.tempoMaxBpm / step));
    const kMax = Math.min(n - 2, Math.ceil(60000 / DET.tempoMinBpm / step));
    let bestK = -1, bestV = 0;
    for (let k = kMin; k <= kMax; k++) {
      let s = 0;
      for (let i = 0; i + k < n; i++) s += ac[i] * ac[i + k];
      const v = s / denom;
      if (v > bestV) { bestV = v; bestK = k; }
    }
    if (bestK < 0 || bestV < DET.tempoPeakMin) { this.bpm = null; this.bpmHist = []; return; }
    let bpm = 60000 / (bestK * step);
    while (bpm > 180) bpm /= 2;   // fold into a musical range (octave errors are inherent
    while (bpm < 70) bpm *= 2;    // to envelope ACF — coarse estimate only, by design)
    this.bpmHist.push(bpm);
    if (this.bpmHist.length > 3) this.bpmHist.shift();
    const sorted = [...this.bpmHist].sort((a, b) => a - b);
    this.bpm = sorted[Math.floor(sorted.length / 2)];
  }

  /** Env regularity over the last 4s: ACF peak ratio at rhythm lags (music gate). */  regularity(): number {
    const now = this.ring.length ? this.ring[this.ring.length - 1].t : 0;
    const pts: number[] = [];
    for (const s of this.tempoBuf) if (s.t >= now - DET.regWinMs) pts.push(s.env);
    if (pts.length < 60) return 0;
    let mean = 0;
    for (const x of pts) mean += x;
    mean /= pts.length;
    const ac = pts.map((x) => x - mean);
    let denom = 0;
    for (const x of ac) denom += x * x;
    if (denom <= 1e-9) return 0;
    const step = DET.tempoStepMs;
    const kMin = Math.max(1, Math.floor(DET.regLagMinMs / step));
    const kMax = Math.min(ac.length - 2, Math.ceil(DET.regLagMaxMs / step));
    let best = 0;
    for (let k = kMin; k <= kMax; k++) {
      let s = 0;
      for (let i = 0; i + k < ac.length; i++) s += ac[i] * ac[i + k];
      const v = s / denom;
      if (v > best) best = v;
    }
    this.lastReg = clamp(best, 0, 1);
    return this.lastReg;
  }

  /**
   * Bar-phase check (M4.5 groove lock): with a locked BPM, is tMs within ±12% of a bar
   * boundary (4 beats)? Returns false when tempo is unknown — the bonus is optional by
   * design (drops never wait for tempo).
   */
  nearBarPhase(tMs: number): boolean {
    if (this.bpm === null || this.bpm <= 0) return false;
    const barMs = (60000 / this.bpm) * 4;
    if (barMs <= 0) return false;
    const phase = ((tMs % barMs) + barMs) % barMs;
    const dist = Math.min(phase, barMs - phase);
    return dist <= barMs * 0.12;
  }

  /** Current nine-grid signature cell from gated bands + onset density (M4.5). */
  currentCell(total: number, density: number): GridCell {
    const s = this.sigEma;
    const sum = s.low + s.mid + s.high;
    let row: 1 | 2 | 3 = 1;
    if (sum > 0) {
      const shares = [s.low / sum, s.mid / sum, s.high / sum];
      row = (shares.indexOf(Math.max(...shares)) + 1) as 1 | 2 | 3;
    }
    let col: 1 | 2 | 3 = 1;
    if (density >= 6) col = 3; else if (density >= 2.5) col = 2;
    if (total <= DET.firstSoundGate) col = 1; // silence reads STATIC
    return { row, col };
  }

  /** Live signature shares (worker → feature vector for the MB layer). */
  signature(): BandEnergy { return { ...this.sigEma }; }

  state(tMs: number): DetectorState {
    return {
      phase: this.phase,
      bpm: this.bpm,
      density: this.f.density,
      novLow: this.f.novLow,
      buildupScore: this.buildupScoreEma,
      regularity: this.lastReg,
      total: this.f.total,
      warm: this.t0 !== null && tMs - this.t0 > DET.warmupMs,
      tMs,
      firstSoundT: this.firstSoundT,
      signature: { ...this.sigEma },
      tempoFrozen: this.tempoFrozen,
      cell: this.currentCell(this.f.total, this.f.density),
    };
  }
}

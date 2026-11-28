// M4.7 C1 content layer — arrangement cues fused from DSP novelty (chroma ring) and YAMNet
// class posteriors. PURE module: zero DOM, zero ONNX imports — runs in the decision worker
// and directly under `node --test`. Emits ContentCue = StructureEvent + static nine-grid
// bias, which the worker funnels through decideOnEvent (cellBias term).
// Cue kinds:
//   breakdown  — raw bass collapses below the groove reference (instant anti-drop)
//   drop-return— kick energy rebounds after a prolonged bass dip / breakdown
//   vocal-entry/exit — YAMNet vocal-chant hysteresis on SemanticFrames
//   hihat-lift — relative HIGH-band pulse lift (independent of the room mic level)
//   arrangement— fused YAMNet + chroma novelty shift without loudness change
// M4.8: adaptive RELATIVE density (densityRef) + effectiveDensity so the Col 2/3 motion
// tiers unlock on room mics and clean feeds alike.
// Erasable-syntax-only for node --test.

import type { BandEnergy } from "./dsp.ts";
import type { GridCell, StructureEvent } from "./detector.ts";

/** One YAMNet inference result (main thread posts these as `{ type: "semantic" }`). */
export interface SemanticFrame {
  tMs: number;
  ready: boolean;
  music: number;
  electronic: number;
  vocalChant: number;
  drums: number;
  silence: number;
  yamnetNovelty: number;
  topClass: string;
  inferMs: number;
}

/** Snapshot attached to every `{ kind: "state" }` post (cockpit diagnostics). */
export interface ContentState {
  chromaNovelty: number;
  yamnetNovelty: number;
  shiftScore: number;
  antiDropActive: boolean;
  vocalActive: boolean;
  inBreakdown: boolean;
  musicProb: number;
  vocalChant: number;
  electronic: number;
  yamnetReady: boolean;
  yamnetInferMs: number;
  topClass: string;
  lastCue: string | null;
  hiHatActive: boolean;
  effectiveDensity: number;
}

export type ContentCueKind = "breakdown" | "drop-return" | "vocal-entry" | "vocal-exit" | "hihat-lift" | "arrangement";

export interface ContentCue {
  event: StructureEvent;
  cellBias: number[];
  cueKind: ContentCueKind;
}

export const MAX_CHROMA_BUCKETS = 48; // 250ms buckets → 12s ring
const BUCKET_MS = 250;
const CHROMA_BINS = 12;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * 12-bin chroma from a Web Audio byte frequency spectrum.
 * Byte value 0 = below the analyser floor (-100 dB) → skip; else byte v maps linearly to
 * -100..-30 dB, converted to linear power so a peak bin dominates the L1-normalised vector.
 */
export function extractChroma12(freq: Uint8Array, sampleRate: number, fftSize: number): number[] {
  const chroma = new Array<number>(CHROMA_BINS).fill(0);
  const topBin = Math.min(freq.length, fftSize / 2);
  for (let b = 1; b < topBin; b++) {
    const hz = (b * sampleRate) / fftSize;
    if (hz < 80 || hz > 2000) continue;
    const bVal = freq[b] ?? 0;
    if (bVal === 0) continue;
    const pc = ((Math.round(12 * Math.log2(hz / 440)) % 12) + 12) % 12;
    const db = -100 + (bVal / 255) * 70;
    chroma[pc] += Math.pow(10, db / 10);
  }
  let total = 0;
  for (let i = 0; i < CHROMA_BINS; i++) total += chroma[i];
  if (total <= 0) return new Array<number>(CHROMA_BINS).fill(0);
  for (let i = 0; i < CHROMA_BINS; i++) chroma[i] /= total;
  return chroma;
}

/** 1 − cosine similarity, clamped to [0, 1]; 0 when either vector has no energy. */
export function cosineDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 1e-12 || nb <= 1e-12) return 0;
  return clamp(1 - dot / Math.sqrt(na * nb), 0, 1);
}

export interface SampleParams {
  tMs: number;
  raw?: BandEnergy;
  density: number;
  regularity: number;
  novLow: number;
  chroma?: number[];
  bpm: number | null;
  cell: GridCell;
}

/**
 * C1 content analyzer: rolling chroma novelty + raw-energy groove/anti-drop tracker +
 * YAMNet vocal hysteresis + fused arrangement-shift detector. Every emitted cue calls
 * noteAutoTrigger() so the shared anti-chatter cooldowns hold even when the decision
 * layer HOLDs (e.g. master suppression).
 */
export class ContentAnalyzer {
  // rolling 250ms chroma buckets (12s ring)
  private readonly bucketId = new Int32Array(MAX_CHROMA_BUCKETS).fill(-1);
  private readonly bucketSum = new Float64Array(MAX_CHROMA_BUCKETS * CHROMA_BINS);
  private readonly bucketFrames = new Int32Array(MAX_CHROMA_BUCKETS);

  chromaNovelty = 0;
  yamnetNovelty = 0;
  shiftScore = 0;
  musicProb = 0;
  vocalChant = 0;
  electronic = 0;
  yamnetReady = false;
  yamnetInferMs = 0;
  topClass = "";
  antiDropActive = false;
  vocalActive = false;
  inBreakdown = false;
  hiHatActive = false;
  effectiveDensity = 0;

  private densityRef = 2.2;
  private rawHighFast = 0;
  private rawHighSlow = 0;
  private prevHighRing: number[] = [];
  private dHighMean = 0;
  private dHighVar = 0;
  private highOnsets: number[] = [];
  private lastHighOnsetT = -1e9;
  private highOnsetDensity = 0;
  private hiHatHoldSince: number | null = null;
  private hiHatLowSince: number | null = null;

  private lastSemantic: SemanticFrame | null = null;
  private lastCue: string | null = null;

  private lastT = 0;
  private lastDensity = 0;
  private lastReg = 0;
  private lastNovLow = 0;
  private lastBpm: number | null = null;
  private lastCell: GridCell = { row: 1, col: 1 };
  private lastRawTotal = 0;

  private rawLowFast = 0;
  private rawLowMed = 0;
  private prevRawLow = 0;
  private grooveLowRef = 0;

  private antiDropSince: number | null = null;
  private lowDipSince: number | null = null;
  private breakdownSince = -1;
  private vocalLowSince: number | null = null;

  private lastAutoTriggerT = -1e9;
  private lastSectionTriggerT = -1e9;
  private lastDropTriggerT = -1e9;
  private lastDropT = -1e9;

  constructor() {
    this.reset();
  }

  state(): ContentState {
    return {
      chromaNovelty: this.chromaNovelty,
      yamnetNovelty: this.yamnetNovelty,
      shiftScore: this.shiftScore,
      antiDropActive: this.antiDropActive,
      vocalActive: this.vocalActive,
      inBreakdown: this.inBreakdown,
      musicProb: this.musicProb,
      vocalChant: this.vocalChant,
      electronic: this.electronic,
      yamnetReady: this.yamnetReady,
      yamnetInferMs: this.yamnetInferMs,
      topClass: this.topClass,
      lastCue: this.lastCue,
      hiHatActive: this.hiHatActive,
      effectiveDensity: this.effectiveDensity,
    };
  }

  getEffectiveDensity(): number {
    return this.effectiveDensity;
  }

  noteAutoTrigger(tMs: number, isDrop = false): void {
    this.lastAutoTriggerT = tMs;
    if (isDrop) this.lastDropTriggerT = tMs;
    else this.lastSectionTriggerT = tMs;
  }

  /** Shared cooldown. Drop: 4.5s since last drop AND 2.5s since last section (so a drop
   *  2.5s+ after a breakdown is never blocked). Section: 4.5s since any auto trigger. */
  canAutoTrigger(tMs: number, isDrop: boolean): boolean {
    if (isDrop) return tMs - this.lastDropTriggerT >= 4500 && tMs - this.lastSectionTriggerT >= 2500;
    return tMs - this.lastAutoTriggerT >= 4500;
  }

  /** False-drop suppressor for the detector's baseline drops. `raw === undefined`
   *  (legacy band-only mode) always allows — keeps the M4 unit sims intact. */
  shouldAllowBaselineDrop(raw: BandEnergy | undefined, density: number, tMs: number): boolean {
    void tMs;
    if (!raw) return true;
    if (density < 1.3 && raw.low + raw.mid + raw.high < 0.85) return false;
    if (this.grooveLowRef >= 0.45 && raw.low < 0.74 * this.grooveLowRef) return false;
    if (this.yamnetReady && this.musicProb < 0.22 && this.vocalChant < 0.30) return false;
    return true;
  }

  updateSample(params: SampleParams): ContentCue | null {
    const tMs = params.tMs;
    const dt = clamp(tMs - this.lastT, 1, 250);
    this.lastT = tMs;
    this.lastDensity = params.density;
    this.lastReg = params.regularity;
    this.lastNovLow = params.novLow;
    this.lastBpm = params.bpm;
    this.lastCell = params.cell;

    if (params.chroma && params.chroma.length >= CHROMA_BINS) {
      this.addChromaFrame(tMs, params.chroma);
      this.updateChromaNovelty(tMs);
      this.refreshShiftScore();
    }

    let cue: ContentCue | null = null;
    if (params.raw) {
      const raw = params.raw;
      this.lastRawTotal = raw.low + raw.mid + raw.high;
      const dtSlow = Math.min(dt, 250);
      this.rawLowFast += (raw.low - this.rawLowFast) * (1 - Math.exp(-dtSlow / 250));
      this.rawLowMed += (raw.low - this.rawLowMed) * (1 - Math.exp(-dtSlow / 3000));

      // Groove low reference: rises only in rhythmic music (density gate), decays very slowly
      // so an AmbientGate creep cannot erase "the bass used to be here".
      if (raw.low > this.grooveLowRef && params.density >= 1.5) {
        this.grooveLowRef += (raw.low - this.grooveLowRef) * (1 - Math.exp(-dtSlow / 500));
      } else if (raw.low < this.grooveLowRef) {
        this.grooveLowRef += (raw.low - this.grooveLowRef) * (1 - Math.exp(-dtSlow / 45000));
      }

      // Instant anti-drop / breakdown: bass collapses vs its 3s mean while a groove exists.
      if (this.grooveLowRef >= 0.40 && this.rawLowMed >= 0.35) {
        const lowDropped = raw.low <= this.rawLowMed * 0.65 || this.rawLowMed - raw.low >= 0.085;
        if (lowDropped) {
          if (this.antiDropSince === null) this.antiDropSince = tMs;
        } else {
          this.antiDropSince = null;
        }
        this.antiDropActive = lowDropped;
        if (lowDropped && this.antiDropSince !== null && tMs - this.antiDropSince >= 220 && !this.inBreakdown) {
          this.inBreakdown = true;
          this.breakdownSince = tMs;
          if (tMs - this.lastAutoTriggerT >= 4500) {
            cue = this.makeCue("breakdown", {
              type: "section", tMs, confidence: 0.72, reason: "C1 BREAKDOWN anti-drop",
              novLow: params.novLow, density: params.density, bpm: params.bpm, cell: params.cell,
            }, [0.55, 0, 0, 0.55, 0, 0, 0.55, 0, 0], false);
          }
        }
      } else {
        this.antiDropActive = false;
        this.antiDropSince = null;
      }

      // Bass-dip clock for the kick-return drop (starts before breakdown detection).
      if (this.inBreakdown || (this.grooveLowRef >= 0.40 && this.rawLowMed < 0.72 * this.grooveLowRef)) {
        if (this.lowDipSince === null) this.lowDipSince = tMs;
      } else {
        this.lowDipSince = null;
      }

      // Raw kick-return drop: bass comes back after a ≥3s dip.
      if (
        cue === null &&
        (this.inBreakdown || (this.grooveLowRef >= 0.40 && this.rawLowMed < 0.72 * this.grooveLowRef)) &&
        this.lowDipSince !== null && tMs - this.lowDipSince >= 3000 &&
        raw.low >= Math.max(0.45, 0.84 * this.grooveLowRef) &&
        (raw.low - this.prevRawLow >= 0.018 || params.novLow >= 1.4) &&
        (!this.yamnetReady || this.musicProb >= 0.25 || this.vocalChant >= 0.35) &&
        this.canAutoTrigger(tMs, true) &&
        tMs - this.lastDropT >= 5000
      ) {
        this.inBreakdown = false;
        this.lowDipSince = null;
        this.antiDropSince = null;
        this.antiDropActive = false;
        this.lastDropT = tMs;
        cue = this.makeCue("drop-return", {
          type: "drop", tMs, confidence: 0.82, reason: "C1 DROP kick-return",
          novLow: params.novLow, density: params.density, bpm: params.bpm, cell: params.cell,
        }, [0, 0.55, 0.55, 0, 0, 0, 0, 0, 0], true);
      }
      this.prevRawLow = raw.low;

      // ── M4.8 adaptive RELATIVE density reference (30s EMA, only while sound is present) ──
      if (this.lastRawTotal > 0.20 || params.density > 0.5) {
        const aRef = 1 - Math.exp(-dtSlow / 30000);
        this.densityRef = clamp(this.densityRef + (params.density - this.densityRef) * aRef, 1.2, 6.0);
      }

      // ── M4.8 independent RELATIVE hi-hat / high-band lift detector ──
      // 4-sample ring ≈ 48ms lookback; the fast/slow HIGH EMAs run at 400ms / 6s so a hat
      // layer that is merely louder than the room floor still clears the RATIO test.
      this.prevHighRing.push(raw.high);
      if (this.prevHighRing.length > 4) this.prevHighRing.shift();
      const dHigh = Math.max(0, raw.high - this.prevHighRing[0]);
      this.rawHighFast += (raw.high - this.rawHighFast) * (1 - Math.exp(-dtSlow / 400));
      this.rawHighSlow += (raw.high - this.rawHighSlow) * (1 - Math.exp(-dtSlow / 6000));
      const a3 = 1 - Math.exp(-dtSlow / 3000);
      const dHi = dHigh - this.dHighMean;
      this.dHighMean += dHi * a3;
      this.dHighVar += (dHi * dHi - this.dHighVar) * a3;
      const dHighStd = Math.sqrt(Math.max(0, this.dHighVar));
      const highOnsetTh = Math.max(0.008, 1.5 * this.dHighMean + 0.9 * dHighStd);
      if (dHigh > highOnsetTh && tMs - this.lastHighOnsetT >= 90) {
        this.lastHighOnsetT = tMs;
        this.highOnsets.push(tMs);
      }
      while (this.highOnsets.length > 0 && this.highOnsets[0] < tMs - 2000) this.highOnsets.shift();
      this.highOnsetDensity = this.highOnsets.length / 2;

      const highLifted =
        (this.rawHighFast >= Math.max(0.04, this.rawHighSlow * 1.38) ||
          this.rawHighFast - this.rawHighSlow >= 0.055) &&
        this.highOnsetDensity >= 2.0 &&
        !this.antiDropActive;

      if (!this.hiHatActive) {
        if (highLifted) {
          if (this.hiHatHoldSince === null) this.hiHatHoldSince = tMs;
          if (
            tMs - this.hiHatHoldSince >= 450 &&
            (!this.yamnetReady || this.musicProb >= 0.28 || this.vocalChant >= 0.35) &&
            this.canAutoTrigger(tMs, false)
          ) {
            this.hiHatActive = true;
            this.hiHatLowSince = null;
            // never overwrite a higher-priority breakdown/drop-return on the same sample
            if (cue === null) {
              cue = this.makeCue("hihat-lift", {
                type: "section", tMs, confidence: 0.74, reason: "C1 HI-HAT lift (high pulse)",
                novLow: params.novLow, density: params.density, bpm: params.bpm, cell: params.cell,
              }, [0, 0.20, 0.45, 0, 0.35, 0.55, 0, 0.40, 0.65], false);
            }
          }
        } else {
          this.hiHatHoldSince = null;
        }
      } else if (this.rawHighFast < this.rawHighSlow * 1.10 && this.highOnsetDensity < 1.5) {
        if (this.hiHatLowSince === null) this.hiHatLowSince = tMs;
        if (tMs - this.hiHatLowSince >= 2000) {
          this.hiHatActive = false;
          this.hiHatLowSince = null;
        }
      } else {
        this.hiHatLowSince = null;
      }

      // ── M4.8 relative density → effectiveDensity (Col 1 STATIC breakdown, Col 2 groove,
      //    Col 3 when the relative groove + hat / high-onset energy lifts) ──
      if (this.inBreakdown && !this.hiHatActive) {
        this.effectiveDensity = clamp((params.density / Math.max(1.2, this.densityRef)) * 2.2, 0, 2.4);
      } else {
        this.effectiveDensity = clamp(
          (params.density / Math.max(1.2, this.densityRef)) * 3.3 +
            (this.hiHatActive ? 1.8 : 0) +
            (this.highOnsetDensity >= 3.0 ? 1.2 : 0),
          0, 8.5,
        );
      }
    } else {
      this.lastRawTotal = 0;
    }

    if (cue === null) cue = this.maybeArrangementCue(tMs);
    return cue;
  }

  updateSemantic(frame: SemanticFrame): ContentCue | null {
    this.lastSemantic = frame;
    this.yamnetReady = frame.ready;
    this.yamnetNovelty = frame.yamnetNovelty;
    this.musicProb = frame.music;
    this.vocalChant = frame.vocalChant;
    this.electronic = frame.electronic;
    this.yamnetInferMs = frame.inferMs;
    this.topClass = frame.topClass;
    this.refreshShiftScore();
    if (!frame.ready) return null;

    if (!this.vocalActive && frame.vocalChant >= 0.55) {
      const canFire = frame.vocalChant >= 0.70
        ? frame.tMs - this.lastAutoTriggerT >= 2500
        : this.canAutoTrigger(frame.tMs, false);
      if (canFire) {
        this.vocalActive = true;
        this.vocalLowSince = null;
        return this.makeCue("vocal-entry", {
          type: "section", tMs: frame.tMs, confidence: 0.78,
          reason: `C1 VOCAL/CHANT entry (${frame.topClass})`,
          novLow: this.lastNovLow, density: this.lastDensity, bpm: this.lastBpm, cell: this.lastCell,
        }, [0, 0, 0, 0.55, 0, 0, 0.55, 0.55, 0], false);
      }
      return null;
    }
    if (this.vocalActive && frame.vocalChant < 0.20) {
      if (this.vocalLowSince === null) this.vocalLowSince = frame.tMs;
      if (frame.tMs - this.vocalLowSince >= 3000 || frame.yamnetNovelty >= 0.38) {
        this.vocalActive = false;
        this.vocalLowSince = null;
        if (this.canAutoTrigger(frame.tMs, false)) {
          return this.makeCue("vocal-exit", {
            type: "section", tMs: frame.tMs, confidence: 0.72, reason: "C1 VOCAL/CHANT exit",
            novLow: this.lastNovLow, density: this.lastDensity, bpm: this.lastBpm, cell: this.lastCell,
          }, [0, 0.48, 0, 0, 0.48, 0.48, 0, 0, 0], false);
        }
      }
      return null;
    }
    if (this.vocalActive) this.vocalLowSince = null;
    return this.maybeArrangementCue(frame.tMs);
  }

  reset(): void {
    this.bucketId.fill(-1);
    this.bucketSum.fill(0);
    this.bucketFrames.fill(0);
    this.chromaNovelty = 0;
    this.yamnetNovelty = 0;
    this.shiftScore = 0;
    this.musicProb = 0;
    this.vocalChant = 0;
    this.electronic = 0;
    this.yamnetReady = false;
    this.yamnetInferMs = 0;
    this.topClass = "";
    this.antiDropActive = false;
    this.vocalActive = false;
    this.inBreakdown = false;
    this.hiHatActive = false;
    this.effectiveDensity = 0;
    this.densityRef = 2.2;
    this.rawHighFast = 0;
    this.rawHighSlow = 0;
    this.prevHighRing = [];
    this.dHighMean = 0;
    this.dHighVar = 0;
    this.highOnsets = [];
    this.lastHighOnsetT = -1e9;
    this.highOnsetDensity = 0;
    this.hiHatHoldSince = null;
    this.hiHatLowSince = null;
    this.lastSemantic = null;
    this.lastCue = null;
    this.lastT = 0;
    this.lastDensity = 0;
    this.lastReg = 0;
    this.lastNovLow = 0;
    this.lastBpm = null;
    this.lastCell = { row: 1, col: 1 };
    this.lastRawTotal = 0;
    this.rawLowFast = 0;
    this.rawLowMed = 0;
    this.prevRawLow = 0;
    this.grooveLowRef = 0;
    this.antiDropSince = null;
    this.lowDipSince = null;
    this.breakdownSince = -1;
    this.vocalLowSince = null;
    this.lastAutoTriggerT = -1e9;
    this.lastSectionTriggerT = -1e9;
    this.lastDropTriggerT = -1e9;
    this.lastDropT = -1e9;
  }

  private makeCue(kind: ContentCueKind, event: StructureEvent, cellBias: number[], isDrop: boolean): ContentCue {
    this.lastCue = kind;
    this.noteAutoTrigger(event.tMs, isDrop);
    return { event, cellBias, cueKind: kind };
  }

  private refreshShiftScore(): void {
    this.shiftScore = this.yamnetReady
      ? 0.62 * clamp(this.yamnetNovelty / 0.42, 0, 1.5) + 0.38 * clamp(this.chromaNovelty / 0.26, 0, 1.5)
      : clamp(this.chromaNovelty / 0.26, 0, 1.5);
  }

  private maybeArrangementCue(tMs: number): ContentCue | null {
    if (!(this.shiftScore >= 0.80 || (this.yamnetReady && this.yamnetNovelty >= 0.45))) return null;
    const gate = this.yamnetReady
      ? this.musicProb >= 0.30 || this.vocalChant >= 0.40
      : this.lastReg >= 0.20 || this.lastRawTotal >= 0.35;
    if (!gate) return null;
    if (!this.canAutoTrigger(tMs, false)) return null;
    const confidence = clamp(0.55 + 0.25 * this.shiftScore, 0.55, 0.88);
    return this.makeCue("arrangement", {
      type: "section", tMs, confidence, reason: `C1 ARRANGEMENT shift (${this.shiftScore.toFixed(2)})`,
      novLow: this.lastNovLow, density: this.lastDensity, bpm: this.lastBpm, cell: this.lastCell,
    }, [0, 0, 0, 0, 0, 0, 0, 0, 0], false);
  }

  private addChromaFrame(tMs: number, chroma: number[]): void {
    const bId = Math.floor(tMs / BUCKET_MS);
    const slot = ((bId % MAX_CHROMA_BUCKETS) + MAX_CHROMA_BUCKETS) % MAX_CHROMA_BUCKETS;
    if (this.bucketId[slot] !== bId) {
      this.bucketId[slot] = bId;
      this.bucketFrames[slot] = 0;
      this.bucketSum.fill(0, slot * CHROMA_BINS, slot * CHROMA_BINS + CHROMA_BINS);
    }
    let energy = 0;
    for (let i = 0; i < CHROMA_BINS; i++) {
      const v = chroma[i];
      if (!Number.isFinite(v) || v <= 0) continue;
      this.bucketSum[slot * CHROMA_BINS + i] += v;
      energy += v;
    }
    if (energy > 0) this.bucketFrames[slot]++;
  }

  private meanChroma(startT: number, endT: number): number[] | null {
    const out = new Array<number>(CHROMA_BINS).fill(0);
    let frames = 0;
    const lo = Math.ceil(startT / BUCKET_MS);
    const hi = Math.floor((endT - 1) / BUCKET_MS);
    for (let b = lo; b <= hi; b++) {
      const slot = ((b % MAX_CHROMA_BUCKETS) + MAX_CHROMA_BUCKETS) % MAX_CHROMA_BUCKETS;
      if (this.bucketId[slot] !== b || this.bucketFrames[slot] <= 0) continue;
      for (let i = 0; i < CHROMA_BINS; i++) out[i] += this.bucketSum[slot * CHROMA_BINS + i];
      frames += this.bucketFrames[slot];
    }
    if (frames <= 0) return null;
    for (let i = 0; i < CHROMA_BINS; i++) out[i] /= frames;
    return out;
  }

  private updateChromaNovelty(tMs: number): void {
    const past = this.meanChroma(tMs - 5500, tMs - 1500);
    const now = this.meanChroma(tMs - 1500, tMs + 1);
    if (past && now) this.chromaNovelty = cosineDistance(past, now);
  }
}

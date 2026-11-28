// M3 DSP — three-band energy from an AnalyserNode FFT magnitude spectrum.
// Parameters (M3_TICKET / SPEC_V2 §M3, research-confirmed, carried over from legacy):
//   FFT 2048 · bands LOW 30–180Hz / MID 180–2500Hz / HIGH 2500–min(8000, Nyquist)Hz
//   attack 50ms / release 220ms exponential smoothing + silence gate.
// PURE module (no DOM / no three) so `node --test` can run it directly.
// Erasable-syntax-only (no enums / parameter properties).

export const FFT_SIZE = 2048;
export const ATTACK_MS = 50;
export const RELEASE_MS = 220;
/** Raw band energy below this is treated as silence (target 0) so meters truly reach zero. */
export const SILENCE_GATE = 0.008;
/** Smoothed values below this snap to exactly 0 (contract (a): zero within 2s of silence). */
export const ZERO_EPS = 0.001;

export const BAND_DEFS = {
  LOW: { min: 30, max: 180 },
  MID: { min: 180, max: 2500 },
  HIGH: { min: 2500, max: 8000 }, // upper bound clamped to Nyquist at runtime
} as const;

export type BandKey = "low" | "mid" | "high";
export interface BandEnergy {
  low: number;
  mid: number;
  high: number;
}
export const BAND_KEYS: readonly BandKey[] = ["low", "mid", "high"];

/**
 * FFT bin index range [b0, b1] (inclusive) covering fMin–fMax for a real-valued
 * spectrum of fftSize/2 bins. fMax is clamped to Nyquist (CONTEXT「三頻分組」).
 */
export function binRange(sampleRate: number, fftSize: number, fMin: number, fMax: number): [number, number] {
  const nyquist = sampleRate / 2;
  const bins = fftSize / 2;
  const binHz = nyquist / bins; // == sampleRate / fftSize
  const hi = Math.min(fMax, nyquist);
  let b0 = Math.ceil(fMin / binHz);
  let b1 = Math.floor(hi / binHz);
  b0 = Math.max(0, Math.min(b0, bins - 1));
  b1 = Math.max(b0, Math.min(b1, bins - 1));
  return [b0, b1];
}

/** Mean magnitude (0..1) inside each band from a getByteFrequencyData buffer. */
export function bandEnergies(freq: Uint8Array, sampleRate: number, fftSize: number): BandEnergy {
  const mean = (fMin: number, fMax: number): number => {
    const [b0, b1] = binRange(sampleRate, fftSize, fMin, fMax);
    let sum = 0;
    for (let i = b0; i <= b1; i++) sum += freq[i] ?? 0;
    const n = b1 - b0 + 1;
    return n > 0 ? sum / n / 255 : 0;
  };
  return {
    low: mean(BAND_DEFS.LOW.min, BAND_DEFS.LOW.max),
    mid: mean(BAND_DEFS.MID.min, BAND_DEFS.MID.max),
    high: mean(BAND_DEFS.HIGH.min, BAND_DEFS.HIGH.max),
  };
}

/**
 * Ambient baseline tracker = per-band DC removal (M3 real-mic QC findings), UPGRADED to
 * ASYMMETRIC tracking (M4.5 architecture consensus):
 *   - raw < slow (floor fell: music stopped / breakdown / Start pressed mid-song then a
 *     quiet moment) → fast DOWN tracking, tauDown = 1500ms, so the baseline re-anchors to
 *     the new floor quickly (mid-song auto-correction);
 *   - raw > slow (music above the floor) → very slow UP drift, tauUp = 25000ms, so 8–16s
 *     risers and sustained bass are NOT absorbed (M4 finding: the old symmetric tau=6s
 *     ate long risers — the build-up riser cue read ~0 on real WAVs).
 * Effective = max(0, raw − slow − ε). Silence still clamps to 0 immediately (raw ≤ slow),
 * so the M3 "zero within 2s" contract is preserved.
 * The 1.2s calibration window at Start pre-seeds `slow` with the room mean; recalibrate()
 * re-runs that window at any time (the ↻ button / mid-song correction).
 */
export class AmbientGate {
  readonly tauDownMs = 1500;
  readonly tauUpMs = 25000;
  readonly epsilon = 0.005;
  private slow: BandEnergy = { low: 0, mid: 0, high: 0 };
  private calT = 0;
  private calSum: BandEnergy = { low: 0, mid: 0, high: 0 };
  private calibrated = false;
  private calMs: number;

  constructor(calMs = 1200) {
    this.calMs = calMs;
  }

  isCalibrating(): boolean { return !this.calibrated; }
  /** Current tracked baseline (UI/QC display). */
  ambientNow(): BandEnergy { return { ...this.slow }; }

  /** Update with a raw sample; returns baseline-subtracted energy (≥0). */
  apply(raw: BandEnergy, dtMs: number): BandEnergy {
    const dt = Math.max(1, Math.min(dtMs, 250));
    if (!this.calibrated) {
      this.calT += dt;
      for (const k of BAND_KEYS) this.calSum[k] += raw[k];
      if (this.calT >= this.calMs) {
        const frames = Math.max(1, Math.round(this.calT / 16));
        for (const k of BAND_KEYS) this.slow[k] = this.calSum[k] / frames;
        this.calibrated = true;
      }
      return { low: 0, mid: 0, high: 0 }; // idle during calibration
    }
    const out: BandEnergy = { low: 0, mid: 0, high: 0 };
    for (const k of BAND_KEYS) {
      const diff = raw[k] - this.slow[k];
      const tau = diff < 0 ? this.tauDownMs : this.tauUpMs; // asymmetric (see class doc)
      const a = 1 - Math.exp(-dt / tau);
      this.slow[k] += diff * a;
      out[k] = Math.max(0, raw[k] - this.slow[k] - this.epsilon);
    }
    return out;
  }

  /** Re-run the calibration window from now (↻ button / mid-song floor correction). */
  recalibrate(): void { this.reset(); }

  reset(): void {
    this.calibrated = false;
    this.calT = 0;
    this.calSum = { low: 0, mid: 0, high: 0 };
    this.slow = { low: 0, mid: 0, high: 0 };
  }
}

/**
 * Asymmetric exponential smoother: fast attack (50ms), slow release (220ms).
 * Silence gate forces target 0; values under ZERO_EPS snap to exactly 0.
 * Decay math: 1.0 → <0.001 takes RELEASE_MS·ln(1000) ≈ 1.52s, inside the 2s contract.
 */
export class BandSmoother {
  private v: BandEnergy = { low: 0, mid: 0, high: 0 };

  update(raw: BandEnergy, dtMs: number): BandEnergy {
    const dt = Math.max(1, Math.min(dtMs, 250)); // clamp wild frame gaps
    const out: BandEnergy = { low: 0, mid: 0, high: 0 };
    for (const k of BAND_KEYS) {
      const target = raw[k] < SILENCE_GATE ? 0 : raw[k];
      const tau = target > this.v[k] ? ATTACK_MS : RELEASE_MS;
      const alpha = 1 - Math.exp(-dt / tau);
      let next = this.v[k] + (target - this.v[k]) * alpha;
      if (next < ZERO_EPS) next = 0;
      this.v[k] = next;
      out[k] = next;
    }
    return out;
  }

  current(): BandEnergy {
    return { ...this.v };
  }

  reset(): void {
    this.v = { low: 0, mid: 0, high: 0 };
  }
}

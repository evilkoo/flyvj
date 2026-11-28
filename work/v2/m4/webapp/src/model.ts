// M3 model-source interface (ADR 0007): `model source → joint/morph parameters → renderer`.
// First model source = procedural cartoon fruit fly built purely from Three.js geometry
// (ZERO external assets → licensing 100% clean, M3_TICKET「禁止」).
// Later sources (open-source skeleton rigs / NeuroMechFly v2) implement the same interface:
// they return a THREE.Object3D root plus a rig that maps band energy → part transforms.
// PURE-ish module: three types only, no DOM — safe to import from `node --test` for the
// rig math (band→pose function is exported separately from any scene wiring).

import type * as THREE from "three";
import type { BandEnergy } from "./dsp.ts";

/** Named, animatable parts a cartoon fly exposes. Any model source must map these. */
export type FlyPartName =
  | "body"        // LOW: torso bob / squash
  | "legFL" | "legFR" | "legML" | "legMR" | "legBL" | "legBR" // LOW: tap on kick
  | "antennaL" | "antennaR" // MID: twitch / sweep
  | "head"        // MID: nod / tilt
  | "wingL" | "wingR"; // HIGH: buzz-flap

/**
 * Normalised pose values in roughly [-1, 1] driving each part. The renderer applies
 * part-specific transforms (rotation / position / scale) from these numbers, so the
 * SAME rig contract works for a cartoon fly now and a skeleton model later.
 */
export interface FlyPose {
  /** 0..1 band energies echoed for HUD/debug. */
  bands: BandEnergy;
  body: number;          // 0..1 → vertical bob + slight squash
  head: number;          // 0..1 → nod amplitude
  antennaL: number;      // 0..1 → sweep amplitude
  antennaR: number;
  wingL: number;         // 0..1 → flap angle
  wingR: number;
  /** per-leg tap amounts 0..1, phase-offset so legs alternate on the kick. */
  legs: Record<"FL" | "FR" | "ML" | "MR" | "BL" | "BR", number>;
  /**
   * M4: full-body pulse 0..1 driven by a CONFIRMED drop event (CONTEXT「三頻身體映射」:
   * 結構事件 (drop) → 全身大動作). Decays over ~1s after the drop; 0 = no pulse.
   */
  dropPulse: number;
  /** seconds since pose epoch — used for oscillation phase (wing buzz, leg tap). */
  t: number;
}

export interface FlyRig {
  /** Root object to add to the scene. */
  root: THREE.Object3D;
  /** Build the current FlyPose from band energy + elapsed time + drop pulse (pure function of inputs). */
  pose(bands: BandEnergy, tSeconds: number, dropPulse?: number): FlyPose;
  /** Apply a pose to the rig's part transforms. Called once per rendered frame. */
  apply(pose: FlyPose): void;
  /** Dispose ALL GPU resources (geometry/material/texture). Contract: three.js MUST dispose. */
  dispose(): void;
  /** Part-name → Object3D lookup (QC / tests can assert parts exist and moved). */
  part(name: FlyPartName): THREE.Object3D | undefined;
}

export interface ModelSource {
  readonly id: string;         // e.g. "procedural-cartoon-fly-v1"
  readonly label: string;
  createRig(): FlyRig;
}

/**
 * Pure band→pose mapping (Band-Body Mapping, CONTEXT「三頻身體映射」):
 *   LOW (30–180Hz) → body + legs (kick tap)
 *   MID (180–2500Hz) → head + antennae (twitch)
 *   HIGH (2500–8000Hz) → wings (buzz flap)
 *   dropPulse 0..1 → FULL-BODY big motion (M4: 結構事件 drop → 全身大動作)
 * Oscillation uses tSeconds for phase; leg taps alternate via per-leg phase offsets so
 * a kick visibly "taps" rather than freezing. Exported for unit tests (no scene needed).
 */
export function bandsToPose(bands: BandEnergy, tSeconds: number, dropPulse = 0): FlyPose {
  const legPhase = { FL: 0, FR: Math.PI, ML: Math.PI * 0.5, MR: Math.PI * 1.5, BL: Math.PI * 0.75, BR: Math.PI * 0.25 };
  const dp = Math.max(0, Math.min(1, dropPulse));
  const tap = (phase: number): number => {
    const amp = bands.low;
    // a kick produces a positive oscillation gated by LOW energy
    const osc = 0.5 + 0.5 * Math.sin(tSeconds * 12 + phase);
    // drop pulse forces every leg into a big synchronized spread/jump (lower bound 0.7 so
    // ALL legs visibly engage regardless of phase — 全身大動作, not a per-leg oscillation)
    return Math.min(1, amp * osc + dp * (0.85 + 0.15 * Math.sin(tSeconds * 18 + phase)));
  };
  return {
    bands: { ...bands },
    body: Math.min(1, bands.low + dp),
    head: Math.min(1, bands.mid * (0.6 + 0.4 * Math.sin(tSeconds * 7)) + dp * 0.8),
    antennaL: Math.min(1, bands.mid * (0.5 + 0.5 * Math.sin(tSeconds * 9)) + dp * 0.9),
    antennaR: Math.min(1, bands.mid * (0.5 + 0.5 * Math.sin(tSeconds * 9 + 1.1)) + dp * 0.9),
    wingL: Math.min(1, bands.high + dp),
    wingR: Math.min(1, bands.high + dp),
    legs: {
      FL: tap(legPhase.FL),
      FR: tap(legPhase.FR),
      ML: tap(legPhase.ML),
      MR: tap(legPhase.MR),
      BL: tap(legPhase.BL),
      BR: tap(legPhase.BR),
    },
    dropPulse: dp,
    t: tSeconds,
  };
}

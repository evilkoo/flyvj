// M3 audio input — getUserMedia with AGC/echo/noise-suppression OFF *requested*,
// then getSettings() to read the ACTUAL state (never assume success — CONTEXT「AGC 對策」).
// AnalyserNode FFT 2048 feeds src/dsp.ts. All browser-side; pure logic lives in dsp.ts.

import { FFT_SIZE, AmbientGate, BandSmoother, bandEnergies, type BandEnergy } from "./dsp.ts";
import { extractChroma12 } from "./content.ts";

export interface MicActualSettings {
  autoGainControl: boolean | null;
  echoCancellation: boolean | null;
  noiseSuppression: boolean | null;
  sampleRate: number | null;
  deviceId: string;
  label: string;
}

export interface MicStatus {
  state: "idle" | "starting" | "running" | "error";
  error?: string;
  settings?: MicActualSettings;
  /** Requested constraints vs what the browser actually applied. */
  requested?: { autoGainControl: false; echoCancellation: false; noiseSuppression: false };
}

export const MIC_CONSTRAINTS = {
  autoGainControl: false,
  echoCancellation: false,
  noiseSuppression: false,
} as const;

/** Read the ACTUAL track settings (contract (d): display real state, never assume). */
export function readActualSettings(track: MediaStreamTrack): MicActualSettings {
  const s = track.getSettings() as MediaTrackSettings & {
    autoGainControl?: boolean;
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
  };
  return {
    autoGainControl: s.autoGainControl ?? null,
    echoCancellation: s.echoCancellation ?? null,
    noiseSuppression: s.noiseSuppression ?? null,
    sampleRate: (s.sampleRate as number | undefined) ?? null,
    deviceId: s.deviceId ?? "",
    label: track.label ?? "(no label)",
  };
}

export interface AudioPipeline {
  context: AudioContext;
  analyser: AnalyserNode;
  stream: MediaStream;
  track: MediaStreamTrack;
  settings: MicActualSettings;
  /** M4.8: where the audio comes from — user mic or system/display capture (Resolume feed). */
  sourceKind?: "mic" | "system";
  /** M4.7 C1: 16 kHz PCM tap (null when AudioWorklet unavailable → fallback timer used). */
  pcmTap?: AudioWorkletNode | null;
  /** Stops the tap node + fallback timer; idempotent, called by stopMicPipeline. */
  stopPcmTap?: () => void;
}

/**
 * Shared pipeline construction for any audio MediaStream (mic or system capture):
 * actual-settings read, AudioContext + FFT analyser, and the optional 16 kHz PCM tap.
 * @param onPcm16k optional C1 tap — receives zero-copy Float32Array(7680) chunks
 * (0.48 s @ 16 kHz) resampled from the source stream. AudioWorklet path with an
 * AnalyserNode-based fallback when addModule / AudioWorkletNode is unavailable.
 */
async function createPipelineFromStream(
  stream: MediaStream,
  track: MediaStreamTrack,
  sourceKind: "mic" | "system",
  onPcm16k?: (samples: Float32Array) => void,
): Promise<AudioPipeline> {
  const settings = readActualSettings(track);
  const context = new AudioContext();
  if (context.state === "suspended") await context.resume(); // Start button = user gesture
  const analyser = context.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0; // smoothing is OUR job (attack/release in dsp.ts)
  const src = context.createMediaStreamSource(stream);
  src.connect(analyser);

  let pcmTap: AudioWorkletNode | null = null;
  let stopPcmTap: (() => void) | undefined = undefined;
  if (onPcm16k) {
    try {
      await context.audioWorklet.addModule("/pcm-tap.worklet.js");
      const tap = new AudioWorkletNode(context, "flyvj-pcm-tap");
      src.connect(tap);
      // Chromium only schedules process() on a node connected to a destination — route
      // through a silent gain so the tap runs cleanly without ever emitting sound.
      const silent = context.createGain();
      silent.gain.value = 0;
      tap.connect(silent);
      silent.connect(context.destination);
      tap.port.onmessage = (ev: MessageEvent) => {
        if (ev.data instanceof Float32Array) onPcm16k(ev.data);
      };
      pcmTap = tap;
      stopPcmTap = () => {
        try { tap.port.onmessage = null; } catch { /* noop */ }
        try { tap.disconnect(); } catch { /* noop */ }
        try { silent.disconnect(); } catch { /* noop */ }
      };
    } catch {
      // Fallback: AnalyserNode time-domain reads on a 32ms timer, continuously linear-
      // resampled to 16 kHz. Same 7680-sample chunk contract as the worklet path.
      const CHUNK = 7680;
      const tmp = new Float32Array(FFT_SIZE);
      let hold = new Float32Array(0);
      let cursor = 0;
      let out = new Float32Array(CHUNK);
      let filled = 0;
      const fallbackTimer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(tmp);
        const merged = new Float32Array(hold.length + tmp.length);
        merged.set(hold);
        merged.set(tmp, hold.length);
        hold = merged;
        const ratio = context.sampleRate / 16000;
        while (cursor + 1 < hold.length) {
          const i = cursor | 0;
          const frac = cursor - i;
          const v = hold[i] + (hold[i + 1] - hold[i]) * frac;
          out[filled++] = Number.isFinite(v) ? v : 0;
          if (filled === CHUNK) {
            onPcm16k(out);
            out = new Float32Array(CHUNK);
            filled = 0;
          }
          cursor += ratio;
        }
        const keepFrom = cursor | 0;
        hold = hold.slice(keepFrom);
        cursor -= keepFrom;
      }, 32);
      stopPcmTap = () => { window.clearInterval(fallbackTimer); };
    }
  }
  return { context, analyser, stream, track, settings, sourceKind, pcmTap, stopPcmTap };
}

export async function startMicPipeline(onPcm16k?: (samples: Float32Array) => void): Promise<AudioPipeline> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { ...MIC_CONSTRAINTS },
    video: false,
  });
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error("getUserMedia returned no audio track");
  return createPipelineFromStream(stream, track, "mic", onPcm16k);
}

/**
 * M4.8: capture the SYSTEM audio feed (e.g. Resolume output) via getDisplayMedia instead
 * of a room mic — no speakers re-recording, no AGC colouring. The picker must run with
 * "share system audio" ticked; a video track is requested only because Chromium gates
 * system-audio capture behind a visual surface, and it is stopped immediately.
 * @param onPcm16k same 0.48 s chunk contract as the mic pipeline
 * @param onEnded fired once when the captured track dies (share window closed / stream ends)
 */
export async function startSystemAudioPipeline(
  onPcm16k?: (samples: Float32Array) => void,
  onEnded?: () => void,
): Promise<AudioPipeline> {
  const rawStream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { autoGainControl: false, echoCancellation: false, noiseSuppression: false } as MediaTrackConstraints,
  });
  for (const vt of rawStream.getVideoTracks()) {
    vt.stop();
    rawStream.removeTrack(vt);
  }
  const audioTrack = rawStream.getAudioTracks()[0];
  if (!audioTrack) {
    throw new Error("未收到系統音訊 — 彈窗請揀「整個畫面」並剔選「同時分享系統音訊」");
  }
  // Clean audio-only stream so MediaRecorder (5m diag capture) works on system audio too.
  const audioStream = new MediaStream([audioTrack]);
  audioTrack.addEventListener("ended", () => onEnded?.(), { once: true });
  return createPipelineFromStream(audioStream, audioTrack, "system", onPcm16k);
}

/**
 * Per-frame sampler: reads byte spectrum → raw band means → ambient gate (room-noise
 * baseline subtraction, see dsp.ts AmbientGate) → asymmetric smoothing.
 * Contract (a): silenced input must reach exactly 0 within 2s (gate + decay math).
 */
export class BandSampler {
  private buf: Uint8Array;
  private gate = new AmbientGate();
  private smoother = new BandSmoother();
  private lastT: number | null = null;
  private analyser: AnalyserNode;
  private sampleRate: number;
  /** M4: last RAW (pre-gate, pre-smoother) band means — onset/rhythm features read these
   * (the smoother's 220ms release blurs fast snare-roll transients). */
  private raw: BandEnergy = { low: 0, mid: 0, high: 0 };
  /** M4.7 C1: last 12-bin chroma (L1-normalised) from the same byte spectrum. */
  private chroma: number[] = new Array(12).fill(0);

  constructor(analyser: AnalyserNode, sampleRate: number) {
    this.analyser = analyser;
    this.sampleRate = sampleRate;
    this.buf = new Uint8Array(analyser.frequencyBinCount);
  }

  /** True during the first ~1.2s after start (ambient calibration; bands stay 0). */
  isCalibrating(): boolean { return this.gate.isCalibrating(); }
  ambient(): BandEnergy { return this.gate.ambientNow(); }
  /** M4.5: ↻ button — re-run the calibration window now (mid-song floor correction). */
  recalibrate(): void { this.gate.recalibrate(); this.lastT = null; }
  /** Raw band means from the most recent sample() (M4 onset source). */
  lastRaw(): BandEnergy { return { ...this.raw }; }
  /** Last chroma vector from the most recent sample() (C1 harmony-novelty source). */
  lastChroma(): number[] { return [...this.chroma]; }

  /** @param nowMs timestamp (performance.now()); returns smoothed 0..1 per band. */
  sample(nowMs: number): BandEnergy {
    this.analyser.getByteFrequencyData(this.buf as Uint8Array<ArrayBuffer>);
    const raw = bandEnergies(this.buf, this.sampleRate, FFT_SIZE);
    this.raw = raw;
    this.chroma = extractChroma12(this.buf, this.sampleRate, FFT_SIZE);
    const dt = this.lastT === null ? 16 : nowMs - this.lastT;
    this.lastT = nowMs;
    const gated = this.gate.apply(raw, dt);
    return this.smoother.update(gated, dt);
  }

  reset(): void {
    this.gate.reset();
    this.smoother.reset();
    this.lastT = null;
    this.raw = { low: 0, mid: 0, high: 0 };
    this.chroma = new Array(12).fill(0);
  }
}

export function stopMicPipeline(p: AudioPipeline): void {
  if (p.stopPcmTap) { try { p.stopPcmTap(); } catch { /* noop */ } }
  try { p.track.stop(); } catch { /* noop */ }
  for (const t of p.stream.getTracks()) { try { t.stop(); } catch { /* noop */ } }
  void p.context.close().catch(() => undefined);
}

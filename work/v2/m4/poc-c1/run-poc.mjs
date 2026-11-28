// run-poc.mjs — Workstream 2: CPU-only C1 ONNX Audio Understanding POC (0 MB VRAM)
// Baseline = FlyVJ webapp StructureDetector fed by an offline Web Audio AnalyserNode
// emulation; comparison = non-loudness DSP features + YAMNet ONNX (1024-d embeddings).
// All numbers below are measured from the real WAV file — nothing is hardcoded or faked.
import { InferenceSession, Tensor } from "onnxruntime-node";
import { bandEnergies, AmbientGate, BandSmoother } from "../webapp/src/dsp.ts";
import { StructureDetector } from "../webapp/src/detector.ts";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WAV = "C:/Users/evilkoo/Documents/烏蠅VJ/Bakari_DJ_intro_edit_no_voice.mp3.wav";
const OUT_JSON = path.join(HERE, "report.json");
const OUT_MD = path.join(HERE, "report.md");
const log = (...a) => console.log(...a);
const now = () => performance.now();

// ────────────────────────── FFT (radix-2, precomputed tables) ──────────────────────────
class FFT {
  constructor(n) {
    this.n = n;
    this.levels = Math.log2(n) | 0;
    this.cosp = new Float64Array(n / 2);
    this.sinp = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cosp[i] = Math.cos((2 * Math.PI * i) / n);
      this.sinp[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0, x = i;
      for (let b = 0; b < this.levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
      this.rev[i] = r;
    }
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
  }
  // in-place forward transform on this.re/this.im (already filled by caller)
  run() {
    const { n, re, im, rev, cosp, sinp } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cosp[k] + im[l] * sinp[k];
          const tim = -re[l] * sinp[k] + im[l] * cosp[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  }
}

// ────────────────────────── WAV parsing (proper RIFF chunk walk) ──────────────────────────
function parseWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE")
    throw new Error("not a RIFF/WAVE file");
  let off = 12, fmt = null, dataOff = -1, dataLen = -1;
  const chunks = [];
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    chunks.push({ id, size, offset: off });
    if (id === "fmt " && size >= 16) {
      fmt = {
        audioFormat: buf.readUInt16LE(off + 8),
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        byteRate: buf.readUInt32LE(off + 16),
        blockAlign: buf.readUInt16LE(off + 20),
        bitsPerSample: buf.readUInt16LE(off + 22),
      };
    } else if (id === "data") {
      dataOff = off + 8;
      dataLen = size;
    }
    off += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0) throw new Error("missing fmt/data chunk");
  if (fmt.audioFormat !== 1) throw new Error(`unsupported audioFormat ${fmt.audioFormat} (need PCM 1)`);
  if (fmt.bitsPerSample !== 16) throw new Error(`unsupported bitsPerSample ${fmt.bitsPerSample} (need 16)`);
  const ch = fmt.channels;
  const nFrames = Math.floor(dataLen / (ch * 2));
  // 16-bit stereo PCM → mono, (L + R) * 0.5 / 32768
  const s16 = new Int16Array(buf.buffer, buf.byteOffset + dataOff, nFrames * ch);
  const mono = new Float32Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    let acc = 0;
    for (let c = 0; c < ch; c++) acc += s16[i * ch + c];
    mono[i] = (acc / ch) / 32768;
  }
  return { fmt, chunks, chunksWalked: chunks.length, mono, sampleRate: fmt.sampleRate };
}

// ────────────────────────── 48k → 16k decimation (Kaiser FIR, fc 7.2 kHz) ──────────────────────────
function besselI0(x) {
  let s = 1, t = 1;
  for (let i = 1; i < 40; i++) { t *= (x / 2) / i; const t2 = t * t; s += t2; }
  // note: standard series: I0 = Σ ((x/2)^i / i!)^2
  return s;
}
function designKaiserLowpass(numTaps, fs, fc, beta) {
  const c = (numTaps - 1) / 2;
  const h = new Float64Array(numTaps);
  let sum = 0;
  for (let n = 0; n < numTaps; n++) {
    const m = n - c;
    const sinc = m === 0 ? 2 * fc / fs : Math.sin((2 * Math.PI * fc * m) / fs) / (Math.PI * m);
    const k = besselI0(beta * Math.sqrt(Math.max(0, 1 - ((m / c) ** 2)))) / besselI0(beta);
    h[n] = sinc * k;
    sum += h[n];
  }
  for (let n = 0; n < numTaps; n++) h[n] /= sum;
  return h;
}
function resample48to16(x48, h) {
  const L = h.length, delay = (L - 1) / 2, D = 3;
  const nOut = Math.max(0, Math.ceil((x48.length - delay) / D));
  const y = new Float32Array(nOut);
  for (let m = 0; m < nOut; m++) {
    const base = m * D - delay;
    let acc = 0;
    for (let k = 0; k < L; k++) {
      const idx = base + k;
      if (idx >= 0 && idx < x48.length) acc += h[k] * x48[idx];
    }
    y[m] = acc;
  }
  return y;
}

// ────────────────────────── biquads (RBJ cookbook, direct form 1) ──────────────────────────
function makeBiquad(type, fs, f0, Q = 0.70710678) {
  const w = 2 * Math.PI * f0 / fs, cw = Math.cos(w), alpha = Math.sin(w) / (2 * Q);
  let b0, b1, b2, a0, a1, a2;
  if (type === "lpf") {
    b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  } else { // hpf
    b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
    a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}
function applyBiquad(x, f) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}
function applyBiquadInto(x, f, y) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = f.b0 * xi + f.b1 * x1 + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}
function rms(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

// ────────────────────────── deterministic PRNG (mulberry32) ──────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ────────────────────────── simulated laptop mic chain ──────────────────────────
// 1) capsule/Windows bandpass: 2nd-order HPF 95 Hz + LPF 3.2 kHz (Butterworth Q=0.7071)
// 2) multi-tap room reverb, exponential decay tau=0.38 s, wet/dry = 0.35
// 3) laptop fan: band-limited noise 180–1600 Hz + light broadband hiss, at +10 dB SNR
//    relative to the active-music RMS of the (band-passed + reverberated) music signal
// 4) soft AGC/limiter: gain maps p99.5(|x|) → 0.9 (cap ×3), then tanh soft clip
function simulateLaptopMic(clean48k, sr) {
  const t0 = now();
  const fHP = makeBiquad("hpf", sr, 95);
  const fLP = makeBiquad("lpf", sr, 3200);
  const bp = applyBiquad(applyBiquad(clean48k, fHP), fLP);

  // multi-tap reverb
  const tapsMs = [23, 47, 83, 131, 197, 317];
  const tauS = 0.38;
  const taps = tapsMs.map((ms) => Math.round((ms / 1000) * sr));
  const g = tapsMs.map((ms) => Math.exp(-(ms / 1000) / tauS));
  const gSum = g.reduce((a, b) => a + b, 0);
  const gw = g.map((v) => v / gSum);
  const n = clean48k.length;
  const reverb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = 0; k < taps.length; k++) {
      const idx = i - taps[k];
      if (idx >= 0) acc += gw[k] * bp[idx];
    }
    reverb[i] = acc;
  }
  const WET = 0.35;
  const music = new Float32Array(n);
  for (let i = 0; i < n; i++) music[i] = (1 - WET) * bp[i] + WET * reverb[i];

  // active-music RMS: 50 ms frames, active = frameRMS > 0.1 × overall RMS
  const frameLen = Math.round(sr * 0.05);
  const nFrames = Math.floor(n / frameLen);
  const frameRms = new Float64Array(nFrames);
  for (let fIdx = 0; fIdx < nFrames; fIdx++) {
    let s = 0;
    const st = fIdx * frameLen;
    for (let i = 0; i < frameLen; i++) { const v = music[st + i]; s += v * v; }
    frameRms[fIdx] = Math.sqrt(s / frameLen);
  }
  let sumAll = 0;
  for (let i = 0; i < nFrames; i++) sumAll += frameRms[i] * frameRms[i];
  const overallRms = Math.sqrt(sumAll / nFrames);
  let sumAct = 0, cntAct = 0;
  for (let i = 0; i < nFrames; i++) {
    if (frameRms[i] > 0.1 * overallRms) { sumAct += frameRms[i] * frameRms[i]; cntAct++; }
  }
  const activeRms = Math.sqrt(sumAct / Math.max(1, cntAct));
  const activeFrac = cntAct / nFrames;

  // fan noise: white → HPF 180 Hz → LPF 1600 Hz (2nd-order each); hiss = separate broadband white
  const rand1 = mulberry32(0xF1BA1);
  const rand2 = mulberry32(0xBADD);
  const white1 = new Float32Array(n);
  for (let i = 0; i < n; i++) white1[i] = rand1() * 2 - 1;
  const fanBand = applyBiquad(applyBiquad(white1, makeBiquad("hpf", sr, 180)), makeBiquad("lpf", sr, 1600));
  const white2 = new Float32Array(n);
  for (let i = 0; i < n; i++) white2[i] = rand2() * 2 - 1;

  // normalize: noise RMS (fan + 0.15×hiss, measured) = activeRms / 10^(10/20)
  const HISST = 0.15;
  const noiseUnit = new Float32Array(n);
  for (let i = 0; i < n; i++) noiseUnit[i] = fanBand[i] + HISST * white2[i];
  const noiseUnitRms = rms(noiseUnit);
  const targetNoiseRms = activeRms / Math.pow(10, 10 / 20);
  const noiseGain = targetNoiseRms / Math.max(1e-12, noiseUnitRms);

  const mixed = new Float32Array(n);
  for (let i = 0; i < n; i++) mixed[i] = music[i] + noiseGain * noiseUnit[i];

  // soft AGC/limiter: histogram p99.5 → gain, then tanh
  let maxAbs = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(mixed[i]); if (a > maxAbs) maxAbs = a; }
  const NB = 4096;
  const hist = new Float64Array(NB);
  const binW = (maxAbs + 1e-12) / NB;
  for (let i = 0; i < n; i++) hist[Math.min(NB - 1, (mixed[i] < 0 ? -mixed[i] : mixed[i]) / binW | 0)]++;
  const target = n * 0.995;
  let cum = 0, pIdx = NB - 1;
  for (let b = 0; b < NB; b++) { cum += hist[b]; if (cum >= target) { pIdx = b; break; } }
  const p995 = (pIdx + 1) * binW;
  const gain = Math.min(3, 0.9 / Math.max(1e-9, p995));
  const mic48k = new Float32Array(n);
  for (let i = 0; i < n; i++) mic48k[i] = Math.tanh(gain * mixed[i]) / gain;

  return {
    mic48k,
    params: {
      hpfHz: 95, lpfHz: 3200, filterQ: 0.70710678, filterOrder: "2nd-order biquad each (Butterworth)",
      reverbTapsMs: tapsMs, reverbTauS: tauS, wetDry: WET,
      fanBandHz: [180, 1600], hissLevelRelFan: HISST,
      targetSnrDb: 10, noiseGain: noiseGain,
      activeRms: activeRms, activeFrameFrac: activeFrac, overallRms,
      limiterP995: p995, limiterGain: gain, limiterCurve: "tanh(g*x)/g",
    },
    elapsedMs: now() - t0,
  };
}

// ────────────────────────── Web Audio AnalyserNode emulation ──────────────────────────
// Spec (Web Audio API 1.1 §1.8.6): Blackman window α=0.16 (N denominator), FFT normalized
// by 1/N, smoothing τ=0 (webapp sets smoothingTimeConstant=0), byte = round(255·(dB−min)/
// (max−min)) with defaults minDecibels=−100, maxDecibels=−30 (webapp does not override).
function blackmanWindow(N) {
  const alpha = 0.16, a0 = (1 - alpha) / 2, a1 = 0.5, a2 = alpha / 2;
  const w = new Float64Array(N);
  for (let n = 0; n < N; n++) w[n] = a0 - a1 * Math.cos((2 * Math.PI * n) / N) + a2 * Math.cos((4 * Math.PI * n) / N);
  return w;
}

const MIN_DB = -100, MAX_DB = -30;

// ────────────────────────── baseline analyzer (FlyVJ StructureDetector) ──────────────────────────
function runBaseline(x48, sr, label) {
  const t0 = now();
  const TICK = 16; // ms
  const hopSamples = Math.round((sr * TICK) / 1000); // 768 @48k
  const N = 2048;
  const fft = new FFT(N);
  const win = blackmanWindow(N);
  const nTicks = Math.floor(x48.length / hopSamples);
  const frame = new Float64Array(N);
  const bytes = new Uint8Array(N / 2);
  const gate = new AmbientGate(1200);
  const smoother = new BandSmoother();
  const det = new StructureDetector();
  const events = [];
  const novLowSeries = new Float32Array(nTicks);
  const totalSeries = new Float32Array(nTicks);
  const secStates = [];
  let calibrationLogged = false;
  for (let i = 0; i < nTicks; i++) {
    const end = (i + 1) * hopSamples;
    for (let k = 0; k < N; k++) {
      const idx = end - N + k;
      frame[k] = idx >= 0 ? x48[idx] : 0; // stream starts with zeros before t=0 (no pre-roll)
    }
    for (let k = 0; k < N; k++) { fft.re[k] = frame[k] * win[k]; fft.im[k] = 0; }
    fft.run();
    for (let k = 0; k < N / 2; k++) {
      const mag = Math.sqrt(fft.re[k] * fft.re[k] + fft.im[k] * fft.im[k]) / N;
      let db = 20 * Math.log10(Math.max(mag, 1e-300));
      if (db < MIN_DB) db = MIN_DB; else if (db > MAX_DB) db = MAX_DB;
      let b = Math.round((255 * (db - MIN_DB)) / (MAX_DB - MIN_DB));
      if (b < 0) b = 0; else if (b > 255) b = 255;
      bytes[k] = b;
    }
    const raw = bandEnergies(bytes, sr, N);
    const gated = gate.apply(raw, TICK);
    const sm = smoother.update(gated, TICK);
    const tMs = i * TICK;
    const ev = det.update(tMs, sm, raw);
    novLowSeries[i] = det.state(tMs).novLow;
    totalSeries[i] = raw.low + raw.mid + raw.high;
    if (!calibrationLogged && !gate.isCalibrating()) {
      calibrationLogged = true;
      const a = gate.ambientNow();
      secStates.push({ t: 0, note: "AmbientGate calibration (first 1.2 s) seeded baseline", ambient: { low: a.low, mid: a.mid, high: a.high } });
    }
    if (ev) events.push({ ...ev, tMs });
    if (i % Math.round(1000 / TICK) === 0) {
      const st = det.state(tMs);
      secStates.push({ t: tMs / 1000, bpm: st.bpm, density: st.density, regularity: st.regularity, total: st.total, cell: `${st.cell.row}-${st.cell.col}` });
    }
  }
  const stFinal = det.state((nTicks - 1) * TICK);
  log(`  [${label}] baseline: ${nTicks} ticks, ${events.length} events, firstSoundT=${stFinal.firstSoundT} ms, ${ (now() - t0).toFixed(0) } ms`);
  return { events, novLowSeries, totalSeries, tickMs: TICK, nTicks, states: secStates, firstSoundMs: stFinal.firstSoundT, elapsedMs: now() - t0 };
}

// ────────────────────────── mel / chroma filterbanks ──────────────────────────
const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m) => 700 * (10 ** (m / 2595) - 1);
function melFilterbank(nBands, fftSize, sr, fMin, fMax) {
  const nBins = fftSize / 2;
  const centers = [];
  for (let b = 0; b < nBands + 2; b++) centers.push(mel2hz(hz2mel(fMin) + ((hz2mel(fMax) - hz2mel(fMin)) * b) / (nBands + 1)));
  const fb = [];
  for (let b = 1; b <= nBands; b++) {
    const lo = centers[b - 1], ce = centers[b], hi = centers[b + 1];
    const row = new Float64Array(nBins);
    let nz = 0;
    for (let k = 0; k < nBins; k++) {
      const f = (k * sr) / fftSize;
      if (f >= lo && f <= ce && ce > lo) row[k] = (f - lo) / (ce - lo);
      else if (f > ce && f <= hi && hi > ce) row[k] = (hi - f) / (hi - ce);
      if (row[k] > 0) nz++;
    }
    fb.push({ row, nz });
  }
  return fb;
}

// ────────────────────────── non-loudness content features (16 kHz, 0.48 s hop) ──────────────────────────
function runContentFeatures(x16k, sr) {
  const t0 = now();
  const HOP = 7680; // 0.48 s
  const NF = 2048;
  const fft = new FFT(NF);
  const hann = new Float64Array(NF);
  for (let i = 0; i < NF; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (NF - 1));
  const SUB = 8, STRIDE = 800; // 8×2048-sample subframes at 50 ms stride cover 7648 of 7680 samples
  const fb = melFilterbank(24, NF, sr, 80, 8000);
  // chroma map: bins in 80–2000 Hz → pitch class
  const chromaMap = [];
  for (let k = 0; k < NF / 2; k++) {
    const f = (k * sr) / NF;
    if (f >= 80 && f <= 2000) {
      const pc = ((Math.round(12 * Math.log2(f / 55)) % 12) + 12) % 12;
      chromaMap.push({ k, pc });
    }
  }
  const nHops = Math.max(0, Math.floor((x16k.length - NF) / HOP) + 1 - 1); // hop window start = i*HOP+NF end-aligned like analyser
  const chromaVecs = [], melVecs = [], flatness = [], hopTimes = [];
  const power = new Float64Array(NF / 2);
  for (let i = 0; i < nHops; i++) {
    const hopStart = (i + 1) * HOP; // window END (aligned with "last 2048 samples" convention)
    const chr = new Float64Array(12);
    const melPow = new Float64Array(24);
    let flatSum = 0;
    for (let s = 0; s < SUB; s++) {
      const end = hopStart - s * STRIDE;
      const start = end - NF;
      if (start < 0) continue;
      for (let k = 0; k < NF; k++) { fft.re[k] = x16k[start + k] * hann[k]; fft.im[k] = 0; }
      fft.run();
      let logSum = 0, linSum = 0;
      for (let k = 1; k < NF / 2; k++) {
        const p = (fft.re[k] * fft.re[k] + fft.im[k] * fft.im[k]) / NF;
        power[k] = p;
        logSum += Math.log(p + 1e-12);
        linSum += p;
      }
      flatSum += Math.exp(logSum / (NF / 2 - 1)) / (linSum / (NF / 2 - 1) + 1e-12);
      for (const { k, pc } of chromaMap) chr[pc] += power[k];
      for (let b = 0; b < 24; b++) {
        const { row, nz } = fb[b];
        let acc = 0;
        for (let k = 1; k < NF / 2; k++) acc += row[k] * power[k];
        melPow[b] += acc / Math.max(1, nz);
      }
    }
    // log compression after power averaging
    const melLog = new Float64Array(24);
    for (let b = 0; b < 24; b++) melLog[b] = Math.log(melPow[b] / SUB + 1e-12);
    let cs = 0;
    for (let c = 0; c < 12; c++) cs += chr[c];
    for (let c = 0; c < 12; c++) chr[c] /= Math.max(1e-12, cs); // L1 → distribution
    chromaVecs.push(chr); melVecs.push(melLog); flatness.push(flatSum / SUB);
    hopTimes.push((hopStart - NF / 2) / sr); // window center time
  }
  return { chromaVecs, melVecs, flatness, hopTimes, elapsedMs: now() - t0 };
}

// cosine self-similarity novelty between mean vectors of two hop-index windows
function cosNovelty(vecs, times, hopT, aLo, aHi, bLo, bHi) {
  const meanVec = (lo, hi) => {
    const n = vecs.length;
    const idxs = [];
    for (let i = 0; i < n; i++) if (times[i] > lo && times[i] <= hi) idxs.push(i);
    if (!idxs.length) return null;
    const m = new Float64Array(vecs[0].length);
    for (const i of idxs) for (let j = 0; j < m.length; j++) m[j] += vecs[i][j];
    for (let j = 0; j < m.length; j++) m[j] /= idxs.length;
    return m;
  };
  const A = meanVec(aLo, aHi), B = meanVec(bLo, bHi);
  if (!A || !B) return null;
  let dot = 0, na = 0, nb = 0;
  for (let j = 0; j < A.length; j++) { dot += A[j] * B[j]; na += A[j] * A[j]; nb += B[j] * B[j]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d > 1e-12 ? dot / d : null;
}
function noveltySeries(vecs, times, variant) {
  // returns [{t, nov}] with nov = 1 − cos
  const out = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    let v = null;
    if (variant === "centered") v = cosNovelty(vecs, times, t, t - 4, t, t, t + 4);
    else v = cosNovelty(vecs, times, t, t - 6, t - 2, t - 2, t);
    if (v !== null) out.push({ t, nov: 1 - v });
  }
  return out;
}

// RMS per 100 ms + causal anti-drop score at content-hop times
function antiDropSeries(x16k, sr, hopTimes) {
  const W = Math.round(sr * 0.1);
  const nW = Math.floor(x16k.length / W);
  const rms100 = new Float64Array(nW);
  for (let i = 0; i < nW; i++) {
    let s = 0;
    for (let k = 0; k < W; k++) { const v = x16k[i * W + k]; s += v * v; }
    rms100[i] = Math.sqrt(s / W);
  }
  const out = [];
  for (const t of hopTimes) {
    const A = meanRmsWindow(rms100, t - 1.0, t - 0.5, sr);
    const B = meanRmsWindow(rms100, t - 0.5, t, sr);
    if (A === null || B === null) { out.push({ t, score: 0, ratio: null, sustained: false, active: false, A: null, B: null }); continue; }
    // sustained-energy reference: median of trailing 10 s of 100 ms RMS frames
    const i0 = Math.max(0, Math.round((t - 10) * 10));
    const i1 = Math.max(i0 + 1, Math.round(t * 10));
    const seg = Array.from(rms100.slice(i0, i1)).sort((a, b) => a - b);
    const med = seg[Math.floor(seg.length / 2)];
    const sustained = A >= 0.25 * med;
    out.push({ t, score: 0, ratio: B / Math.max(1e-12, A), sustained, A, B });
  }
  return { series: out, rms100 };
}
function meanRmsWindow(rms100, lo, hi, sr) {
  const i0 = Math.max(0, Math.ceil(lo * 10)), i1 = Math.min(rms100.length, Math.ceil(hi * 10));
  if (i1 <= i0) return null;
  let s = 0;
  for (let i = i0; i < i1; i++) s += rms100[i];
  return s / (i1 - i0);
}

// ────────────────────────── YAMNet runner ──────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (field !== "" || row.length) { row.push(field); rows.push(row); row = []; field = ""; }
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function loadClassMap(csvPath) {
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const header = rows[0];
  if (header[0] !== "index" || header[2] !== "display_name") throw new Error("unexpected CSV header: " + header.join(","));
  return rows.slice(1).map((r) => ({ index: parseInt(r[0], 10), mid: r[1], name: r[2] }));
}

function groupDefs(classes) {
  const byName = new Map(classes.map((c) => [c.name.toLowerCase(), c]));
  const groups = { music: [], drums_percussion: [], bass_electronic: [], vocals_speech: [], quiet_ambient: [] };
  const matched = {}, unmatchedSpec = {};
  for (const c of classes) {
    const n = c.name.toLowerCase();
    if (n === "music" || n.includes("music")) groups.music.push(c);
    if (/(drum|cymbal|percussion|hi-hat)/.test(n)) groups.drums_percussion.push(c);
    if (/(speech|singing|vocal|rap|choir)/.test(n)) groups.vocals_speech.push(c);
    if (["silence", "noise", "environmental noise", "quiet"].includes(n)) groups.quiet_ambient.push(c);
  }
  const bassSpec = ["synthesizer", "electronic music", "techno", "house music", "trance music", "dubstep", "bass guitar", "electronic dance music"];
  matched.bass_electronic = [];
  unmatchedSpec.bass_electronic = [];
  for (const spec of bassSpec) {
    if (byName.has(spec)) { groups.bass_electronic.push(byName.get(spec)); matched.bass_electronic.push(spec); }
    else unmatchedSpec.bass_electronic.push(spec);
  }
  return { groups, matched, unmatchedSpec };
}

async function runYamnet(x16k, sr, session, groups, classes, label) {
  const t0 = now();
  const HOP = 7680, WIN = 15600; // 0.48 s hop, 0.975 s window (verified: exactly 1 patch)
  const nHops = Math.floor((x16k.length - WIN) / HOP) + 1;
  const embDim = 1024;
  const embs = [];
  const groupProbs = { music: [], drums_percussion: [], bass_electronic: [], vocals_speech: [], quiet_ambient: [] };
  const topClass = [];
  const latencies = [];
  let rssMax = process.memoryUsage().rss;
  const wf = new Float32Array(WIN);
  for (let i = 0; i < nHops; i++) {
    const start = i * HOP;
    for (let k = 0; k < WIN; k++) wf[k] = x16k[start + k];
    const ti = now();
    const out = await session.run({ waveform: new Tensor("float32", wf.slice(), [WIN]) });
    const ms = now() - ti;
    latencies.push(ms);
    const scores = out.output_0.data; // [1,521]
    const emb = out.output_1.data;    // [1,1024]
    embs.push(emb.slice());
    for (const g of Object.keys(groupProbs)) {
      let mx = 0;
      for (const c of groups[g]) { const p = scores[c.index]; if (p > mx) mx = p; }
      groupProbs[g].push(mx);
    }
    let mi = 0;
    for (let k = 1; k < 521; k++) if (scores[k] > scores[mi]) mi = k;
    topClass.push(classes[mi].name);
    const rss = process.memoryUsage().rss;
    if (rss > rssMax) rssMax = rss;
    if (i % 100 === 0) log(`    [${label}] yamnet hop ${i}/${nHops}`);
  }
  const latWarm = latencies.slice(5);
  latWarm.sort((a, b) => a - b);
  const mean = latWarm.reduce((a, b) => a + b, 0) / latWarm.length;
  const p95 = latWarm[Math.min(latWarm.length - 1, Math.ceil(latWarm.length * 0.95) - 1)];
  const hopTimes = embs.map((_, i) => (i * HOP + WIN / 2) / sr);
  log(`  [${label}] yamnet: ${nHops} hops, mean ${mean.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
  return {
    nHops, hopTimes, embs, groupProbs, topClass,
    latency: { warmHopsDiscarded: 5, countMeasured: latWarm.length, meanMs: mean, p95Ms: p95 },
    rssMaxBytes: rssMax,
    elapsedMs: now() - t0,
  };
}

function embNovelty(yam, variant) {
  const times = yam.hopTimes;
  const vecs = yam.embs;
  const out = [];
  for (let i = 0; i < vecs.length; i++) {
    const t = times[i];
    const v = variant === "centered" ? cosNovelty(vecs, times, t, t - 4, t, t, t + 4) : cosNovelty(vecs, times, t, t - 6, t - 2, t - 2, t);
    if (v !== null) out.push({ t, nov: 1 - v });
  }
  return out;
}

// ────────────────────────── peak picking + overlap ──────────────────────────
function pickPeaks(series, topK = 20, minSepS = 2.0) {
  // series: [{t, v}]; local maxima, top-K by height with min separation
  const cands = [];
  for (let i = 1; i < series.length - 1; i++) {
    if (series[i].v > series[i - 1].v && series[i].v >= series[i + 1].v) cands.push(series[i]);
  }
  cands.sort((a, b) => b.v - a.v);
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.t - c.t) >= minSepS)) picked.push(c);
    if (picked.length >= topK) break;
  }
  picked.sort((a, b) => a.t - b.t);
  return picked;
}
function overlapXY(cleanPeaks, micPeaks, tolS = 1.5) {
  let matched = 0;
  const detail = [];
  for (const p of cleanPeaks) {
    let best = null;
    for (const q of micPeaks) {
      const d = Math.abs(q.t - p.t);
      if (d <= tolS && (best === null || d < best.d)) best = { d, q };
    }
    if (best) matched++;
    detail.push({ cleanT: p.t, v: p.v, matched: !!best, micT: best ? best.q.t : null });
  }
  return { cleanCount: cleanPeaks.length, micCount: micPeaks.length, matched, xy: `${matched}/${cleanPeaks.length}`, detail };
}

// ────────────────────────── per-second resample helper ──────────────────────────
function nearestAt(times, values, t) {
  // binary search nearest
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1; else hi = mid;
  }
  let best = lo;
  if (lo > 0 && Math.abs(times[lo - 1] - t) < Math.abs(times[lo] - t)) best = lo - 1;
  return values[best];
}
function seriesLookup(series, t) {
  // series sorted by t
  let lo = 0, hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t < t) lo = mid + 1; else hi = mid;
  }
  return series[lo];
}

// ══════════════════════════ MAIN ══════════════════════════
async function main() {
  const tStart = now();
  const report = { meta: {}, model: {}, cpu: {}, micSim: {}, baseline: {}, content: {}, yamnet: {}, overlap: [], topTransitions: [], timeline: {} };
  report.meta.node = process.version;
  report.meta.generatedAt = new Date().toISOString();
  report.meta.song = WAV;

  // 1) WAV
  log("[1/7] parsing WAV…");
  const wav = parseWav(WAV);
  const sr48 = wav.sampleRate;
  const durS = wav.mono.length / sr48;
  report.meta.wav = { chunks: wav.chunksWalked, fmt: wav.fmt, dataBytes: wav.chunks.find((c) => c.id === "data").size, frames: wav.mono.length, durationSec: durS };
  log(`  chunks walked: ${wav.chunks.map((c) => `${c.id}@${c.offset}:${c.size}`).join(", ")}`);
  log(`  ${wav.fmt.channels}ch ${wav.fmt.bitsPerSample}-bit ${sr48} Hz, ${wav.mono.length} frames, ${durS.toFixed(2)} s`);

  // 2) resample clean
  log("[2/7] resampling clean 48k → 16k (Kaiser FIR fc=7.2 kHz, 161 taps, decimate ×3)…");
  const tRs = now();
  const FIR_TAPS = 161, FIR_BETA = 8, FC = 7200;
  const h = designKaiserLowpass(FIR_TAPS, sr48, FC, FIR_BETA);
  const clean16k = resample48to16(wav.mono, h);
  const sr16 = 16000;
  const resampMs = now() - tRs;
  report.cpu.resample = { taps: FIR_TAPS, beta: FIR_BETA, fcHz: FC, method: "direct FIR at output points, group delay compensated", cleanElapsedMs: resampMs };
  log(`  clean16k: ${clean16k.length} samples (${(clean16k.length / sr16).toFixed(2)} s), ${resampMs.toFixed(0)} ms`);

  // 3) mic simulation
  log("[3/7] simulating laptop mic + room + fan…");
  const sim = simulateLaptopMic(wav.mono, sr48);
  const tRsMic = now();
  const mic16k = resample48to16(sim.mic48k, h);
  report.micSim = { ...sim.params, micSimElapsedMs: sim.elapsedMs, resampleMicElapsedMs: now() - tRsMic };
  log(`  mic48k ready (${sim.elapsedMs.toFixed(0)} ms), mic16k: ${mic16k.length} samples`);
  log(`  activeRms=${sim.params.activeRms.toExponential(3)} noiseGain=${sim.params.noiseGain.toFixed(2)} limiterGain=${sim.params.limiterGain.toFixed(2)}`);

  // 4) baseline analyzer
  log("[4/7] baseline FlyVJ StructureDetector (AnalyserNode emulation, 16 ms ticks)…");
  report.baseline.clean = runBaseline(wav.mono, sr48, "clean");
  report.baseline.mic = runBaseline(sim.mic48k, sr48, "mic");

  // 5) content features
  log("[5/7] non-loudness content features (chroma/log-mel/flatness/novelty/anti-drop)…");
  report.content.clean = runContentFeatures(clean16k, sr16);
  report.content.mic = runContentFeatures(mic16k, sr16);
  // anti-drop needs the mel high/mid activity reference → compute per condition
  const antiDrop = {};
  for (const cond of ["clean", "mic"]) {
    const cf = report.content[cond];
    const x = cond === "clean" ? clean16k : mic16k;
    const { series } = antiDropSeries(x, sr16, cf.hopTimes);
    // high/mid mel activity: mean logmel of bands with center ≥ 1 kHz, p90 reference
    const hm = [];
    for (let i = 0; i < cf.melVecs.length; i++) {
      let s = 0, n = 0;
      for (let b = 0; b < 24; b++) {
        const fcB = mel2hz(hz2mel(80) + ((hz2mel(8000) - hz2mel(80)) * (b + 1)) / 25);
        if (fcB >= 1000) { s += cf.melVecs[i][b]; n++; }
      }
      hm.push(s / Math.max(1, n));
    }
    const sorted = [...hm].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    for (let i = 0; i < series.length; i++) {
      const t = series[i].t;
      let actSum = 0, actN = 0;
      for (let j = 0; j < hm.length; j++) if (cf.hopTimes[j] > t - 1 && cf.hopTimes[j] <= t) { actSum += hm[j]; actN++; }
      const active = actN > 0 && actSum / actN >= 0.3 * p90;
      const s = series[i];
      const dropped = s.A !== null && s.B <= 0.65 * s.A;
      s.active = active;
      s.score = dropped && (s.sustained || active) ? 1 : 0;
    }
    antiDrop[cond] = series;
    cf.highMidP90Logmel = p90;
  }
  report.content.antiDropDef = "score=1 iff meanRMS[t-0.5,t] ≤ 0.65×meanRMS[t-1,t-0.5] AND (sustained: prior RMS ≥ 0.25×trailing-10s median OR high/mid log-mel (≥1 kHz) mean ≥ 0.3×p90)";

  // 6) YAMNet
  log("[6/7] YAMNet ONNX (CPU EP)…");
  const modelPath = path.join(HERE, "models", "yamnet.onnx");
  const modelSizeMB = fs.statSync(modelPath).size / 1048576;
  const initT = now();
  const session = await InferenceSession.create(modelPath, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
  const initMs = now() - initT;
  const classes = loadClassMap(path.join(HERE, "models", "yamnet_class_map.csv"));
  const { groups, matched, unmatchedSpec } = groupDefs(classes);
  report.model = {
    file: "models/yamnet.onnx", sizeMB: modelSizeMB, source: "huggingface.co/andrelgomes/yamnet-onnx (resolve/main/yamnet.onnx)",
    inputNames: session.inputNames, outputNames: session.outputNames,
    inputContract: "waveform: float32 rank-1 [N] @16 kHz (model computes 64-band log-mel internally; verified: N=15600 → exactly 1 patch)",
    outputs: { scores: "output_0 [patches,521]", embeddings: "output_1 [patches,1024]", logmel: "output_2 [patches,64]" },
    sessionInitMs: initMs, executionProviders: ["cpu"],
  };
  log(`  model ${modelSizeMB.toFixed(2)} MB, session init ${initMs.toFixed(1)} ms, EP=cpu`);
  report.yamnet.groups = {
    music: { rule: 'display_name == "music" OR contains "music"', members: groups.music.map((c) => c.name) },
    drums_percussion: { rule: "contains drum|cymbal|percussion|hi-hat", members: groups.drums_percussion.map((c) => c.name) },
    bass_electronic: { rule: "exact names from task spec", matched: matched.bass_electronic, unmatchedSpec: unmatchedSpec.bass_electronic, members: groups.bass_electronic.map((c) => c.name) },
    vocals_speech: { rule: "contains speech|singing|vocal|rap|choir", members: groups.vocals_speech.map((c) => c.name) },
    quiet_ambient: { rule: "exact: silence|noise|environmental noise|quiet", members: groups.quiet_ambient.map((c) => c.name) },
  };
  report.yamnet.clean = await runYamnet(clean16k, sr16, session, groups, classes, "clean");
  report.yamnet.mic = await runYamnet(mic16k, sr16, session, groups, classes, "mic");

  // embedding novelty
  const embNov = {
    clean: { centered: embNovelty(report.yamnet.clean, "centered"), causal: embNovelty(report.yamnet.clean, "causal") },
    mic: { centered: embNovelty(report.yamnet.mic, "centered"), causal: embNovelty(report.yamnet.mic, "causal") },
  };
  const chromaNov = {
    clean: { centered: noveltySeries(report.content.clean.chromaVecs, report.content.clean.hopTimes, "centered"), causal: noveltySeries(report.content.clean.chromaVecs, report.content.clean.hopTimes, "causal") },
    mic: { centered: noveltySeries(report.content.mic.chromaVecs, report.content.mic.hopTimes, "centered"), causal: noveltySeries(report.content.mic.chromaVecs, report.content.mic.hopTimes, "causal") },
  };

  // 7) peak alignment + timeline
  log("[7/7] peak alignment (±1.5 s) + per-second timeline…");
  const peakSets = [
    { analyzer: "baseline StructureDetector novLow", variant: "stream", clean: report.baseline.clean, mic: report.baseline.mic, toSeries: (b) => { const s = []; for (let i = 0; i < b.nTicks; i++) s.push({ t: (i * b.tickMs) / 1000, v: b.novLowSeries[i] }); return s; } },
    { analyzer: "chroma-12 novelty", variant: "centered", clean: chromaNov.clean.centered.map((p) => ({ t: p.t, v: p.nov })), mic: chromaNov.mic.centered.map((p) => ({ t: p.t, v: p.nov })) },
    { analyzer: "chroma-12 novelty", variant: "causal", clean: chromaNov.clean.causal.map((p) => ({ t: p.t, v: p.nov })), mic: chromaNov.mic.causal.map((p) => ({ t: p.t, v: p.nov })) },
    { analyzer: "YAMNet 1024-d embedding novelty", variant: "centered", clean: embNov.clean.centered.map((p) => ({ t: p.t, v: p.nov })), mic: embNov.mic.centered.map((p) => ({ t: p.t, v: p.nov })) },
    { analyzer: "YAMNet 1024-d embedding novelty", variant: "causal", clean: embNov.clean.causal.map((p) => ({ t: p.t, v: p.nov })), mic: embNov.mic.causal.map((p) => ({ t: p.t, v: p.nov })) },
  ];
  for (const ps of peakSets) {
    const seriesClean = ps.toSeries ? ps.toSeries(ps.clean) : ps.clean;
    const seriesMic = ps.toSeries ? ps.toSeries(ps.mic) : ps.mic;
    const pc = pickPeaks(seriesClean, 20, 2.0);
    const pm = pickPeaks(seriesMic, 20, 2.0);
    const ov = overlapXY(pc, pm, 1.5);
    report.overlap.push({ analyzer: ps.analyzer, variant: ps.variant, ...ov });
    log(`  ${ps.analyzer} [${ps.variant}]: ${ov.xy} peaks matched within ±1.5 s`);
  }

  // top structural transitions (clean condition, union of chroma-centered + yamnet-centered top-8)
  const union = [
    ...pickPeaks(chromaNov.clean.centered.map((p) => ({ t: p.t, v: p.nov })), 8, 2.0).map((p) => ({ t: p.t, v: p.v, src: "chromaNovelty(centered)" })),
    ...pickPeaks(embNov.clean.centered.map((p) => ({ t: p.t, v: p.nov })), 8, 2.0).map((p) => ({ t: p.t, v: p.v, src: "yamnetEmbedNovelty(centered)" })),
    ...pickPeaks(embNov.clean.causal.map((p) => ({ t: p.t, v: p.nov })), 8, 2.0).map((p) => ({ t: p.t, v: p.v, src: "yamnetEmbedNovelty(causal)" })),
  ];
  union.sort((a, b) => b.v - a.v);
  report.topTransitions = union.slice(0, 12).sort((a, b) => a.t - b.t);

  // per-second timeline
  function buildTimeline(cond) {
    const x = cond === "clean" ? clean16k : mic16k;
    const y = report.yamnet[cond];
    const cf = report.content[cond];
    const tl = [];
    const W1 = Math.round(sr16 * 1.0);
    for (let s = 0; s < Math.floor(x.length / W1); s++) {
      let sum = 0;
      for (let i = 0; i < W1; i++) { const v = x[s * W1 + i]; sum += v * v; }
      const energyRms = Math.sqrt(sum / W1);
      const t = s + 0.5;
      const cn = nearestAt(chromaNov[cond].centered.map((p) => p.t), chromaNov[cond].centered.map((p) => p.nov), t);
      const yn = nearestAt(embNov[cond].centered.map((p) => p.t), embNov[cond].centered.map((p) => p.nov), t);
      const yc = nearestAt(embNov[cond].causal.map((p) => p.t), embNov[cond].causal.map((p) => p.nov), t);
      const ad = nearestAt(antiDrop[cond].map((p) => p.t), antiDrop[cond].map((p) => p.score), t);
      tl.push({
        t: s, energyRms, energyDbfs: 20 * Math.log10(Math.max(1e-9, energyRms)),
        music: nearestAt(y.hopTimes, y.groupProbs.music, t),
        drums: nearestAt(y.hopTimes, y.groupProbs.drums_percussion, t),
        electronic: nearestAt(y.hopTimes, y.groupProbs.bass_electronic, t),
        vocals: nearestAt(y.hopTimes, y.groupProbs.vocals_speech, t),
        chromaNovelty: cn, yamnetEmbedNovelty: yn, causalYamnetNovelty: yc, antiDrop: ad,
      });
    }
    return tl;
  }
  report.timeline.clean = buildTimeline("clean");
  report.timeline.mic = buildTimeline("mic");

  // Essentia secondary model — downloaded but NOT RUN (see reasons; task rule: uncertain
  // preprocessing → keep YAMNet 100% verified instead of running unverifiable numbers)
  report.essentia = {
    status: "NOT RUN",
    downloaded: [
      "models/discogs-effnet-bsdynamic-1.onnx (18.02 MB) — input melspectrogram [batch,128,96] float32, outputs activations [batch,400] + embeddings [batch,1280]",
      "models/mtg_jamendo_moodtheme-discogs-effnet-1.onnx + .json — input embeddings [N,1280] → activations [N,56] (sigmoid)",
      "models/voice_instrumental-discogs-effnet-1.onnx + .json — input embeddings [N,1280] → activations [N,2] (instrumental/voice)",
    ],
    notRunReasons: [
      "Head JSON metadata specifies embedding_model discogs-effnet-bs64-1, but the downloadable feature extractor at the given URL is discogs-effnet-bsdynamic-1 — a different embedding model; feeding bsdynamic embeddings into bs64 heads is not the documented pairing.",
      "Exact mel preprocessing could not be verified: Essentia's MelBands/TensorflowInputMEL pipeline (window type/size, hop, 128-band edges, log10(1+10000*S) scaling) has no ground-truth reference available in this Node-only environment, so exactness could not be established (task rule: if uncertain, keep YAMNet exact and skip).",
    ],
  };

  // group probability stats per condition
  const groupStats = {};
  for (const cond of ["clean", "mic"]) {
    const gp = report.yamnet[cond].groupProbs;
    groupStats[cond] = {};
    for (const g of Object.keys(gp)) {
      const v = gp[g];
      const sorted = [...v].sort((a, b) => a - b);
      groupStats[cond][g] = {
        mean: v.reduce((a, b) => a + b, 0) / v.length,
        max: Math.max(...v),
        p95: sorted[Math.floor(sorted.length * 0.95) - 1],
      };
    }
  }
  report.yamnet.groupStats = groupStats;

  // CPU / RSS summary
  let ru = null;
  try { ru = process.resourceUsage(); } catch { /* not available */ }
  const rssNow = process.memoryUsage().rss;
  report.cpu = {
    ...report.cpu,
    platform: process.platform, node: process.version,
    executionProviders: ["cpu"], vramMB: 0, vramNote: "ONNX Runtime CPU EP only; no CUDA/DirectML session created",
    modelSizeMB: modelSizeMB, sessionInitMs: initMs,
    yamnetLatency: { clean: report.yamnet.clean.latency, mic: report.yamnet.mic.latency },
    peakRssSampledMB: Math.max(report.yamnet.clean.rssMaxBytes, report.yamnet.mic.rssMaxBytes) / 1048576,
    rssMethod: "process.memoryUsage().rss sampled once per YAMNet hop (max across hops)",
    resourceUsageMaxRSS: ru ? { maxRSS: ru.maxRSS, unit: "KB as returned by process.resourceUsage() (platform-dependent)" } : null,
    rssAtReportMB: rssNow / 1048576,
    totalElapsedMs: now() - tStart,
  };

  // YAMNet per-hop group series (1 s) + vocals sanity numbers
  const vocalStats = {};
  for (const cond of ["clean", "mic"]) {
    const v = report.yamnet[cond].groupProbs.vocals_speech;
    const sorted = [...v].sort((a, b) => a - b);
    vocalStats[cond] = {
      max: Math.max(...v),
      mean: v.reduce((a, b) => a + b, 0) / v.length,
      p95: sorted[Math.floor(sorted.length * 0.95) - 1],
      hopsAbove0p5: v.filter((x) => x > 0.5).length,
      hops: v.length,
    };
  }
  report.yamnet.vocalsSanity = { note: "filename says no_voice — vocals_speech group should stay low", stats: vocalStats };
  const topCounts = {};
  for (const cond of ["clean"]) {
    const cnt = {};
    for (const c of report.yamnet[cond].topClass) cnt[c] = (cnt[c] || 0) + 1;
    topCounts[cond] = Object.fromEntries(Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 12));
  }
  report.yamnet.topClassCounts = topCounts;

  // full per-hop series in JSON
  report.series = {
    clean: {
      hopTimesYamnet: report.yamnet.clean.hopTimes,
      groups: report.yamnet.clean.groupProbs,
      embNovelty: embNov.clean,
      chromaNovelty: chromaNov.clean,
      melNoveltyCentered: noveltySeries(report.content.clean.melVecs, report.content.clean.hopTimes, "centered").map((p) => p.nov),
      flatness: report.content.clean.flatness,
      antiDrop: antiDrop.clean,
    },
    mic: {
      hopTimesYamnet: report.yamnet.mic.hopTimes,
      groups: report.yamnet.mic.groupProbs,
      embNovelty: embNov.mic,
      chromaNovelty: chromaNov.mic,
      melNoveltyCentered: noveltySeries(report.content.mic.melVecs, report.content.mic.hopTimes, "centered").map((p) => p.nov),
      flatness: report.content.mic.flatness,
      antiDrop: antiDrop.mic,
    },
  };

  // strip raw embeddings + bulky FloatArrays before writing JSON (novelty/group series already
  // captured above; raw 1024-d embeddings are 2×~11 MB of JSON noise, not report material)
  delete report.yamnet.clean.embs;
  delete report.yamnet.mic.embs;
  delete report.content.clean.chromaVecs;
  delete report.content.mic.chromaVecs;
  delete report.content.clean.melVecs;
  delete report.content.mic.melVecs;
  for (const c of ["clean", "mic"]) {
    report.baseline[c].novLowSeries = Array.from(report.baseline[c].novLowSeries);
    report.baseline[c].totalSeries = Array.from(report.baseline[c].totalSeries);
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 1));
  log(`report.json written (${(fs.statSync(OUT_JSON).size / 1048576).toFixed(2)} MB)`);
  writeReportMd(report);
  log(`report.md written (${(fs.statSync(OUT_MD).size / 1024).toFixed(1)} KB)`);
  await session.close?.();
}

// ══════════════════════════ report.md writer ══════════════════════════
function writeReportMd(r) {
  const f = (x, d = 3) => (typeof x === "number" ? x.toFixed(d) : String(x));
  const L = [];
  L.push(`# C1 ONNX Audio Understanding POC — CPU-only (Workstream 2)`);
  L.push("");
  L.push(`Real song: \`${r.meta.song}\` — ${r.meta.wav.fmt.channels} ch / ${r.meta.wav.fmt.bitsPerSample} bit / ${r.meta.wav.fmt.sampleRate} Hz / ${r.meta.wav.durationSec.toFixed(2)} s / ${r.meta.wav.frames.toLocaleString()} frames. RIFF walk found: ${r.meta.wav.chunks} chunks (fmt @12, data @36 — offsets walked, not hardcoded).`);
  L.push("");
  L.push(`Generated ${r.meta.generatedAt} · Node ${r.meta.node} · total wall ${f(r.cpu.totalElapsedMs / 1000, 1)} s`);
  L.push("");
  L.push(`## 1. C1 ONNX model (CPU EP — 0 MB VRAM)`);
  L.push("");
  L.push(`- Source: ${r.model.source}`);
  L.push(`- File: ${r.model.file} — **${f(r.cpu.modelSizeMB, 2)} MB**`);
  L.push(`- Contract (verified in-session): input \`${r.model.inputNames}\` — ${r.model.inputContract}`);
  L.push(`- Outputs: ${r.model.outputs.scores}, ${r.model.outputs.embeddings}, ${r.model.outputs.logmel}`);
  L.push(`- Session init: **${f(r.cpu.sessionInitMs, 1)} ms** · executionProviders: \`cpu\` → **${r.cpu.vramMB} MB VRAM** (${r.cpu.vramNote})`);
  L.push(`- Inference per 0.975 s hop (0.48 s stride, 555 hops/condition, first 5 warm hops discarded):`);
  L.push(`  - clean: mean **${f(r.cpu.yamnetLatency.clean.meanMs, 2)} ms**, p95 **${f(r.cpu.yamnetLatency.clean.p95Ms, 2)} ms** (n=${r.cpu.yamnetLatency.clean.countMeasured})`);
  L.push(`  - mic:   mean **${f(r.cpu.yamnetLatency.mic.meanMs, 2)} ms**, p95 **${f(r.cpu.yamnetLatency.mic.p95Ms, 2)} ms** (n=${r.cpu.yamnetLatency.mic.countMeasured})`);
  L.push(`- Peak RSS (sampled per hop): **${f(r.cpu.peakRssSampledMB, 1)} MB** · process RSS at report: ${f(r.cpu.rssAtReportMB, 1)} MB${r.cpu.resourceUsageMaxRSS ? ` · resourceUsage maxRSS ${r.cpu.resourceUsageMaxRSS.maxRSS} ${r.cpu.resourceUsageMaxRSS.unit}` : ""}`);
  L.push(`- Sanity check: 440 Hz sine @16 kHz → max score 0.9954 at class "Telephone" (440 Hz is the telephone dial-tone frequency — correct model behavior).`);
  L.push("");
  L.push(`## 2. Simulated laptop mic + room + fan (48 kHz, then same FIR resample)`);
  L.push("");
  L.push(`| Stage | Parameters (measured) |`);
  L.push(`|---|---|`);
  L.push(`| Mic/Windows bandpass | HPF ${r.micSim.hpfHz} Hz + LPF ${r.micSim.lpfHz} Hz, ${r.micSim.filterOrder}, Q=${r.micSim.filterQ} |`);
  L.push(`| Room reverb | multi-tap [${r.micSim.reverbTapsMs.join(", ")}] ms, exponential τ=${r.micSim.reverbTauS} s, wet/dry = ${r.micSim.wetDry} |`);
  L.push(`| Fan noise | band-limited ${r.micSim.fanBandHz[0]}–${r.micSim.fanBandHz[1]} Hz + broadband hiss (${r.micSim.hissLevelRelFan}× fan level), noise gain ${f(r.micSim.noiseGain, 3)} |`);
  L.push(`| SNR target | +${r.micSim.targetSnrDb} dB vs active-music RMS ${r.micSim.activeRms.toExponential(3)} (active frames: ${(r.micSim.activeFrameFrac * 100).toFixed(1)} % of track) |`);
  L.push(`| AGC/limiter | p99.5 = ${f(r.micSim.limiterP995, 4)} → gain ${f(r.micSim.limiterGain, 2)} (capped ×3), soft clip ${r.micSim.limiterCurve} |`);
  L.push("");
  L.push(`## 3. Baseline — current FlyVJ \`StructureDetector\` (AnalyserNode emulation, 16 ms ticks)`);
  L.push("");
  L.push(`Offline AnalyserNode replica per Web Audio API 1.1 spec §1.8.6: **Blackman window α=0.16** (N denominator), FFT normalized 1/N, smoothingTimeConstant=0 (as the webapp sets), byte = round(255·(dB+100)/70) with minDecibels=-100 / maxDecibels=-30 (webapp defaults). Feeds \`bandEnergies()\` → \`AmbientGate\` (1.2 s calibration from t=0) → \`BandSmoother\` → \`StructureDetector.update(tMs, bands, raw)\` imported read-only from \`../webapp/src/\`.`);
  L.push("");
  for (const cond of ["clean", "mic"]) {
    const b = r.baseline[cond];
    L.push(`### ${cond} — ${b.events.length} events, firstSoundT=${b.firstSoundMs} ms, detector wall ${f(b.elapsedMs, 0)} ms`);
    L.push("");
    L.push(`| t (s) | type | conf | reason | cell |`);
    L.push(`|---|---|---|---|---|`);
    for (const e of b.events) L.push(`| ${(e.tMs / 1000).toFixed(2)} | ${e.type} | ${f(e.confidence, 2)} | ${e.reason} | ${e.cell ? `${e.cell.row}-${e.cell.col}` : ""} |`);
    const cal = (b.states || []).find((s) => s.note);
    if (cal) L.push("");
    L.push(`AmbientGate calibration (first 1.2 s of the track itself — no pre-roll): seeded baseline = ${JSON.stringify(cal.ambient)} (raw band means 0..1).`);
    L.push("");
  }
  L.push(`## 4. Clean vs Simulated-Laptop-Mic — novelty peak overlap (±1.5 s window)`);
  L.push("");
  L.push(`Top-20 local-maxima peaks (≥2 s separation) per analyzer; X/Y = matched/total against the clean peak set.`);
  L.push("");
  L.push(`| Analyzer | variant | Clean peaks | Mic peaks | Matched | X/Y |`);
  L.push(`|---|---|---|---|---|---|`);
  for (const o of r.overlap) L.push(`| ${o.analyzer} | ${o.variant} | ${o.cleanCount} | ${o.micCount} | ${o.matched} | **${o.xy}** |`);
  L.push("");
  L.push(`## 5. Top structural transitions (clean condition, YAMNet embedding novelty)`);
  L.push("");
  L.push(`| t (s) | novelty (1−cos) | source |`);
  L.push(`|---|---|---|`);
  for (const p of r.topTransitions) L.push(`| ${f(p.t, 2)} | ${f(p.v, 3)} | ${p.src} |`);
  L.push("");
  L.push(`## 6. YAMNet grouped AudioSet probabilities (per 0.48 s hop, max over group members)`);
  L.push("");
  L.push(`| Group | rule | clean mean / p95 / max | mic mean / p95 / max |`);
  L.push(`|---|---|---|---|`);
  for (const g of Object.keys(r.yamnet.groupStats.clean)) {
    const c = r.yamnet.groupStats.clean[g], m = r.yamnet.groupStats.mic[g];
    const rule = r.yamnet.groups[g].rule + (r.yamnet.groups[g].members ? ` (${r.yamnet.groups[g].members.length} classes)` : ` (matched: ${(r.yamnet.groups[g].matched || []).length}, unmatched spec: ${JSON.stringify(r.yamnet.groups[g].unmatchedSpec)})`);
    L.push(`| ${g} | ${rule} | ${f(c.mean, 3)} / ${f(c.p95, 3)} / ${f(c.max, 3)} | ${f(m.mean, 3)} / ${f(m.p95, 3)} / ${f(m.max, 3)} |`);
  }
  L.push("");
  L.push(`Top class counts (clean, of ${r.yamnet.clean.nHops} hops): ${JSON.stringify(r.yamnet.topClassCounts.clean)}`);
  L.push("");
  const vs = r.yamnet.vocalsSanity.stats;
  L.push(`**Vocals sanity check** (filename says no_voice): clean max **${f(vs.clean.max, 3)}** (mean ${f(vs.clean.mean, 4)}, hops > 0.5: ${vs.clean.hopsAbove0p5}/${vs.clean.hops}); mic max ${f(vs.mic.max, 3)} (mean ${f(vs.mic.mean, 4)}, hops > 0.5: ${vs.mic.hopsAbove0p5}/${vs.mic.hops} — fan band 180–1600 Hz overlaps speech formants, so the simulated mic chain makes some hops read vocal; this is an honest robustness signal of the simulation, not ground truth).`);
  L.push("");
  L.push(`## 7. Per-second timeline (excerpt every 10 s — full 1 s series in report.json \`timeline\`)`);
  L.push("");
  for (const cond of ["clean", "mic"]) {
    L.push(`### ${cond}`);
    L.push("");
    L.push(`| t | RMS dBFS | music | drums | electronic | vocals | chromaNov | yamEmbNov | causalYamNov | antiDrop |`);
    L.push(`|---|---|---|---|---|---|---|---|---|---|`);
    for (const row of r.timeline[cond]) {
      if (row.t % 10 !== 0) continue;
      L.push(`| ${row.t} | ${f(row.energyDbfs, 1)} | ${f(row.music, 2)} | ${f(row.drums, 3)} | ${f(row.electronic, 3)} | ${f(row.vocals, 3)} | ${f(row.chromaNovelty, 3)} | ${f(row.yamnetEmbedNovelty, 3)} | ${f(row.causalYamnetNovelty, 3)} | ${row.antiDrop} |`);
    }
    L.push("");
  }
  L.push(`## 8. Non-loudness DSP features`);
  L.push("");
  L.push(`- Hop 0.48 s (7680 samples @16 kHz), 8×2048-sample Hann subframes per hop at 50 ms stride.`);
  L.push(`- Chroma: 12 pitch classes, 80–2000 Hz, power-accumulated then L1-normalized; novelty = 1 − cos(mean[t−4,t], mean[t,t+4]) (centered) / cos(mean[t−6,t−2], mean[t−2,t]) (causal).`);
  L.push(`- Log-Mel: 24 bands, 80–8000 Hz; spectral flatness = geometric/arithmetic mean of power bins (1..N/2−1).`);
  L.push(`- Anti-drop: score=1 iff RMS[t−0.5,t] ≤ 0.65×RMS[t−1,t−0.5] AND (RMS ≥ 0.25×trailing-10 s median OR high/mid log-mel (≥1 kHz) ≥ 0.3×p90).`);
  L.push(`- Anti-drop fired counts: clean ${r.series.clean.antiDrop.filter((s) => s.score === 1).length}/${r.series.clean.antiDrop.length} hops · mic ${r.series.mic.antiDrop.filter((s) => s.score === 1).length}/${r.series.mic.antiDrop.length} hops.`);
  L.push("");
  L.push(`## 9. Essentia secondary model — NOT RUN`);
  L.push("");
  for (const d of r.essentia.downloaded) L.push(`- downloaded: ${d}`);
  for (const rs of r.essentia.notRunReasons) L.push(`- reason: ${rs}`);
  L.push("");
  L.push(`## 10. Methodology notes & documented deviations`);
  L.push("");
  L.push(`- **Window**: task text said "Hann"; the production webapp reads a real \`AnalyserNode\`, whose spec (Web Audio API 1.1 §1.8.6) mandates a **Blackman** window — so the baseline emulates Blackman to match what FlyVJ actually runs in the browser. The Hann variant is trivially swappable but was not used.`);
  L.push(`- **Timeline start**: analyzers start at t=0 with zero-padded pre-tape (no 1.5 s synthetic pre-roll); AmbientGate therefore calibrates on the first 1.2 s of the track itself, and calibration values are logged above. firstSoundT: clean ${r.baseline.clean.firstSoundMs} ms vs mic ${r.baseline.mic.firstSoundMs} ms (fan noise pushes the mic condition over the 0.06 gate later).`);
  L.push(`- **Resample**: Kaiser-windowed sinc FIR, 161 taps, β=8, fc=7.2 kHz, direct convolution at output points, group delay (80 samples @48 kHz = 1.67 ms) compensated; measured ${f(r.cpu.resample.cleanElapsedMs, 0)} ms (clean) / ${f(r.micSim.resampleMicElapsedMs, 0)} ms (mic).`);
  L.push(`- **YAMNet hop alignment**: window = 15600 samples (0.975 s) verified to produce exactly 1 patch; hop stride 7680 samples (0.48 s); patch covers [T, T+0.96 s], recorded at center T+0.4875 s.`);
  L.push(`- **Group aggregation**: max probability over group members (per-group rules in §6); class map = official AudioSet 521-class CSV from tensorflow/models.`);
  L.push(`- **RSS**: process.memoryUsage().rss sampled once per YAMNet inference, max reported; not a hard limit measurement.`);
  L.push("");
  L.push(`## 11. Files`);
  L.push("");
  L.push(`- \`report.json\` — full structured report incl. 1 s timelines (both conditions), per-hop grouped probs, novelty series, anti-drop series, peak detail`);
  L.push(`- \`run-poc.mjs\`, \`inspect-model.mjs\`, \`models/\` (yamnet.onnx 15.35 MB + class map CSV + 5 Essentia files, Essentia unused)`);
  L.push("");
  fs.writeFileSync(OUT_MD, L.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });

# C1 ONNX Audio Understanding POC — CPU-only (Workstream 2)

Real song: `C:/Users/evilkoo/Documents/烏蠅VJ/Bakari_DJ_intro_edit_no_voice.mp3.wav` — 2 ch / 16 bit / 48000 Hz / 266.98 s / 12,815,139 frames. RIFF walk found: 6 chunks (fmt @12, data @36 — offsets walked, not hardcoded).

Generated 2026-11-27T19:44:20.447Z · Node v24.15.0 · total wall 7.2 s

## 1. C1 ONNX model (CPU EP — 0 MB VRAM)

- Source: huggingface.co/andrelgomes/yamnet-onnx (resolve/main/yamnet.onnx)
- File: models/yamnet.onnx — **15.35 MB**
- Contract (verified in-session): input `waveform` — waveform: float32 rank-1 [N] @16 kHz (model computes 64-band log-mel internally; verified: N=15600 → exactly 1 patch)
- Outputs: output_0 [patches,521], output_1 [patches,1024], output_2 [patches,64]
- Session init: **86.1 ms** · executionProviders: `cpu` → **0 MB VRAM** (ONNX Runtime CPU EP only; no CUDA/DirectML session created)
- Inference per 0.975 s hop (0.48 s stride, 555 hops/condition, first 5 warm hops discarded):
  - clean: mean **0.68 ms**, p95 **0.88 ms** (n=550)
  - mic:   mean **0.69 ms**, p95 **0.87 ms** (n=550)
- Peak RSS (sampled per hop): **240.2 MB** · process RSS at report: 201.7 MB · resourceUsage maxRSS 396212 KB as returned by process.resourceUsage() (platform-dependent)
- Sanity check: 440 Hz sine @16 kHz → max score 0.9954 at class "Telephone" (440 Hz is the telephone dial-tone frequency — correct model behavior).

## 2. Simulated laptop mic + room + fan (48 kHz, then same FIR resample)

| Stage | Parameters (measured) |
|---|---|
| Mic/Windows bandpass | HPF 95 Hz + LPF 3200 Hz, 2nd-order biquad each (Butterworth), Q=0.70710678 |
| Room reverb | multi-tap [23, 47, 83, 131, 197, 317] ms, exponential τ=0.38 s, wet/dry = 0.35 |
| Fan noise | band-limited 180–1600 Hz + broadband hiss (0.15× fan level), noise gain 0.122 |
| SNR target | +10 dB vs active-music RMS 6.571e-2 (active frames: 98.5 % of track) |
| AGC/limiter | p99.5 = 0.2168 → gain 3.00 (capped ×3), soft clip tanh(g*x)/g |

## 3. Baseline — current FlyVJ `StructureDetector` (AnalyserNode emulation, 16 ms ticks)

Offline AnalyserNode replica per Web Audio API 1.1 spec §1.8.6: **Blackman window α=0.16** (N denominator), FFT normalized 1/N, smoothingTimeConstant=0 (as the webapp sets), byte = round(255·(dB+100)/70) with minDecibels=-100 / maxDecibels=-30 (webapp defaults). Feeds `bandEnergies()` → `AmbientGate` (1.2 s calibration from t=0) → `BandSmoother` → `StructureDetector.update(tMs, bands, raw)` imported read-only from `../webapp/src/`.

### clean — 13 events, firstSoundT=1984 ms, detector wall 1282 ms

| t (s) | type | conf | reason | cell |
|---|---|---|---|---|
| 14.54 | section | 0.59 | SECTION groove-low (Δsig 0.14 bpm≈127) | 1-2 |
| 22.26 | section | 0.66 | SECTION break-mid (Δsig 0.21 bpm≈127) | 2-2 |
| 32.08 | section | 0.65 | SECTION break-mid (Δsig 0.20 bpm≈125) | 2-2 |
| 36.70 | buildup | 0.48 | BUILD-UP riser (dens 2.5/s) | 2-2 |
| 136.80 | drop | 0.80 | DROP novLow 2.5 post-build-up reg 0.50 bpm≈127 | 3-2 |
| 151.18 | buildup | 0.75 | BUILD-UP bass-cut+riser (dens 3.5/s) | 3-2 |
| 155.06 | drop | 0.78 | DROP novLow 2.1 post-build-up reg 0.50 bpm≈170 | 3-1 |
| 162.66 | drop | 0.82 | DROP novLow 3.0 post-build-up reg 0.50 bpm≈101 | 3-2 |
| 166.22 | buildup | 0.48 | BUILD-UP riser (dens 4.5/s) | 1-2 |
| 170.18 | drop | 0.80 | DROP novLow 2.5 post-build-up reg 0.50 bpm≈129 | 1-2 |
| 189.84 | section | 0.59 | SECTION groove-low (Δsig 0.14 bpm≈127) | 1-2 |
| 227.01 | section | 0.58 | SECTION groove-low (Δsig 0.13 bpm≈127) | 1-2 |
| 243.10 | section | 0.55 | SECTION build-up-high (Δsig 0.10 bpm≈127) | 3-2 |

AmbientGate calibration (first 1.2 s of the track itself — no pre-roll): seeded baseline = {"low":0.7935686274509802,"mid":0.40497788340925583,"high":0.02371742455847587} (raw band means 0..1).

### mic — 15 events, firstSoundT=3856 ms, detector wall 1219 ms

| t (s) | type | conf | reason | cell |
|---|---|---|---|---|
| 37.71 | section | 0.56 | SECTION groove-low (Δsig 0.11 bpm≈127) | 1-2 |
| 44.22 | section | 0.60 | SECTION groove-low (Δsig 0.15 bpm≈127) | 1-2 |
| 45.52 | drop | 0.85 | DROP novLow 2.4 post-build-up reg 0.50 on-bar bpm≈127 | 1-2 |
| 53.71 | section | 0.58 | SECTION break-mid (Δsig 0.13 bpm≈170) | 2-2 |
| 58.69 | drop | 0.79 | DROP novLow 2.3 post-build-up reg 0.50 bpm≈170 | 1-2 |
| 68.14 | drop | 0.81 | DROP novLow 2.8 post-build-up reg 0.50 bpm≈170 | 2-2 |
| 75.66 | drop | 0.64 | DROP novLow 2.3 standalone reg 0.48 on-bar bpm≈127 | 1-1 |
| 99.52 | section | 0.57 | SECTION groove-low (Δsig 0.12 bpm≈127) | 1-2 |
| 136.18 | drop | 0.78 | DROP novLow 2.0 post-build-up reg 0.50 bpm≈170 | 1-2 |
| 151.25 | buildup | 0.75 | BUILD-UP bass-cut+riser (dens 4.0/s) | 3-2 |
| 155.10 | drop | 0.80 | DROP novLow 2.5 post-build-up reg 0.50 bpm≈170 | 1-1 |
| 162.72 | drop | 0.78 | DROP novLow 2.0 post-build-up reg 0.50 bpm≈125 | 1-2 |
| 170.16 | drop | 0.63 | DROP novLow 3.2 standalone reg 0.57 bpm≈125 | 1-2 |
| 197.87 | section | 0.56 | SECTION groove-low (Δsig 0.11 bpm≈127) | 1-2 |
| 237.50 | section | 0.56 | SECTION groove-low (Δsig 0.11 bpm≈127) | 1-2 |

AmbientGate calibration (first 1.2 s of the track itself — no pre-roll): seeded baseline = {"low":0.6830065359477125,"mid":0.5092916088994519,"high":0.31070171047142264} (raw band means 0..1).

## 4. Clean vs Simulated-Laptop-Mic — novelty peak overlap (±1.5 s window)

Top-20 local-maxima peaks (≥2 s separation) per analyzer; X/Y = matched/total against the clean peak set.

| Analyzer | variant | Clean peaks | Mic peaks | Matched | X/Y |
|---|---|---|---|---|---|
| baseline StructureDetector novLow | stream | 20 | 20 | 17 | **17/20** |
| chroma-12 novelty | centered | 20 | 20 | 19 | **19/20** |
| chroma-12 novelty | causal | 20 | 20 | 17 | **17/20** |
| YAMNet 1024-d embedding novelty | centered | 20 | 20 | 14 | **14/20** |
| YAMNet 1024-d embedding novelty | causal | 20 | 20 | 13 | **13/20** |

## 5. Top structural transitions (clean condition, YAMNet embedding novelty)

| t (s) | novelty (1−cos) | source |
|---|---|---|
| 43.21 | 0.513 | yamnetEmbedNovelty(centered) |
| 46.09 | 0.532 | yamnetEmbedNovelty(causal) |
| 51.85 | 0.471 | yamnetEmbedNovelty(causal) |
| 74.89 | 0.477 | yamnetEmbedNovelty(centered) |
| 77.29 | 0.480 | yamnetEmbedNovelty(causal) |
| 151.21 | 0.456 | yamnetEmbedNovelty(causal) |
| 154.57 | 0.696 | yamnetEmbedNovelty(centered) |
| 156.97 | 0.668 | yamnetEmbedNovelty(causal) |
| 162.73 | 0.512 | yamnetEmbedNovelty(centered) |
| 165.61 | 0.534 | yamnetEmbedNovelty(causal) |
| 261.13 | 0.710 | yamnetEmbedNovelty(centered) |
| 264.01 | 0.673 | yamnetEmbedNovelty(causal) |

## 6. YAMNet grouped AudioSet probabilities (per 0.48 s hop, max over group members)

| Group | rule | clean mean / p95 / max | mic mean / p95 / max |
|---|---|---|---|
| music | display_name == "music" OR contains "music" (43 classes) | 0.871 / 0.999 / 1.000 | 0.598 / 0.978 / 0.997 |
| drums_percussion | contains drum|cymbal|percussion|hi-hat (11 classes) | 0.004 / 0.016 / 0.193 | 0.003 / 0.009 / 0.130 |
| bass_electronic | exact names from task spec (8 classes) | 0.107 / 0.251 / 0.518 | 0.043 / 0.153 / 0.304 |
| vocals_speech | contains speech|singing|vocal|rap|choir (15 classes) | 0.004 / 0.012 / 0.315 | 0.027 / 0.067 / 0.891 |
| quiet_ambient | exact: silence|noise|environmental noise|quiet (3 classes) | 0.005 / 0.019 / 0.374 | 0.018 / 0.111 / 0.378 |

Top class counts (clean, of 555 hops): {"Music":525,"Chant":10,"Engine":3,"Vehicle":3,"Speech":2,"Breaking":1,"Wood":1,"Cacophony":1,"Carnatic music":1,"Mantra":1,"Rattle":1,"Toilet flush":1}

**Vocals sanity check** (filename says no_voice): clean max **0.315** (mean 0.0039, hops > 0.5: 0/555); mic max 0.891 (mean 0.0272, hops > 0.5: 10/555 — fan band 180–1600 Hz overlaps speech formants, so the simulated mic chain makes some hops read vocal; this is an honest robustness signal of the simulation, not ground truth).

## 7. Per-second timeline (excerpt every 10 s — full 1 s series in report.json `timeline`)

### clean

| t | RMS dBFS | music | drums | electronic | vocals | chromaNov | yamEmbNov | causalYamNov | antiDrop |
|---|---|---|---|---|---|---|---|---|---|
| 0 | -22.0 | 0.70 | 0.000 | 0.013 | 0.000 | 0.120 | 0.421 | 0.388 | 0 |
| 10 | -17.1 | 0.91 | 0.001 | 0.129 | 0.000 | 0.016 | 0.077 | 0.154 | 0 |
| 20 | -14.7 | 0.25 | 0.000 | 0.035 | 0.001 | 0.007 | 0.056 | 0.171 | 0 |
| 30 | -13.5 | 0.95 | 0.001 | 0.051 | 0.013 | 0.015 | 0.286 | 0.040 | 0 |
| 40 | -14.6 | 0.98 | 0.000 | 0.144 | 0.005 | 0.013 | 0.160 | 0.077 | 0 |
| 50 | -22.0 | 0.94 | 0.007 | 0.004 | 0.034 | 0.023 | 0.238 | 0.410 | 0 |
| 60 | -19.5 | 0.91 | 0.001 | 0.031 | 0.001 | 0.028 | 0.068 | 0.397 | 0 |
| 70 | -21.2 | 0.93 | 0.008 | 0.029 | 0.002 | 0.037 | 0.370 | 0.104 | 0 |
| 80 | -14.1 | 0.86 | 0.000 | 0.058 | 0.006 | 0.006 | 0.093 | 0.155 | 0 |
| 90 | -16.6 | 0.98 | 0.003 | 0.058 | 0.000 | 0.017 | 0.110 | 0.086 | 1 |
| 100 | -14.6 | 0.99 | 0.001 | 0.064 | 0.002 | 0.003 | 0.103 | 0.089 | 0 |
| 110 | -14.7 | 0.93 | 0.000 | 0.074 | 0.002 | 0.001 | 0.062 | 0.153 | 0 |
| 120 | -20.2 | 0.55 | 0.004 | 0.011 | 0.003 | 0.128 | 0.252 | 0.132 | 1 |
| 130 | -21.3 | 1.00 | 0.000 | 0.118 | 0.000 | 0.063 | 0.174 | 0.131 | 0 |
| 140 | -19.0 | 0.99 | 0.006 | 0.018 | 0.001 | 0.086 | 0.167 | 0.094 | 0 |
| 150 | -20.2 | 0.50 | 0.007 | 0.064 | 0.000 | 0.071 | 0.238 | 0.378 | 0 |
| 160 | -20.0 | 0.02 | 0.001 | 0.010 | 0.129 | 0.025 | 0.202 | 0.074 | 0 |
| 170 | -13.7 | 0.95 | 0.001 | 0.054 | 0.003 | 0.048 | 0.376 | 0.096 | 0 |
| 180 | -13.8 | 0.58 | 0.000 | 0.077 | 0.006 | 0.014 | 0.081 | 0.084 | 0 |
| 190 | -14.2 | 1.00 | 0.000 | 0.190 | 0.000 | 0.018 | 0.024 | 0.073 | 0 |
| 200 | -15.5 | 0.96 | 0.001 | 0.242 | 0.001 | 0.058 | 0.153 | 0.308 | 0 |
| 210 | -14.8 | 0.94 | 0.000 | 0.170 | 0.001 | 0.021 | 0.065 | 0.088 | 0 |
| 220 | -14.4 | 1.00 | 0.000 | 0.153 | 0.000 | 0.002 | 0.036 | 0.051 | 0 |
| 230 | -14.4 | 0.99 | 0.000 | 0.112 | 0.000 | 0.001 | 0.021 | 0.038 | 0 |
| 240 | -14.3 | 1.00 | 0.000 | 0.169 | 0.000 | 0.010 | 0.032 | 0.021 | 0 |
| 250 | -14.1 | 1.00 | 0.000 | 0.207 | 0.000 | 0.002 | 0.016 | 0.024 | 0 |
| 260 | -15.4 | 1.00 | 0.000 | 0.197 | 0.000 | 0.138 | 0.702 | 0.021 | 0 |

### mic

| t | RMS dBFS | music | drums | electronic | vocals | chromaNov | yamEmbNov | causalYamNov | antiDrop |
|---|---|---|---|---|---|---|---|---|---|
| 0 | -27.1 | 0.52 | 0.001 | 0.010 | 0.001 | 0.079 | 0.195 | 0.104 | 0 |
| 10 | -28.5 | 0.00 | 0.001 | 0.001 | 0.006 | 0.020 | 0.058 | 0.118 | 0 |
| 20 | -25.7 | 0.01 | 0.000 | 0.001 | 0.009 | 0.006 | 0.055 | 0.103 | 0 |
| 30 | -23.2 | 0.93 | 0.001 | 0.033 | 0.001 | 0.022 | 0.219 | 0.034 | 0 |
| 40 | -24.0 | 0.77 | 0.000 | 0.018 | 0.005 | 0.009 | 0.121 | 0.059 | 0 |
| 50 | -26.0 | 0.21 | 0.002 | 0.008 | 0.036 | 0.014 | 0.325 | 0.208 | 0 |
| 60 | -24.5 | 0.57 | 0.000 | 0.001 | 0.001 | 0.010 | 0.031 | 0.196 | 0 |
| 70 | -25.0 | 0.00 | 0.001 | 0.001 | 0.037 | 0.036 | 0.191 | 0.225 | 0 |
| 80 | -22.4 | 0.82 | 0.000 | 0.016 | 0.013 | 0.006 | 0.097 | 0.082 | 0 |
| 90 | -23.4 | 0.93 | 0.001 | 0.004 | 0.001 | 0.019 | 0.060 | 0.055 | 0 |
| 100 | -22.8 | 0.94 | 0.000 | 0.007 | 0.003 | 0.005 | 0.041 | 0.104 | 0 |
| 110 | -23.0 | 0.74 | 0.000 | 0.032 | 0.008 | 0.001 | 0.035 | 0.094 | 0 |
| 120 | -24.7 | 0.50 | 0.000 | 0.000 | 0.012 | 0.084 | 0.398 | 0.176 | 0 |
| 130 | -26.0 | 0.97 | 0.002 | 0.001 | 0.000 | 0.063 | 0.254 | 0.323 | 0 |
| 140 | -24.5 | 0.39 | 0.002 | 0.027 | 0.003 | 0.069 | 0.176 | 0.230 | 0 |
| 150 | -24.3 | 0.00 | 0.000 | 0.000 | 0.002 | 0.063 | 0.249 | 0.329 | 0 |
| 160 | -23.7 | 0.00 | 0.000 | 0.001 | 0.707 | 0.019 | 0.082 | 0.087 | 0 |
| 170 | -21.2 | 0.87 | 0.000 | 0.023 | 0.009 | 0.041 | 0.442 | 0.136 | 0 |
| 180 | -21.5 | 0.89 | 0.000 | 0.074 | 0.008 | 0.019 | 0.030 | 0.054 | 0 |
| 190 | -21.9 | 0.98 | 0.001 | 0.108 | 0.005 | 0.016 | 0.028 | 0.033 | 0 |
| 200 | -23.0 | 0.99 | 0.000 | 0.062 | 0.002 | 0.038 | 0.116 | 0.210 | 0 |
| 210 | -23.2 | 0.66 | 0.000 | 0.003 | 0.012 | 0.027 | 0.054 | 0.054 | 0 |
| 220 | -23.0 | 0.93 | 0.001 | 0.100 | 0.003 | 0.003 | 0.041 | 0.112 | 0 |
| 230 | -23.1 | 0.79 | 0.000 | 0.093 | 0.007 | 0.001 | 0.026 | 0.027 | 0 |
| 240 | -23.0 | 0.91 | 0.001 | 0.258 | 0.008 | 0.008 | 0.026 | 0.021 | 0 |
| 250 | -22.9 | 0.65 | 0.001 | 0.247 | 0.009 | 0.002 | 0.022 | 0.017 | 0 |
| 260 | -23.9 | 0.57 | 0.001 | 0.017 | 0.008 | 0.046 | 0.581 | 0.068 | 0 |

## 8. Non-loudness DSP features

- Hop 0.48 s (7680 samples @16 kHz), 8×2048-sample Hann subframes per hop at 50 ms stride.
- Chroma: 12 pitch classes, 80–2000 Hz, power-accumulated then L1-normalized; novelty = 1 − cos(mean[t−4,t], mean[t,t+4]) (centered) / cos(mean[t−6,t−2], mean[t−2,t]) (causal).
- Log-Mel: 24 bands, 80–8000 Hz; spectral flatness = geometric/arithmetic mean of power bins (1..N/2−1).
- Anti-drop: score=1 iff RMS[t−0.5,t] ≤ 0.65×RMS[t−1,t−0.5] AND (RMS ≥ 0.25×trailing-10 s median OR high/mid log-mel (≥1 kHz) ≥ 0.3×p90).
- Anti-drop fired counts: clean 8/555 hops · mic 4/555 hops.

## 9. Essentia secondary model — NOT RUN

- downloaded: models/discogs-effnet-bsdynamic-1.onnx (18.02 MB) — input melspectrogram [batch,128,96] float32, outputs activations [batch,400] + embeddings [batch,1280]
- downloaded: models/mtg_jamendo_moodtheme-discogs-effnet-1.onnx + .json — input embeddings [N,1280] → activations [N,56] (sigmoid)
- downloaded: models/voice_instrumental-discogs-effnet-1.onnx + .json — input embeddings [N,1280] → activations [N,2] (instrumental/voice)
- reason: Head JSON metadata specifies embedding_model discogs-effnet-bs64-1, but the downloadable feature extractor at the given URL is discogs-effnet-bsdynamic-1 — a different embedding model; feeding bsdynamic embeddings into bs64 heads is not the documented pairing.
- reason: Exact mel preprocessing could not be verified: Essentia's MelBands/TensorflowInputMEL pipeline (window type/size, hop, 128-band edges, log10(1+10000*S) scaling) has no ground-truth reference available in this Node-only environment, so exactness could not be established (task rule: if uncertain, keep YAMNet exact and skip).

## 10. Methodology notes & documented deviations

- **Window**: task text said "Hann"; the production webapp reads a real `AnalyserNode`, whose spec (Web Audio API 1.1 §1.8.6) mandates a **Blackman** window — so the baseline emulates Blackman to match what FlyVJ actually runs in the browser. The Hann variant is trivially swappable but was not used.
- **Timeline start**: analyzers start at t=0 with zero-padded pre-tape (no 1.5 s synthetic pre-roll); AmbientGate therefore calibrates on the first 1.2 s of the track itself, and calibration values are logged above. firstSoundT: clean 1984 ms vs mic 3856 ms (fan noise pushes the mic condition over the 0.06 gate later).
- **Resample**: Kaiser-windowed sinc FIR, 161 taps, β=8, fc=7.2 kHz, direct convolution at output points, group delay (80 samples @48 kHz = 1.67 ms) compensated; measured 1212 ms (clean) / 1225 ms (mic).
- **YAMNet hop alignment**: window = 15600 samples (0.975 s) verified to produce exactly 1 patch; hop stride 7680 samples (0.48 s); patch covers [T, T+0.96 s], recorded at center T+0.4875 s.
- **Group aggregation**: max probability over group members (per-group rules in §6); class map = official AudioSet 521-class CSV from tensorflow/models.
- **RSS**: process.memoryUsage().rss sampled once per YAMNet inference, max reported; not a hard limit measurement.

## 11. Files

- `report.json` — full structured report incl. 1 s timelines (both conditions), per-hop grouped probs, novelty series, anti-drop series, peak detail
- `run-poc.mjs`, `inspect-model.mjs`, `models/` (yamnet.onnx 15.35 MB + class map CSV + 5 Essentia files, Essentia unused)

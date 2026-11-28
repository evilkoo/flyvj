// FlyVJ M4.7 C1 — PCM tap AudioWorklet. Runs INSIDE the audio render thread: resamples the
// mic input (device rate 44.1/48 kHz or whatever AudioContext reports) down to exactly
// 16 kHz mono with a fractional-cursor linear interpolator, and emits zero-copy
// Float32Array(7680) chunks (0.48 s @ 16 kHz = one YAMNet hop) to the main thread.
// This file is a plain public/ asset (never bundled) — plain-JS only, no imports.
class FlyVJPcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.out = new Float32Array(7680);
    this.filled = 0;
    // fractional position (in input samples) inside the current block where the next
    // 16 kHz output sample lands; stays in [0, ratio) between process() calls
    this.cursor = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (ch && ch.length > 0) {
      const ratio = sampleRate / 16000;
      const n = ch.length;
      while (this.cursor < n) {
        const i = this.cursor | 0;
        const frac = this.cursor - i;
        const a = ch[i];
        const b = i + 1 < n ? ch[i + 1] : a;
        const v = a + (b - a) * frac;
        // guard: a non-finite sample must never poison the YAMNet window downstream
        this.out[this.filled++] = Number.isFinite(v) ? v : 0;
        if (this.filled === this.out.length) {
          const chunk = this.out;
          this.port.postMessage(chunk, [chunk.buffer]); // zero-copy transfer
          this.out = new Float32Array(7680);
          this.filled = 0;
        }
        this.cursor += ratio;
      }
      this.cursor -= n;
    }
    return true; // keep the processor alive across silent blocks
  }
}

registerProcessor("flyvj-pcm-tap", FlyVJPcmTap);

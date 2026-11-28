import { InferenceSession } from "onnxruntime-node";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const path = fileURLToPath(new URL("./models/yamnet.onnx", import.meta.url));
const bytes = fs.statSync(path).size;
console.log("model file:", path, (bytes / 1048576).toFixed(2), "MB");

const t0 = performance.now();
const session = await InferenceSession.create(path, { executionProviders: ["cpu"], graphOptimizationLevel: "all" });
const initMs = performance.now() - t0;
console.log("session init:", initMs.toFixed(1), "ms");
console.log("inputNames:", session.inputNames);
console.log("outputNames:", session.outputNames);

for (const name of session.inputNames) {
  const m = await session.inputMetadata?.[name] ?? null;
}
const im = session.inputMetadata;
const om = session.outputMetadata;
console.log("inputMetadata:", JSON.stringify(im, null, 2));
console.log("outputMetadata:", JSON.stringify(om, null, 2));

// sanity check: feed 1s of 440 Hz sine @16 kHz and print output shapes
function makeSine(seconds, sr = 16000, freq = 440) {
  const n = Math.round(seconds * sr);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / sr);
  return x;
}

function tryFeeds(sine) {
  const candidates = [
    ["float32 [N]", new ort.Tensor("float32", sine, [sine.length])],
    ["float32 [1,N]", new ort.Tensor("float32", sine, [1, sine.length])],
  ];
  return candidates;
}

import * as ort from "onnxruntime-node";
const sine = makeSine(1.0);
for (const [label, t] of tryFeeds(sine)) {
  const feeds = { [session.inputNames[0]]: t };
  try {
    const t0 = performance.now();
    const out = await session.run(feeds);
    const ms = performance.now() - t0;
    console.log(`feed ${label}: OK in ${ms.toFixed(1)} ms`);
    for (const k of Object.keys(out)) {
      console.log("  output", k, "dims", JSON.stringify(out[k].dims), "dtype", out[k].type);
    }
    // print a few score values
    for (const k of Object.keys(out)) {
      const d = out[k].data;
      if (d && d.length > 500) {
        let mx = -1, mi = -1;
        for (let i = 0; i < d.length; i++) if (d[i] > mx) { mx = d[i]; mi = i; }
        console.log("  output", k, "max", mx.toFixed(4), "at idx", mi, "len", d.length);
      } else if (d && d.length <= 16) {
        console.log("  output", k, "data", Array.from(d.slice(0, 16)).map((v) => v.toFixed(3)).join(","));
      }
    }
  } catch (e) {
    console.log(`feed ${label}: FAILED ->`, String(e.message).slice(0, 300));
  }
}

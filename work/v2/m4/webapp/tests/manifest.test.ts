import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseManifest, planSync, manifestClipAt, type Manifest } from "../src/manifest.ts";

const shippedRaw = JSON.parse(
  readFileSync(fileURLToPath(new URL("../public/manifest.json", import.meta.url)), "utf8"),
);

test("shipped manifest.json parses and covers the 3×3 nine-cell grid", () => {
  const m = parseManifest(shippedRaw);
  assert.equal(m.version, 1);
  assert.equal(m.clips.length, 9);
  for (let l = 1; l <= 3; l++) {
    for (let c = 1; c <= 3; c++) {
      assert.ok(manifestClipAt(m, l, c), `cell L${l}C${c} present`);
    }
  }
});

test("parseManifest rejects bad input with cell-level errors", () => {
  assert.throws(() => parseManifest(null), /root must be an object/);
  assert.throws(() => parseManifest({ version: 2, clips: [] }), /unsupported version/);
  assert.throws(() => parseManifest({ version: 1 }), /clips must be an array/);
  assert.throws(
    () => parseManifest({ version: 1, clips: [{ layer: 0, column: 1, energy: "LOW", motion: "STATIC", source: "s", name: "n" }] }),
    /clips\[0\]: layer/,
  );
  assert.throws(
    () => parseManifest({ version: 1, clips: [{ layer: 1, column: 1, energy: "BASS", motion: "STATIC", source: "s", name: "n" }] }),
    /energy must be one of/,
  );
  assert.throws(
    () => parseManifest({ version: 1, clips: [{ layer: 1, column: 1, energy: "LOW", motion: "STATIC", source: "", name: "n" }] }),
    /source must be a non-empty/,
  );
  assert.throws(
    () => parseManifest({ version: 1, arenaPort: "8080", clips: [] }),
    /arenaPort must be an integer/,
  );
});

function comp(names: string[][]) {
  return {
    name: { value: "test" },
    layers: names.map((row, li) => ({
      id: li + 1,
      name: { value: `Layer ${li + 1}` },
      clips: row.map((n, ci) => ({
        id: (li + 1) * 10 + ci,
        name: { value: n },
        connected: { id: (li + 1) * 100 + ci, value: "Disconnected" },
      })),
    })),
    columns: names[0].map((_, ci) => ({ id: ci + 1, connected: { id: 900 + ci, value: "Disconnected" } })),
  };
}

test("planSync: matching names → zero ops (contract b relies on name as sync key)", () => {
  const m = parseManifest(shippedRaw);
  const ops = planSync(m, comp([
    ["Metaballs", "Rings", "Spiral"],
    ["LineScape", "Tunnelines", "Gradient"],
    ["Stroboscope", "Checkered", "SolidColor"],
  ]));
  assert.deepEqual(ops, []);
});

test("planSync: mismatched cell → open+rename pair (M1 finding #3: open keeps old name)", () => {
  const m: Manifest = parseManifest({
    version: 1,
    clips: [{ layer: 2, column: 3, energy: "MID", motion: "ACTIVE", source: "file:///C:/clips/x.mov", name: "MyClip", tags: [] }],
  });
  const ops = planSync(m, comp([
    ["a", "b", "c"],
    ["d", "e", "OldName"],
    ["g", "h", "i"],
  ]));
  assert.deepEqual(ops, [
    { kind: "open", layer: 2, column: 3, source: "file:///C:/clips/x.mov" },
    { kind: "rename", layer: 2, column: 3, name: "MyClip" },
  ]);
});

test("planSync: manifest cell beyond composition size is skipped, not crashed", () => {
  const m: Manifest = parseManifest({
    version: 1,
    clips: [{ layer: 5, column: 1, energy: "LOW", motion: "STATIC", source: "s", name: "n" }],
  });
  assert.deepEqual(planSync(m, comp([["a", "b"], ["c", "d"]])), []);
});

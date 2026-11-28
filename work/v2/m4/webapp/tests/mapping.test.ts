import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAPPING_STORAGE_KEY,
  createDefaultMapping,
  cycleLayerRole,
  defaultLayerRoles,
  ensureLayerRoles,
  getLayerRole,
  layersToClearForTarget,
  physicalToSemantic,
  resolveSemanticToPhysical,
  sanitizeMappingConfig,
  slotsForPhysical,
  toggleSlotBinding,
  type MappingConfig,
} from "../src/mapping.ts";

test("MAPPING_STORAGE_KEY and defaultLayerRoles / createDefaultMapping for 3×3 and 5×11", () => {
  assert.equal(MAPPING_STORAGE_KEY, "flyvj.mapping.v1");

  assert.deepEqual(defaultLayerRoles(3), {
    1: "exclusive",
    2: "exclusive",
    3: "exclusive",
  });
  assert.deepEqual(defaultLayerRoles(5), {
    1: "exclusive",
    2: "exclusive",
    3: "exclusive",
    4: "overlay",
    5: "overlay",
  });
  assert.deepEqual(defaultLayerRoles(0), {});

  const m3 = createDefaultMapping(3, 3);
  assert.equal(m3.version, 1);
  assert.deepEqual(m3.layerRoles, { 1: "exclusive", 2: "exclusive", 3: "exclusive" });
  assert.deepEqual(m3.slotPools[0], [{ layer: 1, col: 1 }]);
  assert.deepEqual(m3.slotPools[4], [{ layer: 2, col: 2 }]);
  assert.deepEqual(m3.slotPools[8], [{ layer: 3, col: 3 }]);

  const m5 = createDefaultMapping(5, 11);
  assert.equal(m5.version, 1);
  assert.deepEqual(m5.layerRoles, {
    1: "exclusive",
    2: "exclusive",
    3: "exclusive",
    4: "overlay",
    5: "overlay",
  });
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 3; c++) {
      assert.deepEqual(m5.slotPools[(r - 1) * 3 + (c - 1)], [{ layer: r, col: c }]);
    }
  }

  const m2 = createDefaultMapping(2, 2);
  assert.deepEqual(m2.layerRoles, { 1: "exclusive", 2: "exclusive" });
  assert.deepEqual(m2.slotPools[0], [{ layer: 1, col: 1 }]);
  assert.deepEqual(m2.slotPools[1], [{ layer: 1, col: 2 }]);
  assert.deepEqual(m2.slotPools[2], []);
  assert.deepEqual(m2.slotPools[3], [{ layer: 2, col: 1 }]);
  assert.deepEqual(m2.slotPools[4], [{ layer: 2, col: 2 }]);
  assert.deepEqual(m2.slotPools[5], []);
  assert.deepEqual(m2.slotPools[6], []);
  assert.deepEqual(m2.slotPools[8], []);
});

test("cycleLayerRole and getLayerRole", () => {
  assert.equal(cycleLayerRole("exclusive"), "overlay");
  assert.equal(cycleLayerRole("overlay"), "ignore");
  assert.equal(cycleLayerRole("ignore"), "exclusive");

  const cfg: MappingConfig = {
    version: 1,
    layerRoles: { 1: "overlay", 4: "ignore" },
    slotPools: {},
  };
  assert.equal(getLayerRole(cfg, 1), "overlay");
  assert.equal(getLayerRole(cfg, 2), "exclusive");
  assert.equal(getLayerRole(cfg, 3), "exclusive");
  assert.equal(getLayerRole(cfg, 4), "ignore");
  assert.equal(getLayerRole(cfg, 5), "overlay");
});

test("layersToClearForTarget clears only other exclusive layers and never overlay/ignore", () => {
  const m5 = createDefaultMapping(5, 11);
  assert.deepEqual(layersToClearForTarget(1, 5, m5), [2, 3]);
  assert.deepEqual(layersToClearForTarget(2, 5, m5), [1, 3]);
  assert.deepEqual(layersToClearForTarget(3, 5, m5), [1, 2]);
  assert.deepEqual(layersToClearForTarget(4, 5, m5), []);
  assert.deepEqual(layersToClearForTarget(5, 5, m5), []);

  const custom: MappingConfig = {
    version: 1,
    layerRoles: {
      1: "exclusive",
      2: "overlay",
      3: "ignore",
      4: "exclusive",
      5: "overlay",
    },
    slotPools: {},
  };
  assert.deepEqual(layersToClearForTarget(1, 5, custom), [4]);
  assert.deepEqual(layersToClearForTarget(4, 5, custom), [1]);
  assert.deepEqual(layersToClearForTarget(2, 5, custom), []);
  assert.deepEqual(layersToClearForTarget(3, 5, custom), []);
  assert.deepEqual(layersToClearForTarget(5, 5, custom), []);
  assert.deepEqual(layersToClearForTarget(0, 5, custom), []);
  assert.deepEqual(layersToClearForTarget(6, 5, custom), []);
});

test("resolveSemanticToPhysical: bounds filtering, Bag anti-repeat rotation, and empty fallback", () => {
  const cfg: MappingConfig = {
    version: 1,
    layerRoles: defaultLayerRoles(5),
    slotPools: {
      0: [
        { layer: 5, col: 11 }, // out of 3×3 dims, valid in 5×11
        { layer: 1, col: 1 },
        { layer: 2, col: 3 },
      ],
      1: [{ layer: 4, col: 9 }], // completely out of 3×3 dims -> triggers fallback inside 3×3
      8: [], // empty -> fallback inside 3×3, null outside 2×2
    },
  };

  const last = new Map<number, string>();
  // In 5×11: picks index 0 ({ layer: 5, col: 11 }) when no history
  const first511 = resolveSemanticToPhysical(0, cfg, last, { rows: 5, cols: 11 });
  assert.deepEqual(first511, { layer: 5, col: 11 });
  assert.equal(last.size, 0); // pure read

  // Ensure returned object is a clone (mutating return does not alter config)
  if (first511) first511.layer = 99;
  assert.equal(cfg.slotPools[0][0].layer, 5);

  // Bag anti-repeat rotation skips "5:11" and picks next valid entry { layer: 1, col: 1 }
  last.set(0, "5:11");
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, last, { rows: 5, cols: 11 }), { layer: 1, col: 1 });

  // When last was "1:1", round-robin advances to the NEXT pool entry { layer: 2, col: 3 }
  last.set(0, "1:1");
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, last, { rows: 5, cols: 11 }), { layer: 2, col: 3 });

  // In 3×3 dims: { layer: 5, col: 11 } is filtered out, leaving [{ layer: 1, col: 1 }, { layer: 2, col: 3 }]
  last.set(0, "1:1");
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, last, { rows: 3, cols: 3 }), { layer: 2, col: 3 });

  // Slot 1 pool only has L4C9 (outside 3×3), so filtered pool is empty -> direct fallback (1, 2)
  assert.deepEqual(resolveSemanticToPhysical(1, cfg, last, { rows: 3, cols: 3 }), { layer: 1, col: 2 });

  // Slot 8 empty pool: falls back to (3, 3) in 3×3, returns null in 2×2
  assert.deepEqual(resolveSemanticToPhysical(8, cfg, last, { rows: 3, cols: 3 }), { layer: 3, col: 3 });
  assert.equal(resolveSemanticToPhysical(8, cfg, last, { rows: 2, cols: 2 }), null);
  assert.equal(resolveSemanticToPhysical(2, cfg, last, { rows: 5, cols: 2 }), null);

  // Duplicate-only pool fallback to index 0
  const dupCfg: MappingConfig = {
    version: 1,
    layerRoles: {},
    slotPools: { 0: [{ layer: 1, col: 1 }, { layer: 1, col: 1 }] },
  };
  assert.deepEqual(
    resolveSemanticToPhysical(0, dupCfg, new Map([[0, "1:1"]]), { rows: 3, cols: 3 }),
    { layer: 1, col: 1 },
  );

  // Invalid slot indices
  assert.equal(resolveSemanticToPhysical(-1, cfg, last, { rows: 5, cols: 11 }), null);
  assert.equal(resolveSemanticToPhysical(9, cfg, last, { rows: 5, cols: 11 }), null);
});

test("resolveSemanticToPhysical Auto-Pool: 5×11 default mapping rotates 列 1..N into C4/C5/C6", () => {
  const cfg = createDefaultMapping(5, 11);
  const dims = { rows: 5, cols: 11 };
  const colsByLayer = new Map<number, readonly number[]>([
    [1, [1, 2, 3, 4]],
    [2, [1, 2, 3, 4, 5]],
    [3, [1, 2, 3, 4, 5, 6]],
  ]);
  const last = new Map<number, string>();

  // Slot 0 (L1 / STATIC col): tier columns among L1 = {C1, C4} → round-robin 1:1 ↔ 1:4
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, last, dims, colsByLayer), { layer: 1, col: 1 });
  last.set(0, "1:1");
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, last, dims, colsByLayer), { layer: 1, col: 4 });
  last.set(0, "1:4");
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, last, dims, colsByLayer), { layer: 1, col: 1 });
  assert.equal(last.size, 1, "auto-pool select stays a pure read");

  // Slot 1 (L1 / MEDIUM col): L1 has no C5 → only the tier column C2 remains
  assert.deepEqual(resolveSemanticToPhysical(1, cfg, new Map([[1, "1:2"]]), dims, colsByLayer), { layer: 1, col: 2 });

  // Slot 4 (L2 / MEDIUM col): tier columns among L2 = {C2, C5} → 2:2 ↔ 2:5
  assert.deepEqual(resolveSemanticToPhysical(4, cfg, last, dims, colsByLayer), { layer: 2, col: 2 });
  last.set(4, "2:2");
  assert.deepEqual(resolveSemanticToPhysical(4, cfg, last, dims, colsByLayer), { layer: 2, col: 5 });
  last.set(4, "2:5");
  assert.deepEqual(resolveSemanticToPhysical(4, cfg, last, dims, colsByLayer), { layer: 2, col: 2 });

  // Slot 8 (L3 / ACTIVE col): tier columns among L3 = {C3, C6} → 3:3 ↔ 3:6
  assert.deepEqual(resolveSemanticToPhysical(8, cfg, last, dims, colsByLayer), { layer: 3, col: 3 });
  last.set(8, "3:3");
  assert.deepEqual(resolveSemanticToPhysical(8, cfg, last, dims, colsByLayer), { layer: 3, col: 6 });
  last.set(8, "3:6");
  assert.deepEqual(resolveSemanticToPhysical(8, cfg, last, dims, colsByLayer), { layer: 3, col: 3 });

  // Tier filter falls back to ALL non-empty cols of the row when no tier column matches
  const oddCols = new Map<number, readonly number[]>([[1, [5, 6]]]);
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, new Map([[0, "1:5"]]), dims, oddCols), { layer: 1, col: 6 });

  // Out-of-range / non-integer column hints are ignored (falls back to 1:1)
  const dirtyCols = new Map<number, readonly number[]>([[1, [0, 12, 2.5] as number[]]]);
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, new Map(), dims, dirtyCols), { layer: 1, col: 1 });

  // Layers beyond the Arena row count never auto-pool (slot 0 → row 1 only)
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, new Map(), { rows: 0, cols: 11 }, colsByLayer), null);
});

test("resolveSemanticToPhysical Auto-Pool: explicit Bind Mode entries always override the pool", () => {
  const base = createDefaultMapping(5, 11);
  const dims = { rows: 5, cols: 11 };
  const colsByLayer = new Map<number, readonly number[]>([
    [1, [1, 2, 3, 4]],
    [2, [1, 2, 3, 4, 5]],
    [3, [1, 2, 3, 4, 5, 6]],
  ]);

  // Slot 0 rebound to L4C7 → NOT the untouched default → explicit pool only (never C4)
  const custom = toggleSlotBinding(base, 0, { layer: 4, col: 7 });
  assert.deepEqual(custom.slotPools[0], [{ layer: 1, col: 1 }, { layer: 4, col: 7 }]);
  const last = new Map<number, string>();
  assert.deepEqual(resolveSemanticToPhysical(0, custom, last, dims, colsByLayer), { layer: 1, col: 1 });
  last.set(0, "1:1");
  assert.deepEqual(resolveSemanticToPhysical(0, custom, last, dims, colsByLayer), { layer: 4, col: 7 });
  last.set(0, "4:7");
  assert.deepEqual(resolveSemanticToPhysical(0, custom, last, dims, colsByLayer), { layer: 1, col: 1 });

  // A single custom entry also suppresses the Auto-Pool (it is not the 1:1 default)
  const single = toggleSlotBinding(toggleSlotBinding(base, 0, { layer: 1, col: 1 }), 0, { layer: 5, col: 9 });
  assert.deepEqual(single.slotPools[0], [{ layer: 5, col: 9 }]);
  assert.deepEqual(resolveSemanticToPhysical(0, single, new Map(), dims, colsByLayer), { layer: 5, col: 9 });
});

test("resolveSemanticToPhysical: omitting the 5th arg keeps the pre-M4.8 behaviour", () => {
  const cfg = createDefaultMapping(5, 11);
  const dims = { rows: 5, cols: 11 };
  const colsByLayer = new Map<number, readonly number[]>([[1, [1, 2, 3, 4]]]);

  // Default 1:1 binding, no rotation without the column map
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, new Map(), dims), { layer: 1, col: 1 });
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, new Map([[0, "1:1"]]), dims), { layer: 1, col: 1 });

  // Supplying the map DOES change the same call (proves the two modes differ)
  assert.deepEqual(resolveSemanticToPhysical(0, cfg, new Map([[0, "1:1"]]), dims, colsByLayer), { layer: 1, col: 4 });
});

test("physicalToSemantic: explicit match, implicit default, overridden default, and unmapped L4-L5 / C4-C11", () => {
  const emptyCfg: MappingConfig = { version: 1, layerRoles: {}, slotPools: {} };
  assert.deepEqual(physicalToSemantic({ layer: 1, col: 1 }, emptyCfg), {
    cell: { row: 1, col: 1 },
    explicit: false,
  });
  assert.deepEqual(physicalToSemantic({ layer: 3, col: 2 }, emptyCfg), {
    cell: { row: 3, col: 2 },
    explicit: false,
  });
  assert.equal(physicalToSemantic({ layer: 4, col: 1 }, emptyCfg), null);
  assert.equal(physicalToSemantic({ layer: 1, col: 4 }, emptyCfg), null);
  assert.equal(physicalToSemantic({ layer: 5, col: 11 }, emptyCfg), null);

  const customCfg: MappingConfig = {
    version: 1,
    layerRoles: defaultLayerRoles(5),
    slotPools: {
      0: [{ layer: 4, col: 7 }], // overrides slot 0 (default L1C1)
      4: [{ layer: 2, col: 2 }, { layer: 5, col: 11 }],
    },
  };
  // Explicit bindings in L4/L5/C4-C11 resolve with explicit: true
  assert.deepEqual(physicalToSemantic({ layer: 4, col: 7 }, customCfg), {
    cell: { row: 1, col: 1 },
    explicit: true,
  });
  assert.deepEqual(physicalToSemantic({ layer: 5, col: 11 }, customCfg), {
    cell: { row: 2, col: 2 },
    explicit: true,
  });
  assert.deepEqual(physicalToSemantic({ layer: 2, col: 2 }, customCfg), {
    cell: { row: 2, col: 2 },
    explicit: true,
  });

  // L1C1 is unmapped because defaultSlot 0 is overridden by L4C7
  assert.equal(physicalToSemantic({ layer: 1, col: 1 }, customCfg), null);

  // L1C2 has empty/undefined slot 1 -> falls back to implicit default
  assert.deepEqual(physicalToSemantic({ layer: 1, col: 2 }, customCfg), {
    cell: { row: 1, col: 2 },
    explicit: false,
  });

  // Unmapped outside 3×3
  assert.equal(physicalToSemantic({ layer: 4, col: 1 }, customCfg), null);
  assert.equal(physicalToSemantic({ layer: 2, col: 10 }, customCfg), null);
  assert.equal(physicalToSemantic({ layer: 0, col: 1 }, customCfg), null);
});

test("toggleSlotBinding immutability, deduplication, and slotsForPhysical", () => {
  const base = createDefaultMapping(5, 11);
  const next1 = toggleSlotBinding(base, 0, { layer: 4, col: 5 });
  assert.notEqual(next1, base);
  assert.deepEqual(base.slotPools[0], [{ layer: 1, col: 1 }]); // original untouched
  assert.deepEqual(next1.slotPools[0], [{ layer: 1, col: 1 }, { layer: 4, col: 5 }]);

  // Bind same physical clip to slots 3 and 7 as well
  const next2 = toggleSlotBinding(toggleSlotBinding(next1, 3, { layer: 4, col: 5 }), 7, { layer: 4, col: 5 });
  assert.deepEqual(slotsForPhysical(next2, { layer: 4, col: 5 }), [0, 3, 7]);
  assert.deepEqual(slotsForPhysical(next2, { layer: 5, col: 11 }), []);

  // Toggle again removes from slot 0 only
  const next3 = toggleSlotBinding(next2, 0, { layer: 4, col: 5 });
  assert.deepEqual(next3.slotPools[0], [{ layer: 1, col: 1 }]);
  assert.deepEqual(slotsForPhysical(next3, { layer: 4, col: 5 }), [3, 7]);

  // Pre-existing duplicates get deduplicated on toggle
  const dirty: MappingConfig = {
    version: 1,
    layerRoles: { 1: "exclusive" },
    slotPools: { 2: [{ layer: 1, col: 3 }, { layer: 1, col: 3 }] },
  };
  const deduped = toggleSlotBinding(dirty, 2, { layer: 4, col: 2 });
  assert.deepEqual(deduped.slotPools[2], [{ layer: 1, col: 3 }, { layer: 4, col: 2 }]);

  // Invalid inputs are ignored
  assert.equal(toggleSlotBinding(base, -1, { layer: 1, col: 1 }), base);
  assert.equal(toggleSlotBinding(base, 9, { layer: 1, col: 1 }), base);
  assert.equal(toggleSlotBinding(base, 0, { layer: 0, col: 1 }), base);
  assert.equal(toggleSlotBinding(base, 0, { layer: 1, col: -2 }), base);
});

test("sanitizeMappingConfig handles corrupted/partial JSON, negative indices, bad roles, and ensureLayerRoles", () => {
  const def3 = createDefaultMapping(3, 3);
  const def5 = createDefaultMapping(5, 11);

  assert.deepEqual(sanitizeMappingConfig(null), def3);
  assert.deepEqual(sanitizeMappingConfig("corrupted"), def3);
  assert.deepEqual(sanitizeMappingConfig([]), def3);
  assert.deepEqual(sanitizeMappingConfig({ version: 2, layerRoles: {}, slotPools: {} }, 5, 11), def5);
  assert.deepEqual(sanitizeMappingConfig({ version: 1 }), def3);
  assert.deepEqual(sanitizeMappingConfig({ version: 1, layerRoles: "bad", slotPools: {} }), def3);
  assert.deepEqual(sanitizeMappingConfig({ version: 1, layerRoles: {}, slotPools: [] }), def3);

  const dirty = {
    version: 1,
    layerRoles: {
      "-1": "exclusive",
      "0": "overlay",
      "1": "bogus-role",
      "1.5": "overlay",
      "02": "overlay",
      "2": "overlay",
      "4": "exclusive",
      "5": 123,
    },
    slotPools: {
      "-1": [{ layer: 1, col: 1 }],
      "9": [{ layer: 1, col: 1 }],
      "01": [{ layer: 1, col: 1 }],
      "0": [
        null,
        { layer: 0, col: 1 },
        { layer: 1, col: -3 },
        { layer: 1.5, col: 2 },
        { layer: 4, col: 5 },
        { layer: 4, col: 5 }, // duplicate
        { layer: 2, col: 3 },
      ],
      "3": "not-an-array",
      "4": [{ layer: NaN, col: 1 }],
    },
  };

  const clean = sanitizeMappingConfig(dirty);
  assert.equal(clean.version, 1);
  assert.deepEqual(clean.layerRoles, { 2: "overlay", 4: "exclusive" });
  assert.deepEqual(clean.slotPools, {
    0: [{ layer: 4, col: 5 }, { layer: 2, col: 3 }],
    4: [],
  });

  // Partial JSON with only slotPools
  const partial = sanitizeMappingConfig({ version: 1, slotPools: { 8: [{ layer: 5, col: 11 }] } });
  assert.deepEqual(partial, {
    version: 1,
    layerRoles: {},
    slotPools: { 8: [{ layer: 5, col: 11 }] },
  });

  // ensureLayerRoles fills missing 1..5 without overwriting existing custom roles
  const ensured = ensureLayerRoles(clean, 5);
  assert.deepEqual(ensured.layerRoles, {
    1: "exclusive",
    2: "overlay",
    3: "exclusive",
    4: "exclusive",
    5: "overlay",
  });
  assert.deepEqual(clean.layerRoles, { 2: "overlay", 4: "exclusive" }); // input unmutated
});

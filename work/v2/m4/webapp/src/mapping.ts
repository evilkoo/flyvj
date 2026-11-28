// Decouples FlyVJ's 9 semantic grid slots (0..8, matching GridCell row 1..3 × col 1..3)
// from Resolume Arena's arbitrary physical L × C composition layout (e.g. 3×3 or 5×11).
// Pure module — zero DOM/browser globals; erasable-syntax-only TS for `node --test`.

import type { GridCell } from "./detector.ts";
import { idxCell } from "./decision.ts";

export type LayerRole = "exclusive" | "overlay" | "ignore";

export interface PhysicalClipRef {
  layer: number; // 1-based
  col: number;   // 1-based
}

export interface GridDims {
  rows: number;
  cols: number;
}

export interface MappingConfig {
  version: 1;
  layerRoles: Record<number, LayerRole>;
  slotPools: Record<number, PhysicalClipRef[]>;
}

export const MAPPING_STORAGE_KEY = "flyvj.mapping.v1";

const VALID_ROLES: ReadonlySet<string> = new Set<LayerRole>(["exclusive", "overlay", "ignore"]);

function isLayerRole(v: unknown): v is LayerRole {
  return typeof v === "string" && VALID_ROLES.has(v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

function isValidSlotIdx(slotIdx: number): boolean {
  return Number.isInteger(slotIdx) && slotIdx >= 0 && slotIdx <= 8;
}

function clipKey(ref: PhysicalClipRef): string {
  return `${ref.layer}:${ref.col}`;
}

function toNonNegInt(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;
}

function sanitizeClipList(raw: unknown): PhysicalClipRef[] {
  if (!Array.isArray(raw)) return [];
  const out: PhysicalClipRef[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isPlainObject(item)) continue;
    if (!isPositiveInt(item.layer) || !isPositiveInt(item.col)) continue;
    const ref: PhysicalClipRef = { layer: item.layer, col: item.col };
    const key = clipKey(ref);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(ref);
    }
  }
  return out;
}

function cloneLayerRoles(roles: Record<number, LayerRole> | undefined): Record<number, LayerRole> {
  const out: Record<number, LayerRole> = {};
  if (!roles) return out;
  for (const [k, v] of Object.entries(roles)) {
    if (/^[1-9]\d*$/.test(k) && isLayerRole(v)) {
      out[Number(k)] = v;
    }
  }
  return out;
}

function cloneSlotPools(slotPools: Record<number, PhysicalClipRef[]> | undefined): Record<number, PhysicalClipRef[]> {
  const out: Record<number, PhysicalClipRef[]> = {};
  if (!slotPools) return out;
  for (const [k, pool] of Object.entries(slotPools)) {
    if (/^[0-8]$/.test(k) && Array.isArray(pool)) {
      out[Number(k)] = sanitizeClipList(pool);
    }
  }
  return out;
}

/**
 * Default layer role assignment: layers 1..min(3, layerCount) are "exclusive",
 * layers 4..layerCount are "overlay".
 */
export function defaultLayerRoles(layerCount: number): Record<number, LayerRole> {
  const n = toNonNegInt(layerCount);
  const roles: Record<number, LayerRole> = {};
  const exclusiveEnd = Math.min(3, n);
  for (let l = 1; l <= exclusiveEnd; l++) roles[l] = "exclusive";
  for (let l = 4; l <= n; l++) roles[l] = "overlay";
  return roles;
}

/**
 * Return the configured role for a 1-based layer, falling back to
 * `layer <= 3 ? "exclusive" : "overlay"` when absent or invalid.
 */
export function getLayerRole(config: MappingConfig, layer: number): LayerRole {
  const explicit = config.layerRoles?.[layer];
  if (isLayerRole(explicit)) return explicit;
  return layer <= 3 ? "exclusive" : "overlay";
}

/** Cycle layer role in order: "exclusive" -> "overlay" -> "ignore" -> "exclusive". */
export function cycleLayerRole(role: LayerRole): LayerRole {
  if (role === "exclusive") return "overlay";
  if (role === "overlay") return "ignore";
  return "exclusive";
}

/**
 * Create a default 1:1 MappingConfig for an Arena grid of `rows × cols`.
 * Layers 1..min(3, rows) default to "exclusive", 4..rows to "overlay".
 * Semantic slots 0..8 bind to `[{ layer: r, col: c }]` when within `rows × cols`, else `[]`.
 */
export function createDefaultMapping(rows = 3, cols = 3): MappingConfig {
  const safeRows = toNonNegInt(rows);
  const safeCols = toNonNegInt(cols);
  const slotPools: Record<number, PhysicalClipRef[]> = {};
  for (let r = 1; r <= 3; r++) {
    for (let c = 1; c <= 3; c++) {
      const idx = (r - 1) * 3 + (c - 1);
      slotPools[idx] = r <= safeRows && c <= safeCols ? [{ layer: r, col: c }] : [];
    }
  }
  return {
    version: 1,
    layerRoles: defaultLayerRoles(safeRows),
    slotPools,
  };
}

/**
 * Return all OTHER layers in `1..layerCount` (`r !== targetLayer`) that must be cleared
 * when triggering `targetLayer`. Only "exclusive" targets clear other "exclusive" layers;
 * "overlay" and "ignore" layers are never cleared, and targeting them returns `[]`.
 */
export function layersToClearForTarget(
  targetLayer: number,
  layerCount: number,
  config: MappingConfig,
): number[] {
  const n = toNonNegInt(layerCount);
  if (!Number.isInteger(targetLayer) || targetLayer < 1 || targetLayer > n) return [];
  if (getLayerRole(config, targetLayer) !== "exclusive") return [];
  const toClear: number[] = [];
  for (let r = 1; r <= n; r++) {
    if (r !== targetLayer && getLayerRole(config, r) === "exclusive") {
      toClear.push(r);
    }
  }
  return toClear;
}

/**
 * Resolve a semantic slot index (0..8) to a physical clip within `dims`.
 * Uses round-robin anti-repeat selection against `lastPhysicalBySlot.get(slotIdx)` when the
 * effective pool has >1 entries (pure read; caller records the fired `${layer}:${col}` key).
 * Falls back to direct 1:1 `(floor(slotIdx/3)+1, (slotIdx%3)+1)` when the effective pool is
 * empty and that cell falls inside `dims`, otherwise returns `null`.
 *
 * M4.8 Auto-Pool: pass `nonEmptyColsByLayer` (layer → non-empty column list from content.ts)
 * and an UNTOUCHED default slot (empty or still the 1:1 binding, Bind Mode never used)
 * expands to every matching tier column on the default row (`列 1..N`, `C4–C6+`), picked
 * round-robin so the extra columns rotate instead of only ever firing C1–C3.
 */
export function resolveSemanticToPhysical(
  slotIdx: number,
  config: MappingConfig,
  lastPhysicalBySlot: Map<number, string>,
  dims: GridDims,
  nonEmptyColsByLayer?: ReadonlyMap<number, readonly number[]>,
): PhysicalClipRef | null {
  if (!isValidSlotIdx(slotIdx)) return null;
  if (!Number.isFinite(dims.rows) || !Number.isFinite(dims.cols) || dims.rows < 1 || dims.cols < 1) {
    return null;
  }

  const rawPool = config.slotPools?.[slotIdx] ?? [];
  const pool = rawPool.filter(
    (p) =>
      isPositiveInt(p.layer) &&
      isPositiveInt(p.col) &&
      p.layer <= dims.rows &&
      p.col <= dims.cols,
  );

  const defaultRow = Math.floor(slotIdx / 3) + 1;
  const defaultCol = (slotIdx % 3) + 1;
  const isUntouchedDefault =
    pool.length === 0 || (pool.length === 1 && pool[0].layer === defaultRow && pool[0].col === defaultCol);

  let effectivePool: readonly PhysicalClipRef[] = pool;
  if (nonEmptyColsByLayer && isUntouchedDefault && defaultRow <= dims.rows) {
    const layerCols = (nonEmptyColsByLayer.get(defaultRow) ?? []).filter(
      (c) => Number.isInteger(c) && c >= 1 && c <= dims.cols,
    );
    const tierCols = layerCols.filter((c) => (c - 1) % 3 === defaultCol - 1);
    const chosenCols = tierCols.length > 0 ? tierCols : layerCols;
    if (chosenCols.length > 0) {
      effectivePool = chosenCols.map((c): PhysicalClipRef => ({ layer: defaultRow, col: c }));
    }
  }

  if (effectivePool.length >= 1) {
    let pick = effectivePool[0];
    if (effectivePool.length > 1) {
      const lastKey = lastPhysicalBySlot.get(slotIdx);
      if (lastKey !== undefined) {
        const idx = effectivePool.findIndex((p) => clipKey(p) === lastKey);
        pick = idx >= 0 ? effectivePool[(idx + 1) % effectivePool.length] : effectivePool[0];
      }
    }
    return { layer: pick.layer, col: pick.col };
  }

  if (defaultRow <= dims.rows && defaultCol <= dims.cols) {
    return { layer: defaultRow, col: defaultCol };
  }
  return null;
}

/**
 * Reverse-map a physical clip `{ layer, col }` to a semantic `GridCell`.
 * Searches explicit `slotPools` (`0..8`) first (`explicit: true`), then falls back to the
 * implicit 3×3 cell (`explicit: false`) only when that default slot has no overriding entries.
 * Returns `null` for unmapped cells outside 3×3 or when the default slot is overridden.
 */
export function physicalToSemantic(
  phys: PhysicalClipRef,
  config: MappingConfig,
): { cell: GridCell; explicit: boolean } | null {
  if (!isPositiveInt(phys.layer) || !isPositiveInt(phys.col)) return null;

  for (let slotIdx = 0; slotIdx < 9; slotIdx++) {
    const pool = config.slotPools?.[slotIdx];
    if (Array.isArray(pool) && pool.some((p) => p.layer === phys.layer && p.col === phys.col)) {
      return { cell: idxCell(slotIdx), explicit: true };
    }
  }

  if (phys.layer <= 3 && phys.col <= 3) {
    const defaultSlot = (phys.layer - 1) * 3 + (phys.col - 1);
    const defaultPool = config.slotPools?.[defaultSlot];
    if (!defaultPool || defaultPool.length === 0) {
      return {
        cell: { row: phys.layer as 1 | 2 | 3, col: phys.col as 1 | 2 | 3 },
        explicit: false,
      };
    }
    return null;
  }

  return null;
}

/**
 * Pure immutable toggle adding or removing `phys` from `config.slotPools[slotIdx]`
 * (deduplicated). Ignores invalid `slotIdx` (`<0 || >8`) or invalid `phys` (`<1`).
 */
export function toggleSlotBinding(
  config: MappingConfig,
  slotIdx: number,
  phys: PhysicalClipRef,
): MappingConfig {
  if (!isValidSlotIdx(slotIdx) || !isPositiveInt(phys.layer) || !isPositiveInt(phys.col)) {
    return config;
  }

  const nextPools = cloneSlotPools(config.slotPools);
  const current = nextPools[slotIdx] ?? [];
  const exists = current.some((p) => p.layer === phys.layer && p.col === phys.col);
  nextPools[slotIdx] = exists
    ? current.filter((p) => !(p.layer === phys.layer && p.col === phys.col))
    : [...current, { layer: phys.layer, col: phys.col }];

  return {
    version: 1,
    layerRoles: cloneLayerRoles(config.layerRoles),
    slotPools: nextPools,
  };
}

/** Return sorted semantic slot indices (0..8) whose pool contains `phys`. */
export function slotsForPhysical(config: MappingConfig, phys: PhysicalClipRef): number[] {
  if (!isPositiveInt(phys.layer) || !isPositiveInt(phys.col)) return [];
  const out: number[] = [];
  for (let slotIdx = 0; slotIdx < 9; slotIdx++) {
    const pool = config.slotPools?.[slotIdx];
    if (Array.isArray(pool) && pool.some((p) => p.layer === phys.layer && p.col === phys.col)) {
      out.push(slotIdx);
    }
  }
  return out;
}

/**
 * Fill any missing layer roles for `1..layerCount` using `defaultLayerRoles`
 * without overwriting existing valid user roles.
 */
export function ensureLayerRoles(config: MappingConfig, layerCount: number): MappingConfig {
  const n = toNonNegInt(layerCount);
  const nextRoles = cloneLayerRoles(config.layerRoles);
  const defaults = defaultLayerRoles(n);
  for (let l = 1; l <= n; l++) {
    if (!nextRoles[l]) {
      nextRoles[l] = defaults[l];
    }
  }
  return {
    version: 1,
    layerRoles: nextRoles,
    slotPools: cloneSlotPools(config.slotPools),
  };
}

/**
 * Strictly validate and sanitize untrusted mapping JSON, returning
 * `createDefaultMapping(fallbackRows, fallbackCols)` if malformed.
 */
export function sanitizeMappingConfig(
  raw: unknown,
  fallbackRows = 3,
  fallbackCols = 3,
): MappingConfig {
  if (!isPlainObject(raw) || raw.version !== 1) {
    return createDefaultMapping(fallbackRows, fallbackCols);
  }
  if (raw.layerRoles !== undefined && !isPlainObject(raw.layerRoles)) {
    return createDefaultMapping(fallbackRows, fallbackCols);
  }
  if (raw.slotPools !== undefined && !isPlainObject(raw.slotPools)) {
    return createDefaultMapping(fallbackRows, fallbackCols);
  }
  if (raw.layerRoles === undefined && raw.slotPools === undefined) {
    return createDefaultMapping(fallbackRows, fallbackCols);
  }

  const layerRoles: Record<number, LayerRole> = {};
  if (isPlainObject(raw.layerRoles)) {
    for (const [k, v] of Object.entries(raw.layerRoles)) {
      if (/^[1-9]\d*$/.test(k) && isLayerRole(v)) {
        layerRoles[Number(k)] = v;
      }
    }
  }

  const slotPools: Record<number, PhysicalClipRef[]> = {};
  if (isPlainObject(raw.slotPools)) {
    for (const [k, v] of Object.entries(raw.slotPools)) {
      if (/^[0-8]$/.test(k) && Array.isArray(v)) {
        slotPools[Number(k)] = sanitizeClipList(v);
      }
    }
  }

  return {
    version: 1,
    layerRoles,
    slotPools,
  };
}

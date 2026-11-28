// M2 clip manifest — the "3×3 grid" domain object.
// Contract (docs/M2_TICKET.md): editing manifest.json + reloading the page takes effect
// without touching code. Each clip entry carries layer×column, nine-cell classification
// (energy × motion), source path (file path or source:/// URL) and tags.
// NOTE: keep this file erasable-syntax-only (no enums / parameter properties) so
// `node --test` can run the .ts sources directly.

import type { WsComposition } from "./protocol.ts";

export const ENERGIES = ["LOW", "MID", "HIGH"] as const;
export const MOTIONS = ["STATIC", "MEDIUM", "ACTIVE"] as const;
export type Energy = (typeof ENERGIES)[number];
export type Motion = (typeof MOTIONS)[number];

export interface ManifestClip {
  /** 1-based layer index in the Resolume composition (layer 1 = LOW … by contract). */
  layer: number;
  /** 1-based column index (Column trigger switches all layers of one column). */
  column: number;
  /** Nine-cell classification: energy axis. */
  energy: Energy;
  /** Nine-cell classification: motion axis. */
  motion: Motion;
  /** Clip source: local file path or Arena `source:///…` URL. */
  source: string;
  /** Display name; also the sync key against Arena's actual clip name. */
  name: string;
  tags?: string[];
}

export interface Manifest {
  version: 1;
  arenaPort?: number;
  clips: ManifestClip[];
}

export function parseManifest(json: unknown): Manifest {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    throw new Error("manifest: root must be an object");
  }
  const root = json as Record<string, unknown>;
  if (root.version !== 1) {
    throw new Error(`manifest: unsupported version ${JSON.stringify(root.version)} (expected 1)`);
  }
  if (!Array.isArray(root.clips)) {
    throw new Error("manifest: clips must be an array");
  }
  if (root.arenaPort !== undefined && (typeof root.arenaPort !== "number" || !Number.isInteger(root.arenaPort))) {
    throw new Error("manifest: arenaPort must be an integer");
  }
  const clips: ManifestClip[] = root.clips.map((raw, i) => {
    const c = (raw ?? {}) as Record<string, unknown>;
    const at = (msg: string): never => {
      throw new Error(`manifest.clips[${i}]: ${msg}`);
    };
    if (typeof c.layer !== "number" || !Number.isInteger(c.layer) || c.layer < 1) at("layer must be an integer ≥ 1");
    if (typeof c.column !== "number" || !Number.isInteger(c.column) || c.column < 1) at("column must be an integer ≥ 1");
    if (!ENERGIES.includes(c.energy as Energy)) at(`energy must be one of ${ENERGIES.join("/")}`);
    if (!MOTIONS.includes(c.motion as Motion)) at(`motion must be one of ${MOTIONS.join("/")}`);
    if (typeof c.source !== "string" || c.source.length === 0) at("source must be a non-empty string");
    if (typeof c.name !== "string" || c.name.length === 0) at("name must be a non-empty string");
    if (c.tags !== undefined && (!Array.isArray(c.tags) || c.tags.some((t) => typeof t !== "string"))) {
      at("tags must be an array of strings");
    }
    return {
      layer: c.layer as number,
      column: c.column as number,
      energy: c.energy as Energy,
      motion: c.motion as Motion,
      source: c.source as string,
      name: c.name as string,
      tags: c.tags as string[] | undefined,
    };
  });
  return { version: 1, arenaPort: root.arenaPort as number | undefined, clips };
}

export function manifestClipAt(manifest: Manifest | null, layer: number, column: number): ManifestClip | undefined {
  return manifest?.clips.find((c) => c.layer === layer && c.column === column);
}

export type SyncOp =
  | { kind: "open"; layer: number; column: number; source: string }
  | { kind: "rename"; layer: number; column: number; name: string };

/**
 * Compare manifest against the live composition and return the REST ops needed to
 * make Arena match. Sync key = clip name (v0 limitation: if the name matches we trust
 * the source matches; dummy generators have distinct names).
 * M1 finding #3: clip_open keeps the OLD clip name → every open must be followed by a rename.
 */
export function planSync(manifest: Manifest, comp: WsComposition): SyncOp[] {
  const ops: SyncOp[] = [];
  for (const clip of manifest.clips) {
    const arenaLayer = comp.layers[clip.layer - 1];
    if (!arenaLayer) continue; // composition smaller than manifest — skip (v0)
    const arenaClip = (arenaLayer.clips ?? [])[clip.column - 1];
    const arenaName = arenaClip?.name?.value;
    if (arenaName !== clip.name) {
      ops.push({ kind: "open", layer: clip.layer, column: clip.column, source: clip.source });
      ops.push({ kind: "rename", layer: clip.layer, column: clip.column, name: clip.name });
    }
  }
  return ops;
}

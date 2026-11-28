// M4 dev diagnostics — shared constants, event types and pure helpers for the
// dev-only /__diag endpoints (vite.config.ts flyvjDiagPlugin) and the browser
// diag client. PURE module: no DOM/browser globals beyond the deliberately
// universal btoa/atob/TextEncoder/TextDecoder (Node 16+ / all browsers).
// Erasable-syntax-only (no enums / parameter properties), runs on `node --test`.

import type { BandEnergy } from "./dsp.ts";

export const DIAG_ENDPOINTS = {
  status: "/__diag/status",
  telemetry: "/__diag/telemetry",
  audio: "/__diag/audio",
  audioMeta: "/__diag/audio-meta",
} as const;

export const DIAG_MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const DIAG_MAX_META_BYTES = 8 * 1024 * 1024;
export const DIAG_MAX_JSONL_LINES = 2000;
export const DIAG_AUDIO_MAX_MS = 300_000;
export const DIAG_MAX_BAND_SAMPLES = 25_000;

export interface DiagTickEvent {
  kind: "tick";
  wall: number;
  tMs: number;
  mode: string;
  triggerMode: string;
  wsOpen: boolean;
  compName: string | null;
  dims: { rows: number; cols: number };
  micRunning: boolean;
  agc: unknown;
  ambient: BandEnergy | null;
  bands: BandEnergy;
  raw: BandEnergy | null;
  detector: unknown;
  topCand: { cell: string; prob: number } | null;
  perf: unknown;
}

export interface DiagDecisionEvent {
  kind: "decision";
  wall: number;
  tMs: number;
  decisionKind: string;
  cell: string | null;
  physical: { layer: number; col: number } | null;
  confidence: number;
  reason: string;
  source: string;
  mode: string;
}

export interface DiagArenaExecEvent {
  kind: "arena-exec";
  wall: number;
  tMs: number;
  physical: { layer: number; col: number };
  source: string;
  stage: "fired" | "verified-latched" | "verified-fallback";
}

export type DiagEvent = DiagTickEvent | DiagDecisionEvent | DiagArenaExecEvent;

export interface DiagAudioMeta {
  startWall: number;
  endWall: number;
  startSongMs: number;
  endSongMs: number;
  mimeType: string;
  agc: unknown;
  bandSampleCount: number;
  bandSamples: number[][];
  decisions: unknown[];
  perf: unknown;
}

const LOOPBACK_ADDRESSES = ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"];

export function isLoopbackAddress(addr: string | undefined): boolean {
  if (addr === undefined) return false;
  const s = addr.trim();
  return LOOPBACK_ADDRESSES.includes(s);
}

export function trimJsonlContent(content: string, maxLines: number = DIAG_MAX_JSONL_LINES): string {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const kept = lines.slice(Math.max(0, lines.length - maxLines));
  return kept.length === 0 ? "" : kept.join("\n") + "\n";
}

const AUDIO_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function chooseAudioMimeType(isSupported: (mime: string) => boolean): string {
  for (const mime of AUDIO_MIME_CANDIDATES) {
    if (isSupported(mime)) return mime;
  }
  return "";
}

/** UTF-8-safe base64 of JSON.stringify(meta); header-safe ASCII in Node & browser. */
export function encodeDiagMetaHeader(meta: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(meta));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Inverse of encodeDiagMetaHeader; null on missing / corrupt / non-object input. */
export function decodeDiagMetaHeader(b64: string | undefined): Record<string, unknown> | null {
  if (b64 === undefined) return null;
  const s = b64.trim();
  if (s.length === 0) return null;
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

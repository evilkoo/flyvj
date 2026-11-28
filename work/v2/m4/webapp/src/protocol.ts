// Resolume Arena 7.23.2 WebSocket protocol types + helpers.
// All facts here were verified live in M1 (docs/M1_RESULT_V2.md §協議實測):
//   - `connected` is a ParamState STRING enum "Empty"|"Disconnected"|"Connected", NOT a boolean.
//   - subscribe by numeric param id: {action:"subscribe", parameter:"/parameter/by-id/<id>"}
//   - column trigger: {action:"trigger", parameter:"/composition/columns/by-id/<id>/connect", value:true|false}
//   - REST clip load: POST /composition/layers/{L}/clips/{C}/open, body = raw source string (text/plain)

export interface ParamState {
  id?: number;
  valuetype?: string;
  value: unknown;
  options?: string[];
}

export interface WsClip {
  id: number;
  name?: { value: string };
  connected?: ParamState;
}

export interface WsLayer {
  id: number;
  name?: { value: string };
  clips: WsClip[];
  master?: ParamState;
}

export interface WsColumn {
  id: number;
  name?: { value: string };
  connected?: ParamState;
}

export interface WsComposition {
  name?: { value: string };
  layers: WsLayer[];
  columns: WsColumn[];
}

export interface WsParamMsg {
  type: string;
  id: number;
  value: unknown;
}

export const PARAM_REPLY_TYPES = [
  "parameter_get",
  "parameter_set",
  "parameter_update",
  "parameter_subscribed",
] as const;

export function isParamMsg(m: unknown): m is WsParamMsg {
  const r = m as Record<string, unknown>;
  return !!r && typeof r.type === "string" && PARAM_REPLY_TYPES.includes(r.type as never) && typeof r.id === "number";
}

export function isComposition(m: unknown): m is WsComposition {
  const r = m as Record<string, unknown>;
  return !!r && Array.isArray(r.columns) && Array.isArray(r.layers);
}

/** ParamState → on/off. M1 lesson: never compare with `=== true`. */
export function connectedValue(v: unknown): boolean {
  return v === "Connected" || v === true || (typeof v === "number" && v >= 3);
}

export function columnConnectPath(colId: number): string {
  return `/composition/columns/by-id/${colId}/connect`;
}

/**
 * M4.5 precision clip trigger: trigger ONE clip (layer × column cell) instead of the whole
 * column. VERIFIED LIVE (2026-11-18 probe on Arena 7.23.2): the path is POSITION-based —
 * `/composition/layers/{L}/clips/{C}/connect` with value true latches Connected; the
 * composition-level by-id form (`/composition/clips/by-id/<id>/connect`) does NOT exist
 * for triggering (probe: stayed Disconnected). Residue above the picked clip is cleared
 * with the LAYER-level `/composition/layers/{N}/clear` — sending connect=false to the
 * sibling clips UNDOES the just-fired trigger (probe 0/4 latched vs 3/3 with layer clear).
 */
export function clipConnectPath(layerIdx: number, clipIdx: number): string {
  return `/composition/layers/${layerIdx}/clips/${clipIdx}/connect`;
}

export function layerClearPath(layerIdx: number): string {
  return `/composition/layers/${layerIdx}/clear`;
}

export function paramByIdPath(paramId: number): string {
  return `/parameter/by-id/${paramId}`;
}

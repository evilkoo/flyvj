// Phase 2 External Launch Detector — PURE module (unit-tested in node, zero DOM/WS).
// Tracks Resolume Arena clip connected-parameter rising edges (false -> true) and suppresses
// FlyVJ's own self-fired clip/column triggers within a short echo window so only genuine
// external human launches in Arena are captured.
// Erasable-syntax-only for node --test.

export interface ExternalDetectEvent {
  external: boolean;
  risingEdge: boolean;
}

/**
 * Classifies Resolume clip connected-parameter updates as external human launches vs
 * self-fired echoes / non-rising updates.
 */
export class ExternalLaunchDetector {
  private readonly selfFireWindowMs: number;
  private readonly prevConnected = new Map<number, boolean>();
  private readonly selfClips = new Map<string, number>();
  private readonly selfCols = new Map<number, number>();

  constructor(selfFireWindowMs = 1500) {
    this.selfFireWindowMs = selfFireWindowMs;
  }

  /** Seed initial connected state for paramId without firing rising-edge events. */
  hydrate(paramId: number, connected: boolean): void {
    this.prevConnected.set(paramId, connected);
  }

  /** Record a self-fired clip trigger so its echo rising edge is suppressed within the window. */
  markSelfFiredClip(layer: number, col: number, nowMs: number): void {
    this.selfClips.set(`${layer}:${col}`, nowMs + this.selfFireWindowMs);
  }

  /** Record a self-fired column trigger so echo rising edges across layers in col are suppressed. */
  markSelfFiredColumn(col: number, nowMs: number): void {
    this.selfCols.set(col, nowMs + this.selfFireWindowMs);
  }

  /** Process a clip connected-parameter update and classify rising-edge / external status. */
  onClipParamUpdate(
    paramId: number,
    layer: number,
    col: number,
    connected: boolean,
    nowMs: number,
  ): ExternalDetectEvent {
    const prev = this.prevConnected.get(paramId) ?? false;
    this.prevConnected.set(paramId, connected);
    const risingEdge = !prev && connected;
    if (!risingEdge) return { external: false, risingEdge: false };

    const clipExp = this.selfClips.get(`${layer}:${col}`) ?? -Infinity;
    const colExp = this.selfCols.get(col) ?? -Infinity;
    if (nowMs <= clipExp || nowMs <= colExp) {
      return { external: false, risingEdge: true };
    }
    return { external: true, risingEdge: true };
  }

  /** Clear all tracked connection states and self-fire suppression windows. */
  reset(): void {
    this.prevConnected.clear();
    this.selfClips.clear();
    this.selfCols.clear();
  }
}

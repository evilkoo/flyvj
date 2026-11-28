// M3 renderer — Three.js scene host with HARD contracts:
//   (b) canvas backing store ≤1280×720 (clamped regardless of element CSS size)
//   (e) context-loss → full dispose + rebuild on restore (old M3C FAIL lesson, contract-ised)
//   SPEC §0.1: every geometry/material/renderer disposed; VRAM budget ≤ ~0.3–1GB (tiny primitives).
// The rig comes from a ModelSource (ADR 0007 seam): renderer never knows how the fly is built.

import * as THREE from "three";
import type { FlyRig, ModelSource } from "./model.ts";

export const CANVAS_MAX_W = 1280;
export const CANVAS_MAX_H = 720;

/**
 * Pure backing-store size math (contract (b)): CSS size × DPR, clamped so the result
 * never exceeds 1280×720. Exported for unit tests — no DOM involved.
 */
export function computeBackingSize(cssW: number, cssH: number, dpr: number): { w: number; h: number } {
  const w0 = Math.max(1, Math.round(cssW * dpr));
  const h0 = Math.max(1, Math.round(cssH * dpr));
  const scale = Math.min(1, CANVAS_MAX_W / w0, CANVAS_MAX_H / h0);
  return { w: Math.max(1, Math.round(w0 * scale)), h: Math.max(1, Math.round(h0 * scale)) };
}

export interface RendererState {
  running: boolean;
  rebuilds: number;          // context-loss rebuild counter (QC evidence)
  canvasW: number;
  canvasH: number;
  disposed: boolean;
}

export class FlyViewport {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private rig: FlyRig | null = null;
  private rafId: number | null = null;
  private clock = new THREE.Clock();
  private state: RendererState = { running: false, rebuilds: 0, canvasW: 0, canvasH: 0, disposed: false };
  private onFrame: ((tSeconds: number) => void) | null = null;
  private lostHandler: ((e: Event) => void) | null = null;
  private restoredHandler: (() => void) | null = null;
  private listenersAttached = false;
  /** Bands fed in from outside (audio sampler); renderer stays audio-agnostic. */
  private bands: { low: number; mid: number; high: number } = { low: 0, mid: 0, high: 0 };
  /** M4: drop pulse 0..1, decays exponentially (tau ≈ 350ms → gone in ~1s). Set by the
   * decision worker's dropPulse message; consumed by rig.pose() every frame. */
  private dropPulse = 0;
  private canvas: HTMLCanvasElement;
  private source: ModelSource;

  constructor(canvas: HTMLCanvasElement, source: ModelSource) {
    this.canvas = canvas;
    this.source = source;
  }

  getState(): Readonly<RendererState> { return { ...this.state }; }
  setBands(b: { low: number; mid: number; high: number }): void { this.bands = b; }
  /** M4: fire the full-body drop pulse (confirmed structure event). */
  fireDropPulse(): void { this.dropPulse = 1; }
  /** QC hook: current pulse value (evidence for contract 做#4). */
  getDropPulse(): number { return this.dropPulse; }
  setOnFrame(fn: (tSeconds: number) => void): void { this.onFrame = fn; }

  /** Build renderer + scene + rig and start the loop. Idempotent per generation. */
  start(): void {
    this.build();
    this.loop();
  }

  private build(): void {
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false, powerPreference: "default" });
    this.applyCanvasCap();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0a12);
    this.camera = new THREE.PerspectiveCamera(42, this.state.canvasW / this.state.canvasH, 0.1, 60);
    this.camera.position.set(1.6, 1.1, 3.4);
    this.camera.lookAt(0, 0, -0.2);

    // lights (cheap: 1 key directional + 1 fill ambient + 1 rim)
    this.scene.add(new THREE.AmbientLight(0x8899bb, 0.55));
    const key = new THREE.DirectionalLight(0xfff2dd, 1.6);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x4466ff, 0.7);
    rim.position.set(-4, 1, -3);
    this.scene.add(rim);

    // ground disc for depth cue
    const groundGeo = new THREE.CircleGeometry(3.2, 40);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x14141f, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.05;
    ground.name = "ground";
    this.scene.add(ground);

    this.rig = this.source.createRig();
    this.scene.add(this.rig.root);

    // context-loss contract (e): lost → dispose everything; restored → rebuild.
    // BUGFIX (M3 QC run 2): listeners were re-registered on every rebuild, so one loss
    // fired N restores. Register ONCE per canvas — handlers read `this.*` so they always
    // act on the current generation.
    if (!this.listenersAttached) {
      this.listenersAttached = true;
      this.lostHandler = (e: Event) => {
        e.preventDefault(); // signals we intend to restore
        this.state.running = false;
        this.teardownScene();
        // A lost WebGLRenderer is stale — dispose it; restoredHandler builds a fresh one.
        if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
        window.dispatchEvent(new CustomEvent("flyvj:contextlost"));
      };
      this.restoredHandler = () => {
        // Guard: only rebuild if we are actually torn down (renderer disposed by lostHandler).
        if (this.renderer !== null) return; // stale/duplicate restore event
        this.state.rebuilds += 1;
        this.build();
        this.loop();
        window.dispatchEvent(new CustomEvent("flyvj:contextrestored", { detail: { rebuilds: this.state.rebuilds } }));
      };
      this.canvas.addEventListener("webglcontextlost", this.lostHandler, false);
      this.canvas.addEventListener("webglcontextrestored", this.restoredHandler, false);
    }
  }

  /** Clamp backing store to ≤1280×720 (contract (b)) while keeping CSS size flexible. */
  private applyCanvasCap(): void {
    if (!this.renderer) return;
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width || 960);
    const cssH = Math.max(1, rect.height || 540);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = Math.round(cssW * dpr);
    let h = Math.round(cssH * dpr);
    const scale = Math.min(1, CANVAS_MAX_W / w, CANVAS_MAX_H / h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    this.renderer.setSize(w, h, false); // false = don't touch CSS style
    this.state.canvasW = w;
    this.state.canvasH = h;
    if (this.camera) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  }

  private loop(): void {
    if (this.state.running) return;
    this.state.running = true;
    this.state.disposed = false;
    this.clock.start();
    const tick = () => {
      if (!this.state.running || !this.renderer || !this.scene || !this.camera || !this.rig) return;
      this.rafId = requestAnimationFrame(tick);
      const t = this.clock.getElapsedTime();
      // M4: decay the drop pulse (tau ≈ 350ms → visually gone in ~1s); feed it to the rig.
      const pulse = this.dropPulse;
      if (pulse > 0) this.dropPulse = Math.max(0, pulse * Math.exp(-0.016 / 0.35));
      const pose = this.rig.pose(this.bands, t, pulse);
      this.rig.apply(pose);
      // idle turntable so the character reads as 3D even when silent
      this.rig.root.rotation.y = t * 0.25;
      this.renderer.render(this.scene, this.camera);
      this.onFrame?.(t);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  /** Dispose scene contents (rig + lights + ground) but keep the renderer (lost-context path). */
  private teardownScene(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    if (this.rig) { this.rig.dispose(); this.rig = null; }
    if (this.scene) {
      this.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) m?.dispose();
        }
      });
      this.scene.clear();
      this.scene = null;
    }
    this.camera = null;
  }

  /** Full teardown incl. renderer (page unload / manual stop). */
  dispose(): void {
    this.state.running = false;
    if (this.lostHandler) this.canvas.removeEventListener("webglcontextlost", this.lostHandler);
    if (this.restoredHandler) this.canvas.removeEventListener("webglcontextrestored", this.restoredHandler);
    this.teardownScene();
    if (this.renderer) { this.renderer.dispose(); this.renderer = null; }
    this.state.disposed = true;
  }

  /** QC hook: current backing-store size (contract (b) evidence). */
  canvasSize(): { w: number; h: number } { return { w: this.state.canvasW, h: this.state.canvasH }; }

  /** Re-check cap on window resize. */
  resize(): void { this.applyCanvasCap(); }
}

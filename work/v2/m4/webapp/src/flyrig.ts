// Procedural cartoon fruit fly — ModelSource #1 (M3_TICKET 做#1, ADR 0007).
// Built ENTIRELY from Three.js primitive geometry: zero external assets, zero textures,
// zero downloaded models → licensing 100% clean (no per-asset license audit needed).
// Cartoon style: big head, big red compound eyes, fuzzy amber thorax, striped abdomen,
// 6 jointed legs, 2 feathery antennae, 2 translucent iridescent wings.
// The rig maps FlyPose (src/model.ts) → part transforms. dispose() frees every
// geometry + material it created (SPEC §0.1: Three.js 資源必須 dispose).

import * as THREE from "three";
import { bandsToPose, type FlyPartName, type FlyPose, type FlyRig, type ModelSource } from "./model.ts";

const DEG = Math.PI / 180;

interface PartRefs {
  root: THREE.Group;
  body: THREE.Group;         // whole torso group (bob/squash target)
  head: THREE.Group;
  antennaL: THREE.Group;
  antennaR: THREE.Group;
  wingL: THREE.Group;
  wingR: THREE.Group;
  legs: Record<string, THREE.Group>;
}

/** Track every disposable we create so dispose() cannot leak. */
class Disposal {
  geometries = new Set<THREE.BufferGeometry>();
  materials = new Set<THREE.Material>();
  geo(g: THREE.BufferGeometry): THREE.BufferGeometry { this.geometries.add(g); return g; }
  mat(m: THREE.Material): THREE.Material { this.materials.add(m); return m; }
  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.geometries.clear();
    this.materials.clear();
  }
}

export function buildCartoonFly(): { rig: FlyRig; parts: PartRefs; disposal: Disposal } {
  const d = new Disposal();
  const partsByName = new Map<FlyPartName, THREE.Object3D>();

  const root = new THREE.Group();
  root.name = "fly-root";

  // ── materials (shared, cartoon-flat with a bit of shading) ───────────────
  const thoraxMat = d.mat(new THREE.MeshStandardMaterial({ color: 0xc8791e, roughness: 0.85, metalness: 0.0 }));
  const abdomenMat = d.mat(new THREE.MeshStandardMaterial({ color: 0x3a2a18, roughness: 0.8 }));
  const stripeMat = d.mat(new THREE.MeshStandardMaterial({ color: 0x1b140c, roughness: 0.8 }));
  const headMat = d.mat(new THREE.MeshStandardMaterial({ color: 0x2b2118, roughness: 0.7 }));
  const eyeMat = d.mat(new THREE.MeshStandardMaterial({ color: 0xd42a1e, roughness: 0.25, metalness: 0.1 }));
  const legMat = d.mat(new THREE.MeshStandardMaterial({ color: 0x181009, roughness: 0.9 }));
  const antennaMat = d.mat(new THREE.MeshStandardMaterial({ color: 0x2a1d12, roughness: 0.9 }));
  const wingMat = d.mat(new THREE.MeshPhysicalMaterial({
    color: 0xbfe8ff, roughness: 0.15, metalness: 0.0, transparent: true, opacity: 0.42,
    transmission: 0.0, side: THREE.DoubleSide, iridescence: 0.6, iridescenceIOR: 1.3,
  }));

  // ── body group (thorax + abdomen); bob/squash target for LOW ─────────────
  const body = new THREE.Group();
  body.name = "body";
  root.add(body);

  const thorax = new THREE.Mesh(d.geo(new THREE.SphereGeometry(0.62, 24, 18)), thoraxMat);
  thorax.scale.set(1.0, 0.9, 1.25);
  thorax.position.set(0, 0, 0);
  body.add(thorax);
  // fuzzy bristles: a few small cones on the thorax back (cartoon texture, still primitives)
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Mesh(d.geo(new THREE.ConeGeometry(0.05, 0.22, 6)), stripeMat);
    const a = (i / 7) * Math.PI * 2;
    b.position.set(Math.cos(a) * 0.45, 0.5, Math.sin(a) * 0.5);
    b.rotation.z = -Math.cos(a) * 0.5;
    body.add(b);
  }

  const abdomen = new THREE.Mesh(d.geo(new THREE.SphereGeometry(0.68, 24, 18)), abdomenMat);
  abdomen.scale.set(0.82, 0.78, 1.5);
  abdomen.position.set(0, -0.06, -0.95);
  body.add(abdomen);
  // abdomen stripes
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(d.geo(new THREE.TorusGeometry(0.5 - i * 0.06, 0.05, 8, 20)), stripeMat);
    s.rotation.x = Math.PI / 2;
    s.position.set(0, -0.06 + i * 0.02, -0.72 - i * 0.28);
    body.add(s);
  }

  // ── head group (MID nod/tilt) ────────────────────────────────────────────
  const head = new THREE.Group();
  head.name = "head";
  head.position.set(0, 0.12, 0.72);
  body.add(head);
  const skull = new THREE.Mesh(d.geo(new THREE.SphereGeometry(0.42, 24, 18)), headMat);
  skull.scale.set(1.0, 0.95, 0.9);
  head.add(skull);
  // big compound eyes
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(d.geo(new THREE.SphereGeometry(0.26, 20, 16)), eyeMat);
    eye.position.set(side * 0.26, 0.05, 0.18);
    eye.scale.set(0.9, 1.05, 0.9);
    head.add(eye);
    // glint
    const glint = new THREE.Mesh(d.geo(new THREE.SphereGeometry(0.06, 8, 8)), d.mat(new THREE.MeshBasicMaterial({ color: 0xffffff })));
    glint.position.set(side * 0.2, 0.16, 0.36);
    head.add(glint);
  }
  // proboscis (cartoon snout)
  const snout = new THREE.Mesh(d.geo(new THREE.ConeGeometry(0.12, 0.3, 10)), headMat);
  snout.position.set(0, -0.22, 0.3);
  snout.rotation.x = 100 * DEG;
  head.add(snout);

  // ── antennae (MID sweep), pivoted at the head front ──────────────────────
  const mkAntenna = (side: number, name: FlyPartName): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(side * 0.12, 0.1, 0.42);
    const stalk = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(0.03, 0.05, 0.32, 8)), antennaMat);
    stalk.position.set(0, 0.16, 0.05);
    stalk.rotation.x = -30 * DEG;
    g.add(stalk);
    // feathery arista: small sphere + a thin rod
    const knob = new THREE.Mesh(d.geo(new THREE.SphereGeometry(0.07, 10, 8)), antennaMat);
    knob.position.set(0, 0.32, 0.1);
    g.add(knob);
    const arista = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 5)), antennaMat);
    arista.position.set(side * 0.02, 0.5, 0.02);
    arista.rotation.z = side * -18 * DEG;
    arista.rotation.x = -20 * DEG;
    g.add(arista);
    head.add(g);
    partsByName.set(name, g);
    return g;
  };
  const antennaL = mkAntenna(-1, "antennaL");
  const antennaR = mkAntenna(1, "antennaR");

  // ── wings (HIGH buzz-flap), pivoted at the thorax top-back ───────────────
  const mkWing = (side: number, name: FlyPartName): THREE.Group => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(side * 0.2, 0.5, -0.25);
    // elongated teardrop wing from a scaled sphere + a tapered plane-ish box
    const blade = new THREE.Mesh(d.geo(new THREE.SphereGeometry(0.5, 20, 14)), wingMat);
    blade.scale.set(0.28, 0.02, 1.7);
    blade.position.set(side * 0.25, 0, -0.55);
    g.add(blade);
    // vein
    const vein = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 5)), d.mat(new THREE.MeshBasicMaterial({ color: 0x88ccee })));
    vein.position.set(side * 0.25, 0.02, -0.6);
    vein.rotation.x = Math.PI / 2;
    g.add(vein);
    g.rotation.z = side * -12 * DEG; // rest angle, slightly open
    body.add(g);
    partsByName.set(name, g);
    return g;
  };
  const wingL = mkWing(-1, "wingL");
  const wingR = mkWing(1, "wingR");

  // ── legs (LOW kick tap), 3 pairs pivoted at the thorax underside ─────────
  const legs: Record<string, THREE.Group> = {};
  const legAnchors: Record<string, [number, number, number]> = {
    FL: [-0.42, -0.35, 0.45], FR: [0.42, -0.35, 0.45],
    ML: [-0.5, -0.4, 0.0], MR: [0.5, -0.4, 0.0],
    BL: [-0.42, -0.35, -0.45], BR: [0.42, -0.35, -0.45],
  };
  for (const [key, [x, y, z]] of Object.entries(legAnchors)) {
    const g = new THREE.Group();
    g.name = `leg${key}`;
    g.position.set(x, y, z);
    const side = x < 0 ? -1 : 1;
    // femur
    const femur = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(0.06, 0.05, 0.5, 8)), legMat);
    femur.position.set(side * 0.18, -0.18, 0);
    femur.rotation.z = side * 55 * DEG;
    g.add(femur);
    // tibia
    const tibia = new THREE.Mesh(d.geo(new THREE.CylinderGeometry(0.04, 0.03, 0.55, 8)), legMat);
    tibia.position.set(side * 0.4, -0.5, 0);
    tibia.rotation.z = side * 12 * DEG;
    g.add(tibia);
    // foot
    const foot = new THREE.Mesh(d.geo(new THREE.SphereGeometry(0.06, 8, 6)), legMat);
    foot.position.set(side * 0.44, -0.76, 0);
    g.add(foot);
    body.add(g);
    legs[key] = g;
    partsByName.set(`leg${key}` as FlyPartName, g);
  }

  partsByName.set("body", body);
  partsByName.set("head", head);

  // ── rest transforms captured so apply() is idempotent (pose 0 = rest) ─────
  const rest = {
    wingLz: wingL.rotation.z, wingRz: wingR.rotation.z,
    antennaLx: antennaL.rotation.x, antennaRx: antennaR.rotation.x,
  };

  const rig: FlyRig = {
    root,
    pose: (bands, t, dropPulse) => bandsToPose(bands, t, dropPulse),
    apply(pose: FlyPose) {
      // M4 drop pulse → full-body big motion: jump + spin burst + wing spread.
      // dp decays 1→0 over ~1s (renderer owns the decay); all transforms stay bounded.
      const dp = pose.dropPulse;
      // LOW → body bob + squash (+ drop jump)
      body.position.y = pose.body * 0.18 + dp * 0.55 * Math.abs(Math.sin(pose.t * 10));
      const sq = 1 - pose.body * 0.06 - dp * 0.08;
      body.scale.set(1 / Math.sqrt(Math.max(0.5, sq)), Math.max(0.5, sq), 1 / Math.sqrt(Math.max(0.5, sq)));
      // LOW → leg taps (rotate each leg about its anchor); drop = big synchronized spread
      for (const [key, g] of Object.entries(legs)) {
        const amt = pose.legs[key as keyof typeof pose.legs];
        const side = legAnchors[key][0] < 0 ? -1 : 1;
        g.rotation.x = -amt * 0.5 - dp * side * 0.4;
        g.rotation.z = side * (amt * 0.18 + dp * 0.5);
      }
      // MID → head nod/tilt (+ drop: excited shake)
      head.rotation.x = pose.head * 0.35 + dp * 0.3 * Math.sin(pose.t * 22);
      head.rotation.z = Math.sin(pose.t * 5) * pose.head * 0.12 + dp * 0.25 * Math.sin(pose.t * 17);
      // MID → antenna sweep (+ drop: thrown back)
      antennaL.rotation.x = rest.antennaLx - pose.antennaL * 0.6 - dp * 0.7;
      antennaR.rotation.x = rest.antennaRx - pose.antennaR * 0.6 - dp * 0.7;
      antennaL.rotation.z = -pose.antennaL * 0.25 - dp * 0.3;
      antennaR.rotation.z = pose.antennaR * 0.25 + dp * 0.3;
      // HIGH → wing buzz (fast oscillation scaled by HIGH energy); drop = full spread flap
      const flap = Math.sin(pose.t * 60) * (0.15 + pose.wingL * 1.1 + dp * 0.9);
      wingL.rotation.z = rest.wingLz + flap;
      wingR.rotation.z = rest.wingRz - flap;
      wingL.rotation.x = pose.wingL * 0.25 * Math.sin(pose.t * 40) - dp * 0.5;
      wingR.rotation.x = -pose.wingL * 0.25 * Math.sin(pose.t * 40) + dp * 0.5;
      // root: drop burst spin + hop (whole-body, visible from any camera angle)
      root.rotation.z = dp * 0.18 * Math.sin(pose.t * 14);
      root.position.y = dp * 0.35 * Math.abs(Math.sin(pose.t * 9));
    },
    dispose() { d.dispose(); },
    part: (name) => partsByName.get(name),
  };

  return { rig, parts: { root, body, head, antennaL, antennaR, wingL, wingR, legs }, disposal: d };
}

export const cartoonFlySource: ModelSource = {
  id: "procedural-cartoon-fly-v1",
  label: "程序化卡通果蠅 (Three.js primitives, zero assets)",
  createRig: () => buildCartoonFly().rig,
};

// Worker contract test — main.ts ⇄ decision.worker.ts message contract, exercised
// end-to-end in Node. Stubs globalThis.self (postMessage collector + onmessage hook)
// before dynamically importing the worker module; the same math runs here as in the
// browser because detector/decision/capture are pure modules. Erasable-syntax-only;
// zero DOM globals; session fit is asserted via the worker's own match/count fields.

import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkerInMsg } from "../src/decision.worker.ts";
import type { BandEnergy } from "../src/dsp.ts";

type OutMsg = Record<string, unknown>;
type Handler = (e: { data: unknown }) => void;
type SessionPair = { trained: boolean; cell: { row: number; col: number } | null };

interface SelfStub {
  postMessage: (m: OutMsg) => void;
  onmessage: Handler | null;
}

const posted: OutMsg[] = [];
const selfStub: SelfStub = {
  postMessage: (m) => { posted.push(m); },
  onmessage: null,
};

function send(msg: WorkerInMsg): void {
  assert.ok(selfStub.onmessage, "worker module installed self.onmessage on the stub");
  selfStub.onmessage({ data: msg });
}

async function ensureWorkerLoaded(): Promise<void> {
  if (selfStub.onmessage) return;
  const globalScope = globalThis as { self?: unknown };
  const originalSelf = globalScope.self;
  globalScope.self = selfStub;
  try {
    await import("../src/decision.worker.ts");
  } finally {
    globalScope.self = originalSelf;
  }
}

function msgsOf(kind: string): OutMsg[] {
  return posted.filter((m) => m.kind === kind);
}

function lastOf(kind: string): OutMsg {
  const found = msgsOf(kind);
  assert.ok(found.length > 0, `expected at least one "${kind}" message, got 0`);
  return found[found.length - 1];
}

function snapshotSession(m: OutMsg): SessionPair[] {
  const session = m.session;
  assert.ok(Array.isArray(session), `expected session array on "${String(m.kind)}"`);
  return JSON.parse(JSON.stringify(session)) as SessionPair[];
}

test("decision.worker in/out message contract end-to-end", async () => {
  const globalScope = globalThis as { self?: unknown };
  const originalSelf = globalScope.self;
  globalScope.self = selfStub;
  try {
    await import("../src/decision.worker.ts");
  } finally {
    globalScope.self = originalSelf;
  }

  // (1) gated band samples (~16ms cadence) advance detector time; probe lastSampleT
  //     via setTriggerMode, which posts state unconditionally.
  const bands: BandEnergy = { low: 0.6, mid: 0.3, high: 0.15 };
  const sampleTs = [100, 116, 132, 148, 164, 180];
  for (const tMs of sampleTs) send({ type: "sample", tMs, bands, raw: bands });
  const statesAfterSamples = msgsOf("state");
  assert.ok(statesAfterSamples.length >= 1, "sample should post throttled state");
  send({ type: "setTriggerMode", mode: "clip" });
  const probe = lastOf("state") as { state: { tMs: number } };
  assert.equal(probe.state.tMs, sampleTs[sampleTs.length - 1]);
  assert.ok(probe.state.tMs > 0, "lastSampleT must advance past 0");

  // (2) REC on → capture-state recording:true
  send({ type: "setRecording", enabled: true });
  const recOn = lastOf("capture-state") as { recording: boolean; total: number };
  assert.equal(recOn.recording, true);
  assert.equal(recOn.total, 0);

  // (3) external Arena launches: 1 mapped cell + 1 unmapped (semanticCell null)
  send({ type: "captureExternal", physical: { layer: 1, col: 1 }, semanticCell: { row: 1, col: 1 }, tMs: 200, wall: 1 });
  send({ type: "captureExternal", physical: { layer: 2, col: 3 }, semanticCell: null, tMs: 220, wall: 2 });
  const captured = lastOf("capture-state") as {
    total: number; trainableCount: number; unmappedCount: number; trainedCount: number;
  };
  assert.equal(captured.total, 2);
  assert.equal(captured.trainableCount, 1);
  assert.equal(captured.unmappedCount, 1);
  assert.equal(captured.trainedCount, 0);

  // (4) live cockpit override while REC → recorded trained:true (already learned live,
  //     so trainCapture must not double-train: trainableCount stays 1)
  send({ type: "override", cell: { row: 2, col: 2 }, tMs: 240, physical: { layer: 2, col: 2 }, denied: null });
  const afterOverride = lastOf("capture-state") as {
    total: number; trainableCount: number; unmappedCount: number; trainedCount: number;
  };
  assert.equal(afterOverride.total, 3);
  assert.equal(afterOverride.trainedCount, 1);
  assert.equal(afterOverride.trainableCount, 1, "live override must not re-enter the trainable pool");
  assert.equal(snapshotSession(lastOf("capture-state")).filter((p) => p.trained).length, 1);

  // (5) trainCapture → exactly 1 trained pair, rollback armed, weights posted with
  //     increased learnCount
  const weightsBeforeTrain = (lastOf("weights") as { weights: number[]; learnCount: number }).weights.slice();
  const learnCountBeforeTrain = (lastOf("weights") as { learnCount: number }).learnCount;
  const weightsMsgsBeforeTrain = msgsOf("weights").length;
  send({ type: "trainCapture" });
  assert.ok(msgsOf("weights").length > weightsMsgsBeforeTrain, "trainCapture must post weights");
  const trained = lastOf("train-result") as { result: { trainedCount: number }; canRollback: boolean };
  assert.equal(trained.result.trainedCount, 1);
  assert.equal(trained.canRollback, true);
  const weightsAfterTrain = lastOf("weights") as { learnCount: number };
  assert.ok(weightsAfterTrain.learnCount > learnCountBeforeTrain, "batch train must increase learnCount");

  // (6) rollbackTrain → ok:true, weights restored to pre-train snapshot, the batch
  //     pair leaves the trained pool (trainableCount back to 1)
  send({ type: "rollbackTrain" });
  const rollback = lastOf("train-rollback") as { ok: boolean };
  assert.equal(rollback.ok, true);
  const weightsAfterRollback = lastOf("weights") as { weights: number[] };
  assert.deepEqual(weightsAfterRollback.weights, weightsBeforeTrain);
  const sessionAfterRollback = snapshotSession(rollback);
  assert.equal(sessionAfterRollback.filter((p) => !p.trained && p.cell !== null).length, 1);
  assert.equal(sessionAfterRollback.filter((p) => p.trained).length, 1);

  // (7) clearCapture → session emptied
  send({ type: "clearCapture" });
  const cleared = lastOf("capture-state") as { total: number; trainableCount: number; canRollback: boolean };
  assert.equal(cleared.total, 0);
  assert.equal(cleared.trainableCount, 0);
  assert.equal(cleared.canRollback, false);
});

test("reset unfreezes state emission when the song clock restarts", async () => {
  await ensureWorkerLoaded();
  const bands: BandEnergy = { low: 0.6, mid: 0.3, high: 0.15 };

  // Advance the song clock past 50s so the 100ms state throttle is anchored far ahead
  // of any restarted clock (regression: lastStatePost survived `reset`).
  for (let tMs = 50000; tMs <= 50200; tMs += 100) send({ type: "sample", tMs, bands, raw: bands });
  const beforeReset = lastOf("state") as { state: { tMs: number } };
  assert.ok(beforeReset.state.tMs >= 50000, "state emission must advance past 50s before reset");

  send({ type: "reset" });
  const stateCountBefore = msgsOf("state").length;

  for (let tMs = 100; tMs <= 260; tMs += 16) send({ type: "sample", tMs, bands, raw: bands });

  const afterReset = msgsOf("state").slice(stateCountBefore) as { state: { tMs: number } }[];
  assert.ok(
    afterReset.some((m) => m.state.tMs >= 100 && m.state.tMs <= 260),
    "reset must unfreeze state emission on the restarted song clock (expected a state with tMs 100..260)",
  );
});

test("C1 contract: chroma samples + semantic frames populate state.content; reset clears it", async () => {
  await ensureWorkerLoaded();
  send({ type: "reset" });
  send({ type: "auto", tMs: 0 }); // master may still be OVERRIDE from the earlier override test
  const bands: BandEnergy = { low: 0.6, mid: 0.3, high: 0.15 };
  const chroma = new Array<number>(12).fill(1 / 12);
  for (let i = 0; i < 8; i++) {
    send({ type: "sample", tMs: 100 + i * 16, bands, raw: bands, chroma });
  }
  send({ type: "setTriggerMode", mode: "clip" });
  const st0 = lastOf("state") as {
    content: { chromaNovelty: number; yamnetReady: boolean; lastCue: string | null };
  };
  assert.ok(st0.content, "state must carry the C1 content snapshot");
  assert.equal(typeof st0.content.chromaNovelty, "number");
  assert.equal(st0.content.yamnetReady, false);
  assert.equal(st0.content.lastCue, null);

  const decisionsBefore = msgsOf("decision").length;
  send({
    type: "semantic",
    frame: {
      tMs: 300, ready: true, music: 0.85, electronic: 0.05, vocalChant: 0.7, drums: 0.1,
      silence: 0.02, yamnetNovelty: 0.1, topClass: "Singing", inferMs: 25,
    },
  });
  assert.equal(msgsOf("decision").length, decisionsBefore + 1, "vocal entry must post a decision");
  const dec = lastOf("decision") as { decision: { kind: string; reason: string } };
  assert.equal(dec.decision.kind, "trigger");
  assert.match(dec.decision.reason, /VOCAL\/CHANT entry/);
  const st1 = lastOf("state") as {
    content: { vocalActive: boolean; lastCue: string | null; topClass: string; musicProb: number };
  };
  assert.equal(st1.content.vocalActive, true);
  assert.equal(st1.content.lastCue, "vocal-entry");
  assert.equal(st1.content.topClass, "Singing");
  assert.equal(st1.content.musicProb, 0.85);

  send({ type: "reset" });
  send({ type: "setTriggerMode", mode: "clip" });
  const st2 = lastOf("state") as {
    content: {
      vocalActive: boolean; inBreakdown: boolean; lastCue: string | null;
      chromaNovelty: number; yamnetReady: boolean;
    };
  };
  assert.equal(st2.content.vocalActive, false);
  assert.equal(st2.content.inBreakdown, false);
  assert.equal(st2.content.lastCue, null);
  assert.equal(st2.content.chromaNovelty, 0);
  assert.equal(st2.content.yamnetReady, false);
});

test("M4.8: BUILD-UP auto-triggers a Col 3 ACTIVE decision when cooled down, OVERRIDE suppresses it", async () => {
  await ensureWorkerLoaded();
  send({ type: "reset" });
  send({ type: "resetWeights" }); // isolate from learning done by the earlier override tests
  send({ type: "auto", tMs: 0 });

  const STEP = 16;
  let rollPhase = 0;
  // Groove 2/s → snare roll accelerating ×1.17/s + HIGH riser 0.04→0.09 (bass-cut free, so
  // no C1 breakdown cue races the build-up). Detector fires BUILD-UP ~12.5s.
  const buildupBands = (t: number): BandEnergy => {
    if (t < 5000) {
      return { low: 0.45, mid: 0.12 + (t % 512 < STEP ? 0.25 : 0), high: 0.04 };
    }
    const rate = 3.5 * Math.pow(1.17, (t - 5000) / 1000);
    rollPhase += (STEP * rate) / 1000;
    let spike = 0;
    if (rollPhase >= 1) {
      rollPhase -= 1;
      spike = 0.25;
    }
    const high = 0.04 + 0.05 * Math.min(1, (t - 5000) / 4000);
    return { low: 0.45, mid: 0.12 + spike, high };
  };

  type DecMsg = {
    decision: {
      kind: string;
      cell: { row: number; col: number } | null;
      event: { type: string } | null;
      reason: string;
    };
  };
  const decisionsFrom = (start: number): DecMsg["decision"][] =>
    (posted.slice(start).filter((m) => m.kind === "decision") as unknown as DecMsg[]).map((m) => m.decision);

  const firstStart = posted.length;
  for (let t = 0; t <= 14000; t += STEP) {
    const bands = buildupBands(t);
    send({ type: "sample", tMs: t, bands, raw: bands });
  }
  const firstDecs = decisionsFrom(firstStart);
  const buildupTriggers = firstDecs.filter((d) => d.kind === "trigger" && d.event?.type === "buildup");
  assert.ok(
    buildupTriggers.length >= 1,
    `AUTO + cooled down must TRIGGER the build-up (got ${JSON.stringify(firstDecs.map((d) => `${d.kind}:${d.reason}`))})`,
  );
  assert.equal(buildupTriggers[0].cell?.col, 3, "build-up lands in the ACTIVE (Col 3) tier");

  const st = lastOf("state") as {
    content: { hiHatActive: unknown; effectiveDensity: unknown };
  };
  assert.ok(st.content, "state must carry the C1 snapshot");
  assert.equal(typeof st.content.hiHatActive, "boolean");
  assert.equal(typeof st.content.effectiveDensity, "number");

  // OVERRIDE: the same build-up must post the suppressed hold, never an auto trigger.
  send({ type: "override", cell: { row: 1, col: 1 }, tMs: 14000 });
  send({ type: "resetWeights" }); // the override above just learned on the live KC code
  send({ type: "reset" });
  rollPhase = 0;
  const secondStart = posted.length;
  for (let t = 0; t <= 14000; t += STEP) {
    const bands = buildupBands(t);
    send({ type: "sample", tMs: t, bands, raw: bands });
  }
  const secondDecs = decisionsFrom(secondStart);
  assert.equal(
    secondDecs.filter((d) => d.kind === "trigger" && d.event?.type === "buildup").length,
    0,
    "OVERRIDE must not auto-trigger the build-up",
  );
  assert.ok(
    secondDecs.some((d) => d.kind === "hold" && /SUPPRESSED \(OVERRIDE\)/.test(d.reason)),
    "OVERRIDE build-up posts the suppressed hold",
  );
  send({ type: "auto", tMs: 14000 });
});

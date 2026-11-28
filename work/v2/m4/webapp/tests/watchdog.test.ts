import { test } from "node:test";
import assert from "node:assert/strict";
import { Watchdog } from "../src/watchdog.ts";

/** Minimal fake timer queue so the watchdog is tested deterministically (no real sleeping). */
function makeClock() {
  let t = 0;
  let seq = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimeoutFn: (fn: () => void, ms: number) => { const id = seq++; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimeoutFn: (id: unknown) => { timers.delete(id as number); },
    /** Advance time, firing due timers in order (re-entrant safe for nested schedules). */
    advance(ms: number) {
      const target = t + ms;
      for (;;) {
        let nextId = -1; let nextAt = Infinity;
        for (const [id, tm] of timers) if (tm.at <= target && tm.at < nextAt) { nextAt = tm.at; nextId = id; }
        if (nextId < 0) break;
        const tm = timers.get(nextId)!; timers.delete(nextId); t = tm.at; tm.fn();
      }
      t = target;
    },
  };
}

function setup(over: Partial<ConstructorParameters<typeof Watchdog>[0]> = {}) {
  const clock = makeClock();
  const events: string[] = [];
  const wd = new Watchdog({
    triggerEchoTimeoutMs: 2000,
    heartbeatMs: 30000,
    maxStrikes: 3,
    now: clock.now,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    onRecover: (r) => events.push(`recover:${r}`),
    onError: (r) => events.push(`error:${r}`),
    onHeartbeat: () => events.push("heartbeat"),
    ...over,
  });
  return { clock, events, wd };
}

test("trigger with echo in time → no strike", () => {
  const { clock, events, wd } = setup();
  wd.start();
  wd.expectEcho();
  clock.advance(1000);
  wd.markLiveness("echo");
  clock.advance(3000);
  assert.deepEqual(events, []); // no recover, no error
  assert.equal(wd.getState().strikes, 0);
});

test("trigger with NO echo → strike + onRecover after triggerEchoTimeoutMs", () => {
  const { clock, events, wd } = setup();
  wd.start();
  wd.expectEcho();
  clock.advance(1999);
  assert.equal(events.length, 0, "not yet timed out");
  clock.advance(1);
  assert.equal(events.length, 1);
  assert.match(events[0], /^recover:no echo after trigger/);
  assert.equal(wd.getState().strikes, 1);
});

test("heartbeat fires every heartbeatMs and missing echo strikes", () => {
  const { clock, events, wd } = setup();
  wd.start();
  clock.advance(30_000);
  assert.deepEqual(events, ["heartbeat"]); // heartbeat issued, echo armed
  clock.advance(2000); // no reply → strike
  assert.equal(events.length, 2);
  assert.match(events[1], /^recover:no echo after heartbeat/);
});

test("heartbeat reply (markLiveness) cancels the pending strike", () => {
  const { clock, events, wd } = setup();
  wd.start();
  clock.advance(30_000);
  assert.deepEqual(events, ["heartbeat"]);
  wd.markLiveness("echo"); // reply arrived
  clock.advance(5000);
  assert.equal(events.length, 1, "no strike");
  assert.equal(wd.getState().strikes, 0);
});

// NOTE: fake heartbeatMs must be > triggerEchoTimeoutMs (real config: 30s vs 2s).
// Otherwise each heartbeat re-arms (clears) the pending echo and no strike can ever fire.
const FAST = { heartbeatMs: 1000, triggerEchoTimeoutMs: 500, maxStrikes: 3 } as const;

test("3 consecutive strikes → onError escalation; strikes survive restart (M1 dead-channel loop)", () => {
  const { clock, events, wd } = setup(FAST);
  const strikeOnce = () => { clock.advance(1000); clock.advance(500); }; // heartbeat → echo timeout
  wd.start();
  strikeOnce();
  assert.equal(wd.getState().strikes, 1);
  assert.equal(events.filter(e => e.startsWith("recover")).length, 1);
  wd.start(); // host reconnects → restart watchdog; strikes must NOT reset
  strikeOnce();
  assert.equal(wd.getState().strikes, 2, "strike 2 counted after restart");
  wd.start();
  strikeOnce();
  assert.equal(wd.getState().strikes, 3);
  assert.ok(events.some(e => e.startsWith("error:")), "onError fired at maxStrikes");
  assert.match(events.find(e => e.startsWith("error:"))!, /channel dead \(3 consecutive strikes\)/);
});

test("a real liveness signal resets accumulated strikes", () => {
  const { clock, wd } = setup(FAST);
  wd.start();
  clock.advance(1000); clock.advance(500); // strike 1
  assert.equal(wd.getState().strikes, 1);
  wd.markLiveness("state"); // composition state push after reconnect
  assert.equal(wd.getState().strikes, 0);
});

test("stop() prevents scheduled callbacks from firing", () => {
  const { clock, events, wd } = setup();
  wd.start();
  wd.stop();
  clock.advance(120_000);
  assert.deepEqual(events, [], "nothing fires after stop");
  assert.equal(wd.getState().running, false);
});

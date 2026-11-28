// M2 watchdog — solves M1 finding #1: the socket can stay `open` while the channel is
// effectively dead (trigger produces no echo, subscribe pushes stop) after Arena has run
// a long time with many connect/disconnect cycles. Detection = liveness, not readyState.
//
// Liveness signals (any one resets the clock):
//   - markEcho()   : a reply to something we sent (parameter_set / parameter_update …)
//   - markPush()   : an unsolicited parameter_update push
//   - markState()  : a composition state push
//
// Actions:
//   - after a trigger, expect an echo within triggerEchoTimeoutMs (default 2000);
//     missing → count a strike and reconnect.
//   - heartbeat: every heartbeatMs (default 30000) we ask the host to re-read the
//     composition (a request we can confirm) — if nothing at all comes back inside
//     triggerEchoTimeoutMs, that is also a strike.
//   - strikes reaching maxStrikes (default 3) → onError (report), but keep recovering.
//
// Erasable-syntax-only so `node --test` can run this .ts directly.

export interface WatchdogOptions {
  /** How long to wait for a reply to a trigger / heartbeat read before a strike. */
  triggerEchoTimeoutMs?: number;
  /** How often to issue a liveness read of the composition. */
  heartbeatMs?: number;
  /** Consecutive strikes before we escalate to onError. */
  maxStrikes?: number;
  /** Called when the watchdog decides the channel is dead: host must reconnect + resubscribe. */
  onRecover: (reason: string) => void;
  /** Called when strikes reach maxStrikes: host should surface a visible error. */
  onError?: (reason: string) => void;
  /** Issues a liveness read (host sends whatever request produces a confirmable reply). */
  onHeartbeat?: () => void;
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

export interface WatchdogState {
  strikes: number;
  lastLiveness: number;
  running: boolean;
}

export class Watchdog {
  private opts: Required<Pick<WatchdogOptions, "triggerEchoTimeoutMs" | "heartbeatMs" | "maxStrikes">> & WatchdogOptions;
  private nowFn: () => number;
  private setT: (fn: () => void, ms: number) => unknown;
  private clearT: (handle: unknown) => void;
  private heartbeatHandle: unknown = null;
  private echoHandle: unknown = null;
  private state: WatchdogState;
  /** Monotonic generation guard: callbacks from a stale generation must be ignored. */
  private generation = 0;

  constructor(opts: WatchdogOptions) {
    this.opts = {
      triggerEchoTimeoutMs: 2000,
      heartbeatMs: 30000,
      maxStrikes: 3,
      ...opts,
    } as WatchdogOptions & Required<Pick<WatchdogOptions, "triggerEchoTimeoutMs" | "heartbeatMs" | "maxStrikes">>;
    this.nowFn = opts.now ?? (() => Date.now());
    this.setT = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearT = opts.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.state = { strikes: 0, lastLiveness: this.nowFn(), running: false };
  }

  getState(): Readonly<WatchdogState> {
    return { ...this.state };
  }

  /**
   * Start (or restart after a reconnect) the heartbeat loop.
   * Strikes intentionally SURVIVE restarts: a dead channel that keeps dying right after
   * each reconnect must accumulate strikes until maxStrikes → onError. Only a real
   * liveness signal (markLiveness, e.g. the post-reconnect composition state push)
   * resets the counter.
   */
  start(): void {
    this.stop();
    this.generation++;
    this.state = { strikes: this.state.strikes, lastLiveness: this.nowFn(), running: true };
    const gen = this.generation;
    const schedule = () => {
      this.heartbeatHandle = this.setT(() => {
        if (gen !== this.generation || !this.state.running) return;
        this.opts.onHeartbeat?.();
        this.armEcho("heartbeat", gen);
        schedule();
      }, this.opts.heartbeatMs);
    };
    schedule();
  }

  /** Stop all timers (on socket close / manual teardown). Does NOT reset strike history. */
  stop(): void {
    this.generation++;
    this.state.running = false;
    if (this.heartbeatHandle !== null) this.clearT(this.heartbeatHandle);
    if (this.echoHandle !== null) this.clearT(this.echoHandle);
    this.heartbeatHandle = null;
    this.echoHandle = null;
  }

  /** Any liveness signal: resets the strike counter and the echo timer. */
  markLiveness(kind: "echo" | "push" | "state"): void {
    this.state.lastLiveness = this.nowFn();
    if (this.state.strikes !== 0) this.state.strikes = 0;
    if (kind === "echo" && this.echoHandle !== null) {
      this.clearT(this.echoHandle);
      this.echoHandle = null;
    }
  }

  /** Called right after we send a trigger: expect an echo within triggerEchoTimeoutMs. */
  expectEcho(): void {
    this.armEcho("trigger", this.generation);
  }

  private armEcho(reason: string, gen: number): void {
    if (this.echoHandle !== null) this.clearT(this.echoHandle);
    this.echoHandle = this.setT(() => {
      if (gen !== this.generation || !this.state.running) return;
      this.echoHandle = null;
      this.strike(`no echo after ${reason} within ${this.opts.triggerEchoTimeoutMs}ms`);
    }, this.opts.triggerEchoTimeoutMs);
  }

  private strike(reason: string): void {
    this.state.strikes++;
    const strikes = this.state.strikes;
    this.opts.onRecover(reason);
    if (strikes >= this.opts.maxStrikes) {
      this.opts.onError?.(`channel dead (${strikes} consecutive strikes): ${reason}`);
    }
  }
}

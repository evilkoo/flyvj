"""Private child entry point. Only this process imports/executes WinMM audio.

Use --list for query-only metadata; capture always requires --index N. The parent
contains this child in a kill-on-close Job before any Python code can run.
"""
import argparse
import json
import os
import threading
import sys
import time


class _ControlLease:
    """A child-owned, hard-exit deadline, independent of native IO and stdout.

    Windows Python 3.11 monotonic_ns uses the same system clock across processes.
    Pulses carry send time: queued old bytes never buy extra lease lifetime.
    """
    def __init__(self, stream, *, lease_seconds=4.0, hard_exit=None):
        if not isinstance(lease_seconds, (int, float)) or not 0 < lease_seconds <= 6:
            raise ValueError('Child lease must be positive and <=6 seconds')
        self.stream = stream
        self._exit = hard_exit if hard_exit is not None else os._exit
        self._lease_ns = int(lease_seconds*1_000_000_000)
        self._deadline = time.monotonic_ns()+self._lease_ns
        self._last_stamp = -1
        self._lock = threading.Lock()
        self._stopped = threading.Event()
        self._dead = threading.Event()
        self._ready = threading.Event()

    def _die(self):
        with self._lock:
            if self._dead.is_set() or self._stopped.is_set():
                return
            self._dead.set()
            self._ready.set()
        # No native close, Python finally, output flush or logging on this path.
        self._exit(74)

    def start(self):
        try:
            threading.Thread(target=self._watch, daemon=True, name='KinectControlDeadline').start()
            threading.Thread(target=self._read, daemon=True, name='KinectControlInput').start()
        except Exception:
            self._die()

    def wait_ready(self):
        self._ready.wait()
        if self._dead.is_set():
            raise RuntimeError('Parent control lease lost')

    def _watch(self):
        while not self._stopped.is_set() and not self._dead.is_set():
            with self._lock:
                remaining = (self._deadline-time.monotonic_ns())/1_000_000_000
            if remaining <= 0:
                self._die()
                return
            self._stopped.wait(min(.01, remaining))

    def _read(self):
        from .kinect_process import MAX_CONTROL_LINE
        try:
            while not self._stopped.is_set() and not self._dead.is_set():
                raw = self.stream.readline(MAX_CONTROL_LINE+1)
                if self._stopped.is_set():
                    return
                if (not isinstance(raw, bytes) or not raw or len(raw) > MAX_CONTROL_LINE
                        or not raw.startswith(b'K1 ') or not raw.endswith(b'\n')
                        or not 1 <= len(raw[3:-1]) <= 20 or not raw[3:-1].isdigit()):
                    self._die()
                    return
                stamp = int(raw[3:-1])
                now = time.monotonic_ns()
                with self._lock:
                    invalid = (now >= self._deadline or stamp > now
                               or stamp <= self._last_stamp or stamp+self._lease_ns <= now)
                    if not invalid:
                        self._last_stamp = stamp
                        self._deadline = stamp+self._lease_ns
                if invalid:
                    self._die()
                    return
                self._ready.set()
        except Exception:
            self._die()

    def stop(self):
        self._stopped.set()


def _emit(message, output):
    raw = (json.dumps(message, allow_nan=False, separators=(',', ':'))+'\n').encode('utf-8')
    if len(raw) > 8192:
        raise ValueError('Aggregate exceeds protocol limit')
    output.write(raw)
    output.flush()


def main(argv=None, *, capture_factory=None, enumerate_devices=None, output=None, sleep=time.sleep,
         control_input=None, hard_exit=None, control_lease_seconds=None):
    parser = argparse.ArgumentParser(description='Owned Azure Kinect worker')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--list', action='store_true')
    mode.add_argument('--index', type=int)
    args = parser.parse_args(argv)
    if args.index is not None and not 0 <= args.index < 0xFFFFFFFF:
        parser.error('Explicit non-mapper device index required')
    output = output if output is not None else sys.stdout.buffer
    from .kinect_process import _devices, _validate_snapshot, CONTROL_LEASE_SECONDS
    control_input = control_input if control_input is not None else sys.stdin.buffer
    lease = _ControlLease(control_input,
        lease_seconds=CONTROL_LEASE_SECONDS if control_lease_seconds is None else control_lease_seconds,
        hard_exit=hard_exit)
    capture = None
    lease.start()  # BEFORE driver import, enumeration, native open, or any stdout operation
    try:
        lease.wait_ready()  # no native work without a fresh parent heartbeat
        if capture_factory is None or enumerate_devices is None:
            from .kinect import KinectCapture, enumerate_kinect_devices
            capture_factory = capture_factory or KinectCapture
            enumerate_devices = enumerate_devices or enumerate_kinect_devices
        if args.list:
            # No capture object is constructed and start is never called in query mode.
            _emit({'kind':'devices', 'devices':_devices(enumerate_devices())}, output)
            return 0
        capture = capture_factory()
        snap = _validate_snapshot(capture.start(args.index), args.index, ready=True)
        _emit({'kind':'ready', 'snapshot':snap}, output)
        while True:
            sleep(.05)
            snap = _validate_snapshot(capture.snapshot(), args.index)
            if snap['state'] != 'running' or not snap['active'] or snap['error'] is not None:
                raise RuntimeError('Native capture failed')
            _emit({'kind':'status', 'snapshot':snap}, output)
    except Exception:
        try:
            # Never serialize native exceptions, raw data, credentials or diagnostics.
            _emit({'kind':'error', 'error':'Native worker failed'}, output)
        except Exception:
            pass
        return 1
    finally:
        if capture is not None:
            # May block on a faulty driver; the parent deadline then kills this Job.
            try:
                capture.stop()
            except Exception:
                pass
        lease.stop()  # never disarm before potentially blocked native close returns


if __name__ == '__main__':
    raise SystemExit(main())
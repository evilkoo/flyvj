"""Bounded parent-side supervision of isolated Azure Kinect WinMM workers.

This module never imports the audio driver or loads WinMM. Only owned suspended
children may run it, after attachment to a kill-on-close Windows Job.
"""
import copy
from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import subprocess
import threading
import time

from flyvj_m0.windows_job import OwnedWindowsJob

PROCESS_CAPTURE_API = 1
ISOLATED_NATIVE_AUDIO = True
SUPPORTS_CANCEL_EVENT = True
CONTROL_HEARTBEAT_INTERVAL = 0.5
CONTROL_LEASE_SECONDS = 4.0
MAX_CONTROL_LINE = 64
MAX_LINE = 8192
PYTHON311 = r'C:\Users\evilkoo\AppData\Local\Programs\Python\Python311\python.exe'
CREATE_SUSPENDED = 0x00000004
CREATE_NO_WINDOW = 0x08000000


class KinectError(RuntimeError):
    """Process supervision/protocol failure, not proof the microphone is off."""


def _blank(state='off', active=False, error=None, device=None):
    return dict(state=state, active=active, device=device, time=0., rms=0.,
                bands=dict(low=0., mid=0., high=0.), clipping=False,
                sample_rate=48000, frame_size=2048, frames=0, error=error)


def _index(value):
    return type(value) is int and 0 <= value < 0xFFFFFFFF


def _device(value):
    if (not isinstance(value, dict) or set(value) != {'index', 'name'}
            or not _index(value['index']) or not isinstance(value['name'], str)
            or not 0 < len(value['name']) <= 256
            or 'azure kinect' not in value['name'].casefold()
            or any(ord(c) < 32 for c in value['name'])):
        raise KinectError('Invalid Azure Kinect identity')
    return dict(value)


def _devices(value):
    if not isinstance(value, list) or len(value) > 64:
        raise KinectError('Invalid device list')
    result = [_device(item) for item in value]
    if len({d['index'] for d in result}) != len(result):
        raise KinectError('Duplicate device indices')
    return result


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise KinectError('Duplicate JSON key')
        result[key] = value
    return result


def _reject_constant(value):
    raise KinectError('Nonfinite JSON number')


def _number(value, minimum, maximum):
    return type(value) in (int, float) and math.isfinite(value) and minimum <= value <= maximum


def _validate_snapshot(value, index, ready=False):
    if not isinstance(value, dict) or set(value) != set(_blank()):
        raise KinectError('Invalid aggregate fields')
    s = copy.deepcopy(value)
    device = _device(s['device'])
    if device['index'] != index:
        raise KinectError('Worker acknowledged a different device')
    if (s['state'] not in ('running', 'error', 'off') or type(s['active']) is not bool
            or type(s['clipping']) is not bool or type(s['sample_rate']) is not int
            or s['sample_rate'] != 48000 or type(s['frame_size']) is not int
            or s['frame_size'] != 2048 or type(s['frames']) is not int
            or not 0 <= s['frames'] <= 2**40
            or not _number(s['time'], 0, 2**40)
            or not math.isclose(s['time'], s['frames']*2048/48000, rel_tol=0, abs_tol=1e-7)
            or not _number(s['rms'], 0, 1)
            or not isinstance(s['bands'], dict) or set(s['bands']) != {'low', 'mid', 'high'}
            or not all(_number(v, 0, 1) for v in s['bands'].values())
            or not (s['error'] is None or (isinstance(s['error'], str) and len(s['error']) <= 512))):
        raise KinectError('Invalid aggregate values or sample clock')
    if ready and (s['state'] != 'running' or not s['active'] or s['error'] is not None):
        raise KinectError('Worker did not acknowledge active capture')
    return s


@dataclass(eq=False)
class _Owner:
    job: object
    mode: str
    index: object
    process: object = None
    exited: threading.Event = field(default_factory=threading.Event)
    job_close_started: bool = False
    terminate_started: bool = False
    control_stop: threading.Event = field(default_factory=threading.Event)
    cleanup_launch_error: object = None
    reader_started: bool = False
    message: object = None
    fault: object = None
    last_packet: float = 0.
    last_progress: float = 0.
    ready_seen: bool = False
    last_frames: int = 0
    identity: object = None


@dataclass(eq=False)
class _Session:
    generation: int
    mode: str
    index: object
    deadline: float
    cancel_event: object = None
    owners: list = field(default_factory=list)
    cancelled: threading.Event = field(default_factory=threading.Event)
    ready: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)
    result: object = None
    error: object = None


class _ResumeGate:
    """Per-owned-Job API proxy; never patches the shared M0 implementation.

    OwnedWindowsJob combines attachment/thread discovery/resume in one method.
    Recheck the session at its actual ResumeThread boundary as well as before
    calling attach_and_resume; cancellation during attachment cannot be ignored.
    """
    def __init__(self, api, check):
        self._api, self._check = api, check

    def __getattr__(self, name):
        return getattr(self._api, name)

    def ResumeThread(self, thread_handle):
        self._check()
        return self._api.ResumeThread(thread_handle)


class KinectProcessCapture:
    ISOLATED_NATIVE_AUDIO = True
    PROCESS_CAPTURE_API = 1
    SUPPORTS_CANCEL_EVENT = True

    def __init__(self, *, popen_factory=None, job_factory=None, python_executable=None,
                 query_timeout=2., start_timeout=3., stop_timeout=1., heartbeat_timeout=1., sample_timeout=2.):
        self._popen = popen_factory or subprocess.Popen
        self._job_factory = job_factory or OwnedWindowsJob
        self._python = python_executable or PYTHON311
        for value in (query_timeout, start_timeout, stop_timeout, heartbeat_timeout, sample_timeout):
            if not _number(value, .001, 60):
                raise ValueError('Timeouts must be finite and between .001 and 60 seconds')
        self.query_timeout, self.start_timeout = query_timeout, start_timeout
        self.stop_timeout, self.heartbeat_timeout = stop_timeout, heartbeat_timeout
        self.sample_timeout = sample_timeout
        self._lock = threading.Lock()
        self._generation = 0
        self._current = None
        self._queries = set()
        self._closed = False
        self._snapshot = _blank()

    @staticmethod
    def _thread(target, *args):
        thread = threading.Thread(target=target, args=args, daemon=True,
                                  name='KinectProcessSupervisor')
        thread.start()
        return thread

    @staticmethod
    def _token_cancelled(s):
        return s.cancelled.is_set() or (s.cancel_event is not None and s.cancel_event.is_set())

    def _require_live(self, s, stage):
        if s.cancel_event is not None and s.cancel_event.is_set():
            self._cancel(s, 'Manager reservation cancelled: '+stage)
        if s.cancelled.is_set():
            raise KinectError(s.error or 'Session cancelled: '+stage)

    def _watch_cancel(self, s):
        # A root observer, independent of blocked Popen/Job attachment/pipe IO
        # and of the caller returning after ACK. It never acquires manager locks.
        while not s.finished.is_set():
            if s.cancel_event.is_set():
                self._cancel(s, 'Manager reservation cancelled')
                return
            s.finished.wait(.005)

    def _new_session(self, mode, index, timeout, cancel_event=None):
        with self._lock:
            if cancel_event is not None and cancel_event.is_set():
                raise KinectError('Manager reservation was already cancelled')
            if self._closed:
                raise KinectError('Capture supervisor is shut down')
            if mode == 'capture' and self._current and not self._current.finished.is_set():
                raise KinectError('Previous capture ownership is still unresolved')
            if mode == 'list' and self._queries:
                raise KinectError('Previous device query ownership is still unresolved')
            self._generation += 1
            s = _Session(self._generation, mode, index, time.monotonic()+timeout, cancel_event=cancel_event)
            if mode == 'capture':
                self._current = s
                self._snapshot = _blank('error', True, 'Capture start pending; child exit unconfirmed')
            else:
                self._queries.add(s)
        try:
            if cancel_event is not None:
                self._thread(self._watch_cancel, s)
            self._thread(self._launch, s)
        except Exception as exc:
            with self._lock:
                s.error = 'Cannot start supervisor thread'
                s.finished.set()
                self._queries.discard(s)
                if self._current is s:
                    self._snapshot = _blank('error', False, s.error)
            raise KinectError(s.error) from exc
        return s

    def list_devices(self):
        s = self._new_session('list', None, self.query_timeout)
        if not s.finished.wait(max(0., s.deadline-time.monotonic())):
            self._cancel(s, 'Device query timed out')
            raise KinectError('Device query timed out')
        if s.error or s.result is None:
            raise KinectError(s.error or 'Device query cancelled')
        return copy.deepcopy(s.result)

    def start(self, index=None, cancel_event=None):
        # The caller owns this one-shot Event. Never clear it, replace it, or
        # propagate it into another generation. Do not reserve/spawn if expired.
        if cancel_event is not None:
            if not isinstance(cancel_event, threading.Event):
                raise KinectError('cancel_event must be a threading.Event')
            if cancel_event.is_set():
                raise KinectError('Manager reservation was already cancelled')
        if index is not None and not _index(index):
            raise KinectError('An explicit non-mapper integer device index is required')
        s = self._new_session('capture', index, self.start_timeout, cancel_event)
        while time.monotonic() < s.deadline:
            self._require_live(s, 'waiting for ready')
            result = None
            with self._lock:
                if s.ready.is_set() and not self._token_cancelled(s) and self._current is s:
                    result = copy.deepcopy(self._snapshot)
                if self._token_cancelled(s) or s.finished.is_set():
                    raise KinectError(s.error or 'Capture start cancelled')
            if result is not None:
                self._require_live(s, 'return ready ACK')
                return result
            s.ready.wait(min(.01, max(0., s.deadline-time.monotonic())))
        self._cancel(s, 'Capture start timed out; closure not yet confirmed')
        raise KinectError('Capture start timed out')

    def snapshot(self):
        with self._lock:
            return copy.deepcopy(self._snapshot)

    def _cancel(self, s, error=None):
        with self._lock:
            s.cancelled.set()
            if error and not s.error:
                s.error = error
            owners = tuple(s.owners)
            if self._current is s:
                self._snapshot = _blank('error' if not s.finished.is_set() or s.error else 'off',
                                        not s.finished.is_set(), s.error or 'Stopping; child exit unconfirmed')
        for owner in owners:
            self._retire(owner)

    def _schedule_release(self, owner, marker, target):
        # Reserve ONE path at a time. A failed Thread.start did not schedule it.
        with self._lock:
            if getattr(owner, marker):
                return
            setattr(owner, marker, True)
        try:
            self._thread(target, owner)
        except Exception:
            with self._lock:
                setattr(owner, marker, False)
                owner.cleanup_launch_error = 'Cleanup thread launch failed: '+marker
                current = self._current
                if current and owner in current.owners and not current.finished.is_set():
                    current.error = current.error or owner.cleanup_launch_error
                    self._snapshot = _blank('error', True, current.error)
            # Do not throw: the other release path must still be attempted.

    def _retire(self, owner):
        owner.control_stop.set()  # child lease independently expires even if both launches fail
        self._schedule_release(owner, 'job_close_started', self._close_job)
        if owner.process is not None:
            self._schedule_release(owner, 'terminate_started', self._terminate_and_wait)

    def _send_control(self, s, owner):
        # One bounded write, no user-space queue. Blocking pipe IO is daemon-only.
        # Timestamped pulses cannot renew a lease from stale buffered heartbeats.
        try:
            while not self._token_cancelled(s) and not owner.control_stop.is_set():
                pulse = ('K1 '+str(time.monotonic_ns())+'\n').encode('ascii')
                if owner.process.stdin.write(pulse) != len(pulse):
                    raise OSError('Short control heartbeat write')
                owner.process.stdin.flush()
                if owner.control_stop.wait(CONTROL_HEARTBEAT_INTERVAL):
                    break
        except Exception:
            if not owner.control_stop.is_set() and not s.cancelled.is_set():
                self._cancel(s, 'Parent control heartbeat pipe failed')
        finally:
            try:
                owner.process.stdin.close()
            except Exception:
                pass

    @staticmethod
    def _close_job(owner):
        try:
            owner.job.close()
        except Exception:
            # Direct termination of the exact held Popen is an independent fallback.
            pass

    @staticmethod
    def _terminate_and_wait(owner):
        process = owner.process
        try:
            # Even a failing poll must not bypass termination of this owned handle.
            process.terminate()
        except Exception:
            pass
        while True:
            try:
                if process.wait(timeout=.05) is not None:
                    owner.exited.set()
                    break
            except subprocess.TimeoutExpired:
                continue
            except Exception:
                # A failed wait is NOT confirmation of exit.
                try:
                    if process.poll() is not None:
                        owner.exited.set()
                        break
                except Exception:
                    pass
                time.sleep(.02)
        # File close can block behind a reader. It must not delay exit confirmation.
        try:
            process.stdout.close()
        except Exception:
            pass

    def _spawn(self, s, mode, index=None):
        self._require_live(s, 'before Job creation')
        job = self._job_factory()
        owner = _Owner(job, mode, index)
        with self._lock:
            s.owners.append(owner)  # publish job before even attempting Popen
        self._require_live(s, 'after Job publication')
        args = [self._python, '-B', '-u', '-m', 'flyvj_m3.kinect_worker']
        args += ['--list'] if mode == 'list' else ['--index', str(index)]
        env = os.environ.copy()
        # Known source tree; no shell, caller command, device path or arbitrary module.
        env['PYTHONPATH'] = str(Path(__file__).resolve().parents[1])
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        self._require_live(s, 'before spawn')
        process = self._popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, bufsize=0, close_fds=True,
                              creationflags=CREATE_SUSPENDED | CREATE_NO_WINDOW, env=env)
        with self._lock:
            owner.process = process  # stop now owns the exact Popen, even before attach
            cancelled = self._token_cancelled(s)
        if cancelled:
            self._cancel(s, 'Late suspended child cancelled without resume')
            raise KinectError('Late suspended child cancelled without resume')
        # Cancellation may close the published Job/terminate this exact process
        # while attachment blocks. No mutex is held across this OS operation.
        self._require_live(s, 'before control heartbeat')
        self._thread(self._send_control, s, owner)
        self._require_live(s, 'before attach')
        api = getattr(job, 'api', None)
        # Production always uses OwnedWindowsJob.api. Simple fake Jobs can model
        # atomic attach/resume; staged fakes expose the same ResumeThread seam.
        if api is not None:
            job.api = _ResumeGate(api, lambda: self._require_live(s, 'before ResumeThread'))
        try:
            self._require_live(s, 'before attach/resume dispatch')
            job.attach_and_resume(process.pid)
        finally:
            if api is not None:
                job.api = api
        self._require_live(s, 'after resume')
        owner.last_packet = owner.last_progress = time.monotonic()
        self._thread(self._read, s, owner)
        owner.reader_started = True
        return owner

    def _read(self, s, owner):
        try:
            while not self._token_cancelled(s):
                self._require_live(s, 'before pipe read')
                raw = owner.process.stdout.readline(MAX_LINE+1)
                if not raw:
                    raise KinectError('Worker stdout EOF')
                if not isinstance(raw, bytes) or len(raw) > MAX_LINE or not raw.endswith(b'\n'):
                    raise KinectError('Worker line exceeds limit or is truncated')
                message = json.loads(raw.decode('utf-8'), parse_constant=_reject_constant, object_pairs_hook=_unique_object)
                self._accept(s, owner, message)
                if owner.mode == 'list':
                    return  # exactly one filtered list; no history or stream retained
        except Exception:
            with self._lock:
                owner.fault = 'Invalid worker packet, read failure or EOF'
            if not s.cancelled.is_set():
                self._cancel(s, owner.fault)

    def _accept(self, s, owner, message):
        self._require_live(s, 'before packet validation')
        if not isinstance(message, dict):
            raise KinectError('Invalid worker envelope')
        kind = message.get('kind')
        if kind == 'error':
            if set(message) != {'kind', 'error'} or not isinstance(message['error'], str) or len(message['error']) > 512:
                raise KinectError('Invalid worker error')
            raise KinectError('Worker reported native failure')
        if owner.mode == 'list':
            if kind != 'devices' or set(message) != {'kind', 'devices'}:
                raise KinectError('Invalid query response')
            devices = _devices(message['devices'])
            self._require_live(s, 'before query publication')
            with self._lock:
                if not self._token_cancelled(s):
                    owner.message = devices
            return
        if kind not in ('ready', 'status') or set(message) != {'kind', 'snapshot'}:
            raise KinectError('Invalid capture response')
        snap = _validate_snapshot(message['snapshot'], owner.index, ready=(kind == 'ready'))
        self._require_live(s, 'before aggregate/ready publication')
        with self._lock:
            if self._token_cancelled(s) or self._current is not s:
                return
            if (kind == 'ready') == owner.ready_seen:
                raise KinectError('Missing or duplicate ready acknowledgement')
            if snap['state'] != 'running' or not snap['active'] or snap['error'] is not None:
                raise KinectError('Native driver is no longer healthy')
            if snap['frames'] < owner.last_frames:
                raise KinectError('Sample clock regressed')
            if owner.identity is not None and snap['device'] != owner.identity:
                raise KinectError('Worker identity changed')
            owner.identity = dict(snap['device'])
            if not owner.ready_seen or snap['frames'] > owner.last_frames:
                owner.last_progress = time.monotonic()
            owner.last_frames = snap['frames']
            owner.ready_seen = True
            owner.last_packet = time.monotonic()
            if self._token_cancelled(s):
                return  # cancellation may arrive during validation/state bookkeeping
            self._snapshot = snap  # only current aggregate, never PCM or packet history
            s.ready.set()

    def _query(self, s):
        self._require_live(s, 'before query')
        owner = self._spawn(s, 'list')
        deadline = min(s.deadline, time.monotonic()+self.query_timeout)
        while not self._token_cancelled(s) and time.monotonic() < deadline:
            with self._lock:
                result = owner.message
            if result is not None:
                self._retire(owner)
                if not owner.exited.wait(max(0., deadline-time.monotonic())):
                    raise KinectError('Query child exit unconfirmed')
                self._require_live(s, 'after query exit/before selection')
                return result
            s.cancelled.wait(.005)
        raise KinectError('Device query failed or timed out')

    def _launch(self, s):
        try:
            self._require_live(s, 'launch entry')
            if s.mode == 'list' or s.index is None:
                devices = self._query(s)
                self._require_live(s, 'after query/before capture dispatch')
                if s.mode == 'list':
                    s.result = devices
                    return
                if len(devices) != 1:
                    raise KinectError('Exactly one Azure Kinect required without an explicit index')
                s.index = devices[0]['index']
            owner = self._spawn(s, 'capture', s.index)
            while not s.cancelled.is_set():
                self._require_live(s, 'capture lifetime watchdog')
                with self._lock:
                    ready, last_packet, last_progress = owner.ready_seen, owner.last_packet, owner.last_progress
                now = time.monotonic()
                if not ready and now >= s.deadline:
                    raise KinectError('Native open/ready timed out')
                if ready and now-last_packet >= self.heartbeat_timeout:
                    raise KinectError('Worker aggregate heartbeat lost')
                if ready and now-last_progress >= self.sample_timeout:
                    raise KinectError('Worker sample clock stalled')
                s.cancelled.wait(.01)
        except Exception as exc:
            self._cancel(s, 'Worker launch failed: '+str(exc)[:256] if not s.cancelled.is_set() else None)
        finally:
            # This is reached only after every in-flight Popen/attach has returned.
            # Hence a finished session cannot later create/resume another child.
            with self._lock:
                owners = tuple(s.owners)
            for owner in owners:
                self._retire(owner)
            for owner in owners:
                if owner.process is not None:
                    while not owner.exited.wait(.05):
                        # A scheduling failure is retryable; never abandon owned release.
                        self._retire(owner)
                self._retire(owner)  # also retry an unscheduled Job close after confirmed exit
            with self._lock:
                s.finished.set()
                self._queries.discard(s)
                if self._current is s:
                    self._snapshot = _blank('error' if s.error else 'off', False, s.error)

    def _stop_sessions(self, sessions):
        deadline = time.monotonic()+self.stop_timeout
        for s in sessions:
            self._cancel(s)
        for s in sessions:
            s.finished.wait(max(0., deadline-time.monotonic()))
        with self._lock:
            current = self._current
            if current in sessions:
                if current.finished.is_set():
                    self._snapshot = _blank()
                else:
                    current.error = current.error or 'Stop timed out; child exit unconfirmed'
                    self._snapshot = _blank('error', True, current.error)
            return copy.deepcopy(self._snapshot)

    def stop(self):
        with self._lock:
            sessions = [self._current] if self._current else []
        return self._stop_sessions(sessions)

    def close(self):
        with self._lock:
            self._closed = True
            sessions = list(self._queries)
            if self._current:
                sessions.append(self._current)
        return self._stop_sessions(sessions)

    shutdown = close
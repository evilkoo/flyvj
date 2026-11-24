"""Fail-closed Azure Kinect WinMM input; import never opens an audio device."""
import ctypes as C
import math
import struct
import threading

SAMPLE_RATE = 48000
FRAME_SIZE = 2048


class KinectError(RuntimeError):
    pass


def measure_pcm16(data, sample_rate=SAMPLE_RATE):
    if sample_rate != SAMPLE_RATE or not isinstance(data, (bytes, bytearray)) or len(data) != FRAME_SIZE * 2:
        raise KinectError('Expected one 2048-sample mono PCM16 frame at 48000 Hz')
    samples = struct.unpack('<2048h', data)
    values = [s / 32768.0 for s in samples]
    n = FRAME_SIZE
    fft = [complex(v * (0.42 - 0.5 * math.cos(2*math.pi*i/(n-1)) + 0.08 * math.cos(4*math.pi*i/(n-1)))) for i,v in enumerate(values)]
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            fft[i], fft[j] = fft[j], fft[i]
    size = 2
    while size <= n:
        step = complex(math.cos(-2*math.pi/size), math.sin(-2*math.pi/size))
        for start in range(0, n, size):
            w = 1+0j
            for k in range(size//2):
                a = fft[start+k]
                b = w*fft[start+k+size//2]
                fft[start+k], fft[start+k+size//2] = a+b, a-b
                w *= step
        size *= 2
    bands = dict(low=0., mid=0., high=0.)
    for i in range(n//2+1):
        hz = i*sample_rate/n
        band = 'low' if 30 <= hz < 180 else 'mid' if 180 <= hz < 2500 else 'high' if 2500 <= hz <= min(8000,sample_rate/2) else None
        if band:
            bands[band] = max(bands[band], min(1., 6*abs(fft[i])/n))
    return dict(rms=math.sqrt(sum(v*v for v in values)/n), bands=bands,
                clipping=any(s >= 32767 or s <= -32768 for s in samples))


def _matching(devices):
    return [dict(index=d['index'], name=d['name']) for d in devices
            if type(d.get('index')) is int and d['index'] >= 0
            and isinstance(d.get('name'), str) and 'azure kinect' in d['name'].casefold()]


# Windows fixed-width ABI; pointer-sized fields remain pointer-sized on x64.
WORD, DWORD, UINT = C.c_uint16, C.c_uint32, C.c_uint32
DWORD_PTR = C.c_size_t
HANDLE = C.c_void_p


class WAVEFORMATEX(C.Structure):
    _pack_ = 1
    _fields_ = [('wFormatTag', WORD), ('nChannels', WORD), ('nSamplesPerSec', DWORD),
                ('nAvgBytesPerSec', DWORD), ('nBlockAlign', WORD), ('wBitsPerSample', WORD), ('cbSize', WORD)]


class WAVEHDR(C.Structure):
    _fields_ = [('lpData', C.c_void_p), ('dwBufferLength', DWORD), ('dwBytesRecorded', DWORD),
                ('dwUser', DWORD_PTR), ('dwFlags', DWORD), ('dwLoops', DWORD),
                ('lpNext', C.c_void_p), ('reserved', DWORD_PTR)]


class WAVEINCAPSW(C.Structure):
    _fields_ = [('wMid', WORD), ('wPid', WORD), ('vDriverVersion', DWORD),
                ('szPname', C.c_wchar*32), ('dwFormats', DWORD), ('wChannels', WORD), ('wReserved1', WORD)]


# Failed native releases must retain memory even if the caller drops the exception.
_UNCLOSED = []


def _check(result, operation):
    if result:
        raise KinectError(f'{operation} failed ({result})')


class WinMMAudio:
    def __init__(self, api=None):
        self._api = api

    def _dll(self):
        if self._api is None:
            try:
                api = C.WinDLL('winmm')
            except (AttributeError, OSError) as exc:
                raise KinectError('Windows WinMM is unavailable') from exc
            declarations = {
                'waveInGetNumDevs': ([], UINT),
                'waveInGetDevCapsW': ([DWORD_PTR, C.POINTER(WAVEINCAPSW), UINT], UINT),
                'waveInOpen': ([C.POINTER(HANDLE), UINT, C.POINTER(WAVEFORMATEX), DWORD_PTR, DWORD_PTR, DWORD], UINT),
                'waveInPrepareHeader': ([HANDLE, C.POINTER(WAVEHDR), UINT], UINT),
                'waveInUnprepareHeader': ([HANDLE, C.POINTER(WAVEHDR), UINT], UINT),
                'waveInAddBuffer': ([HANDLE, C.POINTER(WAVEHDR), UINT], UINT),
                'waveInStart': ([HANDLE], UINT), 'waveInReset': ([HANDLE], UINT), 'waveInClose': ([HANDLE], UINT),
            }
            for name, (args, result) in declarations.items():
                fn = getattr(api, name)
                fn.argtypes, fn.restype = args, result
            self._api = api
        return self._api

    def list_devices(self):
        api = self._dll()
        devices = []
        for i in range(api.waveInGetNumDevs()):
            caps = WAVEINCAPSW()
            _check(api.waveInGetDevCapsW(i, C.byref(caps), C.sizeof(caps)), 'waveInGetDevCapsW')
            devices.append(dict(index=i, name=caps.szPname))
        return devices

    def open(self, index, sample_rate=SAMPLE_RATE, frame_size=FRAME_SIZE):
        if sample_rate != SAMPLE_RATE or frame_size != FRAME_SIZE:
            raise KinectError('Unsupported format')
        if type(index) is not int or not any(d['index'] == index for d in _matching(self.list_devices())):
            raise KinectError('Explicit Azure Kinect identity required')
        return _WinMMReader(self._dll(), index)


class _WinMMReader:
    def __init__(self, api, index):
        self.api, self.handle = api, HANDLE()
        self.buffers = []
        self.position = 0
        self.closed = False
        self.format = WAVEFORMATEX(1, 1, SAMPLE_RATE, SAMPLE_RATE*2, 2, 16, 0)
        try:
            _check(api.waveInOpen(C.byref(self.handle), index, C.byref(self.format), 0, 0, 0), 'waveInOpen')
            if not self.handle.value:
                raise KinectError('waveInOpen returned no handle')
            for _ in range(4):
                raw = C.create_string_buffer(FRAME_SIZE*2)
                header = WAVEHDR(lpData=C.addressof(raw), dwBufferLength=FRAME_SIZE*2)
                item = [raw, header, False]
                self.buffers.append(item)
                _check(api.waveInPrepareHeader(self.handle, C.byref(header), C.sizeof(header)), 'waveInPrepareHeader')
                item[2] = True
                _check(api.waveInAddBuffer(self.handle, C.byref(header), C.sizeof(header)), 'waveInAddBuffer')
            _check(api.waveInStart(self.handle), 'waveInStart')
        except Exception as exc:
            try:
                self.close()
            except Exception as cleanup:
                error = KinectError(f'{exc}; cleanup: {cleanup}')
                error.reader = self
                raise error from exc
            raise KinectError(str(exc)) from exc

    def read(self):
        if self.closed:
            raise KinectError('Reader is closed')
        raw, header, _ = self.buffers[self.position]
        if not header.dwFlags & 1:  # WHDR_DONE
            return None
        if header.dwBytesRecorded != FRAME_SIZE*2:
            raise KinectError('Incomplete native PCM frame')
        data = C.string_at(header.lpData, FRAME_SIZE*2)
        header.dwBytesRecorded = 0
        _check(self.api.waveInAddBuffer(self.handle, C.byref(header), C.sizeof(header)), 'waveInAddBuffer')
        self.position = (self.position + 1) % 4
        return data

    def close(self):
        if self.closed:
            return
        try:
            if self.handle.value:
                _check(self.api.waveInReset(self.handle), 'waveInReset')
                for item in self.buffers:
                    if item[2]:
                        _check(self.api.waveInUnprepareHeader(self.handle, C.byref(item[1]), C.sizeof(item[1])), 'waveInUnprepareHeader')
                        item[2] = False
                _check(self.api.waveInClose(self.handle), 'waveInClose')
                self.handle = HANDLE()
            self.closed = True
            self.buffers.clear()
            if self in _UNCLOSED:
                _UNCLOSED.remove(self)
        except Exception:
            if self not in _UNCLOSED:
                _UNCLOSED.append(self)
            raise


def enumerate_kinect_devices():
    return _matching(WinMMAudio().list_devices())


class KinectCapture:
    STOP_TIMEOUT = 1.0

    def __init__(self, backend=None):
        self._backend = backend if backend is not None else WinMMAudio()
        self._lock, self._operations = threading.RLock(), threading.Lock()
        self._stop = threading.Event()
        self._thread = self._reader = None
        self._state, self._active, self._device, self._error = 'off', False, None, None
        self._clear()

    def _clear(self):
        self._frames = 0
        self._features = dict(rms=0., bands=dict(low=0., mid=0., high=0.), clipping=False)

    def _fault(self, exc):
        self._state = 'error'
        message = str(exc)
        self._error = f'{self._error}; {message}' if self._error and message not in self._error else (self._error or message)
        self._clear()

    def list_devices(self):
        return _matching(self._backend.list_devices())

    def snapshot(self):
        with self._lock:
            return dict(state=self._state, active=self._active,
                        device=dict(self._device) if self._device else None,
                        time=self._frames*FRAME_SIZE/SAMPLE_RATE,
                        rms=self._features['rms'], bands=dict(self._features['bands']),
                        clipping=self._features['clipping'], sample_rate=SAMPLE_RATE,
                        frame_size=FRAME_SIZE, frames=self._frames, error=self._error)

    def start(self, index=None):
        with self._operations:
            with self._lock:
                if self._active or (self._thread and self._thread.is_alive()):
                    raise KinectError('Capture already active or stopping')
                self._clear()
                self._device = None
                self._error = None
                try:
                    devices = self.list_devices()
                    if index is None:
                        if len(devices) != 1:
                            raise KinectError('Exactly one Azure Kinect required, otherwise select explicit index')
                        index = devices[0]['index']
                    candidates = [d for d in devices if type(index) is int and d['index'] == index]
                    if len(candidates) != 1:
                        raise KinectError('Selected index is not Azure Kinect')
                    device = candidates[0]
                    if device not in self.list_devices():
                        raise KinectError('Azure Kinect identity changed before open')
                    self._device = device
                    self._reader = self._backend.open(index, sample_rate=SAMPLE_RATE, frame_size=FRAME_SIZE)
                    self._active, self._state = True, 'running'
                    self._stop.clear()
                    self._thread = threading.Thread(target=self._run, daemon=True, name='AzureKinectPCM')
                    self._thread.start()
                except Exception as exc:
                    leaked = getattr(exc, 'reader', None)
                    if leaked is not None:
                        self._reader, self._active = leaked, True
                    self._fault(exc)
                    # Thread-start failure: retain active handle; stop() owns bounded cleanup.
                    raise KinectError(str(exc)) from exc
            return self.snapshot()

    def _close(self):
        try:
            self._reader.close()
        except Exception as exc:
            with self._lock:
                self._fault(exc)
        else:
            with self._lock:
                self._active = False
                self._reader = None
                self._clear()
                if self._state != 'error':
                    self._state, self._device = 'off', None

    def _run(self):
        try:
            while not self._stop.is_set():
                data = self._reader.read()
                if data is None:
                    self._stop.wait(.005)
                    continue
                features = measure_pcm16(data)
                with self._lock:
                    if not self._stop.is_set():
                        self._features = features
                        self._frames += 1
        except Exception as exc:
            with self._lock:
                self._fault(exc)
            self._stop.set()
        finally:
            self._close()

    def stop(self):
        with self._operations:
            with self._lock:
                self._stop.set()
                self._clear()
                thread = self._thread
                if self._active and (thread is None or not thread.is_alive()):
                    thread = self._thread = threading.Thread(target=self._close, daemon=True, name='AzureKinectClose')
                    try:
                        thread.start()
                    except Exception as exc:
                        self._fault(exc)
                        return self.snapshot()
            if thread and thread.is_alive():
                thread.join(self.STOP_TIMEOUT)
            with self._lock:
                if thread and thread.is_alive():
                    self._fault(KinectError('Worker stop/close timed out; hardware closure unconfirmed'))
                elif not self._active:
                    self._state, self._device, self._error = 'off', None, None
                return self.snapshot()
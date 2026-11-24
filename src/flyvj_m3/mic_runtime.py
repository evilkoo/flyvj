"""Loopback-only Kinect feature bridge: explicit start, nonce/origin checks, leases."""
import hmac,json,math,secrets,threading,time
from urllib.parse import urlsplit

def encoded(code,data):
    return code,'application/json; charset=utf-8',json.dumps(data,ensure_ascii=False,allow_nan=False,separators=(',',':')).encode('utf-8')

class MicRuntime:
    def __init__(self,capture,origin,token=None,lease_seconds=6,clock=time.monotonic):
        u=urlsplit(origin)
        if u.scheme!='http' or u.hostname!='127.0.0.1' or not u.port or u.path not in ('','/') or u.query or u.fragment or u.username:
            raise ValueError('Exact loopback origin required')
        if not isinstance(lease_seconds,(int,float)) or isinstance(lease_seconds,bool) or not math.isfinite(lease_seconds) or not 1<=lease_seconds<=10:
            raise ValueError('Bounded mic lease required')
        self.capture=capture;self.origin=origin.rstrip('/');self.host=u.netloc;self.token=token or secrets.token_urlsafe(32)
        self.lease_seconds=lease_seconds;self.clock=clock;self.session=None;self.last_touch=None;self.lock=threading.RLock();self.closed=False;self.generation=0;self.pending=False;self.stopping=False;self.cancel_event=None
    def _headers(self,headers):return {str(k).lower():str(v) for k,v in headers.items()}
    def _same_origin(self,h,post=False):
        return h.get('host')==self.host and h.get('sec-fetch-site')=='same-origin' and ((h.get('origin')==self.origin) if post else h.get('origin',self.origin)==self.origin)
    def _auth(self,h):return isinstance(h.get('x-flyvj-token'),str) and hmac.compare_digest(h['x-flyvj-token'],self.token)
    def _snapshot(self):
        result=self.capture.snapshot()
        if not isinstance(result,dict) or result.get('state') not in ('off','running','error') or type(result.get('active')) is not bool:
            raise ValueError('Invalid capture state')
        for key in ('time','rms'):
            value=result.get(key)
            if type(value) not in (int,float) or not math.isfinite(value) or value<0:raise ValueError('Invalid capture aggregate')
        bands=result.get('bands')
        if not isinstance(bands,dict) or set(bands)!=set(('low','mid','high')) or any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=1 for v in bands.values()):
            raise ValueError('Invalid capture bands')
        if type(result.get('clipping')) is not bool or result.get('sample_rate')!=48000 or result.get('frame_size')!=2048 or type(result.get('frames')) is not int or result['frames']<0:
            raise ValueError('Invalid capture format')
        device=result.get('device')
        if device is not None:
            if not isinstance(device,dict) or type(device.get('index')) is not int or device['index']<0 or not isinstance(device.get('name'),str) or 'azure kinect' not in device['name'].casefold():raise ValueError('Invalid capture device')
            device={'index':device['index'],'name':device['name'][:80]}
        if result['active'] and device is None:raise ValueError('Active capture missing Azure Kinect identity')
        error=result.get('error')
        if error is not None and not isinstance(error,str):raise ValueError('Invalid capture error')
        # Copy only finite current aggregate values, never raw PCM or credentials.
        return {'state':result['state'],'active':result['active'],'device':device,'time':result['time'],'rms':result['rms'],
                'bands':dict(bands),'clipping':result['clipping'],'sample_rate':48000,'frame_size':2048,'frames':result['frames'],
                'error':error[:180] if error else None}
    def _stop(self,expected=None,internal=False,expected_generation=None,expired_only=False):
        with self.lock:
            if expected_generation is not None and (expected!=self.session or expected_generation!=self.generation):return None
            if expired_only and (self.last_touch is None or self.clock()-self.last_touch<self.lease_seconds):return None
            if not internal and self.session is not None and expected!=self.session:raise ValueError('STALE_MIC_SESSION')
            if self.stopping:raise RuntimeError('MIC_STOP_ALREADY_PENDING')
            owner=self.session;self.stopping=True;self.pending=False;self.generation+=1
            if self.cancel_event is not None:self.cancel_event.set()
            if self.last_touch is None:self.last_touch=self.clock()
        try:
            # Native I/O/process stop must not own the HTTP/state lock.
            result=self.capture.stop()
            if not isinstance(result,dict) or result.get('active') is not False:raise RuntimeError('MIC_STOP_NOT_CONFIRMED')
            snap=self._snapshot()
            with self.lock:
                if owner==self.session:self.session=None;self.last_touch=None
            return snap
        finally:
            with self.lock:self.stopping=False
    def _start(self,index):
        with self.lock:
            if self.closed:raise RuntimeError('MIC_RUNTIME_CLOSED')
            if self.session is not None or self.pending or self.stopping:raise RuntimeError('MIC_ALREADY_RUNNING')
            self.generation+=1;ticket=self.generation;sid=secrets.token_urlsafe(24)
            self.session=sid;self.last_touch=self.clock();self.pending=True
            cancelled=threading.Event();self.cancel_event=cancelled
        try:
            self.capture.start(index,cancel_event=cancelled)
            snap=self._snapshot()
            with self.lock:
                if ticket!=self.generation or sid!=self.session or cancelled.is_set():raise RuntimeError('MIC_START_CANCELLED')
                if snap.get('active') is not True or snap.get('state')!='running':raise RuntimeError('KINECT_START_NOT_CONFIRMED')
                self.pending=False;self.last_touch=self.clock()
            return {**snap,'session':sid}
        except Exception:
            # Retain the pending cleanup deadline even when no successful reply/session was delivered.
            with self.lock:
                own=ticket==self.generation and sid==self.session
                if own:self.pending=False
            if own:
                try:self._stop(expected=sid,internal=True,expected_generation=ticket)
                except Exception:pass # Active/unknown owner remains leased; no fake OFF.
            raise
    def handle(self,method,path,headers,body=b''):
        if not path.startswith('/mic/'):return None
        method=method.upper();h=self._headers(headers)
        if method not in ('GET','POST'):return encoded(405,{'error':'METHOD_NOT_ALLOWED'})
        if not self._same_origin(h,method=='POST'):return encoded(403,{'error':'LOCAL_ORIGIN_REQUIRED'})
        with self.lock:
            if self.closed:return encoded(503,{'error':'MIC_RUNTIME_CLOSED'})
        if path=='/mic/config' and method=='GET':return encoded(200,{'token':self.token,'lease_seconds':self.lease_seconds,'source':'AZURE_KINECT_ONLY','raw_audio':False,'manual_start':True})
        if not self._auth(h):return encoded(403,{'error':'LOCAL_SESSION_REQUIRED'})
        data={}
        if method=='POST':
            if h.get('content-type','').split(';',1)[0].strip().lower()!='application/json' or not isinstance(body,bytes) or len(body)>1024:return encoded(400,{'error':'SMALL_JSON_REQUIRED'})
            try:data=json.loads(body.decode('utf-8'))
            except (UnicodeError,ValueError):return encoded(400,{'error':'INVALID_JSON'})
            if not isinstance(data,dict):return encoded(400,{'error':'JSON_OBJECT_REQUIRED'})
        try:
            self.expire()
            if path=='/mic/devices' and method=='GET':
                # Enumeration can stall: query it outside the manager lock and in an isolated child.
                return encoded(200,{'devices':self.capture.list_devices()})
            if path=='/mic/status' and method=='GET':
                with self.lock:
                    sid=self.session;ticket=self.generation
                    if sid is not None and h.get('x-flyvj-mic')!=sid:return encoded(409,{'error':'STALE_MIC_SESSION'})
                snap=self._snapshot()
                with self.lock:
                    if sid==self.session and ticket==self.generation and snap.get('active') and snap.get('state')=='running' and not self.pending and not self.stopping:self.last_touch=self.clock()
                return encoded(200,snap)
            if path=='/mic/start' and method=='POST':
                if set(data)-{'index'}:return encoded(400,{'error':'INDEX_ONLY'})
                index=data.get('index')
                if index is not None and (type(index) is not int or index<0):return encoded(400,{'error':'INVALID_KINECT_INDEX'})
                return encoded(200,self._start(index))
            if path=='/mic/stop' and method=='POST':
                if set(data)-{'session'}:return encoded(400,{'error':'SESSION_ONLY'})
                with self.lock:
                    if self.session is not None and data.get('session')!=self.session:return encoded(409,{'error':'STALE_MIC_SESSION'})
                return encoded(200,self._stop(expected=data.get('session')))
            return encoded(404,{'error':'NOT_FOUND'})
        except Exception as exc:
            try:active=self._snapshot()['active']
            except Exception:active=None
            return encoded(409,{'error':'KINECT_OPERATION_FAILED','detail':str(exc)[:180],'state':'error','active':active})
    def expire(self):
        with self.lock:
            expired=self.last_touch is not None and self.clock()-self.last_touch>=self.lease_seconds and not self.stopping
            sid=self.session;ticket=self.generation
        if expired:self._stop(expected=sid,internal=True,expected_generation=ticket,expired_only=True)
    def close(self):
        with self.lock:self.closed=True
        return self._stop(internal=True)

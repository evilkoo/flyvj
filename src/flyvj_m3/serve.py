"""M3 restricted loopback WebApp runtime; no arbitrary-file/browser URL proxy."""
import argparse,hashlib,json,os,time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from flyvj_m2.runner import validate_run_id

def select_bundle(project_root,run_dir):
    root=Path(project_root).resolve(strict=True)
    raw=str(run_dir)
    if raw.startswith(('\\\\','//')) or '://' in raw:raise ValueError('Local owned M3 run only')
    supplied=Path(run_dir)
    if not supplied.is_absolute():supplied=root/supplied
    if supplied.parent!=root/'work/runs':raise ValueError('Runtime only accepts work/runs/<id>')
    validate_run_id(supplied.name)
    run=supplied.resolve(strict=True)
    if not run.is_relative_to(root/'work/runs'):raise ValueError('Run resolved outside workspace')
    state_path=run/'state.json';console=run/'console.html'
    for p in (state_path,console):
        if not p.resolve(strict=True).is_relative_to(run):raise ValueError('Bundle path resolved outside its run')
    state=json.loads(state_path.read_text(encoding='utf-8'))
    if state.get('stage')!='M3' or state.get('status')!='PASSED':raise ValueError('Only a PASSED M3 build can run')
    data=console.read_bytes()
    if len(data)>2*1024*1024:raise ValueError('HTML bundle exceeds2MiB')
    manifest_path=run/'manifest.json'
    if not manifest_path.is_file():raise ValueError('Generated M3 manifest required')
    if not manifest_path.resolve(strict=True).is_relative_to(run):raise ValueError('Manifest escaped run')
    manifest=json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get(str(console.relative_to(root)))!=hashlib.sha256(data).hexdigest():raise ValueError('Bundle differs from generated manifest')
    return data,console

def route(path,data,run_id=None):
    if path in ('/','/console.html'):return 200,'text/html; charset=utf-8',data
    if path=='/health':return 200,'application/json; charset=utf-8',json.dumps({'app':'M3','scope':'loopback-only','file_proxy':False,'run_id':run_id,'bundle_sha256':hashlib.sha256(data).hexdigest()}).encode('utf-8')
    return 404,'text/plain; charset=utf-8',b'Not found'

def parse_options(argv=None):
    p=argparse.ArgumentParser(description='M3 loopback-only runtime; fixed endpoint, bounded idle')
    p.add_argument('--run-dir',required=True);p.add_argument('--session-file',required=True)
    p.add_argument('--idle-seconds',type=int,default=7200);p.add_argument('--port',type=int,default=54654)
    a=p.parse_args(argv)
    if not 10<=a.idle_seconds<=7200:raise ValueError('Idle timeout must be10..7200s')
    if not 0<=a.port<=65535:raise ValueError('Port must be0..65535')
    return a

def authorize_kinect_bundle(project_root,run_dir):
    root=Path(project_root).resolve(strict=True);run=Path(run_dir).resolve(strict=True)
    state=json.loads((run/'state.json').read_text(encoding='utf-8'))
    if state.get('input_capabilities',{}).get('azure_kinect_mic') is not True:return False
    manifest=json.loads((run/'manifest.json').read_text(encoding='utf-8'))
    paths=[run/'payload.json',root/'src/flyvj_m3/serve.py',root/'src/flyvj_m3/mic_runtime.py',root/'src/flyvj_m3/kinect.py',
           root/'src/flyvj_m3/kinect_process.py',root/'src/flyvj_m3/kinect_worker.py',root/'src/flyvj_m0/windows_job.py']
    for p in paths:
        if not p.resolve(strict=True).is_relative_to(root):raise ValueError('Kinect backend escaped workspace')
        if manifest.get(str(p.relative_to(root)))!=hashlib.sha256(p.read_bytes()).hexdigest():raise ValueError('Kinect backend/payload differs from approved build')
    payload=json.loads((run/'payload.json').read_text(encoding='utf-8'))
    if payload.get('audio_policy',{}).get('kinect_microphone_enabled') is not True:raise ValueError('Bundle did not declare Kinect capability')
    return True

def make_handler(data,run_id):
    class Handler(BaseHTTPRequestHandler):
        def _send(self,result):
            code,mime,body=result;self.send_response(code)
            self.send_header('Content-Type',mime);self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
            self.end_headers();self.wfile.write(body)
        def _mic(self,method,body=b''):
            mic=getattr(self.server,'mic',None)
            if mic is None:return None
            return mic.handle(method,self.path,self.headers,body)
        def do_GET(self):
            self.server.last_request=time.monotonic()
            result=self._mic('GET')
            self._send(result if result is not None else route(self.path,data,run_id))
        def do_POST(self):
            self.server.last_request=time.monotonic()
            if not self.path.startswith('/mic/') or getattr(self.server,'mic',None) is None:
                self._send((404,'text/plain; charset=utf-8',b'Not found'));return
            try:
                raw=self.headers.get('Content-Length','');length=int(raw)
                if not raw.isdecimal() or not 0<=length<=1024 or self.headers.get('Transfer-Encoding'):raise ValueError('Small content length required')
            except (TypeError,ValueError):
                self.close_connection=True;self._send((400,'application/json; charset=utf-8',b'{"error":"SMALL_JSON_REQUIRED"}'));return
            # Bound slow body reads. No chunked uploads or arbitrary file endpoint.
            self.connection.settimeout(2)
            try:body=self.rfile.read(length)
            except (TimeoutError,OSError):
                self.close_connection=True;self._send((400,'application/json; charset=utf-8',b'{"error":"REQUEST_BODY_TIMEOUT"}'));return
            if len(body)!=length:
                self.close_connection=True;self._send((400,'application/json; charset=utf-8',b'{"error":"INCOMPLETE_JSON"}'));return
            result=self._mic('POST',body)
            self._send(result if result is not None else (404,'text/plain; charset=utf-8',b'Not found'))
        def log_message(self,*args):pass
    return Handler

def main():
    a=parse_options()
    root=Path(__file__).resolve().parents[2];data,console=select_bundle(root,a.run_dir)
    kinect_enabled=authorize_kinect_bundle(root,console.parent)
    session=Path(a.session_file).resolve()
    session_root=(root/'work/m3/sessions').resolve()
    if not session_root.is_relative_to(root.resolve()) or not session.is_relative_to(session_root) or session.suffix!='.json':raise ValueError('Session receipt must stay under work/m3/sessions')
    session.parent.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',a.port),make_handler(data,console.parent.name));server.timeout=1;server.daemon_threads=True
    server.last_request=time.monotonic();server.mic=None
    if kinect_enabled:
        from flyvj_m3.kinect_process import KinectProcessCapture
        from flyvj_m3.mic_runtime import MicRuntime
        server.mic=MicRuntime(KinectProcessCapture(),'http://127.0.0.1:'+str(server.server_port))
    receipt={'schema_version':1,'app':'M3','pid':os.getpid(),'executable':__import__('sys').executable,'port':server.server_port,
             'url':'http://127.0.0.1:'+str(server.server_port)+'/','console':str(console),
             'scope':'ONE_GENERATED_M3_BUNDLE_NO_FILE_PROXY','idle_seconds':a.idle_seconds,
             'kinect_capability':kinect_enabled,'capture_default':'OFF'}
    try:
        with session.open('x',encoding='utf-8') as file:json.dump(receipt,file,indent=2)
        while time.monotonic()-server.last_request<a.idle_seconds:
            server.handle_request()
            if server.mic is not None:server.mic.expire()
    finally:
        try:
            if server.mic is not None:server.mic.close()
        finally:server.server_close()
    return 0
if __name__=='__main__':raise SystemExit(main())

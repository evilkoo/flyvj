import hashlib,http.client,json,tempfile,threading,unittest,time
from pathlib import Path
from http.server import ThreadingHTTPServer
from flyvj_m3.serve import make_handler,authorize_kinect_bundle
from flyvj_m3.mic_runtime import MicRuntime
from test_kinect_http import FakeCapture
class KinectServeTests(unittest.TestCase):
    def setUp(self):
        self.cap=FakeCapture();self.server=ThreadingHTTPServer(('127.0.0.1',0),make_handler(b'<p>fixed</p>','test'))
        self.origin='http://127.0.0.1:'+str(self.server.server_port);self.server.last_request=time.monotonic();self.server.mic=MicRuntime(self.cap,self.origin,token='test-token')
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.mic.close();self.server.shutdown();self.server.server_close();self.thread.join(2)
    def request(self,method,path,body=None,headers=None):
        con=http.client.HTTPConnection('127.0.0.1',self.server.server_port,timeout=3)
        h={'Origin':self.origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json','X-FlyVJ-Token':'test-token',**(headers or {})}
        con.request(method,path,json.dumps(body or {}) if method=='POST' else None,h);resp=con.getresponse();data=resp.read();status=resp.status;rh=dict(resp.getheaders());con.close();return status,data,rh
    def test_real_http_only_config_metadata_until_manual_start(self):
        c,b,h=self.request('GET','/mic/config');self.assertEqual(c,200);self.assertFalse(self.cap.active);self.assertNotIn('Access-Control-Allow-Origin',h)
        c,b,h=self.request('GET','/mic/devices');self.assertEqual(json.loads(b)['devices'][0]['index'],0);self.assertFalse(self.cap.active)
    def test_manual_start_status_and_stop_match_private_session(self):
        c,b,h=self.request('POST','/mic/start',{'index':0});self.assertEqual(c,200);s=json.loads(b)['session']
        c,b,h=self.request('GET','/mic/status',headers={'X-FlyVJ-Mic':s});self.assertTrue(json.loads(b)['active'])
        c,b,h=self.request('POST','/mic/stop',{'session':s});self.assertFalse(json.loads(b)['active'])
    def test_foreign_posts_and_large_body_fail_without_capture(self):
        c,b,h=self.request('POST','/mic/start',{'index':0},{'Origin':'https://foreign.example','Sec-Fetch-Site':'cross-site'});self.assertEqual(c,403)
        c,b,h=self.request('POST','/mic/start',{'junk':'x'*1100});self.assertEqual(c,400);self.assertFalse(self.cap.active)
    def test_static_bundle_health_and_no_file_proxy_still_work(self):
        c,b,h=self.request('GET','/');self.assertEqual((c,b),(200,b'<p>fixed</p>'))
        c,b,h=self.request('GET','/health');self.assertFalse(json.loads(b)['file_proxy'])
        c,b,h=self.request('GET','/private.wav');self.assertEqual(c,404)
    def test_unapproved_bundle_has_no_mic_endpoints(self):
        self.server.mic=None;c,b,h=self.request('GET','/mic/config');self.assertEqual(c,404);self.server.mic=MicRuntime(self.cap,self.origin,token='test-token')
class KinectBundleGateTests(unittest.TestCase):
    def fixture(self,root,enabled):
        run=root/'work'/'runs'/'test';run.mkdir(parents=True)
        (run/'state.json').write_text(json.dumps({'input_capabilities':{'azure_kinect_mic':enabled}}))
        payload=run/'payload.json';payload.write_text(json.dumps({'audio_policy':{'kinect_microphone_enabled':True}}))
        paths=[payload]
        for name in ('serve.py','mic_runtime.py','kinect.py','kinect_process.py','kinect_worker.py'):
            p=root/'src'/'flyvj_m3'/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(name);paths.append(p)
        p=root/'src'/'flyvj_m0'/'windows_job.py';p.parent.mkdir(parents=True,exist_ok=True);p.write_text('job');paths.append(p)
        (run/'manifest.json').write_text(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}))
        return run
    def test_old_bundle_cannot_gain_microphone_capability(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);run=self.fixture(root,False);self.assertFalse(authorize_kinect_bundle(root,run))
    def test_enabled_bundle_requires_pinned_backend_and_payload(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);run=self.fixture(root,True);self.assertTrue(authorize_kinect_bundle(root,run));(root/'src/flyvj_m3/kinect.py').write_text('tampered')
            with self.assertRaises(ValueError):authorize_kinect_bundle(root,run)

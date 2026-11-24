import json,unittest
from flyvj_m3.mic_runtime import MicRuntime
class FakeCapture:
    def __init__(self):self.active=False;self.starts=[];self.stops=0
    def list_devices(self):return [{'index':0,'name':'Azure Kinect Microphone Array'}]
    def start(self,index=None,cancel_event=None):
        if cancel_event is not None and cancel_event.is_set():raise RuntimeError('cancelled start')
        if self.active:raise RuntimeError('already running')
        if index not in (None,0):raise RuntimeError('wrong device')
        self.active=True;self.starts.append(index);return self.snapshot()
    def stop(self):self.active=False;self.stops+=1;return self.snapshot()
    def snapshot(self):return {'state':'running' if self.active else 'off','active':self.active,'device':self.list_devices()[0] if self.active else None,'time':1.0 if self.active else 0.0,'rms':.1 if self.active else 0.0,'bands':{'low':.2 if self.active else 0,'mid':0,'high':0},'clipping':False,'sample_rate':48000,'frame_size':2048,'frames':48000 if self.active else 0,'error':None}
class KinectHTTPTests(unittest.TestCase):
    def setUp(self):
        self.capture=FakeCapture();self.time=[10.0];self.origin='http://127.0.0.1:54654'
        self.r=MicRuntime(self.capture,self.origin,token='test-token',clock=lambda:self.time[0]);self.base={'Host':'127.0.0.1:54654','Origin':self.origin,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json','X-FlyVJ-Token':'test-token'}
    def request(self,method,path,data=None,headers=None):
        body=json.dumps(data or {}).encode();code,mime,raw=self.r.handle(method,path,headers or self.base,body);return code,json.loads(raw)
    def start(self):
        code,b=self.request('POST','/mic/start',{'index':0});self.assertEqual(code,200);return b['session']
    def test_config_and_device_reads_do_not_capture(self):
        c,b=self.request('GET','/mic/config');self.assertEqual(c,200);self.assertEqual(b['token'],'test-token');c,b=self.request('GET','/mic/devices');self.assertEqual(b['devices'][0]['index'],0);self.assertFalse(self.capture.active);self.assertEqual(self.capture.starts,[])
    def test_bad_origin_host_fetchsite_token_never_starts(self):
        for key,value in [('Origin','https://foreign.example'),('Host','foreign.example'),('Sec-Fetch-Site','cross-site'),('X-FlyVJ-Token','wrong')]:
            h={**self.base,key:value};c,b=self.request('POST','/mic/start',{'index':0},h);self.assertEqual(c,403)
        self.assertEqual(self.capture.starts,[])
    def test_non_json_oversize_and_bad_device_are_rejected(self):
        c,_=self.request('POST','/mic/start',headers={**self.base,'Content-Type':'text/plain'});self.assertEqual(c,400)
        c,_,_=self.r.handle('POST','/mic/start',self.base,b'x'*1025);self.assertEqual(c,400)
        for value in [-1,True,'0',3]:
            c,_=self.request('POST','/mic/start',{'index':value});self.assertIn(c,[400,409])
        self.assertFalse(self.capture.active)
    def test_authenticated_status_heartbeats_keep_only_own_session(self):
        s=self.start();self.time[0]=15;h={**self.base,'X-FlyVJ-Mic':s};c,b=self.request('GET','/mic/status',headers=h);self.assertEqual(c,200);self.assertTrue(b['active']);self.time[0]=20;self.r.expire();self.assertTrue(self.capture.active);self.time[0]=22;self.r.expire();self.assertFalse(self.capture.active)
    def test_wrong_session_does_not_renew_lease_or_stop_new_capture(self):
        a=self.start();self.request('POST','/mic/stop',{'session':a});b=self.start();self.assertNotEqual(a,b);c,_=self.request('POST','/mic/stop',{'session':a});self.assertEqual(c,409);self.assertTrue(self.capture.active);c,_=self.request('GET','/mic/status',headers={**self.base,'X-FlyVJ-Mic':a});self.assertEqual(c,409)
    def test_stop_and_server_close_clear_capture(self):
        s=self.start();c,b=self.request('POST','/mic/stop',{'session':s});self.assertEqual(c,200);self.assertFalse(b['active']);self.start();self.r.close();self.assertFalse(self.capture.active)
    def test_no_raw_audio_or_nonce_in_status(self):
        s=self.start();c,b=self.request('GET','/mic/status',headers={**self.base,'X-FlyVJ-Mic':s});self.assertEqual(c,200);self.assertNotIn('pcm',b);self.assertNotIn('token',b);self.assertNotIn('session',b)
    def test_unknown_paths_do_not_become_proxy(self):
        self.assertIsNone(self.r.handle('GET','/private.wav',self.base,b''));c,b=self.request('POST','/mic/anything');self.assertEqual(c,404);self.assertEqual(self.capture.starts,[])

class MicSnapshotSafetyTests(unittest.TestCase):
    setUp=KinectHTTPTests.setUp
    request=KinectHTTPTests.request
    def test_missing_active_is_never_confirmed_off(self):
        self.request('POST','/mic/start',{'index':0})
        self.capture.stop=lambda:{'state':'off'}
        c,b=self.request('POST','/mic/stop');self.assertNotEqual(c,200);self.assertNotEqual(b.get('active'),False)
    def test_nonfinite_metrics_are_not_serialized_as_live_features(self):
        original=self.capture.snapshot
        self.capture.snapshot=lambda:{**original(),'rms':float('nan')}
        c,b=self.request('GET','/mic/status');self.assertNotEqual(c,200);self.assertEqual(b['state'],'error')

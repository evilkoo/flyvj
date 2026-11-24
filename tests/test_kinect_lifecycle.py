import json,threading,unittest
import test_kinect_http as helper
class MicLeaseLifecycleTests(unittest.TestCase):
    setUp=helper.KinectHTTPTests.setUp
    request=helper.KinectHTTPTests.request
    def test_blocked_start_does_not_block_lease_cleanup(self):
        entered=threading.Event();release=threading.Event();original=self.capture.start
        def blocked(index,**kwargs):
            result=original(index,**kwargs);entered.set();release.wait(1)
            if not self.capture.active:raise RuntimeError('cancelled open')
            return result
        self.capture.start=blocked
        t=threading.Thread(target=lambda:self.request('POST','/mic/start',{'index':0}),daemon=True);t.start();self.assertTrue(entered.wait(.3));self.time[0]=17
        e=threading.Thread(target=self.r.expire,daemon=True);e.start();e.join(.2);finished=not e.is_alive()
        release.set();t.join(1);e.join(1)
        self.assertTrue(finished,'expiry must not wait for a hung native start');self.assertFalse(self.capture.active)
    def test_blocked_device_enumeration_cannot_hold_running_capture_lease(self):
        c,b=self.request('POST','/mic/start',{'index':0});self.assertEqual(c,200)
        entered=threading.Event();release=threading.Event()
        def blocked():entered.set();release.wait(1);return []
        self.capture.list_devices=blocked
        t=threading.Thread(target=lambda:self.request('GET','/mic/devices'),daemon=True);t.start();self.assertTrue(entered.wait(.3));self.time[0]=17
        e=threading.Thread(target=self.r.expire,daemon=True);e.start();e.join(.2);finished=not e.is_alive()
        release.set();t.join(1);e.join(1)
        self.assertTrue(finished,'metadata must not block lease stop');self.assertFalse(self.capture.active)
    def test_failed_start_active_reader_keeps_internal_cleanup_deadline(self):
        def fail_start(index,**kwargs):self.capture.active=True;raise RuntimeError('thread start failed')
        original_stop=self.capture.stop
        self.capture.start=fail_start;self.capture.stop=lambda:(_ for _ in ()).throw(RuntimeError('close failed'))
        c,b=self.request('POST','/mic/start',{'index':0});self.assertEqual(c,409);self.assertTrue(b['active'])
        self.assertIsNotNone(self.r.last_touch);self.capture.stop=original_stop;self.time[0]=110;self.r.expire();self.assertFalse(self.capture.active)

    def test_stale_expiry_cannot_stop_a_new_private_session(self):
        c,b=self.request('POST','/mic/start',{'index':0});old=b['session'];self.time[0]=17
        entered=threading.Event();release=threading.Event();original=self.r._stop
        def delayed(*args,**kwargs):
            if threading.current_thread().name=='old-expiry':entered.set();release.wait(1)
            return original(*args,**kwargs)
        self.r._stop=delayed;th=threading.Thread(target=self.r.expire,name='old-expiry',daemon=True);th.start();self.assertTrue(entered.wait(.3))
        self.request('POST','/mic/stop',{'session':old});c,b=self.request('POST','/mic/start',{'index':0});self.assertEqual(c,200);new=b['session'];before=self.capture.stops
        release.set();th.join(1);self.assertTrue(self.capture.active);self.assertEqual(self.r.session,new);self.assertEqual(self.capture.stops,before)
    def test_expiry_rechecks_a_renewed_lease_inside_stop_reservation(self):
        c,b=self.request('POST','/mic/start',{'index':0});self.time[0]=17
        entered=threading.Event();release=threading.Event();original=self.r._stop
        def delayed(*args,**kwargs):entered.set();release.wait(1);return original(*args,**kwargs)
        self.r._stop=delayed;th=threading.Thread(target=self.r.expire,daemon=True);th.start();self.assertTrue(entered.wait(.3))
        with self.r.lock:self.r.last_touch=self.time[0]
        release.set();th.join(1);self.assertTrue(self.capture.active);self.assertEqual(self.capture.stops,0)

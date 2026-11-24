import importlib
import math
import struct
import threading
import time
import unittest
from unittest.mock import patch


def pcm(freq=0, amplitude=.5):
    return struct.pack('<2048h', *(round(amplitude*32767*math.sin(2*math.pi*freq*i/48000)) for i in range(2048)))


class Reader:
    def __init__(self, chunks=()):
        self.chunks = list(chunks)
        self.closed = False
        self.fail_close = False
        self.fail_read = False
    def read(self):
        if self.fail_read:
            raise RuntimeError('read fault')
        return self.chunks.pop(0) if self.chunks else None
    def close(self):
        if self.fail_close:
            raise RuntimeError('close fault')
        self.closed = True


class Backend:
    def __init__(self, devices=None, reader=None):
        self.devices = devices if devices is not None else [{'index':0,'name':'Azure Kinect Microphone Array'}]
        self.reader = reader or Reader()
        self.opens = []
    def list_devices(self):
        return self.devices
    def open(self, index, sample_rate=48000, frame_size=2048):
        self.opens.append((index, sample_rate, frame_size))
        return self.reader


class KinectTests(unittest.TestCase):
    def setUp(self):
        self.k = importlib.import_module('flyvj_m3.kinect')
    def wait(self, pred):
        end=time.monotonic()+2
        while not pred() and time.monotonic()<end:
            time.sleep(.005)
        self.assertTrue(pred())
    def test_zero(self):
        self.assertEqual(self.k.measure_pcm16(bytes(4096)), {'rms':0.,'bands':{'low':0.,'mid':0.,'high':0.},'clipping':False})
    def test_tones(self):
        for freq, band in [(80,'low'),(880,'mid'),(4200,'high')]:
            m=self.k.measure_pcm16(pcm(freq))
            self.assertAlmostEqual(m['rms'], .5/math.sqrt(2), delta=.02)
            self.assertEqual(max(m['bands'], key=m['bands'].get),band)
            self.assertGreater(m['bands'][band], .45)
            self.assertTrue(all(0<=v<=1 for v in m['bands'].values()))
    def test_invalid(self):
        for data,rate in [(b'',48000),(bytes(4095),48000),(bytes(4098),48000),(bytes(4096),44100),('x'*4096,48000)]:
            with self.assertRaises(self.k.KinectError): self.k.measure_pcm16(data,rate)
    def test_clipping(self):
        self.assertTrue(self.k.measure_pcm16(struct.pack('<2048h', *([32767,-32768]*1024)))['clipping'])
    def test_filter(self):
        c=self.k.KinectCapture(Backend([{'index':1,'name':'Other mic'},{'index':2,'name':'AZURE KINECT array'}]))
        self.assertEqual(c.list_devices(),[{'index':2,'name':'AZURE KINECT array'}])
    def test_reject_identity(self):
        for devices,index in [([],None),([{'index':0,'name':'Other'}],0),([{'index':0,'name':'Azure Kinect'},{'index':1,'name':'Azure Kinect'}],None)]:
            b=Backend(devices); c=self.k.KinectCapture(b)
            with self.assertRaises(self.k.KinectError): c.start(index)
            self.assertFalse(b.opens)
    def test_identity_recheck(self):
        b=Backend(); c=self.k.KinectCapture(b)
        with patch.object(b,'list_devices',side_effect=[b.devices,[{'index':0,'name':'Other'}]]):
            with self.assertRaises(self.k.KinectError): c.start()
        self.assertFalse(b.opens)
    def test_explicit(self):
        b=Backend([{'index':0,'name':'Azure Kinect'},{'index':2,'name':'Azure Kinect'}]);c=self.k.KinectCapture(b)
        try:
            self.assertTrue(c.start(2)['active']);self.assertEqual(b.opens,[(2,48000,2048)])
        finally:c.stop()
    def test_clock_and_clear(self):
        b=Backend(reader=Reader([pcm(880),pcm(80)]));c=self.k.KinectCapture(b)
        try:
            c.start();self.wait(lambda:c.snapshot()['frames']==2)
            s=c.snapshot();self.assertAlmostEqual(s['time'],4096/48000)
            self.assertEqual(set(s),set('state active device time rms bands clipping sample_rate frame_size frames error'.split()))
            s['bands']['low']=99;self.assertNotEqual(c.snapshot()['bands']['low'],99)
        finally:s=c.stop()
        self.assertEqual(s['state'],'off');self.assertFalse(s['active']);self.assertEqual(s['rms'],0);self.assertEqual(s['frames'],0)
        self.assertEqual(c.stop(),s)
    def test_read_error_cleanup(self):
        r=Reader();r.fail_read=True;c=self.k.KinectCapture(Backend(reader=r));c.start()
        self.wait(lambda:c.snapshot()['state']=='error')
        self.wait(lambda:r.closed)
        self.assertFalse(c.snapshot()['active']);self.assertEqual(c.snapshot()['rms'],0)
        c.stop()
    def test_close_error_not_false_off(self):
        r=Reader();r.fail_close=True;c=self.k.KinectCapture(Backend(reader=r));c.start()
        s=c.stop();self.assertTrue(s['active']);self.assertEqual(s['state'],'error');self.assertEqual(s['frames'],0)
        r.fail_close=False;self.assertFalse(c.stop()['active'])
    def test_open_error(self):
        b=Backend();c=self.k.KinectCapture(b)
        with patch.object(b,'open',side_effect=RuntimeError('open fault')):
            with self.assertRaises(self.k.KinectError):c.start()
        self.assertEqual(c.snapshot()['state'],'error');self.assertFalse(c.snapshot()['active'])
    def test_stop_race(self):
        c=self.k.KinectCapture(Backend(reader=Reader([pcm(80)]*10)));c.start()
        threads=[threading.Thread(target=c.stop) for _ in range(5)]
        for t in threads:t.start()
        for t in threads:t.join(2);self.assertFalse(t.is_alive())
        self.assertFalse(c.snapshot()['active']);self.assertEqual(c.snapshot()['rms'],0)



class NativeAPI:
    def __init__(self, k, fail=None, nth=1):
        self.k=k;self.fail=fail;self.nth=nth;self.calls={};self.headers=[]
    def result(self,name):
        self.calls[name]=self.calls.get(name,0)+1
        return 7 if self.fail==name and self.calls[name]==self.nth else 0
    def waveInGetNumDevs(self):return 1
    def waveInGetDevCapsW(self,index,p,size):
        p._obj.szPname='Azure Kinect';return 0
    def waveInOpen(self,p,index,*args):
        result=self.result('open')
        if not result:p._obj.value=123
        return result
    def waveInPrepareHeader(self,h,p,size):return self.result('prepare')
    def waveInAddBuffer(self,h,p,size):
        self.headers.append(p._obj);p._obj.dwFlags=0
        return self.result('add')
    def waveInStart(self,h):return self.result('start')
    def waveInReset(self,h):return self.result('reset')
    def waveInUnprepareHeader(self,h,p,size):return self.result('unprepare')
    def waveInClose(self,h):return self.result('close')


class NativeTests(unittest.TestCase):
    def setUp(self):self.k=importlib.import_module('flyvj_m3.kinect')
    def test_format_abi(self):
        self.assertEqual(self.k.C.sizeof(self.k.WAVEFORMATEX),18)
        self.assertEqual(self.k.C.sizeof(self.k.WAVEHDR),48 if self.k.C.sizeof(self.k.C.c_void_p)==8 else 32)
    def test_four_buffers_read_cleanup(self):
        api=NativeAPI(self.k);r=self.k.WinMMAudio(api).open(0)
        self.assertEqual(len(r.buffers),4);self.assertIsNone(r.read())
        raw,h,_=r.buffers[0];h.dwFlags=1;h.dwBytesRecorded=4096
        self.assertEqual(r.read(),bytes(4096));self.assertEqual(api.calls['add'],5)
        r.close();r.close();self.assertEqual(api.calls['unprepare'],4);self.assertEqual(api.calls['close'],1)
    def test_partial_failures_cleanup(self):
        for name,nth,prepared in [('open',1,0),('prepare',3,2),('add',3,3),('start',1,4)]:
            with self.subTest(name=name):
                api=NativeAPI(self.k,name,nth)
                with self.assertRaises(self.k.KinectError):self.k.WinMMAudio(api).open(0)
                self.assertEqual(api.calls.get('unprepare',0),prepared)
                self.assertEqual(api.calls.get('close',0),0 if name=='open' else 1)
    def test_release_failure_retains_and_retry(self):
        for name in ['reset','unprepare','close']:
            with self.subTest(name=name):
                api=NativeAPI(self.k,name);r=self.k.WinMMAudio(api).open(0)
                with self.assertRaises(self.k.KinectError):r.close()
                self.assertFalse(r.closed);self.assertEqual(len(r.buffers),4);self.assertIn(r,self.k._UNCLOSED)
                r.close();self.assertTrue(r.closed);self.assertNotIn(r,self.k._UNCLOSED)
    def test_start_and_cleanup_failure_retained(self):
        api=NativeAPI(self.k,'start')
        with patch.object(api,'waveInReset',return_value=7):
            with self.assertRaises(self.k.KinectError) as caught:self.k.WinMMAudio(api).open(0)
            r=caught.exception.reader
            self.assertEqual(len(r.buffers),4);self.assertIn(r,self.k._UNCLOSED)
        r.close()
    def test_native_invalid_read_and_requeue(self):
        api=NativeAPI(self.k);r=self.k.WinMMAudio(api).open(0)
        try:
            h=r.buffers[0][1];h.dwFlags=1;h.dwBytesRecorded=2
            with self.assertRaises(self.k.KinectError):r.read()
            h.dwBytesRecorded=4096;api.fail='add';api.nth=5
            with self.assertRaises(self.k.KinectError):r.read()
        finally:r.close()
    def test_native_reject_mapper_other_bool(self):
        api=NativeAPI(self.k)
        for index in [-1,4294967295,1,True,None]:
            with self.assertRaises(self.k.KinectError):self.k.WinMMAudio(api).open(index)
        self.assertNotIn('open',api.calls)
    def test_enumerate_only_matching(self):
        with patch.object(self.k.WinMMAudio,'list_devices',return_value=[{'index':0,'name':'Other'},{'index':1,'name':'Azure Kinect'}]):
            self.assertEqual(self.k.enumerate_kinect_devices(),[{'index':1,'name':'Azure Kinect'}])
    def test_bounded_stop_blocked_read(self):
        entered=threading.Event();release=threading.Event();r=Reader()
        def read():entered.set();release.wait(2);return pcm(880)
        r.read=read;c=self.k.KinectCapture(Backend(reader=r));c.STOP_TIMEOUT=.02;c.start()
        try:
            self.assertTrue(entered.wait(1));begin=time.monotonic();s=c.stop()
            self.assertLess(time.monotonic()-begin,.3);self.assertTrue(s['active']);self.assertEqual(s['state'],'error');self.assertEqual(s['rms'],0)
        finally:release.set();c._thread.join(2)
        self.assertFalse(c.snapshot()['active']);self.assertEqual(c.snapshot()['frames'],0);c.stop()
    def test_bounded_stop_blocked_close(self):
        release=threading.Event();r=Reader()
        def close():release.wait(2);r.closed=True
        r.close=close;c=self.k.KinectCapture(Backend(reader=r));c.STOP_TIMEOUT=.02;c.start()
        try:
            s=c.stop();self.assertTrue(s['active']);self.assertEqual(s['state'],'error')
        finally:release.set();c._thread.join(2)
        self.assertFalse(c.snapshot()['active']);c.stop()
    def test_thread_start_failure_cleanup(self):
        r=Reader();c=self.k.KinectCapture(Backend(reader=r))
        with patch.object(threading.Thread,'start',side_effect=RuntimeError('no threads')):
            with self.assertRaises(self.k.KinectError):c.start()
        c.stop();self.assertTrue(r.closed);self.assertFalse(c.snapshot()['active'])
    def test_restart_resets_and_error_ghosts(self):
        r=Reader([pcm(80)]);b=Backend(reader=r);c=self.k.KinectCapture(b);c.start()
        end=time.monotonic()+2
        while c.snapshot()['frames']==0 and time.monotonic()<end:time.sleep(.005)
        self.assertEqual(c.snapshot()['frames'],1);c.stop();b.reader=Reader();s=c.start()
        self.assertEqual(s['frames'],0);self.assertEqual(s['rms'],0);c.stop()
    def test_read_and_close_fault_preserves_both(self):
        r=Reader();r.fail_read=r.fail_close=True;c=self.k.KinectCapture(Backend(reader=r));c.start();c._thread.join(2)
        try:
            s=c.snapshot();self.assertTrue(s['active']);self.assertIn('read fault',s['error']);self.assertIn('close fault',s['error'])
        finally:r.fail_close=False;c.stop()
    def test_partial_allocation_cleanup(self):
        api=NativeAPI(self.k);original=self.k.C.create_string_buffer;counter=[0]
        def allocate(*args):
            counter[0]+=1
            if counter[0]==3:raise MemoryError('allocation failure')
            return original(*args)
        with patch.object(self.k.C,'create_string_buffer',side_effect=allocate):
            with self.assertRaises(self.k.KinectError):self.k.WinMMAudio(api).open(0)
        self.assertEqual(api.calls['unprepare'],2);self.assertEqual(api.calls['close'],1)
    def test_capture_start_cleanup_fail_active(self):
        api=NativeAPI(self.k,'start');c=self.k.KinectCapture(self.k.WinMMAudio(api))
        with patch.object(api,'waveInReset',return_value=7):
            with self.assertRaises(self.k.KinectError):c.start()
            self.assertTrue(c.snapshot()['active']);self.assertEqual(c.snapshot()['state'],'error')
        self.assertFalse(c.stop()['active'])


if __name__=='__main__': unittest.main()

"""Process isolation tests: fake subprocesses/jobs only; never open a microphone."""
import importlib
import io
import json
import queue
import subprocess
import threading
import time
import unittest


def packet(index=0, frames=0, **overrides):
    s=dict(state='running',active=True,device={'index':index,'name':'Azure Kinect Microphone Array'},
           time=frames*2048/48000,rms=.2,bands={'low':.1,'mid':.2,'high':.3},
           clipping=False,sample_rate=48000,frame_size=2048,frames=frames,error=None)
    s.update(overrides)
    return s


def line(kind, **payload):
    return (json.dumps(dict(kind=kind,**payload))+'\n').encode()


class Pipe:
    def __init__(self):self.q=queue.Queue();self.closed=False
    def feed(self,b):self.q.put(b)
    def readline(self,size):
        b=self.q.get()
        return b[:size]
    def close(self):self.closed=True


class ControlWriter:
    def __init__(self):self.closed=False;self.last=None
    def write(self,data):
        if self.closed:raise OSError('closed')
        self.last=data;return len(data)
    def flush(self):pass
    def close(self):self.closed=True


class Process:
    next_pid=100
    def __init__(self,kind,index=0,script='normal',killable=True):
        type(self).next_pid+=1;self.pid=type(self).next_pid
        self.kind=kind;self.index=index;self.script=script;self.killable=killable
        self.stdout=Pipe();self.stdin=ControlWriter();self.returncode=None;self.exited=threading.Event()
        self.resumed=False;self.terminate_calls=0
    def resume(self):
        if self.returncode is not None:return
        self.resumed=True
        if self.kind=='list':
            self.stdout.feed(line('devices',devices=[{'index':0,'name':'Azure Kinect Microphone Array'}]))
        elif self.script=='normal':self.stdout.feed(line('ready',snapshot=packet(self.index)))
        elif self.script=='eof':self.stdout.feed(b'')
        elif self.script=='error':self.stdout.feed(line('error',error='native start failed'))
        elif isinstance(self.script,bytes):self.stdout.feed(self.script)
    def poll(self):return self.returncode
    def terminate(self):
        self.terminate_calls+=1
        if self.killable:self.exit()
    def exit(self):
        if self.returncode is None:
            self.returncode=0;self.exited.set();self.stdout.feed(b'')
    def wait(self,timeout=None):
        if not self.exited.wait(timeout):raise subprocess.TimeoutExpired('fake',timeout)
        return self.returncode


class Factory:
    def __init__(self,script='normal',killable=True):
        self.script=script;self.killable=killable;self.processes=[];self.jobs=[];self.calls=[]
        self.spawn_entered=threading.Event();self.spawn_release=None;self.job_fail=False;self.attach_fail=False
        self.close_block=None;self.capture=None;self.publish_seen=False
    def job(self):
        if self.job_fail:raise OSError('job creation failed')
        f=self
        class Job:
            def __init__(self):self.process=None;self.closed=False
            def attach_and_resume(self,pid):
                f.calls.append('attach')
                self.process=next(p for p in f.processes if p.pid==pid)
                if f.capture and f.capture._current:
                    f.publish_seen=f.capture._current.owners[-1].process is self.process and f.capture._current.owners[-1].job is self
                if f.attach_fail:raise OSError('attach failed')
                if self.closed:raise OSError('job closed')
                f.calls.append('resume');self.process.resume()
            def close(self):
                f.calls.append('job-close')
                if f.close_block:f.close_block.wait(2)
                self.closed=True
                if self.process:self.process.terminate()
        j=Job();self.jobs.append(j);return j
    def popen(self,args,**kwargs):
        self.calls.append(('popen',args,kwargs));self.spawn_entered.set()
        if self.spawn_release:self.spawn_release.wait(2)
        kind='list' if '--list' in args else 'capture'
        index=int(args[args.index('--index')+1]) if kind=='capture' else 0
        p=Process(kind,index,self.script,self.killable);self.processes.append(p);return p


class ProcessTests(unittest.TestCase):
    def setUp(self):self.m=importlib.import_module('flyvj_m3.kinect_process');self.captures=[]
    def tearDown(self):
        for c,f in self.captures:
            if f.spawn_release:f.spawn_release.set()
            if f.close_block:f.close_block.set()
            for p in f.processes:p.killable=True;p.exit()
            c.close()
    def capture(self,**kwargs):
        f=kwargs.pop('factory',Factory());c=self.m.KinectProcessCapture(popen_factory=f.popen,job_factory=f.job,
             query_timeout=.12,start_timeout=.18,stop_timeout=.10,heartbeat_timeout=.4,**kwargs)
        f.capture=c;self.captures.append((c,f));return c,f
    def wait(self,pred):
        deadline=time.monotonic()+1
        while not pred() and time.monotonic()<deadline:time.sleep(.002)
        self.assertTrue(pred())
    def test_import_flags_no_raw_driver_import(self):
        self.assertEqual(self.m.PROCESS_CAPTURE_API,1);self.assertTrue(self.m.ISOLATED_NATIVE_AUDIO)
    def test_explicit_start_ack_and_ownership_before_resume(self):
        c,f=self.capture();s=c.start(0)
        self.assertTrue(s['active']);self.assertEqual(s['state'],'running');self.assertTrue(f.publish_seen)
        args,kw=f.calls[0][1:];self.assertIn('--index',args);self.assertNotIn('--list',args)
        self.assertEqual(kw['creationflags'] & (4|0x08000000),4|0x08000000)
        self.assertTrue(kw['close_fds']);self.assertEqual(kw['stderr'],subprocess.DEVNULL)
        self.assertFalse(c.stop()['active'])
    def test_query_only_then_single_index(self):
        c,f=self.capture();devices=c.list_devices();self.assertEqual(devices[0]['index'],0)
        self.assertEqual(f.processes[0].kind,'list');self.assertFalse(c.snapshot()['active'])
        s=c.start();self.assertEqual(s['device']['index'],0)
        self.assertEqual([p.kind for p in f.processes],['list','list','capture'])
    def test_bad_indices_never_spawn(self):
        c,f=self.capture()
        for index in [-1,True,'0',4294967295]:
            with self.assertRaises(self.m.KinectError):c.start(index)
        self.assertFalse(f.processes)
    def test_no_ready_hung_open_bounded_and_killed(self):
        c,f=self.capture(factory=Factory(script='hung'));begin=time.monotonic()
        with self.assertRaises(self.m.KinectError):c.start(0)
        self.assertLess(time.monotonic()-begin,.5)
        self.wait(lambda:f.processes[0].poll() is not None);self.wait(lambda:not c.snapshot()['active'])
    def test_stop_pending_late_spawn_never_resume(self):
        f=Factory();f.spawn_release=threading.Event();c,f=self.capture(factory=f);errors=[]
        def start():
            try:c.start(0)
            except self.m.KinectError as e:errors.append(str(e))
        t=threading.Thread(target=start);t.start();self.assertTrue(f.spawn_entered.wait(1))
        begin=time.monotonic();s=c.stop();self.assertLess(time.monotonic()-begin,.3)
        self.assertTrue(s['active']);self.assertEqual(s['state'],'error')
        begin=time.monotonic();c.snapshot();self.assertLess(time.monotonic()-begin,.03)
        f.spawn_release.set();t.join(1);self.wait(lambda:f.processes and f.processes[0].poll() is not None)
        self.assertFalse(f.processes[0].resumed);self.wait(lambda:not c.snapshot()['active']);self.assertTrue(errors)
    def test_eof_and_leaked_failure_force_kill(self):
        for script in ['eof','error']:
            c,f=self.capture(factory=Factory(script=script))
            with self.assertRaises(self.m.KinectError):c.start(0)
            self.wait(lambda:f.processes[0].poll() is not None)
    def test_job_creation_and_attach_fail(self):
        for attr in ['job_fail','attach_fail']:
            f=Factory();setattr(f,attr,True);c,f=self.capture(factory=f)
            with self.assertRaises(self.m.KinectError):c.start(0)
            self.assertNotIn('resume',f.calls)
            self.wait(lambda:all(p.poll() is not None for p in f.processes))
    def test_unconfirmed_exit_not_false_off(self):
        c,f=self.capture(factory=Factory(killable=False));c.start(0);s=c.stop()
        self.assertTrue(s['active']);self.assertEqual(s['state'],'error');self.assertEqual(s['frames'],0)
        with self.assertRaises(self.m.KinectError):c.start(0)
        f.processes[0].exit();self.wait(lambda:not c.snapshot()['active'])
    def test_job_close_hang_does_not_hold_lock_or_prevent_terminate(self):
        f=Factory();f.close_block=threading.Event();c,f=self.capture(factory=f);c.start(0)
        begin=time.monotonic();s=c.stop();self.assertLess(time.monotonic()-begin,.3)
        self.assertFalse(s['active']);self.assertGreater(f.processes[0].terminate_calls,0)
    def test_bad_json_oversize_nonfinite_and_bad_identity(self):
        scripts=[b'{no}\n',b'x'*8193,b'{"kind":"ready","snapshot":NaN}\n',
                 line('ready',snapshot=packet(5)),line('ready',snapshot=packet(device={'index':0,'name':'Other mic'})),
                 line('ready',snapshot=packet(active=False)),line('ready',snapshot=packet(time=99)),
                 line('ready',snapshot=packet(frames=True)),line('ready',snapshot=packet(rms=float('inf')))]
        for script in scripts:
            with self.subTest(script=script[:70]):
                c,f=self.capture(factory=Factory(script=script))
                with self.assertRaises(self.m.KinectError):c.start(0)
                self.wait(lambda:f.processes[0].poll() is not None)
    def test_clock_current_only_and_clear(self):
        c,f=self.capture();c.start(0);p=f.processes[0]
        p.stdout.feed(line('status',snapshot=packet(frames=9)))
        self.wait(lambda:c.snapshot()['frames']==9);s=c.snapshot();self.assertEqual(s['time'],9*2048/48000)
        s['bands']['low']=123;self.assertEqual(c.snapshot()['bands']['low'],.1)
        c.stop();self.assertEqual(c.snapshot()['frames'],0);self.assertEqual(c.snapshot()['rms'],0)
    def test_heartbeat_lost_ready_kills(self):
        c,f=self.capture();c.start(0);self.wait(lambda:f.processes[0].poll() is not None)
        self.wait(lambda:not c.snapshot()['active']);self.assertEqual(c.snapshot()['state'],'error')
    def test_old_cleanup_and_late_packet_cannot_kill_new(self):
        f=Factory();f.close_block=threading.Event();c,f=self.capture(factory=f);c.start(0);old=f.processes[0]
        c.stop();c.start(0);new=f.processes[-1]
        old.stdout.feed(line('ready',snapshot=packet(frames=999)));f.close_block.set();time.sleep(.02)
        self.assertIsNone(new.poll());self.assertTrue(c.snapshot()['active']);self.assertEqual(c.snapshot()['frames'],0)
    def test_shutdown_prevents_new_spawn(self):
        c,f=self.capture();c.start(0);s=c.shutdown();self.assertFalse(s['active'])
        with self.assertRaises(self.m.KinectError):c.start(0)
        with self.assertRaises(self.m.KinectError):c.list_devices()
        self.assertEqual(c.stop()['state'],'off')



class ExtendedProcessTests(unittest.TestCase):
    setUp = ProcessTests.setUp
    tearDown = ProcessTests.tearDown
    capture = ProcessTests.capture
    wait = ProcessTests.wait
    # Reuse only fixture/helpers, not the initial test cases (removed below).
    def test_duplicate_json_keys_rejected(self):
        raw=line('ready',snapshot=packet()).replace(b'"kind": "ready"',b'"kind":"error","kind":"ready"')
        c,f=self.capture(factory=Factory(script=raw))
        with self.assertRaises(self.m.KinectError):c.start(0)
        self.wait(lambda:f.processes[0].poll() is not None)
    def test_outstanding_hung_query_is_bounded(self):
        f=Factory();f.spawn_release=threading.Event();c,f=self.capture(factory=f)
        with self.assertRaises(self.m.KinectError):c.list_devices()
        calls_before=len(f.jobs)
        with self.assertRaises(self.m.KinectError):c.list_devices()
        self.assertEqual(len(f.jobs),calls_before)
    def test_query_empty_ambiguous_and_other_identity(self):
        for devices in [[],[{'index':0,'name':'Azure Kinect'},{'index':1,'name':'Azure Kinect'}],[{'index':0,'name':'Other microphone'}]]:
            f=Factory();original=f.popen
            def popen(*args,_devices=devices,**kwargs):
                p=original(*args,**kwargs)
                def resume():p.resumed=True;p.stdout.feed(line('devices',devices=_devices))
                p.resume=resume;return p
            f.popen=popen;c,f=self.capture(factory=f)
            with self.assertRaises(self.m.KinectError):c.start()
            self.assertTrue(all(p.kind=='list' for p in f.processes))
    def test_query_timeout_does_not_capture(self):
        f=Factory();original=f.popen
        def popen(*args,**kwargs):
            p=original(*args,**kwargs);p.resume=lambda:None;return p
        f.popen=popen;c,f=self.capture(factory=f)
        begin=time.monotonic()
        with self.assertRaises(self.m.KinectError):c.list_devices()
        self.assertLess(time.monotonic()-begin,.3);self.wait(lambda:f.processes[0].poll() is not None)
        self.assertTrue(all(p.kind=='list' for p in f.processes));self.assertFalse(c.snapshot()['active'])
    def test_attach_hang_does_not_block_snapshot_or_stop(self):
        f=Factory();original=f.job;entered=threading.Event();release=threading.Event()
        def job():
            j=original();attach=j.attach_and_resume
            def blocked(pid):entered.set();release.wait(2);attach(pid)
            j.attach_and_resume=blocked;return j
        f.job=job;c,f=self.capture(factory=f);errors=[]
        def run():
            try:c.start(0)
            except self.m.KinectError as exc:errors.append(str(exc))
        t=threading.Thread(target=run);t.start();self.assertTrue(entered.wait(1))
        try:
            begin=time.monotonic();c.snapshot();self.assertLess(time.monotonic()-begin,.03)
            s=c.stop();self.assertTrue(s['active']);self.assertIsNotNone(f.processes[0].poll())
        finally:release.set();t.join(1)
        self.wait(lambda:not c.snapshot()['active']);self.assertFalse(f.processes[0].resumed)
    def test_job_close_raises_direct_popen_termination(self):
        f=Factory();original=f.job
        def job():
            j=original()
            def close():raise OSError('close failed')
            j.close=close;return j
        f.job=job;c,f=self.capture(factory=f);c.start(0)
        self.assertFalse(c.stop()['active']);self.assertGreater(f.processes[0].terminate_calls,0)
    def test_invalid_status_clock_identity_and_pcm_rejected(self):
        for update in [packet(frames=1,time=10),packet(device={'index':0,'name':'Azure Kinect changed'}),dict(packet(),pcm='forbidden'),packet(state='error',error='driver fault'),packet(active=False),packet(bands={'low':True,'mid':0,'high':0})]:
            c,f=self.capture();c.start(0);f.processes[0].stdout.feed(line('status',snapshot=update))
            self.wait(lambda:f.processes[0].poll() is not None);self.wait(lambda:not c.snapshot()['active'])
            self.assertEqual(c.snapshot()['state'],'error');self.assertEqual(c.snapshot()['rms'],0)
    def test_eof_after_ready_and_clock_regression(self):
        c,f=self.capture();c.start(0);f.processes[0].stdout.feed(b'')
        self.wait(lambda:f.processes[0].poll() is not None)
        c,f=self.capture();c.start(0);p=f.processes[0];p.stdout.feed(line('status',snapshot=packet(frames=9)))
        self.wait(lambda:c.snapshot()['frames']==9);p.stdout.feed(line('status',snapshot=packet(frames=8)))
        self.wait(lambda:p.poll() is not None)
    def test_stop_concurrent_calls_and_late_ready_no_resurrection(self):
        c,f=self.capture();c.start(0);p=f.processes[0]
        threads=[threading.Thread(target=c.stop) for _ in range(6)]
        for t in threads:t.start()
        p.stdout.feed(line('ready',snapshot=packet(frames=300)))
        for t in threads:t.join(.5);self.assertFalse(t.is_alive())
        self.assertFalse(c.snapshot()['active']);self.assertEqual(c.snapshot()['frames'],0)
    def test_poll_fault_and_job_close_fault_still_attempt_terminate(self):
        f=Factory();original_job=f.job;original_popen=f.popen
        def job():
            j=original_job()
            def close():raise OSError('job close failed')
            j.close=close;return j
        def popen(*args,**kwargs):
            p=original_popen(*args,**kwargs)
            def poll():raise OSError('poll failed')
            p.poll=poll;return p
        f.job=job;f.popen=popen;c,f=self.capture(factory=f);c.start(0)
        s=c.stop();self.assertFalse(s['active']);self.assertGreater(f.processes[0].terminate_calls,0)
    def test_cancel_while_job_constructor_hangs_never_spawns(self):
        f=Factory();original=f.job;entered=threading.Event();release=threading.Event()
        def job():entered.set();release.wait(2);return original()
        f.job=job;c,f=self.capture(factory=f)
        def run():
            try:c.start(0)
            except self.m.KinectError:pass
        t=threading.Thread(target=run);t.start();self.assertTrue(entered.wait(1))
        try:
            begin=time.monotonic();c.snapshot();self.assertLess(time.monotonic()-begin,.03)
            self.assertTrue(c.stop()['active']);self.assertFalse(f.processes)
        finally:release.set();t.join(1)
        self.wait(lambda:not c.snapshot()['active']);self.assertFalse(f.processes)
    def test_parent_has_no_raw_driver_import(self):
        import ast
        from pathlib import Path
        tree=ast.parse(Path(self.m.__file__).read_text(encoding='utf-8'))
        imports=[node.module for node in ast.walk(tree) if isinstance(node,ast.ImportFrom)]
        self.assertFalse(any(name and name.endswith('.kinect') for name in imports))
        self.assertNotIn('WinDLL',Path(self.m.__file__).read_text(encoding='utf-8'))


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.w=importlib.import_module('flyvj_m3.kinect_worker');self.controls=[]
    def tearDown(self):
        for control in self.controls:control.feed(b'')
    def control_args(self):
        control=Pipe();control.feed(('K1 '+str(time.monotonic_ns())+'\n').encode());self.controls.append(control)
        return dict(control_input=control,hard_exit=lambda code:None)

    def test_list_never_constructs_or_starts_capture(self):
        output=io.BytesIO()
        def forbidden():self.fail('query constructed capture')
        result=self.w.main(['--list'],**self.control_args(),capture_factory=forbidden,enumerate_devices=lambda:[{'index':0,'name':'Azure Kinect'}],output=output)
        self.assertEqual(result,0);self.assertEqual(json.loads(output.getvalue())['kind'],'devices')
    def test_worker_start_failure_has_no_raw_exception_in_stdout(self):
        class Capture:
            def __init__(self):self.stopped=False
            def start(self,index):raise RuntimeError('PRIVATE_PCM_SHOULD_NEVER_LEAVE')
            def stop(self):self.stopped=True
        c=Capture();output=io.BytesIO()
        result=self.w.main(['--index','0'],**self.control_args(),capture_factory=lambda:c,enumerate_devices=lambda:[],output=output)
        self.assertEqual(result,1);self.assertTrue(c.stopped);self.assertNotIn(b'PRIVATE',output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['kind'],'error')
    def test_worker_ready_current_aggregate_and_error_cleanup(self):
        class Capture:
            def __init__(self):self.stopped=False;self.count=0
            def start(self,index):self.index=index;return packet(index)
            def snapshot(self):
                self.count+=1
                if self.count==2:raise RuntimeError('read failed')
                return packet(self.index,frames=5)
            def stop(self):self.stopped=True
        c=Capture();output=io.BytesIO()
        result=self.w.main(['--index','2'],**self.control_args(),capture_factory=lambda:c,enumerate_devices=lambda:[],output=output,sleep=lambda _:None)
        messages=[json.loads(x) for x in output.getvalue().splitlines()]
        self.assertEqual([x['kind'] for x in messages],['ready','status','error'])
        self.assertEqual(messages[1]['snapshot']['time'],5*2048/48000);self.assertTrue(c.stopped);self.assertEqual(result,1)
    def test_worker_emit_finite_bounded(self):
        for message in [{'rms':float('nan')},{'x':'x'*8192}]:
            output=io.BytesIO()
            with self.assertRaises(ValueError):self.w._emit(message,output)
            self.assertFalse(output.getvalue())

class WatchdogTests(unittest.TestCase):
    setUp = ProcessTests.setUp
    tearDown = ProcessTests.tearDown
    capture = ProcessTests.capture
    wait = ProcessTests.wait
    def test_heartbeat_cannot_hide_stuck_native_sample_clock(self):
        c,f=self.capture(sample_timeout=.10);c.start(0);p=f.processes[0]
        deadline=time.monotonic()+.3
        while p.poll() is None and time.monotonic()<deadline:
            p.stdout.feed(line('status',snapshot=packet(frames=0)));time.sleep(.015)
        self.assertIsNotNone(p.poll());self.wait(lambda:not c.snapshot()['active'])
        self.assertIn('sample clock',c.snapshot()['error'].lower())




class ExternalCancelTests(unittest.TestCase):
    setUp = ProcessTests.setUp
    tearDown = ProcessTests.tearDown
    capture = ProcessTests.capture
    wait = ProcessTests.wait

    def background_start(self,c,event,index=0):
        outcome={}
        def run():
            try:outcome['result']=c.start(index,cancel_event=event)
            except Exception as exc:outcome['error']=exc
        thread=threading.Thread(target=run);thread.start();return thread,outcome

    def test_manager_stop_before_callback_start_call_never_dispatches(self):
        c,f=self.capture();event=threading.Event()
        event.set();c.stop()  # manager expired its reservation before callback entered
        for index in (None,0):
            with self.assertRaises(self.m.KinectError):c.start(index,cancel_event=event)
        self.assertFalse(f.jobs);self.assertFalse(f.processes);self.assertFalse(c.snapshot()['active'])

    def test_expired_old_callback_does_not_touch_new_active_session(self):
        c,f=self.capture();old=threading.Event();old.set();new=threading.Event()
        c.start(0,cancel_event=new);process=f.processes[0]
        with self.assertRaises(self.m.KinectError):c.start(0,cancel_event=old)
        self.assertTrue(c.snapshot()['active']);self.assertIsNone(process.poll());self.assertFalse(new.is_set())

    def test_cancel_before_ack_no_ready_resurrection(self):
        c,f=self.capture(factory=Factory(script='hung'));event=threading.Event()
        thread,outcome=self.background_start(c,event)
        try:
            self.wait(lambda:bool(f.processes) or bool(outcome))
            self.assertTrue(f.processes,repr(outcome))
            event.set();f.processes[0].stdout.feed(line('ready',snapshot=packet()))
            thread.join(.5);self.assertFalse(thread.is_alive());self.assertNotIn('result',outcome)
            self.assertIsInstance(outcome.get('error'),self.m.KinectError)
            self.wait(lambda:f.processes[0].poll() is not None);self.wait(lambda:not c.snapshot()['active'])
            self.assertEqual(c.snapshot()['frames'],0)
        finally:event.set();thread.join(1)

    def test_cancel_after_ack_root_watcher_works_without_caller_poll(self):
        c,f=self.capture();event=threading.Event();c.start(0,cancel_event=event)
        process=f.processes[0];event.set()
        self.assertTrue(process.exited.wait(.15),'root watcher did not close a live capture')
        self.wait(lambda:not c.snapshot()['active']);self.assertEqual(c.snapshot()['rms'],0)

    def test_cancel_during_late_suspended_spawn_no_resume(self):
        f=Factory();f.spawn_release=threading.Event();c,f=self.capture(factory=f);event=threading.Event()
        thread,outcome=self.background_start(c,event)
        try:
            self.wait(lambda:f.spawn_entered.is_set() or bool(outcome));self.assertTrue(f.spawn_entered.is_set(),repr(outcome))
            event.set();thread.join(.1);self.assertFalse(thread.is_alive(),'start did not observe external cancel')
            self.assertTrue(c.snapshot()['active'])
            self.wait(lambda:bool(f.jobs) and f.jobs[0].closed)
            f.spawn_release.set();self.wait(lambda:bool(f.processes) and f.processes[0].poll() is not None)
            self.assertFalse(f.processes[0].resumed);self.wait(lambda:not c.snapshot()['active'])
        finally:f.spawn_release.set();event.set();thread.join(1)

    def test_late_query_cannot_dispatch_capture_after_manager_cancel(self):
        f=Factory();original=f.popen;event=threading.Event()
        def popen(*args,**kwargs):
            p=original(*args,**kwargs)
            def resume():
                p.resumed=True;event.set()
                p.stdout.feed(line('devices',devices=[{'index':0,'name':'Azure Kinect'}]))
            p.resume=resume;return p
        f.popen=popen;c,f=self.capture(factory=f)
        with self.assertRaises(self.m.KinectError):c.start(cancel_event=event)
        self.assertTrue(all(p.kind=='list' for p in f.processes))
        self.wait(lambda:all(p.poll() is not None for p in f.processes))

    def test_event_set_inside_attach_before_resume_is_guarded(self):
        from types import SimpleNamespace
        f=Factory();original=f.job;event=threading.Event();resumes=[]
        def job():
            j=original()
            def resume(handle):
                resumes.append(handle);j.process.resume();return 1
            j.api=SimpleNamespace(ResumeThread=resume)
            def attach(pid):
                j.process=next(p for p in f.processes if p.pid==pid)
                event.set()
                j.api.ResumeThread(pid)
            j.attach_and_resume=attach;return j
        f.job=job;c,f=self.capture(factory=f)
        with self.assertRaises(self.m.KinectError):c.start(0,cancel_event=event)
        self.assertFalse(resumes);self.assertFalse(any(p.resumed for p in f.processes))
        self.wait(lambda:all(p.poll() is not None for p in f.processes))

    def test_cancel_during_ready_validation_cannot_publish_features(self):
        from unittest.mock import patch
        c,f=self.capture();event=threading.Event();validate=self.m._validate_snapshot
        def check(*args,**kwargs):
            result=validate(*args,**kwargs);event.set();return result
        with patch.object(self.m,'_validate_snapshot',side_effect=check):
            with self.assertRaises(self.m.KinectError):c.start(0,cancel_event=event)
        self.wait(lambda:f.processes[0].poll() is not None);self.assertEqual(c.snapshot()['rms'],0)

    def test_root_watcher_not_blocked_by_attach_or_ignored_ack(self):
        f=Factory();original=f.job;entered=threading.Event();release=threading.Event();event=threading.Event()
        def job():
            j=original()
            def attach(pid):
                j.process=next(p for p in f.processes if p.pid==pid)
                entered.set();release.wait(1)
                if not j.closed:j.process.resume()
            j.attach_and_resume=attach;return j
        f.job=job;c,f=self.capture(factory=f);thread,outcome=self.background_start(c,event)
        try:
            self.wait(lambda:entered.is_set() or bool(outcome));self.assertTrue(entered.is_set(),repr(outcome))
            event.set();self.assertTrue(f.processes[0].exited.wait(.15))
            self.assertTrue(c.snapshot()['active'],'attach still unresolved must not be marked off')
        finally:release.set();event.set();thread.join(1)
        self.wait(lambda:not c.snapshot()['active']);self.assertFalse(f.processes[0].resumed)

    def test_old_event_watcher_cannot_cancel_new_generation(self):
        c,f=self.capture();old=threading.Event();c.start(0,cancel_event=old);c.stop()
        new=threading.Event();c.start(0,cancel_event=new);process=f.processes[-1]
        old.set();time.sleep(.03)
        self.assertIsNone(process.poll());self.assertTrue(c.snapshot()['active']);self.assertFalse(new.is_set())

    def test_cancel_at_final_publish_checkpoint_never_emits_running_update(self):
        from unittest.mock import patch
        c,f=self.capture();event=threading.Event();c.start(0,cancel_event=event)
        owner=c._current.owners[-1];published=[]
        class Identity:
            def __ne__(self,other):event.set();return False
        owner.identity=Identity()
        def assign(obj,name,value):
            if obj is c and name=='_snapshot' and value['state']=='running' and event.is_set():
                published.append(value)
            object.__setattr__(obj,name,value)
        with patch.object(type(c),'__setattr__',assign):
            c._accept(c._current,owner,{'kind':'status','snapshot':packet(frames=1)})
            self.assertFalse(published,'cancelled aggregate was published as running')
        self.wait(lambda:f.processes[0].poll() is not None)

    def test_external_cancel_exit_unconfirmed_remains_active(self):
        c,f=self.capture(factory=Factory(killable=False));event=threading.Event();c.start(0,cancel_event=event)
        event.set();self.wait(lambda:f.processes[0].terminate_calls>0)
        self.assertTrue(c.snapshot()['active']);self.assertEqual(c.snapshot()['state'],'error');self.assertEqual(c.snapshot()['rms'],0)
        f.processes[0].exit();self.wait(lambda:not c.snapshot()['active'])




class CleanupLaunchTests(unittest.TestCase):
    setUp = ProcessTests.setUp
    tearDown = ProcessTests.tearDown
    capture = ProcessTests.capture
    wait = ProcessTests.wait

    def test_one_job_cleanup_thread_failure_does_not_skip_terminate(self):
        c,f=self.capture();c.start(0);original=c._thread;failed=[]
        def launch(target,*args):
            if target.__name__=='_close_job' and not failed:
                failed.append(True);raise RuntimeError('one thread-create failure')
            return original(target,*args)
        c._thread=launch
        try:
            c.stop();self.wait(lambda:f.processes[0].exited.is_set())
            self.assertGreater(f.processes[0].terminate_calls,0)
            c.stop();self.wait(lambda:f.jobs[0].closed)
        finally:c._thread=original

    def test_one_terminate_thread_failure_rolls_back_marker_and_retries(self):
        c,f=self.capture();c.start(0);original=c._thread;failed=[]
        def launch(target,*args):
            if target.__name__=='_terminate_and_wait' and not failed:
                failed.append(True);raise RuntimeError('one thread-create failure')
            return original(target,*args)
        c._thread=launch
        try:
            c.stop();self.wait(lambda:f.processes[0].exited.is_set())
            c.stop();self.wait(lambda:not c.snapshot()['active'])
        finally:c._thread=original

    def test_both_thread_launch_failures_leave_retryable_unknown_not_abandoned(self):
        c,f=self.capture();c.start(0);original=c._thread
        def launch(target,*args):
            if target.__name__ in ('_close_job','_terminate_and_wait'):
                raise RuntimeError('temporary thread allocation failure')
            return original(target,*args)
        c._thread=launch
        try:
            s=c.stop();self.assertTrue(s['active']);self.assertEqual(s['state'],'error')
            owner=c._current.owners[-1]
            self.assertFalse(owner.job_close_started);self.assertFalse(owner.terminate_started)
        finally:c._thread=original
        c.stop();self.wait(lambda:not c.snapshot()['active']);self.assertTrue(f.jobs[0].closed)


class ChildControlLeaseTests(unittest.TestCase):
    def setUp(self):self.w=importlib.import_module('flyvj_m3.kinect_worker')

    def run_blocked(self,mode,loss):
        control=Pipe();entered=threading.Event();release=threading.Event();exited=threading.Event();codes=[]
        normal_output=io.BytesIO()
        def hard_exit(code):codes.append(code);exited.set()
        class Capture:
            def start(self,index):
                if mode=='open':entered.set();release.wait(1)
                if mode=='close':raise RuntimeError('open failed; cleanup blocks')
                return packet(index)
            def snapshot(self):return packet()
            def stop(self):
                if mode=='close':entered.set();release.wait(1)
        class Output:
            def write(self,data):
                if mode=='stdout':entered.set();release.wait(1)
                return normal_output.write(data)
            def flush(self):pass
        result={}
        def run():
            try:
                result['code']=self.w.main(['--index','0'],capture_factory=Capture,enumerate_devices=lambda:[],
                    output=Output(),control_input=control,hard_exit=hard_exit,control_lease_seconds=.06,
                    sleep=lambda _: (_ for _ in ()).throw(RuntimeError('end probe')))
            except Exception as exc:result['error']=exc
        thread=threading.Thread(target=run,daemon=True);thread.start()
        try:
            # Native open must wait for first valid parent control heartbeat.
            self.assertFalse(entered.wait(.015))
            control.feed(('K1 '+str(time.monotonic_ns())+'\n').encode())
            self.assertTrue(entered.wait(.2),repr(result))
            begin=time.monotonic()
            if loss=='eof':control.feed(b'')
            self.assertTrue(exited.wait(.25),'child did not hard-exit independently')
            self.assertLess(time.monotonic()-begin,.25);self.assertEqual(codes,[74])
            self.assertTrue(thread.is_alive(),'blocked native/output path unexpectedly supplied the exit')
        finally:release.set();control.feed(b'');thread.join(1)

    def test_control_eof_hard_exits_while_open_close_or_stdout_blocked(self):
        for mode in ('open','close','stdout'):
            with self.subTest(mode=mode):self.run_blocked(mode,'eof')

    def test_control_expiry_hard_exits_while_open_close_or_stdout_blocked(self):
        for mode in ('open','close','stdout'):
            with self.subTest(mode=mode):self.run_blocked(mode,'expire')

    def test_stale_future_invalid_control_cannot_extend_lease(self):
        for data in [b'bad\n',b'X'*65,('K1 '+str(time.monotonic_ns()-10_000_000_000)+'\n').encode(),
                     ('K1 '+str(time.monotonic_ns()+60_000_000_000)+'\n').encode()]:
            control=Pipe();died=threading.Event();codes=[]
            lease=self.w._ControlLease(control,lease_seconds=.08,hard_exit=lambda code:(codes.append(code),died.set()))
            try:
                lease.start();control.feed(data);self.assertTrue(died.wait(.2));self.assertEqual(codes,[74])
            finally:lease.stop();control.feed(b'')

    def test_valid_timestamped_heartbeats_renew_but_silence_expires(self):
        control=Pipe();died=threading.Event()
        lease=self.w._ControlLease(control,lease_seconds=.08,hard_exit=lambda _:died.set())
        try:
            lease.start()
            for _ in range(6):
                control.feed(('K1 '+str(time.monotonic_ns())+'\n').encode());time.sleep(.02)
                self.assertFalse(died.is_set())
            self.assertTrue(died.wait(.2))
        finally:lease.stop();control.feed(b'')




class ParentControlTests(unittest.TestCase):
    setUp = ProcessTests.setUp
    tearDown = ProcessTests.tearDown
    capture = ProcessTests.capture
    wait = ProcessTests.wait
    def test_parent_control_is_pipe_bounded_timestamp_and_stops_with_owner(self):
        c,f=self.capture();c.start(0);p=f.processes[0]
        self.wait(lambda:p.stdin.last is not None)
        pulse=p.stdin.last
        self.assertTrue(pulse.startswith(b'K1 '));self.assertLessEqual(len(pulse),64)
        self.assertLessEqual(int(pulse[3:-1]),time.monotonic_ns())
        self.assertEqual(f.calls[0][2]['stdin'],subprocess.PIPE)
        c.stop();self.wait(lambda:p.stdin.closed)
    def test_control_sender_launch_failure_never_resumes_child(self):
        c,f=self.capture();original=c._thread
        def launch(target,*args):
            if target.__name__=='_send_control':raise RuntimeError('cannot start heartbeat sender')
            return original(target,*args)
        c._thread=launch
        try:
            with self.assertRaises(self.m.KinectError):c.start(0)
            self.wait(lambda:f.processes and f.processes[0].exited.is_set())
            self.assertFalse(f.processes[0].resumed)
        finally:c._thread=original


def _no_audio_lease_worker(mode):
    """Explicit CLI probe only: injected fake driver, never import raw kinect."""
    import os
    import sys
    from flyvj_m3.kinect_worker import main
    assert 'flyvj_m3.kinect' not in sys.modules
    blocked=threading.Event()
    def signal(phase):os.write(2,('BLOCKED_'+phase+'\n').encode())
    class FakeCapture:
        def __init__(self):self.frames=0
        def start(self,index):
            assert 'flyvj_m3.kinect' not in sys.modules
            if mode=='open':signal('open');blocked.wait()
            if mode=='close':raise RuntimeError('injected start failure')
            return packet(index)
        def snapshot(self):
            self.frames+=1
            return packet(frames=self.frames)
        def stop(self):
            if mode=='close':signal('close');blocked.wait()
    class BlockedOutput:
        def write(self,data):signal('stdout');blocked.wait()
        def flush(self):blocked.wait()
    return main(['--index','0'],capture_factory=FakeCapture,enumerate_devices=lambda:[],
                output=BlockedOutput() if mode=='stdout' else None)


def _no_audio_lease_parent():
    import sys
    from pathlib import Path
    from flyvj_m3.kinect_process import KinectProcessCapture
    def owned_fake_popen(args,**kwargs):
        return subprocess.Popen([sys.executable,'-B','-u',str(Path(__file__).resolve()),
                                 '--no-audio-lease-worker','normal'],**kwargs)
    capture=KinectProcessCapture(popen_factory=owned_fake_popen)
    try:
        capture.start(0)
        child=capture._current.owners[-1].process
        print(json.dumps({'child_pid':child.pid,'raw_driver_imported':'flyvj_m3.kinect' in sys.modules}),flush=True)
        threading.Event().wait()
    finally:capture.close()


def _run_windows_no_audio_integration():
    """Run once on explicit CLI request; not part of repeated unit discovery.

    Each subprocess is suspended, assigned to an owned Job, then resumed.
    NtSuspendProcess targets only our held parent Popen. The child handle is
    observation-only, from that parent's owned Popen metadata; no PID hunting.
    """
    import ctypes as C
    import os
    import sys
    from pathlib import Path
    from flyvj_m0.windows_job import OwnedWindowsJob
    from flyvj_m3.kinect_process import CONTROL_LEASE_SECONDS
    if os.name!='nt':raise RuntimeError('Windows-only no-audio probe')
    flags=4|0x08000000
    script=str(Path(__file__).resolve())
    results=[]
    def spawn(args):
        job=OwnedWindowsJob();p=None
        try:
            p=subprocess.Popen([sys.executable,'-B','-u',script]+args,stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,bufsize=0,close_fds=True,creationflags=flags)
            job.attach_and_resume(p.pid)
            return job,p
        except BaseException:
            job.close()
            if p is not None:
                p.terminate();p.wait(timeout=3)
            raise
    def read_line(stream,timeout=5):
        q=queue.Queue(maxsize=1)
        threading.Thread(target=lambda:q.put(stream.readline(8193)),daemon=True).start()
        return q.get(timeout=timeout)
    def cleanup(job,p):
        try:job.close()
        finally:
            if p.poll() is None:p.terminate()
            p.wait(timeout=3)
            for pipe in (p.stdin,p.stdout,p.stderr):
                try:pipe.close()
                except OSError:pass
    for mode,loss in [('open','expire'),('close','expire'),('stdout','expire'),('open','eof')]:
        job,p=spawn(['--no-audio-lease-worker',mode])
        try:
            sent=time.monotonic();p.stdin.write(('K1 '+str(time.monotonic_ns())+'\n').encode());p.stdin.flush()
            phase=read_line(p.stderr)
            if phase!=('BLOCKED_'+mode+'\n').encode():raise AssertionError(repr(phase))
            if loss=='eof':p.stdin.close()
            code=p.wait(timeout=CONTROL_LEASE_SECONDS+1.5);elapsed=time.monotonic()-sent
            if code!=74 or elapsed>CONTROL_LEASE_SECONDS+1.5:raise AssertionError((code,elapsed))
            results.append({'case':mode+'-'+loss,'exit':code,'seconds_since_heartbeat':round(elapsed,3),
                            'raw_driver_imported':False})
        finally:cleanup(job,p)

    api=C.WinDLL('kernel32',use_last_error=True);nt=C.WinDLL('ntdll')
    api.OpenProcess.argtypes=[C.c_uint32,C.c_int,C.c_uint32];api.OpenProcess.restype=C.c_void_p
    api.CloseHandle.argtypes=[C.c_void_p];api.CloseHandle.restype=C.c_int
    api.WaitForSingleObject.argtypes=[C.c_void_p,C.c_uint32];api.WaitForSingleObject.restype=C.c_uint32
    api.GetExitCodeProcess.argtypes=[C.c_void_p,C.POINTER(C.c_uint32)];api.GetExitCodeProcess.restype=C.c_int
    nt.NtSuspendProcess.argtypes=[C.c_void_p];nt.NtSuspendProcess.restype=C.c_long
    nt.NtResumeProcess.argtypes=[C.c_void_p];nt.NtResumeProcess.restype=C.c_long
    job,p=spawn(['--no-audio-lease-parent']);child_handle=None;suspended=False
    try:
        info=json.loads(read_line(p.stdout))
        if info['raw_driver_imported']:raise AssertionError('raw driver import')
        child_handle=api.OpenProcess(0x100000|0x1000,False,info['child_pid'])
        if not child_handle:raise C.WinError(C.get_last_error())
        if nt.NtSuspendProcess(int(p._handle))!=0:raise OSError('Cannot suspend owned parent')
        suspended=True;started=time.monotonic()
        wait_result=api.WaitForSingleObject(child_handle,int((CONTROL_LEASE_SECONDS+1.5)*1000))
        elapsed=time.monotonic()-started;code=C.c_uint32()
        if wait_result!=0 or not api.GetExitCodeProcess(child_handle,C.byref(code)):
            raise AssertionError(('child did not exit while parent suspended',wait_result,elapsed))
        if code.value!=74 or p.poll() is not None:raise AssertionError(('unexpected exits',code.value,p.poll()))
        results.append({'case':'all-owned-parent-threads-suspended','child_exit':code.value,
                        'seconds_since_parent_suspend':round(elapsed,3),'parent_still_alive':True,
                        'parent_not_terminated_to_make_child_exit':True,'raw_driver_imported':False})
    finally:
        if suspended:nt.NtResumeProcess(int(p._handle))
        if child_handle:api.CloseHandle(child_handle)
        cleanup(job,p)
    print(json.dumps({'status':'PASS_NO_AUDIO_SCOPED','child_lease_seconds':CONTROL_LEASE_SECONDS,
                      'cases':results,'actual_audio_capture':False},indent=2))


if __name__=='__main__':
    import sys
    if len(sys.argv)>1 and sys.argv[1]=='--no-audio-lease-worker':
        raise SystemExit(_no_audio_lease_worker(sys.argv[2]))
    elif len(sys.argv)>1 and sys.argv[1]=='--no-audio-lease-parent':
        _no_audio_lease_parent()
    elif len(sys.argv)>1 and sys.argv[1]=='--run-windows-no-audio-integration':
        _run_windows_no_audio_integration()
    else:unittest.main()

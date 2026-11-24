import hashlib,json,unittest
from flyvj_m3.serve import parse_options,route
class RuntimeRepairTests(unittest.TestCase):
    def test_default_url_port_is_stable_and_idle_bound_is_two_hours(self):
        a=parse_options(['--run-dir','run','--session-file','session'])
        self.assertEqual(a.port,54654);self.assertEqual(a.idle_seconds,7200)
    def test_port_zero_and_short_idle_are_explicit_overrides(self):
        a=parse_options(['--run-dir','run','--session-file','session','--port','0','--idle-seconds','10'])
        self.assertEqual(a.port,0);self.assertEqual(a.idle_seconds,10)
    def test_invalid_port_and_idle_rejected(self):
        for extra in (['--port','-1'],['--port','65536'],['--idle-seconds','9'],['--idle-seconds','7201']):
            with self.assertRaises(ValueError):parse_options(['--run-dir','run','--session-file','session',*extra])
    def test_health_identifies_exact_bundle_for_safe_existing_process_reuse(self):
        body=b'<p>ownedM3</p>';status,mime,result=route('/health',body,'m3-runtime-repair-01')
        data=json.loads(result);self.assertEqual(status,200);self.assertEqual(data['run_id'],'m3-runtime-repair-01')
        self.assertEqual(data['bundle_sha256'],hashlib.sha256(body).hexdigest());self.assertFalse(data['file_proxy'])

class StarterReuseRepairTests(unittest.TestCase):
    def test_reuse_requires_same_requested_idle_configuration(self):
        from pathlib import Path
        text=(Path(__file__).resolve().parents[1]/'scripts/m3-start.ps1').read_text(encoding='utf-8')
        self.assertIn('[int]$s.idle_seconds -ne $IdleSeconds',text)
        self.assertLess(text.index('[int]$s.idle_seconds -ne $IdleSeconds'),text.index('Existing owned runtime reused'))

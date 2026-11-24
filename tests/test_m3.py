import copy,json,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from flyvj_m3.exporter import build_payload,render_console,write_console
from flyvj_m3.runner import run_m3
from flyvj_m0.runner import CommandResult
ROOT=Path(__file__).resolve().parents[1]
SAMPLE=ROOT/'data/flywire783-m1/sample.json'
class ExportM3Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.payload=build_payload(SAMPLE)
    def test_real_source_audio_policy_and_mapping(self):
        p=self.payload
        self.assertEqual(p['scope'],'M3_LOCAL_FILE_AUDIO');self.assertTrue(p['source_check']['verified'])
        self.assertEqual(len(p['dataset']['neurons']),6);self.assertEqual(len(p['dataset']['connections']),3)
        self.assertEqual(p['audio_policy']['input'],'USER_SELECTED_LOCAL_FILE')
        self.assertTrue(p['audio_policy']['muted_default']);self.assertFalse(p['audio_policy']['network'])
        self.assertIn('HUMAN',p['mapping_semantics'])
    def test_upstream_source_gate_errors_not_bypassed(self):
        with patch('flyvj_m3.exporter.build_m2_payload',side_effect=ValueError('bad source')):
            with self.assertRaises(ValueError): build_payload(SAMPLE)
        with patch('flyvj_m3.exporter.build_m2_payload',return_value={'source_check':{'verified':False}}):
            with self.assertRaises(ValueError): build_payload(SAMPLE)
    def test_console_offline_with_blob_audio_csp(self):
        html=render_console(self.payload)
        self.assertIn('media-src blob: data:',html);self.assertIn('connect-src',html)
        self.assertIn('m3-payload',html);self.assertIn('FlyVJM3',html);self.assertIn('FlyVJM2',html)
        for marker in ('__M3_STYLE__','__M3_PAYLOAD__','__M3_GEOMETRY__','__M3_AUDIO__','__M3_APP__'):self.assertNotIn(marker,html)
        self.assertNotRegex(html,r'<(?:script|link)[^>]+(?:src|href)\s*=')
        self.assertNotIn('getUserMedia(',html);self.assertNotIn('getDisplayMedia(',html);self.assertNotIn('new WebSocket(',html)
    def test_ui_bom_not_inside_embedded_style(self):
        self.assertNotIn('\ufeff',render_console(self.payload))
    def test_payload_script_breakout_escaped(self):
        p=copy.deepcopy(self.payload);p['mapping_semantics']='</script><script>bad</script>'
        html=render_console(p);self.assertNotIn('</script><script>bad</script>',html)
        self.assertIn('\\u003c/script\\u003e',html)
    def test_no_clobber_generated_console(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'console.html';write_console(p,self.payload);before=p.read_bytes()
            with self.assertRaises(FileExistsError):write_console(p,self.payload)
            self.assertEqual(before,p.read_bytes())
class RunnerM3Tests(unittest.TestCase):
    def test_failed_source_has_blocked_evidence_and_no_ui(self):
        with tempfile.TemporaryDirectory() as td:
            with patch('flyvj_m3.runner.build_payload',side_effect=ValueError('source invalid')):
                run,state=run_m3(td,SAMPLE,ROOT/'missing.exe','sourcefail')
            self.assertEqual(state['status'],'BLOCKED');self.assertFalse((run/'console.html').exists())
            self.assertEqual(state['manual_qc']['status'],'NOT_RUN');self.assertEqual(state['steps'],[])
    def test_failed_test_step_halts_after_first_and_preserves_logs(self):
        with tempfile.TemporaryDirectory() as td:
            node=Path(td)/'node.exe';node.write_text('fixture');calls=[]
            def execute(argv,cwd,timeout):calls.append(argv);return CommandResult(1,'partial','failure',.1)
            with patch('flyvj_m3.runner.build_payload',return_value={'source_check':{'verified':True},'dataset_fingerprint':'fixture'}):
                run,state=run_m3(td,SAMPLE,node,'testfail',executor=execute)
            self.assertEqual(len(calls),1);self.assertEqual(state['status'],'BLOCKED')
            self.assertEqual((run/'logs/python.stderr.log').read_text(encoding='utf-8'),'failure')
    def test_success_requires_m2_and_m3_node_suites_tap_and_new_manual_qc(self):
        with tempfile.TemporaryDirectory() as td:
            node=Path(td)/'node.exe';node.write_text('fixture');calls=[]
            def execute(argv,cwd,timeout):
                calls.append(argv)
                if len(calls)==1:
                    Path(argv[argv.index('--result')+1]).write_text(json.dumps({'tests':5,'skipped':0,'failed':0,'errors':0,'successful':True}),encoding='utf-8')
                    return CommandResult(0,'Ran 5 tests in 0.1s\r\nOK\r\n','',.1)
                if len(calls)==3:return CommandResult(0,'M3_POWERSHELL_SYNTAX_PASSED\n','',.1)
                return CommandResult(0,'# tests 19\n# pass 19\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n','',.1)
            with patch('flyvj_m3.runner.build_payload',return_value={'source_check':{'verified':True},'dataset_fingerprint':'fixture'}),patch('flyvj_m3.runner.write_console'):
                run,state=run_m3(td,SAMPLE,node,'pass',executor=execute)
            self.assertEqual(state['status'],'PASSED');self.assertEqual(state['stage'],'M3');self.assertEqual(state['tests_run'],24)
            self.assertEqual(state['manual_qc']['status'],'NOT_RUN')
            for item in ('--test-reporter=tap','tests/m2_ui.test.cjs','tests/m3_audio.test.cjs','tests/m3_ui.test.cjs','tests/m3_regressions.test.cjs'):self.assertIn(item,calls[1])
    def test_timeout_fails_closed_and_saves_partial_output(self):
        import subprocess
        with tempfile.TemporaryDirectory() as td:
            node=Path(td)/'node.exe';node.write_text('fixture')
            def execute(argv,cwd,timeout):raise subprocess.TimeoutExpired(argv,timeout,output=b'partial',stderr=b'failure')
            with patch('flyvj_m3.runner.build_payload',return_value={'source_check':{'verified':True},'dataset_fingerprint':'fixture'}):
                run,state=run_m3(td,SAMPLE,node,'timeout',executor=execute)
            self.assertEqual(state['status'],'BLOCKED');self.assertEqual(state['steps'][0]['error'],'TIMEOUT')
            self.assertEqual((run/'logs/python.stdout.log').read_text(encoding='utf-8'),'partial')
    def test_duplicate_run_never_overwrites(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'work/runs/keep';p.mkdir(parents=True);(p/'state.json').write_text('keep')
            with self.assertRaises(FileExistsError):run_m3(td,SAMPLE,ROOT/'missing.exe','keep')
            self.assertEqual((p/'state.json').read_text(),'keep')

class ServerM3Tests(unittest.TestCase):
    def test_runtime_only_serves_passed_M3_generated_bundle_within_workspace(self):
        from flyvj_m3.serve import select_bundle
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);run=root/'work/runs/demo';run.mkdir(parents=True)
            (run/'console.html').write_text('<p>owned app</p>',encoding='utf-8')
            import hashlib
            (run/'manifest.json').write_text(json.dumps({str((run/'console.html').relative_to(root)):hashlib.sha256(b'<p>owned app</p>').hexdigest()}),encoding='utf-8')
            (run/'state.json').write_text(json.dumps({'stage':'M3','status':'PASSED'}),encoding='utf-8')
            data,path=select_bundle(root,run);self.assertEqual(data,b'<p>owned app</p>');self.assertEqual(path,run/'console.html')
            (run/'state.json').write_text(json.dumps({'stage':'M2','status':'PASSED'}),encoding='utf-8')
            with self.assertRaises(ValueError):select_bundle(root,run)
            outside=root.parent/'not-the-project'
            with self.assertRaises(ValueError):select_bundle(root,outside)
    def test_runtime_route_allowlist_not_a_file_proxy(self):
        from flyvj_m3.serve import route
        data=b'<p>M3 app</p>'
        for name in ('/','/console.html'):
            status,mime,body=route(name,data);self.assertEqual(status,200);self.assertEqual(body,data)
        for name in ('/HANDOFF.md','/source/sample.json','/../data/x','/console.html?file=C:/private','/favicon.ico'):
            status,mime,body=route(name,data);self.assertEqual(status,404);self.assertNotEqual(body,data)

class RequiredManifestM3Tests(unittest.TestCase):
    def test_missing_or_mismatched_runtime_manifest_refused(self):
        from flyvj_m3.serve import select_bundle
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);run=root/'work/runs/demo';run.mkdir(parents=True)
            (run/'console.html').write_text('<p>unverified</p>',encoding='utf-8')
            (run/'state.json').write_text(json.dumps({'stage':'M3','status':'PASSED'}),encoding='utf-8')
            with self.assertRaises(ValueError):select_bundle(root,run)
            (run/'manifest.json').write_text(json.dumps({str((run/'console.html').relative_to(root)):'wrong'}),encoding='utf-8')
            with self.assertRaises(ValueError):select_bundle(root,run)

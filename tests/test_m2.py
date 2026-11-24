"""M2 export / runner tests; no live input or network."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from flyvj_m0.dataset import load_dataset, synthetic_payload
from flyvj_m0.provenance import ProvenanceVerificationError
from flyvj_m2.exporter import build_payload, script_json, render_console, write_console
from flyvj_m2.runner import validate_run_id, parse_node_summary, validate_test_results, validate_python_summary, run_m2
from flyvj_m0.runner import CommandResult

ROOT = Path(__file__).resolve().parents[1]
SAMPLE = ROOT / 'data/flywire783-m1/sample.json'


class ExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = build_payload(SAMPLE)

    def test_real_sample_exact_ids_and_metadata(self):
        p=self.payload
        self.assertEqual(p['scope'], 'M2_OFFLINE_POINT_GRAPH')
        self.assertTrue(p['source_check']['verified'])
        d=load_dataset(SAMPLE)
        self.assertEqual(p['dataset'], d.to_payload())
        self.assertEqual(p['dataset_fingerprint'], d.fingerprint)
        self.assertEqual(p['render_order'], list(reversed(d.neuron_ids)))
        self.assertEqual(len(p['dataset']['neurons']),6)
        self.assertEqual(len(p['dataset']['connections']),3)
        self.assertTrue(all(isinstance(n['id'],str) for n in p['dataset']['neurons']))

    def test_rules_match_m0_at_boundaries(self):
        self.assertEqual([r['column'] for r in self.payload['rule_examples']], [1,1,2,2,3,3])
        self.assertEqual([r['energy'] for r in self.payload['rule_examples']], [0,.399999,.4,.749999,.75,1])

    def test_synthetic_refused(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'sample.json'
            path.write_text(json.dumps(synthetic_payload()),encoding='utf-8')
            with self.assertRaises((ValueError,ProvenanceVerificationError)):
                build_payload(path)

    def test_tampered_point_refused(self):
        raw=json.loads(SAMPLE.read_text(encoding='utf-8'))
        raw['neurons'][0]['position'][0]+=1
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'sample.json'
            path.write_text(json.dumps(raw),encoding='utf-8')
            with self.assertRaises(ProvenanceVerificationError):
                build_payload(path)

    def test_missing_evidence_refused(self):
        with patch('flyvj_m2.exporter.verify_curated_dataset',side_effect=ProvenanceVerificationError('SOURCE_EVIDENCE_INVALID','test')):
            with self.assertRaises(ProvenanceVerificationError):
                build_payload(SAMPLE)

    def test_false_verification_refused(self):
        with patch('flyvj_m2.exporter.verify_curated_dataset',return_value={'verified':False}):
            with self.assertRaises(ValueError):
                build_payload(SAMPLE)

    def test_json_script_breakout_escaped(self):
        original={'text':'</script><script>alert(1)</script>&\u2028\u2029', 'id':'720575940605876866'}
        encoded=script_json(original)
        self.assertNotIn('<',encoded)
        self.assertNotIn('>',encoded)
        self.assertNotIn('&',encoded)
        self.assertEqual(json.loads(encoded),original)

    def test_json_nonfinite_refused(self):
        with self.assertRaises(ValueError): script_json({'v':float('nan')})

    def test_bundle_self_contained(self):
        html=render_console(self.payload)
        for placeholder in ('__M2_STYLE__','__M2_PAYLOAD__','__M2_CORE__','__M2_APP__'):
            self.assertNotIn(placeholder,html)
        self.assertIn('m2-payload',html)
        self.assertNotRegex(html,r'<(?:script|link)[^>]+(?:src|href)\s*=')
        self.assertIn('720575940605876866',html)

    def test_template_requires_unique_placeholders(self):
        with tempfile.TemporaryDirectory() as td:
            assets=Path(td)
            (assets/'index.html').write_text('__M2_PAYLOAD__',encoding='utf-8')
            for name in ('style.css','core.js','app.js'):
                (assets/name).write_text('x',encoding='utf-8')
            with self.assertRaises(ValueError): render_console(self.payload,assets)

    def test_utf8_bom_in_template_assets_is_not_embedded_into_css_selector(self):
        with tempfile.TemporaryDirectory() as td:
            assets=Path(td)
            template='<style>__M2_STYLE__</style><script type="application/json" id="m2-payload">__M2_PAYLOAD__</script><script>__M2_CORE__</script><script>__M2_APP__</script>'
            (assets/'index.html').write_text('\ufeff'+template,encoding='utf-8')
            (assets/'style.css').write_text('\ufeff:root{color:white}',encoding='utf-8')
            for name in ('core.js','app.js'): (assets/name).write_text('\ufeff/*test*/',encoding='utf-8')
            html=render_console(self.payload,assets)
            self.assertNotIn('\ufeff',html)
            self.assertIn('<style>:root{color:white}',html)

    def test_write_exclusive_preserves_existing(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'console.html'
            write_console(target,self.payload)
            first=target.read_bytes()
            with self.assertRaises(FileExistsError): write_console(target,self.payload)
            self.assertEqual(first,target.read_bytes())


class RunnerContractTests(unittest.TestCase):
    def test_good_run_ids(self):
        for value in ('m2-final-01','a','M2_20261002'):
            self.assertEqual(validate_run_id(value),value)

    def test_bad_run_ids(self):
        for value in ('../x','x/y','x\\y','CON','nul','LPT1','x:ads','x ','x.' , '', 'a'*65):
            with self.assertRaises(ValueError,msg=value): validate_run_id(value)

    def test_node_result_counts(self):
        result=parse_node_summary('# tests 11\n# pass 11\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
        self.assertEqual(result,{'tests':11,'passed':11,'failed':0,'cancelled':0,'skipped':0,'todo':0})

    def test_missing_duplicate_summary_refused(self):
        for output in ('', '# tests 3\n', '# tests 3\n# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'):
            with self.assertRaises(ValueError): parse_node_summary(output)

    def test_valid_test_result(self):
        self.assertTrue(validate_test_results(100,0,True,{'tests':11,'passed':11,'failed':0,'cancelled':0,'skipped':0,'todo':0},0))

    def test_zero_skip_failure_refused(self):
        good={'tests':11,'passed':11,'failed':0,'cancelled':0,'skipped':0,'todo':0}
        for count,skips,success,exitcode in ((0,0,True,0),(100,1,True,0),(100,0,False,0),(100,0,True,1)):
            with self.assertRaises(ValueError): validate_test_results(count,skips,success,good,exitcode)
        for field in ('failed','cancelled','skipped','todo'):
            bad=good.copy(); bad[field]=1
            with self.assertRaises(ValueError): validate_test_results(100,0,True,bad,0)
        bad=good.copy(); bad['passed']=10
        with self.assertRaises(ValueError): validate_test_results(100,0,True,bad,0)


class RunnerExecutionTests(unittest.TestCase):
    def test_python_artifact_matches_actual_log(self):
        good={'tests':20,'skipped':0,'failed':0,'errors':0,'successful':True}
        self.assertTrue(validate_python_summary(good,'Ran 20 tests in 0.5s\nOK\n'))
        self.assertTrue(validate_python_summary(good,'Ran 20 tests in 0.5s\r\nOK\r\n'))
        for key in ('tests','skipped','failed','errors','successful'):
            bad=good.copy(); bad[key]=0 if key=='tests' else (False if key=='successful' else 1)
            with self.assertRaises(ValueError): validate_python_summary(bad,'Ran 20 tests in 0.5s\nOK\n')
        with self.assertRaises(ValueError): validate_python_summary(good,'Ran 20 tests in 0.1s\nFAILED (failures=1)\n')
        with self.assertRaises(ValueError): validate_python_summary(good,'Ran 20 tests in 0.1s\nOK\nFAILED (failures=1)\n')
        with self.assertRaises(ValueError): validate_python_summary(good,'Ran 20 tests in 0.1s\n')
        with self.assertRaises(ValueError): validate_python_summary(good,'Ran 1 test in 0.1s\nOK\n')
        with self.assertRaises(ValueError): validate_python_summary(good,'Ran 20 tests in 0.1s\nRan 20 tests in 0.1s\nOK\n')

    def test_node_reporter_is_explicit_and_success_requires_both_suites(self):
        with tempfile.TemporaryDirectory() as td:
            node=Path(td)/'node.exe'; node.write_text('fixture')
            calls=[]
            def execute(argv,cwd,timeout):
                calls.append(argv)
                if len(calls)==1:
                    summary=Path(argv[argv.index('--result')+1])
                    summary.write_text(json.dumps({'tests':20,'skipped':0,'failed':0,'errors':0,'successful':True}),encoding='utf-8')
                    return CommandResult(0,'Ran 20 tests in 0.1s\nOK\n','',.1)
                return CommandResult(0,'# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n','',.1)
            with patch('flyvj_m2.runner.build_payload',return_value={'source_check':{'verified':True},'dataset_fingerprint':'fixture'}),patch('flyvj_m2.runner.write_console'):
                run,state=run_m2(td,SAMPLE,node,'success',executor=execute)
            self.assertIn('--test-reporter=tap',calls[1])
            self.assertEqual(state['status'],'PASSED')
            self.assertEqual(state['tests_run'],23)
            self.assertEqual(state['manual_qc']['status'],'NOT_RUN')

    def test_source_failure_saves_blocked_without_console(self):
        with tempfile.TemporaryDirectory() as td:
            with patch('flyvj_m2.runner.build_payload',side_effect=ValueError('bad source')):
                run,state=run_m2(td,SAMPLE,ROOT/'missing-node.exe','source-fail')
            self.assertEqual(state['status'],'BLOCKED')
            self.assertEqual(state['steps'],[])
            self.assertEqual(state['manual_qc']['status'],'NOT_RUN')
            self.assertFalse((run/'console.html').exists())
            self.assertEqual(json.loads((run/'state.json').read_text(encoding='utf-8'))['error'],'bad source')

    def test_nonzero_step_stops_and_preserves_error_logs(self):
        with tempfile.TemporaryDirectory() as td:
            node=Path(td)/'node.exe'; node.write_text('fixture')
            calls=[]
            def execute(argv,cwd,timeout):
                calls.append(argv)
                return CommandResult(1,'test stdout','specific failure',.1)
            with patch('flyvj_m2.runner.build_payload',return_value={'source_check':{'verified':True},'dataset_fingerprint':'fixture'}):
                run,state=run_m2(td,SAMPLE,node,'test-fail',executor=execute)
            self.assertEqual(len(calls),1)
            self.assertEqual(state['status'],'BLOCKED')
            self.assertFalse((run/'console.html').exists())
            self.assertEqual((run/'logs/python.stderr.log').read_text(encoding='utf-8'),'specific failure')

    def test_timeout_preserves_partial_log_and_does_not_continue(self):
        import subprocess
        with tempfile.TemporaryDirectory() as td:
            node=Path(td)/'node.exe'; node.write_text('fixture')
            def execute(argv,cwd,timeout):
                raise subprocess.TimeoutExpired(argv,timeout,output=b'partial',stderr=b'error')
            with patch('flyvj_m2.runner.build_payload',return_value={'source_check':{'verified':True},'dataset_fingerprint':'fixture'}):
                run,state=run_m2(td,SAMPLE,node,'timeout',executor=execute)
            self.assertEqual(state['status'],'BLOCKED')
            self.assertEqual(state['steps'][0]['error'],'TIMEOUT')
            self.assertEqual((run/'logs/python.stdout.log').read_text(encoding='utf-8'),'partial')
            self.assertFalse((run/'console.html').exists())

    def test_duplicate_run_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as td:
            target=Path(td)/'work/runs/existing'; target.mkdir(parents=True)
            sentinel=target/'state.json'; sentinel.write_text('keep')
            with self.assertRaises(FileExistsError): run_m2(td,SAMPLE,ROOT/'missing-node.exe','existing')
            self.assertEqual(sentinel.read_text(),'keep')


if __name__=='__main__': unittest.main()

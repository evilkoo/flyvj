"""M3C pinned public morphology backend: malformed and tamper regressions."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from flyvj_m3.morphology import load_morphology, parse_region, parse_swc, _read_contained
from flyvj_m3.exporter import build_payload, render_console

ROOT = Path(__file__).resolve().parents[1]
ASSETS = Path('data/morphology-candidate-20261004')

class MorphologyTests(unittest.TestCase):
    def test_exact_contract_and_raw_values(self):
        m = load_morphology(ROOT)
        self.assertEqual(set(m), {'schema_version','semantics','registration','units','body_id','regions','neuron','source_hashes'})
        self.assertEqual(m['schema_version'], 1)
        self.assertEqual(m['semantics'], 'PUBLIC_MORPHOLOGY_DEMO_UNREGISTERED')
        self.assertEqual(m['registration'], 'UNVERIFIED_NO_OVERLAY')
        self.assertEqual(m['units'], 'UNCONFIRMED')
        self.assertIsNone(m['body_id'])
        self.assertEqual(len(m['regions']), 14)
        self.assertEqual(m['neuron']['node_count'], 36044)
        self.assertEqual(m['neuron']['edge_count'], 36043)
        self.assertEqual(m['neuron']['samples'][0], [1,142.61,263.2,184.77,0.12,-1])
        self.assertEqual(len(m['source_hashes']), 18)
        for r in m['regions']:
            raw = json.loads((ROOT/ASSETS/'meshes'/f"{r['id']}.json").read_bytes())
            self.assertEqual(r['vertices'], raw['vertices'])
            self.assertEqual(r['faces'], raw['faces'])
        for name, digest in m['source_hashes'].items():
            self.assertEqual(hashlib.sha256((ROOT/ASSETS/name).read_bytes()).hexdigest(), digest)

    def test_build_payload_loads_mandatory_assets_preserving_policy(self):
        p = build_payload(ROOT/'data/flywire783-m1/sample.json', project_root=ROOT)
        self.assertEqual(p['morphology']['neuron']['node_count'],36044)
        self.assertFalse(p['audio_policy']['auto_capture'])
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises((ValueError,OSError)):
                build_payload(ROOT/'data/flywire783-m1/sample.json', project_root=td)

    def test_tamper_every_asset_and_manifest_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            base = Path(td)/ASSETS
            shutil.copytree(ROOT/ASSETS, base)
            manifest = json.loads((base/'source_manifest.json').read_bytes())
            for name in [r['path'] for r in manifest['records']] + ['source_manifest.json']:
                with self.subTest(asset=name):
                    p=base/name; before=p.read_bytes();p.write_bytes(before+b' ')
                    with self.assertRaises(ValueError):load_morphology(td)
                    p.write_bytes(before)

    def test_modified_asset_and_rehashed_manifest_not_trusted(self):
        with tempfile.TemporaryDirectory() as td:
            base=Path(td)/ASSETS;shutil.copytree(ROOT/ASSETS,base)
            manifest=json.loads((base/'source_manifest.json').read_bytes())
            record=manifest['records'][0];p=base/record['path'];p.write_bytes(p.read_bytes()+b'\n')
            record['sha256']=hashlib.sha256(p.read_bytes()).hexdigest();record['bytes']=p.stat().st_size
            (base/'source_manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
            with self.assertRaisesRegex(ValueError,'manifest'):load_morphology(td)

    def test_containment_and_bounded_reads(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);(root/'small').write_bytes(b'1234')
            self.assertEqual(_read_contained(root,'small',4),b'1234')
            for name in ('../escape','/absolute','C:/secret','file:secret','a\\b','//server/share','a/../small'):
                with self.subTest(name=name), self.assertRaises(ValueError):_read_contained(root,name,20)
            with self.assertRaises(ValueError):_read_contained(root,'small',3)

    def test_missing_asset_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            base=Path(td)/ASSETS;base.mkdir(parents=True)
            shutil.copyfile(ROOT/ASSETS/'source_manifest.json',base/'source_manifest.json')
            with self.assertRaises((ValueError,OSError)):load_morphology(td)

    def test_region_rejects_invalid_triangles_and_coords(self):
        good={'vertices':[0,0,0,1,0,0,0,1,0],'faces':[0,1,2]}
        self.assertEqual(parse_region('demo',json.dumps(good).encode())['id'],'demo')
        for key,value in [('vertices',[]),('vertices',[0,0]),('vertices',[0,0,float('nan')]),('vertices',[True,0,0]),('faces',[]),('faces',[0,1]),('faces',[0,1,3]),('faces',[0,1,-1]),('faces',[0,0,1]),('faces',[0,1,2.0]),('faces',[False,1,2])]:
            d=copy.deepcopy(good);d[key]=value
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):parse_region('demo',json.dumps(d).encode())
        with self.assertRaises(ValueError):parse_region('demo',b'{"vertices":[],"vertices":[],"faces":[]}')

    def test_swc_topology_and_numeric_validation(self):
        valid='1 0 0 0 0 1 -1\n2 0 1 1 1 0.5 1\n'
        self.assertEqual(parse_swc(valid.encode())['edge_count'],1)
        # Parent ordering is not required; connectivity is.
        self.assertEqual(parse_swc(('2 0 1 1 1 .5 1\n1 0 0 0 0 1 -1').encode())['node_count'],2)
        bad=['',valid+'2 0 1 1 1 1 1\n','1 0 0 0 0 1 9','1 0 0 0 0 1 1',
             '1 0 0 0 0 1 2\n2 0 0 0 0 1 1',valid+'3 0 0 0 0 1 -1',
             valid+'3 0 0 0 0 1 4\n4 0 0 0 0 1 3',
             '1 0 nan 0 0 1 -1','1 0 inf 0 0 1 -1','1 0 0 0 0 -1 -1',
             '1.5 0 0 0 0 1 -1','0 0 0 0 0 1 -1','1 0 0 0 0 1 -1 extra']
        for text in bad:
            with self.subTest(text=text),self.assertRaises(ValueError):parse_swc(text.encode())

    def test_inline_markers_order_using_isolated_template(self):
        markers={'__M3_STYLE__':'style.css','__M3_AUDIO__':'audio.js',
                 '__M3_BRAIN_GEOMETRY__':'brain-geometry.js','__M3_BRAIN_RENDERER__':'brain-renderer.js',
                 '__M3_MIC_BRIDGE__':'mic-bridge.js','__M3_MORPH_GEOMETRY__':'public-morphology.js',
                 '__M3_MORPH_RENDERER__':'public-morphology-renderer.js','__M3_APP__':'app.js'}
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            for name in markers.values():(root/name).write_text('CONTENT_'+name,encoding='utf-8')
            (root/'index.html').write_text('__M3_PAYLOAD__\n__M3_GEOMETRY__\n'+'\n'.join(markers),encoding='utf-8')
            html=render_console({'morphology':{'schema_version':1}},root)
            self.assertNotIn('__M3_',html)
            self.assertLess(html.index('CONTENT_public-morphology.js'),html.index('CONTENT_app.js'))
            self.assertLess(html.index('CONTENT_public-morphology-renderer.js'),html.index('CONTENT_app.js'))

class MorphologyHardeningTests(unittest.TestCase):
    def test_zero_area_triangle_rejected(self):
        with self.assertRaises(ValueError):
            parse_region('flat',b'{"vertices":[0,0,0,1,1,1,2,2,2],"faces":[0,1,2]}')

    def test_huge_integer_rejected_as_value_error(self):
        raw=json.dumps({'vertices':[10**400,0,0,1,0,0,0,1,0],'faces':[0,1,2]}).encode()
        with self.assertRaises(ValueError):parse_region('huge',raw)

    def test_reparse_component_rejected_before_read(self):
        from types import SimpleNamespace
        import stat
        with tempfile.TemporaryDirectory() as td:
            with patch('pathlib.Path.lstat',return_value=SimpleNamespace(st_mode=stat.S_IFDIR,st_file_attributes=0x400)):
                with self.assertRaisesRegex(ValueError,'reparse'): _read_contained(td,'linked/file',10)

    def test_runner_manifest_includes_new_code_tests_docs_and_all_sources(self):
        from flyvj_m3.runner import run_m3
        from flyvj_m0.runner import CommandResult
        from flyvj_m3.morphology import EXPECTED_PATHS
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);shutil.copytree(ROOT/ASSETS,root/ASSETS)
            expected={'src/flyvj_m3/morphology.py','src/flyvj_m3/ui/public-morphology.js',
                      'src/flyvj_m3/ui/public-morphology-renderer.js','tests/test_m3c_morphology.py',
                      'tests/m3c_morphology.test.cjs','tests/m3c_morphology_renderer.test.cjs',
                      'tests/m3c_morphology_ui.test.cjs','docs/M3C_MORPHOLOGY_SPEC.md'}
            for name in expected:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text('manifest fixture')
            node=root/'node.exe';node.write_text('test stub')
            def execute(argv,cwd,timeout):
                if '--result' in argv:
                    Path(argv[argv.index('--result')+1]).write_text(json.dumps(dict(tests=1,skipped=0,failed=0,errors=0,successful=True)))
                    return CommandResult(0,'Ran 1 test in 0.1s\nOK\n','',.1)
                if '--test' in argv:
                    return CommandResult(0,'# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n','',.1)
                return CommandResult(0,'M3_POWERSHELL_SYNTAX_PASSED\n','',.1)
            with patch('flyvj_m3.runner.write_console',side_effect=lambda target,payload: target.write_text('fixture console')):
                run,state=run_m3(root,ROOT/'data/flywire783-m1/sample.json',node,'manifest',executor=execute)
            self.assertEqual(state['status'],'PASSED')
            manifest=json.loads((run/'manifest.json').read_bytes())
            expected.update((ASSETS/name).as_posix() for name in EXPECTED_PATHS)
            expected.add((ASSETS/'source_manifest.json').as_posix())
            for name in expected:
                key=str(Path(name))
                self.assertIn(key,manifest)
                self.assertEqual(manifest[key],hashlib.sha256((root/name).read_bytes()).hexdigest())

    def test_runner_rechecks_source_after_test_steps_and_lists_new_suites(self):
        from flyvj_m3.runner import run_m3
        from flyvj_m0.runner import CommandResult
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);base=root/ASSETS;shutil.copytree(ROOT/ASSETS,base)
            node=root/'node.exe';node.write_text('test stub');calls=[]
            def execute(argv,cwd,timeout):
                calls.append(argv)
                if len(calls)==1:
                    Path(argv[argv.index('--result')+1]).write_text(json.dumps(dict(tests=1,skipped=0,failed=0,errors=0,successful=True)))
                    return CommandResult(0,'Ran 1 test in 0.1s\nOK\n','',.1)
                if len(calls)==2:
                    return CommandResult(0,'# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n','',.1)
                asset=base/'meshes/EB.json';asset.write_bytes(asset.read_bytes()+b' ')
                return CommandResult(0,'M3_POWERSHELL_SYNTAX_PASSED\n','',.1)
            with patch('flyvj_m3.runner.write_console'):
                run,state=run_m3(root,ROOT/'data/flywire783-m1/sample.json',node,'morph-tamper',executor=execute)
            self.assertEqual(state['status'],'BLOCKED')
            self.assertIn('Morphology',state['error'])
            self.assertFalse((run/'console.html').exists())
            for name in ('m3c_morphology','m3c_morphology_renderer','m3c_morphology_ui'):
                self.assertIn('tests/'+name+'.test.cjs',calls[1])

if __name__=='__main__':unittest.main()

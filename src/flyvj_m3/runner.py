"""Fail-closed M3 build, using existing owned Windows Job step containment."""
from datetime import datetime,timezone
import hashlib,json,os,subprocess,sys
from pathlib import Path
from uuid import uuid4
from flyvj_m0.runner import create_run_directory,execute_step
from flyvj_m2.runner import validate_run_id,validate_python_summary,parse_node_summary,validate_test_results
from .exporter import build_payload,write_console
from .morphology import ASSET_DIRECTORY, EXPECTED_PATHS

def save(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8',newline='\n')

def run_m3(project_root,dataset_path,node_exe,run_id=None,step_timeout=120,executor=execute_step):
    root=Path(project_root).resolve(strict=True)
    if type(step_timeout) is not int or not 1<=step_timeout<=300:raise ValueError('Timeout must be1..300s')
    run_id=validate_run_id(run_id or 'm3-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid4().hex[:8])
    run=create_run_directory(root,run_id)
    state={'schema_version':1,'stage':'M3','scope':'LOCAL_FILE_PCM_FFT_AND_HUMAN_POINT_MAPPING',
           'run_id':run_id,'status':'RUNNING','created_at':datetime.now(timezone.utc).isoformat(),'steps':[],
           'manual_qc':{'status':'NOT_RUN','scope':'new run; browser/visual/audio evidence required'},
           'safety':{'microphone':False,'automated_tests_open_real_microphone':False,'system_audio_capture':False,
                     'raw_audio_recording':False,'rgb_capture':False,'depth_capture':False,'osc_packets_sent':0,'network_upload':False,'install':False},
           'input_capabilities':{'file':True,'azure_kinect_mic':False,'capture_default':'OFF'},
           'validation_domains':{'source':'NOT_RUN','automated_checks':'NOT_RUN','actual_audio_input':'NOT_RUN',
                                 'visual':'NOT_RUN','kinect_input':'NOT_RUN','private_music_quality':'NOT_TESTED','resolume':'NOT_CONNECTED','gpu':'NOT_TESTED'},
           'visual_extension':'M3C_PUBLIC_MORPHOLOGY_DEMO_UNREGISTERED',
           'limitations':['Public partial morphology: 14 ROI meshes and 1 SWC in separate views; units unconfirmed, anatomical registration unverified, no overlay; legacy procedural illustration is fallback only',
                          'Legacy native sample: 6 marked points/3 selected-neuropil edges, separate from public morphology; neither is a whole-brain reconstruction',
                          'human band mapping, not biological firing or trained model',
                          'onset candidates, not verified beats/BPM/genre',
                          'Column drafts only; no actual OSC or Resolume']}
    save(run/'state.json',state)
    try:
        payload=build_payload(dataset_path, project_root=root)
        save(run/'payload.json',payload)
        state['source_check']=payload['source_check'];state['dataset_fingerprint']=payload['dataset_fingerprint']
        state['validation_domains']['source']='PASSED'
        state['input_capabilities']['azure_kinect_mic']=payload.get('audio_policy',{}).get('kinect_microphone_enabled') is True
        if state['input_capabilities']['azure_kinect_mic']:state['scope']='LOCAL_FILE_OR_USER_ARMED_AZURE_KINECT_PCM_FFT_AND_HUMAN_MAPPING'
        summary=run/'python_tests.json'
        commands=[('python',[sys.executable,'-m','flyvj_m2.checks','--result',str(summary)]),
                  ('node',[str(Path(node_exe).resolve(strict=True)),'--test','--test-reporter=tap',
                           'tests/m2_ui.test.cjs','tests/m3_audio.test.cjs','tests/m3_ui.test.cjs','tests/m3_regressions.test.cjs',
                           'tests/m3_brain_geometry.test.cjs','tests/m3_brain_renderer.test.cjs','tests/m3b_ui.test.cjs',
                           'tests/m3_kinect_bridge.test.cjs','tests/m3_kinect_ui.test.cjs',
                           'tests/m3c_morphology.test.cjs','tests/m3c_morphology_renderer.test.cjs','tests/m3c_morphology_ui.test.cjs']),
                  ('powershell',[str(Path(os.environ.get('SystemRoot',r'C:\Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe'),'-NoProfile','-File','scripts/m3-check.ps1'])]
        py=None;node=None
        for name,command in commands:
            step={'name':name,'command':command,'status':'RUNNING'};state['steps'].append(step);save(run/'state.json',state)
            try:result=executor(command,root,step_timeout)
            except subprocess.TimeoutExpired as exc:
                for stream,content in [('stdout',exc.output or ''),('stderr',exc.stderr or '')]:
                    if isinstance(content,bytes):content=content.decode('utf-8',errors='replace')
                    (run/'logs'/f'{name}.{stream}.log').write_text(content,encoding='utf-8',newline='')
                step.update(status='BLOCKED',error='TIMEOUT',timeout_seconds=step_timeout)
                raise ValueError(name+' timed out') from exc
            for stream in ('stdout','stderr'):(run/'logs'/f'{name}.{stream}.log').write_text(getattr(result,stream),encoding='utf-8',newline='')
            step.update(exit_code=result.exit_code,duration_seconds=result.duration_seconds,status='PASSED' if result.exit_code==0 else 'BLOCKED')
            if result.exit_code!=0:raise ValueError(name+' nonzero test exit')
            try:
                if name=='python':
                    py=json.loads(summary.read_text(encoding='utf-8'));validate_python_summary(py,result.stdout)
                elif name=='node':
                    node=parse_node_summary(result.stdout);validate_test_results(py['tests'],py['skipped'],py['successful'],node,result.exit_code)
                elif 'M3_POWERSHELL_SYNTAX_PASSED' not in result.stdout.splitlines():
                    raise ValueError('PowerShell syntax gate marker missing')
            except (ValueError,TypeError,KeyError,OSError) as exc:
                step.update(status='BLOCKED',error=str(exc));raise
        # Revalidate pinned bytes after child checks, before producing a passed bundle.
        if build_payload(dataset_path, project_root=root).get('morphology') != payload.get('morphology'):
            raise ValueError('Morphology changed during build')
        write_console(run/'console.html',payload)
        paths=[*sorted((root/'src/flyvj_m0').glob('*.py')),*sorted((root/'src/flyvj_m2').glob('*.py')),
               *sorted((root/'src/flyvj_m2/ui').glob('*')),*sorted((root/'src/flyvj_m3').glob('*.py')),
               *sorted((root/'src/flyvj_m3/ui').glob('*')),*sorted((root/'tests').glob('test_*.py')),
               *sorted((root/'tests').glob('*_ui.test.cjs')),root/'tests/m3_audio.test.cjs',root/'tests/m3_regressions.test.cjs',root/'scripts/m3-build.ps1',
               root/'scripts/m3-start.ps1',root/'scripts/m3-stop.ps1',root/'scripts/m3-check.ps1',
               root/'tests/m3_brain_geometry.test.cjs',root/'tests/m3_brain_renderer.test.cjs',root/'tests/m3_kinect_bridge.test.cjs',
               root/'tests/m3c_morphology.test.cjs',root/'tests/m3c_morphology_renderer.test.cjs',
               root/'tests/m3c_morphology_ui.test.cjs',root/'docs/M3C_MORPHOLOGY_SPEC.md',
               root/ASSET_DIRECTORY/'source_manifest.json',*[root/ASSET_DIRECTORY/name for name in sorted(EXPECTED_PATHS)],
               root/'docs/M3_SPEC.md',root/'docs/M3B_VISUAL_SPEC.md',root/'docs/M3B_KINECT_SPEC.md',root/'啟動大腦視覺.cmd',run/'console.html',run/'payload.json']
        manifest={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths if p.is_file()}
        save(run/'manifest.json',manifest)
        state.update(status='PASSED',python_tests=py,node_tests=node,tests_run=py['tests']+node['tests'],
                     tests_skipped=py['skipped']+node['skipped'],console='console.html',
                     next_action='Actual audio file/PCM/FFT browser and independent QC still required; not music-quality PASS')
        state['validation_domains']['automated_checks']='PASSED'
    except Exception as exc:
        state.update(status='BLOCKED',error_type=type(exc).__name__,error=str(exc),next_action='Preserve evidence; diagnose; no automatic patch or retry')
        state['validation_domains']['automated_checks']='BLOCKED'
    state['finished_at']=datetime.now(timezone.utc).isoformat();save(run/'state.json',state)
    return run,state

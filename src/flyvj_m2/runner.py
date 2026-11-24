"""M2 verify/export runner; uses M0's owned Windows Job step containment."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
from uuid import uuid4

from flyvj_m0.runner import create_run_directory, execute_step
from .exporter import build_payload, write_console


def validate_run_id(value):
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}',value):
        raise ValueError('run ID must be 1..64 safe ASCII characters')
    if value.upper() in ('CON','PRN','AUX','NUL',*[f'{p}{i}' for p in ('COM','LPT') for i in range(1,10)]):
        raise ValueError('Windows device names are forbidden')
    return value


def parse_node_summary(output):
    fields={'tests':'tests','passed':'pass','failed':'fail','cancelled':'cancelled','skipped':'skipped','todo':'todo'}
    result={}
    for key,label in fields.items():
        matches=re.findall(r'^# '+label+r' (\d+)\s*$',output,re.MULTILINE)
        if len(matches)!=1:
            raise ValueError('Missing or ambiguous Node test summary: '+label)
        result[key]=int(matches[0])
    return result



def validate_python_summary(summary,stdout):
    required={'tests','skipped','failed','errors','successful'}
    if not isinstance(summary,dict) or set(summary)!=required:
        raise ValueError('Invalid Python summary fields')
    for key in ('tests','skipped','failed','errors'):
        if type(summary[key]) is not int or summary[key]<0:
            raise ValueError('Invalid Python test count')
    if summary['tests']==0 or any(summary[k]!=0 for k in ('skipped','failed','errors')) or summary['successful'] is not True:
        raise ValueError('Python tests zero/skipped/failed/errors')
    actual=re.findall(r'^Ran (\d+) tests? in ',stdout,re.MULTILINE)
    if len(actual)!=1 or int(actual[0])!=summary['tests']:
        raise ValueError('Python result artifact differs from actual unittest log')
    outcomes=[line for line in stdout.splitlines() if line=='OK' or line.startswith(('OK ', 'FAILED'))]
    if outcomes!=['OK']:
        raise ValueError('Python unittest outcome missing or contradicts successful artifact')
    return True


def validate_test_results(py_count,py_skips,py_success,node,exit_code):
    if type(py_count) is not int or py_count<=0 or type(py_skips) is not int or py_skips!=0 or py_success is not True:
        raise ValueError('Python tests zero/skipped/failed')
    if exit_code!=0 or any(type(node.get(k)) is not int or node[k]<0 for k in ('tests','passed','failed','cancelled','skipped','todo')):
        raise ValueError('Node test execution failed or invalid count')
    if node['tests']<=0 or node['passed']!=node['tests'] or any(node[k]!=0 for k in ('failed','cancelled','skipped','todo')):
        raise ValueError('Node tests zero/skipped/todo/cancelled/failed')
    return True


def _save(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')


def run_m2(project_root,dataset_path,node_exe,run_id=None,step_timeout=120,executor=execute_step):
    root=Path(project_root).resolve(strict=True)
    if type(step_timeout) is not int or not 1<=step_timeout<=300:
        raise ValueError('step_timeout must be 1..300 seconds')
    run_id=validate_run_id(run_id or 'm2-'+datetime.now().strftime('%Y%m%d-%H%M%S')+'-'+uuid4().hex[:8])
    run=create_run_directory(root,run_id)
    state=dict(schema_version=1,stage='M2',scope='OFFLINE_CURATED_POINT_GRAPH_CONSOLE',run_id=run_id,
               status='RUNNING',created_at=datetime.now(timezone.utc).isoformat(),steps=[],
               manual_qc={'status':'NOT_RUN','scope':'new run; never inherits M1 QC'},
               safety=dict(live_audio=False,osc_packets_sent=0,external_assets=False,dependency_install=False),
               limitations=['point sample only, not full morphology or whole brain','mock activity, not biological firing',
                            'OSC drafts only, not verified Resolume addresses','GPU/4090/3070Ti/4K60 NOT_TESTED'])
    _save(run/'state.json',state)
    try:
        payload=build_payload(dataset_path)
        _save(run/'payload.json',payload)
        state['source_check']=payload['source_check']
        state['dataset_fingerprint']=payload['dataset_fingerprint']
        summary_path=run/'python_tests.json'
        commands=[('python',[sys.executable,'-m','flyvj_m2.checks','--result',str(summary_path)]),
                  ('node',[str(Path(node_exe).resolve(strict=True)),'--test','--test-reporter=tap','tests/m2_ui.test.cjs'])]
        results={}
        for name,command in commands:
            step=dict(name=name,command=command,status='RUNNING')
            state['steps'].append(step); _save(run/'state.json',state)
            try:
                result=executor(command,root,step_timeout)
            except subprocess.TimeoutExpired as exc:
                stdout=exc.output or ''; stderr=exc.stderr or ''
                for stream,content in (('stdout',stdout),('stderr',stderr)):
                    if isinstance(content,bytes): content=content.decode('utf-8',errors='replace')
                    (run/'logs'/f'{name}.{stream}.log').write_text(content,encoding='utf-8')
                step.update(status='BLOCKED',error='TIMEOUT',timeout_seconds=step_timeout)
                raise ValueError(name+' test step timed out') from exc
            for stream in ('stdout','stderr'):
                (run/'logs'/f'{name}.{stream}.log').write_text(getattr(result,stream),encoding='utf-8',newline='')
            step.update(exit_code=result.exit_code,duration_seconds=result.duration_seconds,
                        status='PASSED' if result.exit_code==0 else 'BLOCKED')
            if result.exit_code!=0:
                raise ValueError(name+' test step returned nonzero')
            results[name]=result
            try:
                if name=='python':
                    py=json.loads(summary_path.read_text(encoding='utf-8'))
                    validate_python_summary(py,result.stdout)
                else:
                    node=parse_node_summary(result.stdout)
                    validate_test_results(py['tests'],py['skipped'],py['successful'],node,result.exit_code)
            except (ValueError,KeyError,TypeError,OSError) as exc:
                step.update(status='BLOCKED',error=str(exc))
                raise
        validate_test_results(py['tests'],py['skipped'],py['successful'],node,results['node'].exit_code)
        write_console(run/'console.html',payload)
        manifest={}
        files=[*sorted((root/'src/flyvj_m0').glob('*.py')),
               *sorted((root/'src/flyvj_m2').glob('*.py')),*sorted((root/'src/flyvj_m2/ui').glob('*')),
               *sorted((root/'tests').glob('test_*.py')),root/'tests/m2_ui.test.cjs',
               root/'scripts/m2-build.ps1',root/'docs/M2_SPEC.md',run/'console.html',run/'payload.json']
        for path in files:
            if path.is_file(): manifest[str(path.relative_to(root))]=hashlib.sha256(path.read_bytes()).hexdigest()
        _save(run/'manifest.json',manifest)
        state.update(status='PASSED',python_tests=py,node_tests=node,
                     tests_run=py['tests']+node['tests'],tests_skipped=py['skipped']+node['skipped'],
                     console='console.html',next_action='Independent code / visual QC required before delivery')
    except Exception as exc:
        state.update(status='BLOCKED',error_type=type(exc).__name__,error=str(exc),
                     next_action='Save evidence; diagnose before another run. No automatic patch/retry.')
    state['finished_at']=datetime.now(timezone.utc).isoformat()
    _save(run/'state.json',state)
    return run,state

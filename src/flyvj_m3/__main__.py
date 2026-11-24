import argparse,sys
from pathlib import Path
from .runner import run_m3

def main():
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    p=argparse.ArgumentParser(description='M3 local file audio console; no live capture or OSC')
    p.add_argument('--dataset',required=True);p.add_argument('--node-exe',required=True)
    p.add_argument('--run-id');p.add_argument('--step-timeout',type=int,default=120)
    a=p.parse_args();run,state=run_m3(Path(__file__).resolve().parents[2],a.dataset,a.node_exe,a.run_id,a.step_timeout)
    print('M3 '+state['status']+' | '+str(run/'state.json'))
    if state['status']=='PASSED':print('Console: '+str(run/'console.html')+' | Tests: '+str(state['tests_run'])+' | Manual QC: NOT_RUN')
    else:print(state.get('error',''))
    return 0 if state['status']=='PASSED' else 1
if __name__=='__main__':raise SystemExit(main())

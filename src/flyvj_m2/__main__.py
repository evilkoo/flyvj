import argparse
from pathlib import Path
import sys
from .runner import run_m2


def main():
    if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(description='M2 offline verify/export; no live mode')
    parser.add_argument('--dataset',required=True)
    parser.add_argument('--node-exe',required=True)
    parser.add_argument('--run-id')
    parser.add_argument('--step-timeout',type=int,default=120)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[2]
    run,state=run_m2(root,args.dataset,args.node_exe,args.run_id,args.step_timeout)
    print('M2 '+state['status']+' | '+str(run/'state.json'))
    if state['status']=='PASSED':
        print('Console: '+str(run/'console.html'))
        print(f"Tests: {state['tests_run']} | Skipped: {state['tests_skipped']} | Manual QC: NOT_RUN")
    else: print(state.get('error',''))
    return 0 if state['status']=='PASSED' else 1

if __name__=='__main__': raise SystemExit(main())

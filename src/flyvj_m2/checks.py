"""Bounded child-process Python unittest entry for M2."""
import argparse
import json
from pathlib import Path
import sys
import unittest


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--result',required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[2]
    suite=unittest.defaultTestLoader.discover(str(root/'tests'),pattern='test_*.py')
    result=unittest.TextTestRunner(verbosity=1,stream=sys.stdout).run(suite)
    summary=dict(tests=result.testsRun, skipped=len(result.skipped),
                 failed=len(result.failures), errors=len(result.errors),
                 successful=result.wasSuccessful())
    with Path(args.result).open('x',encoding='utf-8') as f:
        json.dump(summary,f,indent=2)
    return 0 if result.wasSuccessful() and result.testsRun>0 and not result.skipped else 1

if __name__=='__main__': raise SystemExit(main())

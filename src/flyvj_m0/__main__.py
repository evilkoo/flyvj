"""Trusted M0 CLI. No live mode, network targets, or package installation."""
import argparse
import json
from pathlib import Path
import sys

from .pipeline import default_events, run_mock_pipeline
from .runner import run_m0, run_m1
from .verify_data import binding_demo_result, inspect_real_data


def main(argv=None):
    parser = argparse.ArgumentParser(description="Fly VJ M0: synthetic dry-run only")
    subs = parser.add_subparsers(dest="command", required=True)
    syntax = subs.add_parser("syntax")
    syntax.add_argument("--project-root", required=True, type=Path)
    mock = subs.add_parser("mock")
    mock.add_argument("--output", required=True, type=Path)
    run = subs.add_parser("run")
    run.add_argument("--project-root", required=True, type=Path)
    run.add_argument("--run-id")
    run.add_argument("--step-timeout", type=float, default=30)
    data = subs.add_parser("verify-data")
    data.add_argument("--project-root", required=True, type=Path)
    data.add_argument("--run-id")
    data.add_argument("--step-timeout", type=float, default=30)
    data.add_argument("--dataset", type=Path)
    binding = subs.add_parser("binding-check")
    binding.add_argument("--output", required=True, type=Path)
    real = subs.add_parser("real-data-check")
    real.add_argument("--output", required=True, type=Path)
    real.add_argument("--dataset", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.command == "syntax":
            files = sorted((args.project_root / "src" / "flyvj_m0").glob("*.py")) + sorted((args.project_root / "tests").glob("test_*.py"))
            if not files:
                raise ValueError("No Python files to check")
            for path in files:
                compile(path.read_text(encoding="utf-8-sig"), str(path), "exec")
            print(f"Syntax checked: {len(files)} files")
            return 0
        if args.command == "mock":
            payload = run_mock_pipeline(default_events())
            # Exclusive creation: never replace existing artifacts.
            with args.output.open("x", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            print("Mock events: 4; recorded intents: 4; real OSC: 0; keyboard: 0")
            return 0
        if args.command in ("binding-check", "real-data-check"):
            payload = binding_demo_result() if args.command == "binding-check" else inspect_real_data(args.dataset)
            with args.output.open("x", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            print(f'{args.command}: {payload["status"]}')
            return 0 if payload["status"] == "PASSED" else 1
        if args.command == "verify-data":
            state, exit_code = run_m1(args.project_root, args.run_id, args.step_timeout, dataset_path=args.dataset)
        else:
            state, exit_code = run_m0(args.project_root, args.run_id, args.step_timeout)
        print(f'{state["stage"]} {state["status"]}; tests={state["tests_run"]}; interface={state.get("interface_status", "n/a")}; retry_count=0')
        print(f'Report: {args.project_root.resolve() / "work" / "runs" / state["run_id"] / "report.html"}')
        return exit_code
    except (OSError, ValueError, SyntaxError) as exc:
        print(f"M0 blocked: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
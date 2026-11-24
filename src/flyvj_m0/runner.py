"""Bounded, fail-closed M0 verification. No AI auto-patching or live output."""
from dataclasses import dataclass
from datetime import datetime
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from typing import Callable
from uuid import uuid4

from .report import render_report


@dataclass(frozen=True)
class CommandResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_seconds: float


def _now():
    return datetime.now().astimezone().isoformat(timespec="seconds")


def create_run_directory(project_root, run_id):
    if not isinstance(run_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", run_id):
        raise ValueError("run_id must be 1-64 safe ASCII characters")
    root = Path(project_root).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Project root is not a directory")
    parent = root / "work" / "runs"
    if not parent.resolve().is_relative_to(root):
        raise ValueError("Run output must remain inside the project")
    parent.mkdir(parents=True, exist_ok=True)
    run_dir = parent / run_id
    run_dir.mkdir(exist_ok=False)
    (run_dir / "logs").mkdir()
    return run_dir


def execute_step(argv, cwd, timeout):
    env = os.environ.copy()
    env["PYTHONPATH"] = str(Path(cwd) / "src")
    env["PYTHONUTF8"] = "1"
    env["PYTHONNOUSERSITE"] = "1"
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    from .windows_job import OwnedWindowsJob
    started = time.monotonic()
    # File-backed logs avoid descendant-inherited pipes extending communicate().
    with tempfile.TemporaryFile() as stdout_file, tempfile.TemporaryFile() as stderr_file:
        job = OwnedWindowsJob()
        process = None
        try:
            process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                       stdout=stdout_file, stderr=stderr_file,
                                       creationflags=0x00000004 | subprocess.CREATE_NO_WINDOW)
            job.attach_and_resume(process.pid)
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                raise subprocess.TimeoutExpired(argv, timeout)
            process.wait(timeout=remaining)
        except BaseException as exc:
            job.close()
            if process is not None and process.poll() is None:
                # Only our held Popen; also covers attach failure before resume.
                process.kill()
                process.wait(timeout=1)
            if isinstance(exc, subprocess.TimeoutExpired):
                raise subprocess.TimeoutExpired(argv, timeout,
                                                output=_read_log(stdout_file), stderr=_read_log(stderr_file)) from exc
            raise
        finally:
            job.close()  # kills only still-running descendants, including on success
        return CommandResult(process.returncode, _read_log(stdout_file), _read_log(stderr_file),
                             round(time.monotonic() - started, 4))


def _read_log(handle):
    handle.seek(0)
    content = handle.read(1024 * 1024 + 1)
    if len(content) > 1024 * 1024:
        content = content[:1024 * 1024] + b"\n[log truncated at 1 MiB]\n"
    return content.decode("utf-8", errors="replace")


def _decoded(value):
    return value.decode("utf-8", errors="replace") if isinstance(value, bytes) else value or ""


def validate_mock_result(payload):
    if not isinstance(payload, dict):
        raise ValueError("Mock result must be an object")
    required = {"source": "synthetic_fixture", "transport": "in_memory", "neural_data_status": "NOT_LOADED"}
    for key, value in required.items():
        if payload.get(key) != value:
            raise ValueError(f"Unsafe or missing mock field: {key}")
    if payload.get("live_audio_analyzed") is not False:
        raise ValueError("M0 cannot claim live audio")
    for key in ("real_osc_packets_sent", "keyboard_events_sent"):
        if type(payload.get(key)) is not int or payload[key] != 0:
            raise ValueError(f"M0 cannot claim real output: {key}")
    events, decisions, intents = (payload.get(key) for key in ("events", "decisions", "osc_intents"))
    if not all(isinstance(values, list) and len(values) == 4 for values in (events, decisions, intents)):
        raise ValueError("M0 fixture must contain four events, decisions and recorded intents")
    if payload.get("allowed_columns") != [1, 2, 3]:
        raise ValueError("Unexpected M0 allowlist")
    for collection in (events, decisions, intents):
        if not all(isinstance(item, dict) for item in collection):
            raise ValueError("Mock records must be objects")
    if any(type(item.get("column")) is not int for item in decisions + intents):
        raise ValueError("Mock columns must be integers, not booleans")
    if [item.get("column") for item in decisions] != [1, 2, 3, 1]:
        raise ValueError("Unexpected fixture decisions")
    ids = [f"mock-{i:03d}" for i in range(1, 5)]
    for collection in (events, decisions, intents):
        if [item.get("event_id") for item in collection] != ids:
            raise ValueError("Mock event IDs are inconsistent")
    for intent, decision in zip(intents, decisions):
        if intent.get("delivery_status") != "RECORDED_ONLY" or intent.get("resolume_confirmed") is not False:
            raise ValueError("Recorded intent cannot be a confirmed live command")
        if intent.get("column") != decision["column"]:
            raise ValueError("Intent and proposal columns disagree")
        if intent.get("address_preview") != f'/composition/columns/{decision["column"]}/connect' or intent.get("args_preview") != [1]:
            raise ValueError("Unexpected OSC preview")


def _save(run_dir, state):
    # These files belong to this newly created run, never to an existing run.
    temp = run_dir / "state.json.tmp"
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(run_dir / "state.json")
    (run_dir / "report.html").write_text(render_report(state), encoding="utf-8")


def _run_workflow(project_root, run_id=None, step_timeout=30, executor: Callable | None = None, stage="M0", dataset_path=None):
    if stage not in ("M0", "M1"):
        raise ValueError("Unknown verification stage")
    if isinstance(step_timeout, bool) or not isinstance(step_timeout, (int, float)) or not 0 < step_timeout <= 300:
        raise ValueError("step_timeout must be between zero and 300 seconds")
    root = Path(project_root).resolve(strict=True)
    if run_id is None:
        run_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid4().hex[:8]
    run_dir = create_run_directory(root, run_id)
    py = sys.executable
    commands = [
        ("syntax", "Python 語法檢查", [py, "-X", "utf8", "-m", "flyvj_m0", "syntax", "--project-root", str(root)]),
        ("unit", "Unit tests / 安全與失敗路徑", [py, "-X", "utf8", "-m", "unittest", "discover", "-s", str(root / "tests"), "-p", "test_*.py", "-v"]),
        ("mock", "Mock pipeline / OSC spy", [py, "-X", "utf8", "-m", "flyvj_m0", "mock", "--output", str(run_dir / "mock_result.json")]),
    ]
    if stage == "M1":
        commands = commands[:2] + [
            ("binding", "Synthetic 神經 ID / view packet 對照", [py, "-X", "utf8", "-m", "flyvj_m0", "binding-check", "--output", str(run_dir / "binding_result.json")]),
            ("real_data", "真實神經資料 / 來源關卡", [py, "-X", "utf8", "-m", "flyvj_m0", "real-data-check", "--output", str(run_dir / "real_data_result.json")]),
        ]
        if dataset_path is not None:
            commands[-1][2].extend(["--dataset", str(Path(dataset_path).absolute())])
    state = {
        "schema_version": 1, "stage": stage, "scope": "M0_DRY_RUN" if stage == "M0" else "M1_DATA_INTERFACE", "run_id": run_id,
        "status": "RUNNING", "created_at": _now(), "finished_at": None,
        "retry_count": 0, "tests_run": None,
        "safety": {"mode": "dry_run", "osc_transport": "in_memory", "real_osc_enabled": False, "keyboard_injection_enabled": False},
        "coverage": {"real_neural_data": "NOT_IMPLEMENTED", "live_audio": "NOT_IMPLEMENTED", "render_3d": "NOT_IMPLEMENTED", "resolume": "NOT_CONNECTED"},
        "manual_qc": {"status": "NOT_RUN", "evidence": []},
        "steps": [{"id": key, "title": title, "command": argv, "status": "NOT_RUN", "exit_code": None} for key, title, argv in commands],
    }
    if stage == "M1":
        state["interface_status"] = "NOT_RUN"
    try:
        _save(run_dir, state)
        package = root / "src" / "flyvj_m0"
        tests = root / "tests"
        if not package.is_dir() or not tests.is_dir() or not any(tests.glob("test_*.py")):
            state["status"] = "BLOCKED"
            state["error"] = "M0 source 或 tests 未齊；唔可以當測試通過。"
            state["steps"][0].update(status="BLOCKED", error_code="MISSING_PROJECT_INPUTS")
        else:
            invoke = executor or execute_step
            for step in state["steps"]:
                step["status"] = "RUNNING"
                _save(run_dir, state)
                stdout = stderr = ""
                result = None
                error_code = None
                try:
                    result = invoke(step["command"], root, step_timeout)
                    stdout, stderr = result.stdout, result.stderr
                    step["exit_code"] = result.exit_code
                    step["duration_seconds"] = result.duration_seconds
                    if step["id"] == "real_data":
                        from .verify_data import validate_real_gate_result
                        payload = json.loads((run_dir / "real_data_result.json").read_text(encoding="utf-8"))
                        validate_real_gate_result(payload, dataset_path=dataset_path)
                        expected_exit = 0 if payload["status"] == "PASSED" else 1
                        if type(result.exit_code) is not int or result.exit_code != expected_exit:
                            raise ValueError("Real-data exit code disagrees with verified artifact")
                        state["real_data_result"] = payload
                        state["coverage"]["real_neural_data"] = payload["status"]
                        if payload["status"] == "BLOCKED":
                            error_code = payload["error_code"]
                    elif result.exit_code != 0:
                        error_code = "NONZERO_EXIT"
                    elif step["id"] == "unit":
                        match = re.search(r"Ran\s+(\d+)\s+tests?\b", stdout + "\n" + stderr)
                        state["tests_run"] = int(match.group(1)) if match else 0
                        skipped = re.search(r"skipped=(\d+)", stdout + "\n" + stderr)
                        state["tests_skipped"] = int(skipped.group(1)) if skipped else 0
                        if not state["tests_run"]:
                            error_code = "EMPTY_TEST_SUITE"
                        elif state["tests_skipped"]:
                            error_code = "SKIPPED_TESTS"
                    elif step["id"] == "mock":
                        payload = json.loads((run_dir / "mock_result.json").read_text(encoding="utf-8"))
                        validate_mock_result(payload)
                        state["mock_result"] = payload
                    elif step["id"] == "binding":
                        from .verify_data import validate_binding_result
                        payload = json.loads((run_dir / "binding_result.json").read_text(encoding="utf-8"))
                        validate_binding_result(payload)
                        state["data_result"] = payload
                        state["interface_status"] = "PASSED"
                except subprocess.TimeoutExpired as exc:
                    stdout, stderr = _decoded(exc.stdout), _decoded(exc.stderr)
                    error_code = "STEP_TIMEOUT"
                except OSError as exc:
                    stderr = str(exc)
                    error_code = "PROCESS_START_FAILED" if result is None else "ARTIFACT_ERROR"
                except (ValueError, TypeError, KeyError, AttributeError) as exc:
                    stderr = str(exc)
                    error_code = "INVALID_MOCK_ARTIFACT" if stage == "M0" else "INVALID_DATA_ARTIFACT"
                except KeyboardInterrupt:
                    stderr = "使用者中止；冇自動重試。"
                    error_code = "INTERRUPTED"
                step["stdout_log"] = f'logs/{step["id"]}.stdout.log'
                step["stderr_log"] = f'logs/{step["id"]}.stderr.log'
                (run_dir / step["stdout_log"]).write_text(stdout, encoding="utf-8")
                (run_dir / step["stderr_log"]).write_text(stderr, encoding="utf-8")
                if error_code:
                    step.update(status="BLOCKED", error_code=error_code)
                    state["status"] = "BLOCKED"
                    state["error_code"] = error_code
                    state["error"] = f'{step["title"]}：{error_code}。先睇 log，唔盲目重試。'
                    if stage == "M1":
                        if state["interface_status"] != "PASSED":
                            state["interface_status"] = "BLOCKED"
                        if step["id"] == "real_data" and "real_data_result" in state:
                            state["error"] = state["real_data_result"]["message"]
                    break
                step["status"] = "PASSED"
                _save(run_dir, state)
            else:
                state["status"] = "PASSED"
        state["finished_at"] = _now()
        state["next_action"] = ("先覆核 M0 證據；M1 再驗證真實資料同 neuron ID 一致性。" if state["status"] == "PASSED"
                                else "打開失敗步驟嘅 log，確認原因先修復；唔會自動重試。")
        if stage == "M1":
            state["next_action"] = ("提供已授權小樣本嘅本機路徑，再核對來源／版本／授權；唔會自動下載或放行。" if state["interface_status"] == "PASSED" else "先修復接口／測試錯誤，再跑 VerifyData；唔進入真資料或播出。")
        if stage == "M1" and state["status"] == "PASSED":
            state["next_action"] = "交主管獨立 code／source／screen cap QC；只完成 real point sample，唔代表 full morphology／3D renderer。"
        _save(run_dir, state)
    except KeyboardInterrupt:
        state.update(status="BLOCKED", error_code="INTERRUPTED", finished_at=_now(),
                     error="使用者中止；已停止，冇自動重試。",
                     next_action="確認中止原因後，再用新 run ID 執行。")
        for step in state["steps"]:
            if step["status"] == "RUNNING":
                step.update(status="BLOCKED", error_code="INTERRUPTED")
        try:
            _save(run_dir, state)
        except (KeyboardInterrupt, OSError):
            # Best effort only: hard termination/disk failure cannot promise a report.
            pass
    return state, 0 if state["status"] == "PASSED" else 1

def run_m0(project_root, run_id=None, step_timeout=30, executor=None):
    return _run_workflow(project_root, run_id, step_timeout, executor, stage="M0")


def run_m1(project_root, run_id=None, step_timeout=30, executor=None, dataset_path=None):
    return _run_workflow(project_root, run_id, step_timeout, executor, stage="M1", dataset_path=dataset_path)
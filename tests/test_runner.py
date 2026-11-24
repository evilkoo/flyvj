"""Runner/report contracts. Tests use isolated directories and trusted fake steps."""
import importlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class RunnerTests(unittest.TestCase):
    def module(self, name="runner"):
        try:
            return importlib.import_module("flyvj_m0." + name)
        except ModuleNotFoundError as exc:
            if exc.name and exc.name.startswith("flyvj_m0"):
                self.fail("M0 runner/report does not exist yet")
            raise

    def fake_project(self, root):
        package = root / "src" / "flyvj_m0"
        package.mkdir(parents=True)
        (package / "__init__.py").write_text("", encoding="utf-8")
        (root / "tests").mkdir()
        (root / "tests" / "test_example.py").write_text("", encoding="utf-8")

    def successful_executor(self, argv, cwd, timeout):
        if "mock" in argv:
            pipeline = self.module("pipeline")
            output = Path(argv[argv.index("--output") + 1])
            output.write_text(json.dumps(pipeline.run_mock_pipeline(pipeline.default_events())), encoding="utf-8")
        stderr = "Ran 11 tests in 0.010s\n\nOK\n" if "unittest" in argv else ""
        return self.module().CommandResult(0, "completed", stderr, 0.01)

    def test_success_writes_honest_state_and_html(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            state, exit_code = m.run_m0(root, "test-success", executor=self.successful_executor)
            self.assertEqual(exit_code, 0)
            self.assertEqual(state["status"], "PASSED")
            self.assertEqual(state["scope"], "M0_DRY_RUN")
            self.assertEqual(state["tests_run"], 11)
            self.assertEqual(state["manual_qc"]["status"], "NOT_RUN")
            self.assertEqual(state["coverage"]["real_neural_data"], "NOT_IMPLEMENTED")
            self.assertEqual(state["coverage"]["resolume"], "NOT_CONNECTED")
            self.assertEqual(state["retry_count"], 0)
            run_dir = root / "work" / "runs" / "test-success"
            self.assertTrue((run_dir / "report.html").is_file())
            self.assertEqual(json.loads((run_dir / "state.json").read_text(encoding="utf-8")), state)
            self.assertEqual([s["status"] for s in state["steps"]], ["PASSED"] * 3)
            self.assertEqual(len(list((run_dir / "logs").glob("*.log"))), 6)

    def test_failed_step_stops_without_retries(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            calls = []
            def failure(argv, cwd, timeout):
                calls.append(argv)
                return m.CommandResult(1, "", "deliberate failure", 0.01)
            state, code = m.run_m0(root, "test-failure", executor=failure)
            self.assertEqual(code, 1)
            self.assertEqual(state["status"], "BLOCKED")
            self.assertEqual(len(calls), 1)
            self.assertEqual(state["steps"][1]["status"], "NOT_RUN")
            self.assertTrue((root / "work" / "runs" / "test-failure" / "report.html").exists())

    def test_zero_tests_is_blocked_not_passed(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            def zero(argv, cwd, timeout):
                return m.CommandResult(0, "", "Ran 0 tests in 0.000s\nOK\n", 0.01)
            state, code = m.run_m0(root, "zero-tests", executor=zero)
            self.assertEqual(code, 1)
            self.assertEqual(state["status"], "BLOCKED")
            self.assertEqual(state["steps"][1]["error_code"], "EMPTY_TEST_SUITE")

    def test_timeout_is_recorded_and_stops(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            def timeout(argv, cwd, seconds):
                raise subprocess.TimeoutExpired(argv, seconds, output=b"partial output", stderr=b"partial error")
            state, code = m.run_m0(root, "timeout", executor=timeout)
            self.assertEqual(code, 1)
            self.assertEqual(state["status"], "BLOCKED")
            self.assertEqual(state["steps"][0]["error_code"], "STEP_TIMEOUT")
            self.assertIn("partial output", (root / "work" / "runs" / "timeout" / "logs" / "syntax.stdout.log").read_text(encoding="utf-8"))

    def test_process_start_failure_is_recorded(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            def missing(argv, cwd, timeout):
                raise FileNotFoundError("missing executable")
            state, code = m.run_m0(root, "missing-exe", executor=missing)
            self.assertEqual(code, 1)
            self.assertEqual(state["steps"][0]["error_code"], "PROCESS_START_FAILED")

    def test_invalid_run_id_cannot_escape_workspace(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for run_id in ("../escape", "..", "a/b", "a\\b", "", "a" * 65):
                with self.subTest(run_id=run_id), self.assertRaises(ValueError):
                    m.create_run_directory(root, run_id)
            self.assertFalse((root / "work").exists())

    def test_existing_run_directory_is_never_overwritten(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            run_dir = m.create_run_directory(root, "same")
            marker = run_dir / "important.txt"
            marker.write_text("keep", encoding="utf-8")
            with self.assertRaises(FileExistsError):
                m.create_run_directory(root, "same")
            self.assertEqual(marker.read_text(encoding="utf-8"), "keep")

    def test_missing_tests_is_blocked(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "src" / "flyvj_m0").mkdir(parents=True)
            state, code = m.run_m0(root, "no-tests", executor=self.successful_executor)
            self.assertEqual(code, 1)
            self.assertEqual(state["status"], "BLOCKED")
            self.assertEqual(state["steps"][0]["error_code"], "MISSING_PROJECT_INPUTS")

    def test_mock_payload_cannot_claim_live_output(self):
        m = self.module()
        pipeline = self.module("pipeline")
        payload = pipeline.run_mock_pipeline(pipeline.default_events())
        payload["real_osc_packets_sent"] = 1
        with self.assertRaises(ValueError):
            m.validate_mock_result(payload)

    def test_html_escapes_errors_and_names(self):
        report = self.module("report")
        html = report.render_report({"run_id": "<script>bad()</script>", "status": "BLOCKED",
                                     "steps": [], "error": "<img src=x onerror=alert(1)>"})
        self.assertNotIn("<script>", html)
        self.assertNotIn("<img src=x", html)
        self.assertIn("&lt;script&gt;", html)
        self.assertIn("真實大腦", html)

    def test_skipped_tests_are_not_a_clean_pass(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            def skipped(argv, cwd, timeout):
                return m.CommandResult(0, "", "Ran 11 tests in 0.010s\nOK (skipped=11)\n", 0.01)
            state, code = m.run_m0(root, "skipped-tests", executor=skipped)
            self.assertEqual(code, 1)
            self.assertEqual(state["steps"][1].get("error_code"), "SKIPPED_TESTS")

    def test_non_object_mock_records_have_validation_errors(self):
        m = self.module()
        pipeline = self.module("pipeline")
        for key in ("events", "decisions", "osc_intents"):
            payload = pipeline.run_mock_pipeline(pipeline.default_events())
            payload[key][0] = "not an object"
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.validate_mock_result(payload)

    def test_mock_boolean_column_is_rejected(self):
        m = self.module()
        pipeline = self.module("pipeline")
        payload = pipeline.run_mock_pipeline(pipeline.default_events())
        payload["decisions"][0]["column"] = True
        payload["osc_intents"][0]["column"] = True
        with self.assertRaises(ValueError):
            m.validate_mock_result(payload)

    def test_timeout_terminates_owned_descendants(self):
        import time
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            marker = str(Path(temp) / "descendant.txt")
            child = "import time,pathlib,sys; time.sleep(1.6); pathlib.Path(sys.argv[1]).write_text('escaped')"
            parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]]); print('started',flush=True); time.sleep(8)"
            started = time.monotonic()
            with self.assertRaises(subprocess.TimeoutExpired):
                m.execute_step([sys.executable, "-c", parent, child, marker], Path.cwd(), 0.3)
            self.assertLess(time.monotonic() - started, 1.3)
            time.sleep(1.7)
            self.assertFalse(Path(marker).exists(), "Owned descendant escaped timeout cleanup")

    def test_normal_exit_does_not_leave_owned_descendants(self):
        import time
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            marker = str(Path(temp) / "leftover.txt")
            child = "import time,pathlib,sys; time.sleep(1); pathlib.Path(sys.argv[1]).write_text('leftover')"
            parent = "import subprocess,sys; subprocess.Popen([sys.executable,'-c',sys.argv[1],sys.argv[2]])"
            result = m.execute_step([sys.executable, "-c", parent, child, marker], Path.cwd(), 5)
            self.assertEqual(result.exit_code, 0)
            time.sleep(1.1)
            self.assertFalse(Path(marker).exists(), "Owned child continued after the step ended")

    def test_interrupt_during_state_save_is_recorded(self):
        from unittest.mock import patch
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            original_save = m._save
            calls = []
            def save_then_interrupt(run_dir, state):
                calls.append(1)
                original_save(run_dir, state)
                if len(calls) == 2:
                    raise KeyboardInterrupt()
            with patch.object(m, "_save", side_effect=save_then_interrupt):
                try:
                    state, code = m.run_m0(root, "interrupt", executor=self.successful_executor)
                except KeyboardInterrupt:
                    self.fail("Interrupt escaped and left RUNNING state")
            self.assertEqual(code, 1)
            self.assertEqual(state["status"], "BLOCKED")
            self.assertEqual(state["error_code"], "INTERRUPTED")
            self.assertIsNotNone(state["finished_at"])
            disk = json.loads((root / "work" / "runs" / "interrupt" / "state.json").read_text(encoding="utf-8"))
            self.assertEqual(disk["status"], "BLOCKED")

    def test_report_displays_independent_qc_status(self):
        report = self.module("report")
        html = report.render_report({"run_id": "qc-status", "status": "PASSED", "steps": [],
                                     "manual_qc": {"status": "NOT_RUN", "evidence": []}})
        self.assertIn("獨立 QC 狀態", html)
        self.assertIn("NOT_RUN", html)
        reviewed = report.render_report({"run_id": "qc-status", "status": "PASSED", "steps": [],
                                         "manual_qc": {"status": "REVIEWED", "evidence": ["local screenshot"]}})
        self.assertIn("REVIEWED", reviewed)
        self.assertIn("local screenshot", reviewed)

    def test_execute_step_captures_exit_code(self):
        m = self.module()
        result = m.execute_step([sys.executable, "-c", "print('probe'); raise SystemExit(3)"], Path.cwd(), 5)
        self.assertEqual(result.exit_code, 3)
        self.assertIn("probe", result.stdout)


if __name__ == "__main__":
    unittest.main()
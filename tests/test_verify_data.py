"""M1 must not turn a synthetic or self-declared real file into real acceptance."""
import importlib
import json
from pathlib import Path
import tempfile
import unittest


class VerifyDataTests(unittest.TestCase):
    def module(self, name="verify_data"):
        try:
            return importlib.import_module("flyvj_m0." + name)
        except ModuleNotFoundError as exc:
            if exc.name and exc.name.startswith("flyvj_m0"):
                self.fail("M1 VerifyData does not exist yet")
            raise

    def fake_project(self, root):
        (root / "src" / "flyvj_m0").mkdir(parents=True)
        (root / "tests").mkdir()
        (root / "tests" / "test_sample.py").write_text("", encoding="utf-8")

    def successful_executor(self, argv, cwd, timeout):
        runner = self.module("runner")
        if "binding-check" in argv:
            payload = self.module().binding_demo_result()
            Path(argv[argv.index("--output") + 1]).write_text(json.dumps(payload), encoding="utf-8")
        elif "real-data-check" in argv:
            payload = self.module().inspect_real_data(None)
            Path(argv[argv.index("--output") + 1]).write_text(json.dumps(payload), encoding="utf-8")
            return runner.CommandResult(1, "real gate blocked", "", 0.01)
        return runner.CommandResult(0, "", "Ran 25 tests in 0.1s\nOK\n", 0.01)

    def test_missing_real_dataset_is_blocked(self):
        m = self.module()
        result = m.inspect_real_data(None)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["error_code"], "REAL_DATA_NOT_PROVIDED")
        self.assertFalse(result["provenance_verified"])

    def test_synthetic_is_not_accepted_as_real(self):
        m = self.module()
        data = self.module("dataset")
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "synthetic.json"
            p.write_text(json.dumps(data.synthetic_payload()), encoding="utf-8")
            result = m.inspect_real_data(p)
            self.assertEqual(result["error_code"], "SYNTHETIC_IS_NOT_REAL")
            self.assertEqual(result["status"], "BLOCKED")

    def test_self_declared_real_metadata_is_not_authentication(self):
        m = self.module()
        data = self.module("dataset")
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "claimed-real.json"
            payload = data.synthetic_payload()
            payload["provenance"]["kind"] = "real"
            p.write_text(json.dumps(payload), encoding="utf-8")
            result = m.inspect_real_data(p)
            self.assertEqual(result["error_code"], "REAL_PROVENANCE_UNVERIFIED")
            self.assertEqual(result["status"], "BLOCKED")
            self.assertFalse(result["provenance_verified"])

    def test_bad_file_fails_closed(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "invalid.json"
            p.write_text("not json", encoding="utf-8")
            self.assertEqual(m.inspect_real_data(p)["error_code"], "INVALID_DATASET")

    def test_deep_json_and_surrogate_gate_return_structured_blockers(self):
        m = self.module()
        data = self.module("dataset")
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "bad.json"
            p.write_text("[" * 1100 + "0" + "]" * 1100, encoding="utf-8")
            self.assertEqual(m.inspect_real_data(p)["error_code"], "INVALID_DATASET")
            payload = data.synthetic_payload()
            payload["coordinates"]["frame"] = "\ud800"
            p.write_text(json.dumps(payload), encoding="utf-8")
            self.assertEqual(m.inspect_real_data(p)["error_code"], "INVALID_DATASET")

    def test_binding_demo_labels_scope_and_has_id_rows(self):
        m = self.module()
        result = m.binding_demo_result()
        self.assertEqual(result["source_kind"], "synthetic")
        self.assertEqual(result["status"], "PASSED")
        self.assertEqual(result["rendering_status"], "NOT_IMPLEMENTED")
        self.assertEqual(len(result["rows"]), 3)
        self.assertEqual([r["engine_index"] for r in result["rows"]], [2, 1, 0])
        self.assertEqual(result["real_osc_packets_sent"], 0)

    def test_tampered_binding_artifact_is_rejected(self):
        m = self.module()
        result = m.binding_demo_result()
        result["rows"][0]["position"][0] = 999
        with self.assertRaises(ValueError):
            m.validate_binding_result(result)

    def test_runner_reports_interface_pass_and_real_gate_block(self):
        m = self.module("runner")
        self.assertTrue(hasattr(m, "run_m1"), "run_m1 not implemented")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            state, code = m.run_m1(root, "m1-test", executor=self.successful_executor)
            self.assertEqual(code, 1)
            self.assertEqual(state["stage"], "M1")
            self.assertEqual(state["scope"], "M1_DATA_INTERFACE")
            self.assertEqual(state["interface_status"], "PASSED")
            self.assertEqual(state["status"], "BLOCKED")
            self.assertEqual(state["steps"][-1]["error_code"], "REAL_DATA_NOT_PROVIDED")
            self.assertEqual(state["retry_count"], 0)
            self.assertEqual(state["manual_qc"]["status"], "NOT_RUN")
            html = (root / "work" / "runs" / "m1-test" / "report.html").read_text(encoding="utf-8")
            self.assertIn("M1", html)
            self.assertIn("接口檢查", html)
            self.assertIn("真資料關卡", html)
            self.assertIn("9007199254740993", html)

    def test_runner_stops_before_binding_if_unit_tests_fail(self):
        m = self.module("runner")
        self.assertTrue(hasattr(m, "run_m1"), "run_m1 not implemented")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            def failure(argv, cwd, timeout):
                if "unittest" in argv:
                    return m.CommandResult(1, "", "FAILED", 0.01)
                return m.CommandResult(0, "", "", 0.01)
            state, code = m.run_m1(root, "m1-unit-failure", executor=failure)
            self.assertEqual(code, 1)
            self.assertEqual(state["interface_status"], "BLOCKED")
            self.assertEqual(state["steps"][2]["status"], "NOT_RUN")
            self.assertEqual(state["steps"][3]["status"], "NOT_RUN")

    def test_real_gate_badge_does_not_claim_it_ran_after_unit_failure(self):
        report = self.module("report")
        html = report.render_report({"stage":"M1", "status":"BLOCKED", "interface_status":"BLOCKED",
                                     "steps":[{"id":"real_data", "status":"NOT_RUN"}]})
        self.assertTrue("真資料關卡 NOT_RUN" in html, "Gate badge must use the actual NOT_RUN state")
        self.assertFalse("真資料關卡 BLOCKED" in html, "An unexecuted gate must not be labelled BLOCKED")

    def test_browser_title_matches_m1_scope(self):
        report = self.module("report")
        html = report.render_report({"stage":"M1", "status":"BLOCKED", "steps":[]})
        self.assertTrue("<title>烏蠅 VJ · M1 報告</title>" in html, "Browser tab must not claim M0")

    def test_rendered_ids_are_escaped(self):
        report = self.module("report")
        html = report.render_report({"stage":"M1", "status":"BLOCKED", "interface_status":"PASSED",
            "data_result":{"rows":[{"neuron_id":"<script>bad</script>","engine_index":0,"view_index":0,
            "position":[0,0,0],"activation":0,"matched":True}]}, "steps":[]})
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)


    def sample_path(self):
        return Path(__file__).resolve().parents[1] / "data" / "flywire783-m1" / "sample.json"

    def test_curated_sample_passes_with_real_id_binding_and_mock_activity(self):
        m = self.module()
        result = m.inspect_real_data(self.sample_path())
        self.assertEqual(result["status"], "PASSED")
        self.assertTrue(result["provenance_verified"])
        self.assertEqual(result["source_scope"], "CURATED_REAL_POINT_GRAPH_SAMPLE")
        self.assertEqual(result["activity_kind"], "synthetic_mock_not_biological_firing")
        self.assertEqual(result["rendering_status"], "NOT_IMPLEMENTED")
        self.assertEqual(result["real_osc_packets_sent"], 0)
        self.assertEqual((result["neuron_count"], result["connection_count"]), (6, 3))
        dataset = self.module("dataset").load_dataset(self.sample_path())
        self.assertEqual([r["neuron_id"] for r in result["rows"]], list(reversed(dataset.neuron_ids)))
        for row in result["rows"]:
            self.assertEqual(row["position"], list(dataset.neuron_by_id[row["neuron_id"]].position))
        m.validate_real_gate_result(result, self.sample_path())
        with self.assertRaises(ValueError):
            m.validate_real_gate_result(result)
        for field, value in (("provenance_verified", 1), ("dataset_fingerprint", "fake"), ("rows", [])):
            forged = dict(result, **{field: value})
            with self.subTest(field=field), self.assertRaises(ValueError):
                m.validate_real_gate_result(forged, self.sample_path())

    def test_changed_real_sample_remains_blocked(self):
        payload = json.loads(self.sample_path().read_text(encoding="utf-8"))
        payload["neurons"][0]["position"][0] += 1
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "changed.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            result = self.module().inspect_real_data(path)
        self.assertEqual(result["error_code"], "REAL_PROVENANCE_UNVERIFIED")

    def test_runner_accepts_only_recomputed_real_pass_and_matching_exit(self):
        m = self.module("runner")
        for exit_code in (0, 1, 2):
            with self.subTest(exit_code=exit_code), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                self.fake_project(root)
                def execute(argv, cwd, timeout):
                    if "real-data-check" in argv:
                        result = self.module().inspect_real_data(self.sample_path())
                        Path(argv[argv.index("--output") + 1]).write_text(json.dumps(result), encoding="utf-8")
                        return m.CommandResult(exit_code, "", "", 0.01)
                    return self.successful_executor(argv, cwd, timeout)
                state, code = m.run_m1(root, "real", executor=execute, dataset_path=self.sample_path())
                self.assertEqual(code, 0 if exit_code == 0 else 1)
                if exit_code == 0:
                    self.assertEqual(state["status"], "PASSED")
                    self.assertEqual(state["coverage"]["real_neural_data"], "PASSED")
                    html = (root / "work/runs/real/report.html").read_text(encoding="utf-8")
                    self.assertIn("720575940605876866", html)
                    self.assertIn("CURATED_REAL_POINT_GRAPH_SAMPLE", html)
                    self.assertIn("full morphology", html)
                else:
                    self.assertEqual(state["error_code"], "INVALID_DATA_ARTIFACT")

    def test_cli_real_check_exits_zero_only_for_verified_sample(self):
        import contextlib
        import io
        cli = self.module("__main__")
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            code = cli.main(["real-data-check", "--dataset", str(self.sample_path()),
                             "--output", str(Path(temp) / "result.json")])
        self.assertEqual(code, 0)



    def test_forced_pass_without_dataset_is_rejected(self):
        m = self.module("runner")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            def execute(argv, cwd, timeout):
                if "real-data-check" in argv:
                    result = self.module().inspect_real_data(None)
                    result.update(status="PASSED", provenance_verified=True)
                    Path(argv[argv.index("--output") + 1]).write_text(json.dumps(result), encoding="utf-8")
                    return m.CommandResult(0, "", "", 0.01)
                return self.successful_executor(argv, cwd, timeout)
            state, code = m.run_m1(root, "forged", executor=execute)
        self.assertEqual(code, 1)
        self.assertEqual(state["error_code"], "INVALID_DATA_ARTIFACT")

    def test_blocker_artifact_cannot_lie_about_reason(self):
        m = self.module()
        for error in ("UNKNOWN", "SOURCE_EVIDENCE_INVALID", "SYNTHETIC_IS_NOT_REAL"):
            payload = m.inspect_real_data(None)
            payload["error_code"] = error
            with self.subTest(error=error), self.assertRaises(ValueError):
                m.validate_real_gate_result(payload)
        m.validate_real_gate_result(m.inspect_real_data(None))

    def test_cli_missing_data_keeps_exit_one(self):
        import contextlib
        import io
        with tempfile.TemporaryDirectory() as temp, contextlib.redirect_stdout(io.StringIO()):
            code = self.module("__main__").main(["real-data-check", "--output", str(Path(temp) / "result.json")])
        self.assertEqual(code, 1)



    def test_runner_rejects_tampered_pass_even_with_genuine_dataset(self):
        m = self.module("runner")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.fake_project(root)
            def execute(argv, cwd, timeout):
                if "real-data-check" in argv:
                    result = self.module().inspect_real_data(self.sample_path())
                    result["rows"][0]["activation"] = 999
                    Path(argv[argv.index("--output") + 1]).write_text(json.dumps(result), encoding="utf-8")
                    return m.CommandResult(0, "", "", 0.01)
                return self.successful_executor(argv, cwd, timeout)
            state, code = m.run_m1(root, "tampered", executor=execute, dataset_path=self.sample_path())
        self.assertEqual(code, 1)
        self.assertEqual(state["error_code"], "INVALID_DATA_ARTIFACT")


if __name__ == "__main__":
    unittest.main()
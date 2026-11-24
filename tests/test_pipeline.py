"""M0 safety contracts. Written before the implementation."""
import importlib
import math
import socket
import unittest
from unittest.mock import patch


class PipelineTests(unittest.TestCase):
    def module(self):
        try:
            return importlib.import_module("flyvj_m0.pipeline")
        except ModuleNotFoundError as exc:
            if exc.name and exc.name.startswith("flyvj_m0"):
                self.fail("M0 pipeline does not exist yet")
            raise

    def test_fixture_produces_deterministic_column_proposals(self):
        m = self.module()
        result = m.run_mock_pipeline(m.default_events())
        self.assertEqual([d["column"] for d in result["decisions"]], [1, 2, 3, 1])
        self.assertEqual(result, m.run_mock_pipeline(m.default_events()))

    def test_spy_records_intents_without_opening_network_socket(self):
        m = self.module()
        with patch.object(socket, "socket", side_effect=AssertionError("Network forbidden")):
            result = m.run_mock_pipeline(m.default_events())
        self.assertEqual(result["transport"], "in_memory")
        self.assertEqual(result["real_osc_packets_sent"], 0)
        self.assertEqual(result["keyboard_events_sent"], 0)
        self.assertEqual(len(result["osc_intents"]), 4)
        self.assertTrue(all(i["delivery_status"] == "RECORDED_ONLY" for i in result["osc_intents"]))
        self.assertTrue(all(i["resolume_confirmed"] is False for i in result["osc_intents"]))

    def test_fixture_is_explicitly_mock_not_real_audio_or_neurons(self):
        m = self.module()
        result = m.run_mock_pipeline(m.default_events())
        self.assertEqual(result["source"], "synthetic_fixture")
        self.assertEqual(result["neural_data_status"], "NOT_LOADED")
        self.assertFalse(result["live_audio_analyzed"])

    def test_threshold_boundaries_are_explicit(self):
        m = self.module()
        events = [m.MockEvent("a", 0, 0, 0.399), m.MockEvent("b", 1, 1000, 0.4),
                  m.MockEvent("c", 2, 2000, 0.749), m.MockEvent("d", 3, 3000, 0.75)]
        self.assertEqual([d["column"] for d in m.run_mock_pipeline(events)["decisions"]], [1, 2, 2, 3])

    def test_unapproved_column_blocks_instead_of_falling_back(self):
        m = self.module()
        with self.assertRaises(m.SafetyViolation):
            m.run_mock_pipeline(m.default_events(), allowed_columns=(1, 2))

    def test_invalid_energy_is_rejected(self):
        m = self.module()
        for energy in (-0.1, 1.1, math.nan, math.inf, True, "0.4"):
            with self.subTest(energy=energy), self.assertRaises(ValueError):
                m.run_mock_pipeline([m.MockEvent("a", 0, 0, energy)])

    def test_duplicate_ids_are_rejected(self):
        m = self.module()
        with self.assertRaises(ValueError):
            m.run_mock_pipeline([m.MockEvent("a", 0, 0, 0.2), m.MockEvent("a", 1, 10, 0.5)])

    def test_out_of_order_events_are_rejected(self):
        m = self.module()
        for events in ([m.MockEvent("a", 1, 10, 0.2), m.MockEvent("b", 0, 20, 0.5)],
                       [m.MockEvent("a", 0, 20, 0.2), m.MockEvent("b", 1, 10, 0.5)]):
            with self.subTest(events=events), self.assertRaises(ValueError):
                m.run_mock_pipeline(events)

    def test_empty_input_has_no_intents(self):
        m = self.module()
        result = m.run_mock_pipeline([])
        self.assertEqual(result["decisions"], [])
        self.assertEqual(result["osc_intents"], [])

    def test_invalid_allowlist_is_rejected(self):
        m = self.module()
        for allowed in ((), (0,), (True,), (1, 1), ("1",)):
            with self.subTest(allowed=allowed), self.assertRaises(ValueError):
                m.run_mock_pipeline([], allowed_columns=allowed)

    def test_spy_enforces_allowlist(self):
        m = self.module()
        spy = m.OscSpy((1, 2))
        with self.assertRaises(m.SafetyViolation):
            spy.record(3, "a")
        self.assertEqual(spy.intents, [])


if __name__ == "__main__":
    unittest.main()
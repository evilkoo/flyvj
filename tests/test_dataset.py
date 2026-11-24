"""M1 dataset/binding tests, written before production code."""
import copy
from dataclasses import FrozenInstanceError, replace
import importlib
import json
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch


class DataTests(unittest.TestCase):
    def module(self, name="dataset"):
        try:
            return importlib.import_module("flyvj_m0." + name)
        except ModuleNotFoundError as exc:
            if exc.name and exc.name.startswith("flyvj_m0"):
                self.fail("M1 data interface does not exist yet")
            raise

    def test_synthetic_is_explicit_and_large_ids_stay_strings(self):
        m = self.module()
        ds = m.parse_dataset(m.synthetic_payload())
        self.assertEqual(ds.provenance.kind, "synthetic")
        self.assertEqual(ds.neuron_ids, ("9007199254740993", "9007199254740995", "9007199254740997"))
        self.assertNotEqual(ds.neuron_ids[0], ds.neuron_ids[1])
        self.assertTrue(all(isinstance(x, str) for x in ds.neuron_ids))

    def test_dataset_is_immutable(self):
        m = self.module()
        ds = m.parse_dataset(m.synthetic_payload())
        with self.assertRaises(FrozenInstanceError):
            ds.neurons = ()
        with self.assertRaises(TypeError):
            ds.neuron_by_id[ds.neuron_ids[0]] = ds.neurons[1]

    def test_direct_constructor_copies_mutable_collections(self):
        m = self.module()
        ds = m.parse_dataset(m.synthetic_payload())
        nodes, edges = list(ds.neurons), list(ds.connections)
        copied = m.NeuralDataset(ds.provenance, ds.coordinates, nodes, edges)
        nodes.reverse()
        edges.clear()
        self.assertEqual(copied.neuron_ids, ds.neuron_ids)
        self.assertEqual(copied.connections, ds.connections)
        self.assertIsInstance(copied.neurons, tuple)

    def test_direct_constructor_cannot_bypass_duplicate_validation(self):
        m = self.module()
        ds = m.parse_dataset(m.synthetic_payload())
        with self.assertRaises(m.DataValidationError):
            m.NeuralDataset(ds.provenance, ds.coordinates, (ds.neurons[0], ds.neurons[0]), ())

    def test_neuron_constructor_does_not_keep_mutable_geometry(self):
        m = self.module()
        position = [0.0, 1.0, 2.0]
        neuron = m.Neuron("test-id", position, "test-region")
        position[0] = 99.0
        self.assertEqual(neuron.position, (0.0, 1.0, 2.0))
        with self.assertRaises(m.DataValidationError):
            m.Neuron("test-id", (True, 1.0, 2.0), "test-region")

    def test_uri_unc_and_device_paths_are_rejected_before_file_io(self):
        m = self.module()
        for path in ("https://example.invalid/data.json", "file:///C:/data.json", r"\\server\share\data.json", r"\\.\pipe\input"):
            with self.subTest(path=path), patch.object(Path, "open", side_effect=AssertionError("Unexpected file IO")):
                with self.assertRaises(m.DataValidationError):
                    m.load_dataset(path)

    def test_boolean_view_geometry_is_not_numeric_zero(self):
        m = self.module()
        b = self.module("binding")
        ds = m.parse_dataset(m.synthetic_payload())
        frame = b.make_engine_frame(ds, [0.1, 0.5, 0.9])
        view = b.bind_view(ds, frame)
        node = replace(view.nodes[0], position=(False, 0.0, 0.0))
        with self.assertRaises(b.BindingMismatch):
            b.verify_binding(ds, frame, replace(view, nodes=(node, *view.nodes[1:])))

    def test_numeric_ids_are_not_silently_converted(self):
        m = self.module()
        p = m.synthetic_payload()
        p["neurons"][0]["id"] = 9007199254740993
        with self.assertRaises(m.DataValidationError):
            m.parse_dataset(p)

    def test_duplicate_neuron_ids_are_rejected(self):
        m = self.module()
        p = m.synthetic_payload()
        p["neurons"][1]["id"] = p["neurons"][0]["id"]
        with self.assertRaises(m.DataValidationError):
            m.parse_dataset(p)

    def test_unknown_connection_endpoint_is_rejected(self):
        m = self.module()
        p = m.synthetic_payload()
        p["connections"][0]["post_id"] = "unknown"
        with self.assertRaises(m.DataValidationError):
            m.parse_dataset(p)

    def test_duplicate_weighted_edge_is_rejected(self):
        m = self.module()
        p = m.synthetic_payload()
        p["connections"].append(copy.deepcopy(p["connections"][0]))
        with self.assertRaises(m.DataValidationError):
            m.parse_dataset(p)

    def test_bad_coordinate_values_are_rejected(self):
        m = self.module()
        for position in ([0, 0], [True, 0, 0], [float("nan"), 0, 0], [float("inf"), 0, 0], ["0", 0, 0]):
            p = m.synthetic_payload()
            p["neurons"][0]["position"] = position
            with self.subTest(position=position), self.assertRaises(m.DataValidationError):
                m.parse_dataset(p)

    def test_negative_inhibitory_weight_is_preserved(self):
        m = self.module()
        p = m.synthetic_payload()
        p["connections"][0]["weight"] = -0.5
        self.assertEqual(m.parse_dataset(p).connections[0].weight, -0.5)

    def test_boolean_weight_is_rejected(self):
        m = self.module()
        p = m.synthetic_payload()
        p["connections"][0]["weight"] = True
        with self.assertRaises(m.DataValidationError):
            m.parse_dataset(p)

    def test_missing_provenance_and_unknown_fields_are_rejected(self):
        m = self.module()
        for edit in ("missing-license", "private-extra", "unknown-kind", "boolean-version"):
            p = m.synthetic_payload()
            if edit == "missing-license":
                del p["provenance"]["license"]
            elif edit == "private-extra":
                p["contacts"] = ["not part of the data interface"]
            elif edit == "unknown-kind":
                p["provenance"]["kind"] = "guess"
            else:
                p["schema_version"] = True
            with self.subTest(edit=edit), self.assertRaises(m.DataValidationError):
                m.parse_dataset(p)

    def test_fingerprint_is_order_independent_but_version_sensitive(self):
        m = self.module()
        p = m.synthetic_payload()
        first = m.parse_dataset(p)
        p["neurons"].reverse()
        p["connections"].reverse()
        self.assertEqual(first.fingerprint, m.parse_dataset(p).fingerprint)
        p["provenance"]["version"] = "different-snapshot"
        self.assertNotEqual(first.fingerprint, m.parse_dataset(p).fingerprint)

    def test_units_and_frame_are_not_guessed(self):
        m = self.module()
        p = m.synthetic_payload()
        ds = m.parse_dataset(p)
        p["coordinates"]["units"] = "nanometer"
        self.assertNotEqual(ds.fingerprint, m.parse_dataset(p).fingerprint)
        del p["coordinates"]["frame"]
        with self.assertRaises(m.DataValidationError):
            m.parse_dataset(p)

    def test_raw_uri_cannot_be_erased_by_parent_normalization(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            selected = Path(temp) / "sample.json"
            raw = "https:\\..\\" + str(selected)
            with patch.object(m, "_drive_type", side_effect=AssertionError("Forbidden raw URI reached volume IO")):
                with self.assertRaises(m.DataValidationError):
                    m.load_dataset(raw)

    def test_raw_ads_cannot_be_erased_by_parent_normalization(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            raw = str(Path(temp) / "invalid:stream" / ".." / "sample.json")
            with patch.object(m, "_drive_type", side_effect=AssertionError("Forbidden raw ADS reached volume IO")):
                with self.assertRaises(m.DataValidationError):
                    m.load_dataset(raw)

    def test_mixed_separator_unc_is_rejected_before_io(self):
        m = self.module()
        for path in (r"\/host/share/data.json", r"/\host/share/data.json"):
            with self.subTest(path=path), patch.object(Path, "open", side_effect=AssertionError("Unexpected UNC IO")):
                with self.assertRaises(m.DataValidationError):
                    m.load_dataset(path)

    def test_small_deep_json_is_a_validation_error(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "deep.json"
            p.write_text("[" * 1100 + "0" + "]" * 1100, encoding="utf-8")
            with self.assertRaises(m.DataValidationError):
                m.load_dataset(p)

    def test_lone_surrogate_is_a_validation_error_not_encode_crash(self):
        m = self.module()
        payload = m.synthetic_payload()
        payload["provenance"]["name"] = "\ud800"
        with self.assertRaises(m.DataValidationError):
            m.parse_dataset(payload)
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "surrogate.json"
            p.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaises(m.DataValidationError):
                m.load_dataset(p)

    def test_network_drive_is_rejected_before_file_io(self):
        m = self.module()
        self.assertTrue(hasattr(m, "_drive_type"), "Local drive guard is not implemented")
        with patch.object(m, "_drive_type", return_value=4), patch.object(Path, "open", side_effect=AssertionError("Unexpected mapped drive IO")):
            with self.assertRaises(m.DataValidationError):
                m.load_dataset(r"Z:\mapped\data.json")

    def test_reparse_path_is_rejected_before_file_io(self):
        m = self.module()
        from types import SimpleNamespace
        info = SimpleNamespace(st_file_attributes=0x400, st_mode=0)
        with patch.object(m.os, "lstat", return_value=info), patch.object(Path, "open", side_effect=AssertionError("Unexpected reparse IO")):
            with self.assertRaises(m.DataValidationError):
                m.load_dataset(Path.cwd() / "data.json")

    def test_loader_accepts_utf8_json_only_and_does_not_open_network(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "sample.json"
            p.write_text(json.dumps(m.synthetic_payload()), encoding="utf-8-sig")
            with patch.object(socket, "socket", side_effect=AssertionError("Network forbidden")):
                ds = m.load_dataset(p)
            self.assertEqual(ds.provenance.kind, "synthetic")

    def test_loader_rejects_duplicate_json_keys_and_nan(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "bad.json"
            for text in ('{"schema_version":1,"schema_version":2}', '{"value":NaN}'):
                p.write_text(text, encoding="utf-8")
                with self.subTest(text=text), self.assertRaises(m.DataValidationError):
                    m.load_dataset(p)

    def test_loader_has_a_byte_limit(self):
        m = self.module()
        with tempfile.TemporaryDirectory() as temp:
            p = Path(temp) / "large.json"
            p.write_text(json.dumps(m.synthetic_payload()), encoding="utf-8")
            with self.assertRaises(m.DataValidationError):
                m.load_dataset(p, max_bytes=16)

    def test_shuffled_view_order_binds_by_id_not_array_index(self):
        m = self.module()
        b = self.module("binding")
        ds = m.parse_dataset(m.synthetic_payload())
        frame = b.make_engine_frame(ds, [0.1, 0.5, 0.9])
        view = b.bind_view(ds, frame, tuple(reversed(ds.neuron_ids)))
        self.assertEqual([n.neuron_id for n in view.nodes], list(reversed(ds.neuron_ids)))
        self.assertEqual([n.activation for n in view.nodes], [0.9, 0.5, 0.1])
        self.assertEqual([n.engine_index for n in view.nodes], [2, 1, 0])
        self.assertTrue(b.verify_binding(ds, frame, view))

    def test_view_accepts_same_dataset_in_different_storage_order(self):
        m = self.module()
        b = self.module("binding")
        p = m.synthetic_payload()
        ds = m.parse_dataset(p)
        frame = b.make_engine_frame(ds, [0.1, 0.5, 0.9])
        p["neurons"].reverse()
        reordered = m.parse_dataset(p)
        view = b.bind_view(reordered, frame)
        self.assertEqual([n.activation for n in view.nodes], [0.9, 0.5, 0.1])
        self.assertTrue(b.verify_binding(reordered, frame, view))

    def test_cross_snapshot_frame_is_rejected(self):
        m = self.module()
        b = self.module("binding")
        p = m.synthetic_payload()
        ds = m.parse_dataset(p)
        frame = b.make_engine_frame(ds, [0.1, 0.5, 0.9])
        p["provenance"]["version"] = "other"
        with self.assertRaises(b.BindingMismatch):
            b.bind_view(m.parse_dataset(p), frame)

    def test_unlabelled_array_length_and_bad_activity_are_rejected(self):
        m = self.module()
        b = self.module("binding")
        ds = m.parse_dataset(m.synthetic_payload())
        for values in ([0.1], [True, 0.5, 0.9], [float("nan"), 0.5, 0.9], [-0.1, 0.5, 0.9]):
            with self.subTest(values=values), self.assertRaises(b.BindingMismatch):
                b.make_engine_frame(ds, values)

    def test_unknown_duplicate_or_missing_view_ids_are_rejected(self):
        m = self.module()
        b = self.module("binding")
        ds = m.parse_dataset(m.synthetic_payload())
        frame = b.make_engine_frame(ds, [0.1, 0.5, 0.9])
        for order in (ds.neuron_ids[:2], (ds.neuron_ids[0],) * 3, ("unknown", *ds.neuron_ids[1:])):
            with self.subTest(order=order), self.assertRaises(b.BindingMismatch):
                b.bind_view(ds, frame, order)

    def test_tampered_position_or_activity_is_detected(self):
        m = self.module()
        b = self.module("binding")
        ds = m.parse_dataset(m.synthetic_payload())
        frame = b.make_engine_frame(ds, [0.1, 0.5, 0.9])
        view = b.bind_view(ds, frame)
        for node in (replace(view.nodes[0], position=(999.0, 0.0, 0.0)), replace(view.nodes[0], activation=0.8)):
            with self.subTest(node=node), self.assertRaises(b.BindingMismatch):
                b.verify_binding(ds, frame, replace(view, nodes=(node, *view.nodes[1:])))

    def test_tampered_frame_unknown_id_is_rejected(self):
        m = self.module()
        b = self.module("binding")
        ds = m.parse_dataset(m.synthetic_payload())
        frame = b.make_engine_frame(ds, [0.1, 0.5, 0.9])
        signals = (replace(frame.signals[0], neuron_id="unknown"), *frame.signals[1:])
        with self.assertRaises(b.BindingMismatch):
            b.bind_view(ds, replace(frame, signals=signals))


if __name__ == "__main__":
    unittest.main()
"""Curated real source verification is exact, offline and fail-closed."""
import copy
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest import mock

from flyvj_m0.dataset import load_dataset, parse_dataset, synthetic_payload
from flyvj_m0.provenance import ProvenanceVerificationError, verify_curated_dataset

ROOT = Path(__file__).resolve().parents[1]
REFERENCE = ROOT / "data" / "flywire783-m1"


class CuratedProvenanceTests(unittest.TestCase):
    def payload(self):
        return json.loads((REFERENCE / "sample.json").read_text(encoding="utf-8"))

    def copied_evidence(self, temp):
        target = Path(temp) / "evidence"
        shutil.copytree(REFERENCE, target)
        return target

    def test_real_reference_is_verified_without_network(self):
        with mock.patch("urllib.request.urlopen", side_effect=AssertionError("No network in VerifyData")):
            result = verify_curated_dataset(load_dataset(REFERENCE / "sample.json"))
        self.assertIs(result["verified"], True)
        self.assertEqual(result["scope"], "CURATED_REAL_POINT_GRAPH_SAMPLE")
        self.assertEqual(result["coordinates_units"], "nm")
        self.assertFalse(result["network_access"])
        self.assertFalse(result["full_morphology_verified"])
        self.assertTrue(result["connection_source_is_partial"])
        self.assertFalse(result["connections_full_object_verified"])
        self.assertTrue(result["coordinate_crc32c_verified"])
        self.assertGreaterEqual(result["source_files_verified"], 7)

    def test_unknown_real_cannot_self_certify(self):
        payload = synthetic_payload()
        payload["provenance"]["kind"] = "real"
        with self.assertRaises(ProvenanceVerificationError) as caught:
            verify_curated_dataset(parse_dataset(payload))
        self.assertEqual(caught.exception.error_code, "REAL_PROVENANCE_UNVERIFIED")

    def test_synthetic_cannot_be_curated(self):
        with self.assertRaises(ProvenanceVerificationError):
            verify_curated_dataset(parse_dataset(synthetic_payload()))

    def test_edited_real_point_region_weight_and_metadata_rejected(self):
        modifications = [
            lambda p: p["neurons"][0]["position"].__setitem__(0, 1),
            lambda p: p["neurons"][0].__setitem__("region", "FAKE"),
            lambda p: p["connections"][0].__setitem__("weight", 999),
            lambda p: p["provenance"].__setitem__("version", "other"),
            lambda p: p["coordinates"].__setitem__("units", "um"),
        ]
        for change in modifications:
            with self.subTest(change=change):
                payload = self.payload()
                change(payload)
                with self.assertRaises(ProvenanceVerificationError):
                    verify_curated_dataset(parse_dataset(payload))

    def test_id_keyed_reference_accepts_array_permutation(self):
        payload = self.payload()
        payload["neurons"].reverse()
        payload["connections"].reverse()
        self.assertTrue(verify_curated_dataset(parse_dataset(payload))["verified"])

    def test_missing_evidence_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ProvenanceVerificationError) as caught:
                verify_curated_dataset(parse_dataset(self.payload()), Path(temp) / "missing")
        self.assertEqual(caught.exception.error_code, "SOURCE_EVIDENCE_INVALID")

    def test_tampered_raw_receipt_docs_and_reference_rejected(self):
        targets = ["source/connections.prefix-65536.bin", "source/coordinates.csv.gz",
                   "source/acquisition_receipt.json", "source/codex-formatting.py.txt",
                   "source_proof.json", "sample.json"]
        for rel in targets:
            with self.subTest(rel=rel), tempfile.TemporaryDirectory() as temp:
                evidence = self.copied_evidence(temp)
                selected = evidence / rel
                raw = selected.read_bytes()
                selected.write_bytes(bytes([raw[0] ^ 1]) + raw[1:])
                with self.assertRaises(ProvenanceVerificationError) as caught:
                    verify_curated_dataset(parse_dataset(self.payload()), evidence)
                self.assertEqual(caught.exception.error_code, "SOURCE_EVIDENCE_INVALID")

    def test_forbidden_evidence_root_never_normalized_into_acceptance(self):
        for root in ["file://C:/data/../evidence", "//server/share", "C:/data:stream", 123, b"bytes"]:
            with self.subTest(root=root), self.assertRaises(ProvenanceVerificationError):
                verify_curated_dataset(parse_dataset(self.payload()), root)

    def test_reference_neuron_ids_preserve_large_integer_precision(self):
        data = load_dataset(REFERENCE / "sample.json")
        self.assertEqual(len(data.neuron_ids), 6)
        self.assertTrue(all(isinstance(n, str) and int(n) > 2**53 for n in data.neuron_ids))
        self.assertEqual(sorted(e.weight for e in data.connections), [7.0, 15.0, 32.0])


if __name__ == "__main__":
    unittest.main()
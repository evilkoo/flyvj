"""Offline, fail-closed verification of one independently curated point sample.

Hashes pin a reviewed reference, not arbitrary metadata or a generic biological
certificate. No upstream code is executed and no network operation exists here.
"""
import base64
import copy
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import zlib

from .dataset import (DataValidationError, NeuralDataset, _reject_forbidden_path_syntax,
                      _selected_local_path, parse_dataset)

EXPECTED_FINGERPRINT = "ad9a6aa448921039529ca106d35bee265a53265786c5b3243ef2cb0f1a21e1ae"
EXPECTED_SAMPLE_SHA256 = "eaa50de4476764fe35e9bfb7ea602866f498a88d83b541e8175a73b75bc02cd7"
EXPECTED_PROOF_SHA256 = "c9a72652f6f152ccc38cbbb64418b8774f8fd35112553ae5827cd3e0d41f89c6"
EXPECTED_REVIEW_SHA256 = "0499019b7442cf251ad7149271d841703db3d5542e9ada65564c606e3c188754"
EXPECTED_SOURCE_SHA256 = {
    "acquisition_receipt.json": "b307c4b03c1f3008c9b1f37ab37f2fa553f0f16ccb0b6f9a137f618f44d85601",
    "codex-formatting.py.txt": "bee35f405161d5c6293e34504fb8b202791971c98ed158b7f7cf41b3b1540c57",
    "codex-local_data_loader.py.txt": "bfeeba93def42f2db5221dc40bf7d0cce6efd912ef9c7908b9a0c3ab1e0c059a",
    "codex-neuron_data_initializer.py.txt": "86deb9935643d5aa76accea10cf71ed1afb1b5fc666032dacac3be6505967e1f",
    "connections.prefix-65536.bin": "5432beb18cced0508fe2189d0f33bb2e1d20bd0e0cc7440a9909f906665c1802",
    "coordinates.csv.gz": "14337121f451f98c2576cee72c24409ada5aaf7948b7c7ca8de9040296840e05",
    "source_commit.json": "105ee5879a51311e1dd49ec6c9623dab2d7672998ea82825a70fa7e1cf164748",
}


class ProvenanceVerificationError(ValueError):
    def __init__(self, error_code, message):
        super().__init__(message)
        self.error_code = error_code


def _checked_read(path, expected, maximum):
    selected = _selected_local_path(path)
    with selected.open("rb") as handle:
        data = handle.read(maximum + 1)
    if len(data) > maximum or hashlib.sha256(data).hexdigest() != expected:
        raise ValueError("Source evidence hash/size differs from curated reference")
    return data


def _gunzip(data, maximum, complete):
    stream = zlib.decompressobj(31)
    result = stream.decompress(data, maximum + 1)
    if len(result) > maximum or stream.unconsumed_tail:
        raise ValueError("Source decompression exceeds bound")
    if complete and (not stream.eof or stream.unused_data):
        raise ValueError("Complete coordinate gzip required")
    if not complete and stream.eof:
        raise ValueError("Expected recorded partial connection object")
    return result


def _crc32c(data):
    table = []
    for value in range(256):
        for _ in range(8):
            value = (value >> 1) ^ (0x82F63B78 if value & 1 else 0)
        table.append(value)
    value = 0xffffffff
    for byte in data:
        value = table[(value ^ byte) & 255] ^ (value >> 8)
    return value ^ 0xffffffff


def _source_rows(raw):
    text = _gunzip(raw, 2 * 1024 * 1024, False).rsplit(b"\n", 1)[0].decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames != ["pre_root_id", "post_root_id", "neuropil", "syn_count", "nt_type"]:
        raise ValueError("Unexpected connection source columns")
    rows, pairs = [], set()
    for row in reader:
        pair = (row["pre_root_id"], row["post_root_id"])
        if pair not in pairs and pair[0] != pair[1]:
            rows.append(row)
            pairs.add(pair)
        if len(rows) == 3:
            return rows
    raise ValueError("Expected three recorded complete rows")


def _coordinate_rows(raw, ids):
    text = _gunzip(raw, 64 * 1024 * 1024, True).decode("utf-8")
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames != ["root_id", "position", "supervoxel_id"]:
        raise ValueError("Unexpected coordinate source columns")
    rows = {}
    for row in reader:
        if row["root_id"] in ids and row["root_id"] not in rows:
            rows[row["root_id"]] = row
        if set(rows) == ids:
            break
    if set(rows) != ids:
        raise ValueError("Source points do not cover selected IDs")
    return [rows[nid] for nid in sorted(ids)]


def verify_curated_dataset(dataset, evidence_root=None):
    """Verify one immutable, audited reference; reject all uncurated real graphs."""
    if (type(dataset) is not NeuralDataset or dataset.provenance.kind != "real"
            or dataset.fingerprint != EXPECTED_FINGERPRINT):
        raise ProvenanceVerificationError("REAL_PROVENANCE_UNVERIFIED", "資料唔係已核對嘅固定真實小樣本。")
    try:
        if evidence_root is None:
            evidence_root = Path(__file__).absolute().parents[2] / "data" / "flywire783-m1"
        raw_root = os.fspath(evidence_root)
        if not isinstance(raw_root, str) or not raw_root:
            raise ValueError("Explicit local evidence root required")
        # Reject URI/UNC/ADS before joining/normalization can erase that intent.
        _reject_forbidden_path_syntax(raw_root)
        root = Path(raw_root)
        reference_raw = _checked_read(root / "sample.json", EXPECTED_SAMPLE_SHA256, 2 * 1024 * 1024)
        proof = json.loads(_checked_read(root / "source_proof.json", EXPECTED_PROOF_SHA256, 64 * 1024).decode("utf-8"))
        review = json.loads(_checked_read(root / "source_review.json", EXPECTED_REVIEW_SHA256, 64 * 1024).decode("utf-8"))
        if (proof["source_files"] != EXPECTED_SOURCE_SHA256
                or proof["candidate_dataset_fingerprint"] != EXPECTED_FINGERPRINT
                or review["source_status"] != "PASSED"
                or review["dataset_fingerprint"] != EXPECTED_FINGERPRINT
                or review["overall_scope"] != "CURATED_POINT_GRAPH_ONLY"):
            raise ValueError("Pinned source proof/review differs")
        sources = {name: _checked_read(root / "source" / name, expected,
                   6 * 1024 * 1024 if name == "coordinates.csv.gz" else 256 * 1024)
                   for name, expected in EXPECTED_SOURCE_SHA256.items()}
        receipt = json.loads(sources["acquisition_receipt.json"].decode("utf-8"))
        if len(sources["connections.prefix-65536.bin"]) != 65536:
            raise ValueError("Partial range length differs")
        coordinate_file = next(f for f in receipt["files"] if f["name"] == "coordinates.csv.gz")
        expected_crc = next(v.split("=", 1)[1].strip() for v in coordinate_file["headers"]["x-goog-hash"].split(",") if v.strip().startswith("crc32c="))
        actual_crc = base64.b64encode(_crc32c(sources["coordinates.csv.gz"]).to_bytes(4, "big")).decode("ascii")
        if expected_crc != actual_crc:
            raise ValueError("Recorded coordinate publisher CRC32C mismatch")
        edges = _source_rows(sources["connections.prefix-65536.bin"])
        ids = {e[k] for e in edges for k in ("pre_root_id", "post_root_id")}
        points = _coordinate_rows(sources["coordinates.csv.gz"], ids)
        if edges != receipt["selected_connection_rows"] or points != receipt["selected_coordinate_rows"]:
            raise ValueError("Source selection cannot be reproduced")
        regions = {}
        for edge in edges:
            for key in ("pre_root_id", "post_root_id"):
                regions.setdefault(edge[key], set()).add(edge["neuropil"])
        rebuilt = copy.deepcopy(json.loads(reference_raw.decode("utf-8")))
        rebuilt["neurons"] = []
        for point in points:
            if not re.fullmatch(r"\[\s*-?\d+\s+-?\d+\s+-?\d+\s*\]", point["position"]):
                raise ValueError("Unsupported source point notation")
            rebuilt["neurons"].append({"id": point["root_id"],
                "position": [int(v) for v in point["position"].strip("[]").split()],
                "region": "/".join(sorted(regions[point["root_id"]]))})
        rebuilt["connections"] = [{"pre_id": e["pre_root_id"], "post_id": e["post_root_id"],
                                   "weight": int(e["syn_count"])} for e in edges]
        if parse_dataset(rebuilt).fingerprint != dataset.fingerprint:
            raise ValueError("Raw source graph differs from requested dataset")
        return {"verified": True, "evidence_id": "FLYWIRE783_M1_POINT_SAMPLE_V1",
                "scope": "CURATED_REAL_POINT_GRAPH_SAMPLE", "source_files_verified": 10,
                "coordinates_units": "nm", "coordinate_frame": dataset.coordinates.frame,
                "region_semantics": proof["region_semantics"], "weight_semantics": proof["weight_semantics"],
                "network_access": False, "full_morphology_verified": False,
                "connection_source_is_partial": True, "connections_full_object_verified": False,
                "coordinate_crc32c_verified": True, "independent_source_qc": "PASSED",
                "reference_sample_sha256": EXPECTED_SAMPLE_SHA256,
                "source_proof_sha256": EXPECTED_PROOF_SHA256, "source_review_sha256": EXPECTED_REVIEW_SHA256}
    except (OSError, UnicodeError, ValueError, TypeError, KeyError, StopIteration, RecursionError, zlib.error) as exc:
        raise ProvenanceVerificationError("SOURCE_EVIDENCE_INVALID", "固定來源證據缺失、被改過或無法安全重現。") from exc
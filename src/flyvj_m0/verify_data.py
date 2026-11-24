"""M1 offline curated point-graph integration with a fail-closed gate."""
import json
from pathlib import Path

from .binding import bind_view, make_engine_frame, verify_binding
from .dataset import DataValidationError, load_dataset, parse_dataset, synthetic_payload


def binding_demo_result():
    dataset = parse_dataset(synthetic_payload())
    frame = make_engine_frame(dataset, [0.1, 0.5, 0.9])
    view = bind_view(dataset, frame, tuple(reversed(dataset.neuron_ids)))
    verify_binding(dataset, frame, view)
    return {"schema_version": 1, "status": "PASSED", "source_kind": "synthetic",
            "dataset_name": dataset.provenance.name, "dataset_version": dataset.provenance.version,
            "dataset_fingerprint": dataset.fingerprint, "units": dataset.coordinates.units,
            "coordinate_frame": dataset.coordinates.frame, "neuron_count": len(dataset.neurons),
            "connection_count": len(dataset.connections), "provenance_verified": False,
            "rendering_status": "NOT_IMPLEMENTED", "real_osc_packets_sent": 0, "keyboard_events_sent": 0,
            "rows": [{"neuron_id": n.neuron_id, "engine_index": n.engine_index, "view_index": n.view_index,
                      "position": list(n.position), "activation": n.activation, "matched": True} for n in view.nodes]}


def validate_binding_result(payload):
    try:
        actual = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
        expected = json.dumps(binding_demo_result(), sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid binding artifact") from exc
    if actual != expected:
        raise ValueError("Binding artifact does not match the declared deterministic synthetic fixture")


def inspect_real_data(path):
    result = {"schema_version": 1, "scope": "REAL_DATA_GATE", "status": "BLOCKED",
              "provided": path is not None, "provenance_verified": False, "structure_status": "NOT_RUN"}
    if path is None:
        result.update(error_code="REAL_DATA_NOT_PROVIDED", message="未提供真實神經資料；接口測試唔等於真資料驗收。")
        return result
    try:
        dataset = load_dataset(path)
    except DataValidationError:
        result.update(error_code="INVALID_DATASET", message="指定資料未通過本機 strict JSON 接口；唔 fallback。")
        return result
    result.update(structure_status="PASSED", declared_kind=dataset.provenance.kind,
                  file_name=Path(path).name, neuron_count=len(dataset.neurons), connection_count=len(dataset.connections),
                  dataset_fingerprint=dataset.fingerprint)
    if dataset.provenance.kind == "synthetic":
        result.update(error_code="SYNTHETIC_IS_NOT_REAL", message="提供嘅係 synthetic 資料，唔可以當真實神經驗收。")
        return result
    from .provenance import ProvenanceVerificationError, verify_curated_dataset
    try:
        evidence = verify_curated_dataset(dataset)
    except ProvenanceVerificationError as exc:
        result.update(error_code=exc.error_code, message=str(exc))
        return result
    frame = make_engine_frame(dataset, [(index + 1) / (len(dataset.neurons) + 1)
                                        for index in range(len(dataset.neurons))])
    view = bind_view(dataset, frame, tuple(reversed(dataset.neuron_ids)))
    verify_binding(dataset, frame, view)
    result.update(status="PASSED", provenance_verified=True, source_kind="real",
                  source_scope=evidence["scope"], evidence=evidence,
                  dataset_name=dataset.provenance.name, dataset_version=dataset.provenance.version,
                  units=dataset.coordinates.units, coordinate_frame=dataset.coordinates.frame,
                  activity_kind="synthetic_mock_not_biological_firing",
                  full_morphology_verified=False, rendering_status="NOT_IMPLEMENTED",
                  real_osc_packets_sent=0, keyboard_events_sent=0, network_access=False,
                  message="接口同已核對真實 point graph sample 通過；activity 係 mock，唔係生物 firing；full morphology 未完成。",
                  rows=[{"neuron_id": n.neuron_id, "engine_index": n.engine_index,
                         "view_index": n.view_index, "position": list(n.position),
                         "activation": n.activation, "matched": True} for n in view.nodes])
    return result


def validate_real_gate_result(payload, dataset_path=None):
    if not isinstance(payload, dict) or payload.get("scope") != "REAL_DATA_GATE":
        raise ValueError("Invalid real-data gate artifact")
    if payload.get("status") == "PASSED":
        if dataset_path is None:
            raise ValueError("A PASS requires the actual dataset path and offline evidence")
    elif payload.get("status") == "BLOCKED":
        if payload.get("provenance_verified") is not False:
            raise ValueError("Blocked artifact cannot claim verified provenance")
        if payload.get("error_code") not in {"REAL_DATA_NOT_PROVIDED", "SYNTHETIC_IS_NOT_REAL",
                                             "REAL_PROVENANCE_UNVERIFIED", "INVALID_DATASET",
                                             "SOURCE_EVIDENCE_INVALID"}:
            raise ValueError("Unknown real-data blocker")
    else:
        raise ValueError("Unknown real-data status")
    try:
        actual = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
        expected = json.dumps(inspect_real_data(dataset_path), sort_keys=True,
                              separators=(",", ":"), allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid real-data artifact") from exc
    if actual != expected:
        raise ValueError("Real-data artifact does not match independently recomputed dataset/evidence")

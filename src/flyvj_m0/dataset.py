"""M1 local, strict JSON graph. No downloads, pickle, or biological simulation."""
from dataclasses import asdict, dataclass, field
import hashlib
import ctypes
from ctypes import wintypes
import json
import math
import os
import ntpath
import stat
from pathlib import Path, PureWindowsPath
import re
from types import MappingProxyType

MAX_JSON_BYTES = 2 * 1024 * 1024


class DataValidationError(ValueError):
    pass


def _keys(value, required, label):
    if not isinstance(value, dict) or set(value) != set(required):
        raise DataValidationError(f"{label}: required fields do not match schema")


def _string(value, label, maximum=256):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise DataValidationError(f"{label}: non-empty bounded string required")
    try:
        value.encode("utf-8", errors="strict")
    except UnicodeError as exc:
        raise DataValidationError(f"{label}: unpaired Unicode surrogate is forbidden") from exc
    if any(ord(c) < 32 for c in value):
        raise DataValidationError(f"{label}: control characters are not allowed")
    return value


def _id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}", value):
        raise DataValidationError("neuron ID must be an exact ASCII string, not a number")
    return value


def _number(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise DataValidationError(f"{label}: finite number, not boolean, required")
    try:
        result = float(value)
    except (OverflowError, ValueError) as exc:
        raise DataValidationError(f"{label}: number is out of range") from exc
    if not math.isfinite(result):
        raise DataValidationError(f"{label}: finite number required")
    return result


def validated_position(value):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise DataValidationError("position requires exactly three numbers")
    return tuple(_number(v, "position") for v in value)

@dataclass(frozen=True)
class Provenance:
    kind: str
    name: str
    version: str
    source: str
    license: str

    def __post_init__(self):
        for name in ("kind", "name", "version", "source", "license"):
            _string(getattr(self, name), name, 1024 if name == "source" else 256)
        if self.kind not in ("synthetic", "real"):
            raise DataValidationError("Unknown provenance kind")


@dataclass(frozen=True)
class Coordinates:
    units: str
    frame: str

    def __post_init__(self):
        _string(self.units, "units", 64)
        _string(self.frame, "frame")


@dataclass(frozen=True)
class Neuron:
    neuron_id: str
    position: tuple[float, float, float]
    region: str

    def __post_init__(self):
        _id(self.neuron_id)
        _string(self.region, "region", 64)
        object.__setattr__(self, "position", validated_position(self.position))


@dataclass(frozen=True)
class Connection:
    pre_id: str
    post_id: str
    weight: float

    def __post_init__(self):
        _id(self.pre_id)
        _id(self.post_id)
        object.__setattr__(self, "weight", _number(self.weight, "weight"))


@dataclass(frozen=True)
class NeuralDataset:
    provenance: Provenance
    coordinates: Coordinates
    neurons: tuple[Neuron, ...]
    connections: tuple[Connection, ...]
    _by_id: object = field(init=False, repr=False, compare=False)
    _fingerprint: str = field(init=False, repr=False)

    def __post_init__(self):
        if type(self.provenance) is not Provenance or type(self.coordinates) is not Coordinates:
            raise DataValidationError("Typed immutable provenance/coordinates required")
        try:
            nodes, edges = tuple(self.neurons), tuple(self.connections)
        except TypeError as exc:
            raise DataValidationError("Dataset collections must be iterable") from exc
        if not 0 < len(nodes) <= 10000 or len(edges) > 50000:
            raise DataValidationError("Dataset is empty or exceeds the sample limit")
        if not all(type(n) is Neuron for n in nodes) or not all(type(e) is Connection for e in edges):
            raise DataValidationError("Typed immutable neurons/connections required")
        ids = {n.neuron_id for n in nodes}
        if len(ids) != len(nodes):
            raise DataValidationError("Duplicate neuron ID")
        pairs = set()
        for edge in edges:
            if edge.pre_id not in ids or edge.post_id not in ids or (edge.pre_id, edge.post_id) in pairs:
                raise DataValidationError("Unknown endpoint or duplicate weighted edge")
            pairs.add((edge.pre_id, edge.post_id))
        object.__setattr__(self, "neurons", nodes)
        object.__setattr__(self, "connections", edges)
        object.__setattr__(self, "_by_id", MappingProxyType({n.neuron_id: n for n in self.neurons}))
        canonical = self.to_payload()
        canonical["neurons"].sort(key=lambda n: n["id"])
        canonical["connections"].sort(key=lambda e: (e["pre_id"], e["post_id"]))
        text = json.dumps(canonical, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        object.__setattr__(self, "_fingerprint", hashlib.sha256(text.encode("utf-8")).hexdigest())

    @property
    def neuron_ids(self):
        return tuple(n.neuron_id for n in self.neurons)

    @property
    def neuron_by_id(self):
        return self._by_id

    @property
    def fingerprint(self):
        return self._fingerprint

    @property
    def region_counts(self):
        result = {}
        for neuron in self.neurons:
            result[neuron.region] = result.get(neuron.region, 0) + 1
        return MappingProxyType(result)

    def to_payload(self):
        return {"schema_version": 1, "provenance": asdict(self.provenance), "coordinates": asdict(self.coordinates),
                "neurons": [{"id": n.neuron_id, "position": list(n.position), "region": n.region} for n in self.neurons],
                "connections": [asdict(e) for e in self.connections]}


def parse_dataset(payload):
    _keys(payload, ("schema_version", "provenance", "coordinates", "neurons", "connections"), "dataset")
    if type(payload["schema_version"]) is not int or payload["schema_version"] != 1:
        raise DataValidationError("Unsupported schema_version")
    p = payload["provenance"]
    _keys(p, ("kind", "name", "version", "source", "license"), "provenance")
    values = {key: _string(p[key], key, 1024 if key == "source" else 256) for key in p}
    if values["kind"] not in ("synthetic", "real"):
        raise DataValidationError("kind must be synthetic or real; no guessing")
    provenance = Provenance(**values)
    coordinates = payload["coordinates"]
    _keys(coordinates, ("units", "frame"), "coordinates")
    coords = Coordinates(_string(coordinates["units"], "units", 64), _string(coordinates["frame"], "frame"))
    raw_nodes = payload["neurons"]
    if not isinstance(raw_nodes, list) or not 0 < len(raw_nodes) <= 10000:
        raise DataValidationError("A bounded non-empty neuron list is required")
    neurons, ids = [], set()
    for raw in raw_nodes:
        _keys(raw, ("id", "position", "region"), "neuron")
        nid = _id(raw["id"])
        if nid in ids:
            raise DataValidationError("Duplicate neuron ID")
        ids.add(nid)
        position = raw["position"]
        if not isinstance(position, list) or len(position) != 3:
            raise DataValidationError("position requires exactly three numbers")
        xyz = tuple(_number(v, "position") for v in position)
        neurons.append(Neuron(nid, xyz, _string(raw["region"], "region", 64)))
    raw_edges = payload["connections"]
    if not isinstance(raw_edges, list) or len(raw_edges) > 50000:
        raise DataValidationError("A bounded connection list is required")
    edges, pairs = [], set()
    for raw in raw_edges:
        _keys(raw, ("pre_id", "post_id", "weight"), "connection")
        pre, post = _id(raw["pre_id"]), _id(raw["post_id"])
        if pre not in ids or post not in ids:
            raise DataValidationError("Connection endpoint has no corresponding neuron")
        if (pre, post) in pairs:
            raise DataValidationError("Duplicate weighted connection; aggregate explicitly before import")
        pairs.add((pre, post))
        edges.append(Connection(pre, post, _number(raw["weight"], "weight")))
    return NeuralDataset(provenance, coords, tuple(neurons), tuple(edges))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise DataValidationError("Duplicate JSON key")
        result[key] = value
    return result


def _reject_constant(value):
    raise DataValidationError("Non-finite JSON constant is forbidden")


def _drive_type(root):
    if os.name != "nt":
        raise DataValidationError("This local-only loader requires Windows")
    api = ctypes.WinDLL("kernel32", use_last_error=True).GetDriveTypeW
    api.argtypes, api.restype = [wintypes.LPCWSTR], wintypes.UINT
    return api(root)


def _reject_forbidden_path_syntax(value):
    portable = value.replace("\\", "/")
    pure = PureWindowsPath(value)
    if portable.startswith("//") or pure.drive.startswith("\\\\"):
        raise DataValidationError("UNC/device paths are forbidden")
    if "://" in portable or (pure.drive and not pure.root) or ":" in value[len(pure.drive):]:
        raise DataValidationError("URI, alternate-stream and drive-relative paths are forbidden")

def _selected_local_path(path):
    try:
        raw = os.fspath(path)
    except TypeError as exc:
        raise DataValidationError("An explicit local file path is required") from exc
    if not isinstance(raw, str) or not raw:
        raise DataValidationError("An explicit local file path is required")
    # Reject forbidden intent BEFORE normalization can erase URI/ADS components.
    _reject_forbidden_path_syntax(raw)
    normalized = ntpath.normpath(raw)
    _reject_forbidden_path_syntax(normalized)
    absolute = Path(ntpath.abspath(normalized))
    if _drive_type(absolute.anchor) not in (2, 3, 5, 6):
        raise DataValidationError("Network/unknown drives are forbidden")
    # Root-first metadata checks reject reparse/junction/cloud paths before following them.
    ancestry = list(reversed(absolute.parents)) + [absolute]
    for candidate in ancestry:
        info = os.lstat(candidate)
        if getattr(info, "st_file_attributes", 0) & 0x400:
            raise DataValidationError("Reparse/symlink/junction paths are forbidden")
    if not stat.S_ISREG(info.st_mode):
        raise DataValidationError("Only an ordinary local file is supported")
    return absolute


def load_dataset(path, max_bytes=MAX_JSON_BYTES):
    if type(max_bytes) is not int or not 0 < max_bytes <= MAX_JSON_BYTES:
        raise DataValidationError("Invalid JSON byte limit")
    try:
        selected = _selected_local_path(path)
        with selected.open("rb") as handle:
            content = handle.read(max_bytes + 1)
        if len(content) > max_bytes:
            raise DataValidationError("JSON sample exceeds the byte limit")
        payload = json.loads(content.decode("utf-8-sig"), object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        return parse_dataset(payload)
    except DataValidationError:
        raise
    except (OSError, UnicodeError, ValueError, RecursionError) as exc:
        raise DataValidationError("Selected local file could not be read as bounded strict UTF-8 JSON") from exc

def synthetic_payload():
    ids = ("9007199254740993", "9007199254740995", "9007199254740997")
    return {"schema_version": 1,
            "provenance": {"kind": "synthetic", "name": "M1 synthetic ID fixture", "version": "m1-fixture-v1",
                           "source": "locally-generated-test-only", "license": "synthetic-test-fixture"},
            "coordinates": {"units": "micrometer", "frame": "synthetic-test-frame"},
            "neurons": [{"id": ids[0], "position": [0, 0, 0], "region": "mock-input"},
                        {"id": ids[1], "position": [1, 0.5, 0], "region": "mock-relay"},
                        {"id": ids[2], "position": [-1, 1, 0], "region": "mock-output"}],
            "connections": [{"pre_id": ids[0], "post_id": ids[1], "weight": 0.5},
                            {"pre_id": ids[1], "post_id": ids[2], "weight": -0.25}]}
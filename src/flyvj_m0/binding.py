"""ID-keyed state-to-view packet bridge. This does not render a 3D brain."""
from dataclasses import dataclass
import math

from .dataset import Coordinates, NeuralDataset, DataValidationError, validated_position


class BindingMismatch(ValueError):
    pass


def _activity(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BindingMismatch("Normalized activity must be numeric, not boolean")
    try:
        number = float(value)
    except (ValueError, OverflowError) as exc:
        raise BindingMismatch("Activity is out of range") from exc
    if not math.isfinite(number) or not 0 <= number <= 1:
        raise BindingMismatch("Normalized activity must be finite between zero and one")
    return number


@dataclass(frozen=True)
class NeuronSignal:
    neuron_id: str
    activation: float


@dataclass(frozen=True)
class EngineFrame:
    dataset_fingerprint: str
    signals: tuple[NeuronSignal, ...]


@dataclass(frozen=True)
class ViewNode:
    neuron_id: str
    position: tuple[float, float, float]
    activation: float
    engine_index: int
    view_index: int


@dataclass(frozen=True)
class ViewState:
    dataset_fingerprint: str
    coordinates: Coordinates
    nodes: tuple[ViewNode, ...]


def make_engine_frame(dataset: NeuralDataset, values):
    values = tuple(values)
    if len(values) != len(dataset.neurons):
        raise BindingMismatch("Engine array length has no complete dataset ID mapping")
    signals = tuple(NeuronSignal(n.neuron_id, _activity(value)) for n, value in zip(dataset.neurons, values))
    return EngineFrame(dataset.fingerprint, signals)


def _signal_map(dataset, frame):
    if not isinstance(frame, EngineFrame) or frame.dataset_fingerprint != dataset.fingerprint:
        raise BindingMismatch("Engine frame is from a different dataset/snapshot")
    if not isinstance(frame.signals, tuple) or len(frame.signals) != len(dataset.neurons):
        raise BindingMismatch("Incomplete engine frame")
    result = {}
    for index, signal in enumerate(frame.signals):
        if not isinstance(signal, NeuronSignal) or not isinstance(signal.neuron_id, str):
            raise BindingMismatch("Signal must carry an exact neuron ID")
        if signal.neuron_id not in dataset.neuron_by_id or signal.neuron_id in result:
            raise BindingMismatch("Unknown or duplicate signal ID")
        result[signal.neuron_id] = (index, _activity(signal.activation))
    return result


def bind_view(dataset, frame, render_order=None):
    signals = _signal_map(dataset, frame)
    order = dataset.neuron_ids if render_order is None else tuple(render_order)
    if not all(isinstance(nid, str) for nid in order) or len(order) != len(dataset.neurons) or set(order) != set(dataset.neuron_ids):
        raise BindingMismatch("View order must contain every dataset ID exactly once")
    nodes = tuple(ViewNode(nid, dataset.neuron_by_id[nid].position, signals[nid][1], signals[nid][0], index)
                  for index, nid in enumerate(order))
    view = ViewState(dataset.fingerprint, dataset.coordinates, nodes)
    verify_binding(dataset, frame, view)
    return view


def verify_binding(dataset, frame, view):
    signals = _signal_map(dataset, frame)
    if not isinstance(view, ViewState) or view.dataset_fingerprint != dataset.fingerprint or view.coordinates != dataset.coordinates:
        raise BindingMismatch("View metadata does not match the dataset")
    if not isinstance(view.nodes, tuple) or len(view.nodes) != len(dataset.neurons):
        raise BindingMismatch("Incomplete view packet")
    seen = set()
    for index, node in enumerate(view.nodes):
        if not isinstance(node, ViewNode) or not isinstance(node.neuron_id, str) or node.neuron_id not in signals or node.neuron_id in seen:
            raise BindingMismatch("Unknown/duplicate view ID")
        seen.add(node.neuron_id)
        expected_index, activation = signals[node.neuron_id]
        if not isinstance(node.position, tuple):
            raise BindingMismatch("View geometry must be immutable")
        try:
            position = validated_position(node.position)
        except DataValidationError as exc:
            raise BindingMismatch("View geometry is not a finite numeric coordinate") from exc
        if position != dataset.neuron_by_id[node.neuron_id].position or _activity(node.activation) != activation:
            raise BindingMismatch("Geometry/activity is mapped to the wrong neuron ID")
        if type(node.engine_index) is not int or node.engine_index != expected_index or type(node.view_index) is not int or node.view_index != index:
            raise BindingMismatch("Diagnostic indices are inconsistent")
    return True
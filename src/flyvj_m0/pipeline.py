"""Deterministic mock feature -> proposal -> in-memory OSC intent pipeline.

There is deliberately no socket, hardware input, real audio, or neural loader.
OSC-looking addresses are draft previews, not verified Resolume commands.
"""
from dataclasses import asdict, dataclass
import math
from typing import Iterable


class SafetyViolation(ValueError):
    """A proposal is outside the explicit M0 allowlist."""


def validate_allowlist(columns):
    values = tuple(columns)
    if not values or any(type(c) is not int or c < 1 for c in values):
        raise ValueError("Column allowlist must contain positive integers")
    if len(set(values)) != len(values):
        raise ValueError("Duplicate columns are not allowed")
    return values


@dataclass(frozen=True)
class MockEvent:
    event_id: str
    sequence: int
    timestamp_ms: int
    energy: float

    def validate(self):
        if not isinstance(self.event_id, str) or not self.event_id.strip():
            raise ValueError("event_id must be a non-empty string")
        if type(self.sequence) is not int or self.sequence < 0:
            raise ValueError("sequence must be a non-negative integer")
        if type(self.timestamp_ms) is not int or self.timestamp_ms < 0:
            raise ValueError("timestamp_ms must be a non-negative integer")
        if isinstance(self.energy, bool) or not isinstance(self.energy, (int, float)):
            raise ValueError("energy must be numeric, not boolean")
        if not math.isfinite(self.energy) or not 0 <= self.energy <= 1:
            raise ValueError("energy must be finite and between zero and one")


class OscSpy:
    """Record only. This class has no network implementation or live mode."""
    def __init__(self, allowed_columns=(1, 2, 3)):
        self.allowed_columns = validate_allowlist(allowed_columns)
        self.intents = []

    def record(self, column, event_id):
        if type(column) is not int or column not in self.allowed_columns:
            raise SafetyViolation("Requested column is not approved")
        self.intents.append({
            "event_id": event_id,
            "column": column,
            "address_preview": f"/composition/columns/{column}/connect",
            "args_preview": [1],
            "delivery_status": "RECORDED_ONLY",
            "resolume_confirmed": False,
        })


def default_events():
    return [MockEvent("mock-001", 0, 0, 0.20),
            MockEvent("mock-002", 1, 1000, 0.55),
            MockEvent("mock-003", 2, 2000, 0.90),
            MockEvent("mock-004", 3, 3000, 0.20)]


def run_mock_pipeline(events: Iterable[MockEvent], allowed_columns=(1, 2, 3)):
    allowed = validate_allowlist(allowed_columns)
    inputs = list(events)
    seen = set()
    previous_sequence = -1
    previous_timestamp = -1
    decisions = []
    for event in inputs:
        if not isinstance(event, MockEvent):
            raise ValueError("Only MockEvent objects are accepted")
        event.validate()
        if event.event_id in seen:
            raise ValueError("Duplicate event_id")
        if event.sequence <= previous_sequence or event.timestamp_ms < previous_timestamp:
            raise ValueError("Events must be ordered")
        seen.add(event.event_id)
        previous_sequence, previous_timestamp = event.sequence, event.timestamp_ms
        if event.energy < 0.4:
            column, reason = 1, "Mock 能量低：候選 Column 1"
        elif event.energy < 0.75:
            column, reason = 2, "Mock 能量中：候選 Column 2"
        else:
            column, reason = 3, "Mock 能量高：候選 Column 3"
        if column not in allowed:
            raise SafetyViolation(f"Column {column} is not approved; no fallback")
        decisions.append({"event_id": event.event_id, "column": column, "reason": reason})

    # Validate the complete batch before recording any intent.
    spy = OscSpy(allowed)
    for decision in decisions:
        spy.record(decision["column"], decision["event_id"])
    return {
        "schema_version": 1,
        "source": "synthetic_fixture",
        "transport": "in_memory",
        "neural_data_status": "NOT_LOADED",
        "live_audio_analyzed": False,
        "real_osc_packets_sent": 0,
        "keyboard_events_sent": 0,
        "allowed_columns": list(allowed),
        "events": [asdict(event) for event in inputs],
        "decisions": decisions,
        "osc_intents": spy.intents,
    }
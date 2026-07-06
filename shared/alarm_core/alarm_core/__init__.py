"""alarm_core — the single alarm evaluation library for the Gito platform.

Pure Python, no I/O, no ORM. Consumed by both the API service and the ingest
processor so alarm behavior can never diverge by ingest path.
See docs/superpowers/plans/2026-07-06-alarm-engine-unification.md
"""

from .engine import Firing, Rule, evaluate

__all__ = ["Rule", "Firing", "evaluate"]

"""Alarm rule evaluation — THRESHOLD and COMPOSITE, cooldown-aware.

Semantics contract (preserved from the previously-live processor evaluator):
- Word operators are canonical (gt/gte/lt/lte/eq/neq); symbol forms are aliases.
- Cooldown: suppressed while now < last_fired_at + cooldown_minutes (boundary fires).
- A rule that cannot be evaluated (unknown operator/logic, bad data) never fires
  and never blocks other rules.
Improvements over the old evaluator (documented in the design doc):
- Numeric strings coerce; non-numeric values skip instead of raising.
- COMPOSITE conditions (AND/OR + weights) are evaluated at ingest.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable, Optional

_OPERATORS: dict[str, Callable[[float, float], bool]] = {
    "gt":  lambda v, t: v > t,
    "gte": lambda v, t: v >= t,
    "lt":  lambda v, t: v < t,
    "lte": lambda v, t: v <= t,
    "eq":  lambda v, t: v == t,
    "neq": lambda v, t: v != t,
}

_SYMBOL_ALIASES = {">": "gt", ">=": "gte", "<": "lt", "<=": "lte", "==": "eq", "!=": "neq"}


@dataclass
class Rule:
    id: str
    rule_type: str = "THRESHOLD"          # THRESHOLD | COMPOSITE
    metric: Optional[str] = None          # THRESHOLD
    operator: Optional[str] = None        # THRESHOLD
    threshold: Optional[float] = None     # THRESHOLD
    conditions: Optional[list[dict]] = None  # COMPOSITE: [{field, operator, threshold, weight}]
    logic: Optional[str] = None           # COMPOSITE: AND | OR
    severity: str = "MAJOR"
    cooldown_minutes: int = 0
    last_fired_at: Optional[datetime] = None


@dataclass
class Firing:
    rule_id: str
    rule_type: str
    severity: str
    message: str
    metric: Optional[str] = None
    value: Optional[float] = None
    threshold: Optional[float] = None
    operator: Optional[str] = None
    score: Optional[int] = None
    details: dict = field(default_factory=dict)


def _coerce(value: Any) -> Optional[float]:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _condition_met(payload: dict, fld: Optional[str], op: Optional[str], thr: Any) -> bool:
    fn = _OPERATORS.get(_SYMBOL_ALIASES.get(op, op))
    value = _coerce(payload.get(fld)) if fld else None
    threshold = _coerce(thr)
    if fn is None or value is None or threshold is None:
        return False
    return fn(value, threshold)


def _in_cooldown(rule: Rule, now: datetime) -> bool:
    return (
        rule.last_fired_at is not None
        and now < rule.last_fired_at + timedelta(minutes=rule.cooldown_minutes)
    )


def _evaluate_threshold(rule: Rule, payload: dict) -> Optional[Firing]:
    if rule.metric not in payload:
        return None
    if not _condition_met(payload, rule.metric, rule.operator, rule.threshold):
        return None
    value = _coerce(payload[rule.metric])
    return Firing(
        rule_id=rule.id,
        rule_type="THRESHOLD",
        severity=rule.severity,
        message=f"{rule.metric} {rule.operator} {rule.threshold} (current: {value})",
        metric=rule.metric,
        value=value,
        threshold=rule.threshold,
        operator=rule.operator,
    )


def _evaluate_composite(rule: Rule, payload: dict) -> Optional[Firing]:
    conditions = rule.conditions or []
    if not conditions or rule.logic not in ("AND", "OR"):
        return None

    met_flags, score, total_weight = [], 0, 0
    for cond in conditions:
        weight = cond.get("weight", 1)
        met = _condition_met(payload, cond.get("field"), cond.get("operator"), cond.get("threshold"))
        met_flags.append(met)
        total_weight += weight
        if met:
            score += weight

    triggered = all(met_flags) if rule.logic == "AND" else any(met_flags)
    if not triggered:
        return None

    score_percent = int(score / total_weight * 100) if total_weight else 0
    met_count = sum(met_flags)
    return Firing(
        rule_id=rule.id,
        rule_type="COMPOSITE",
        severity=rule.severity,
        message=f"{met_count}/{len(conditions)} conditions met ({rule.logic}, score {score_percent}%)",
        score=score_percent,
        details={
            "logic": rule.logic,
            "conditions_met": met_count,
            "conditions_total": len(conditions),
            "weighted_score": f"{score}/{total_weight}",
        },
    )


def evaluate(rules: list[Rule], payload: dict, now: datetime) -> list[Firing]:
    """Evaluate rules against one telemetry payload. Pure: no I/O, no clock reads."""
    firings: list[Firing] = []
    for rule in rules:
        try:
            if _in_cooldown(rule, now):
                continue
            if rule.rule_type == "COMPOSITE":
                firing = _evaluate_composite(rule, payload)
            else:
                firing = _evaluate_threshold(rule, payload)
            if firing is not None:
                firings.append(firing)
        except Exception:  # a malformed rule must never block the others
            continue
    return firings

"""alarm_core.evaluate() — behavior spec.

Semantics preserved from the live processor evaluator (word operators, cooldown
via last_fired_at) and the composite/weighted logic from the API engine.
Every ingest path shares this one evaluator — see
docs/superpowers/plans/2026-07-06-alarm-engine-unification.md
"""

from datetime import datetime, timedelta

import pytest

from alarm_core import Rule, evaluate

NOW = datetime(2026, 7, 6, 12, 0, 0)


def threshold_rule(**overrides) -> Rule:
    base = dict(
        id="r1",
        rule_type="THRESHOLD",
        metric="temperature",
        operator="gt",
        threshold=30.0,
        severity="MAJOR",
        cooldown_minutes=5,
        last_fired_at=None,
    )
    base.update(overrides)
    return Rule(**base)


def composite_rule(conditions, logic="AND", **overrides) -> Rule:
    base = dict(
        id="c1",
        rule_type="COMPOSITE",
        conditions=conditions,
        logic=logic,
        severity="CRITICAL",
        cooldown_minutes=5,
        last_fired_at=None,
    )
    base.update(overrides)
    return Rule(**base)


# ── Threshold operators ──────────────────────────────────────────────────────

@pytest.mark.parametrize("op,value,fires", [
    ("gt", 31.0, True), ("gt", 30.0, False),
    ("gte", 30.0, True), ("gte", 29.9, False),
    ("lt", 29.0, True), ("lt", 30.0, False),
    ("lte", 30.0, True), ("lte", 30.1, False),
    ("eq", 30.0, True), ("eq", 29.0, False),
    ("neq", 29.0, True), ("neq", 30.0, False),
])
def test_threshold_operators(op, value, fires):
    firings = evaluate([threshold_rule(operator=op)], {"temperature": value}, NOW)
    assert (len(firings) == 1) == fires


@pytest.mark.parametrize("symbol,word,firing_value", [
    (">", "gt", 31.0), (">=", "gte", 30.0), ("<", "lt", 29.0),
    ("<=", "lte", 30.0), ("==", "eq", 30.0), ("!=", "neq", 29.0),
])
def test_symbol_operators_are_aliases(symbol, word, firing_value):
    sym = evaluate([threshold_rule(operator=symbol)], {"temperature": firing_value}, NOW)
    wrd = evaluate([threshold_rule(operator=word)], {"temperature": firing_value}, NOW)
    assert len(sym) == len(wrd) == 1


def test_unknown_operator_never_fires():
    assert evaluate([threshold_rule(operator="between")], {"temperature": 99.0}, NOW) == []


# ── Payload handling ─────────────────────────────────────────────────────────

def test_metric_absent_from_payload_skips_rule():
    assert evaluate([threshold_rule()], {"humidity": 99.0}, NOW) == []


def test_metric_none_skips_rule():
    assert evaluate([threshold_rule()], {"temperature": None}, NOW) == []


def test_numeric_string_value_is_coerced():
    firings = evaluate([threshold_rule()], {"temperature": "31.5"}, NOW)
    assert len(firings) == 1
    assert firings[0].value == 31.5


def test_non_numeric_string_value_skips_rule_instead_of_raising():
    assert evaluate([threshold_rule()], {"temperature": "ON"}, NOW) == []


# ── Cooldown ─────────────────────────────────────────────────────────────────

def test_within_cooldown_is_suppressed():
    rule = threshold_rule(last_fired_at=NOW - timedelta(minutes=4), cooldown_minutes=5)
    assert evaluate([rule], {"temperature": 31.0}, NOW) == []


def test_at_cooldown_boundary_fires():
    rule = threshold_rule(last_fired_at=NOW - timedelta(minutes=5), cooldown_minutes=5)
    assert len(evaluate([rule], {"temperature": 31.0}, NOW)) == 1


def test_never_fired_before_fires():
    assert len(evaluate([threshold_rule(last_fired_at=None)], {"temperature": 31.0}, NOW)) == 1


def test_cooldown_applies_to_composite_rules_too():
    rule = composite_rule(
        [{"field": "temperature", "operator": "gt", "threshold": 30.0}],
        last_fired_at=NOW - timedelta(minutes=1),
    )
    assert evaluate([rule], {"temperature": 31.0}, NOW) == []


# ── Composite rules ──────────────────────────────────────────────────────────

TWO_CONDITIONS = [
    {"field": "vibration", "operator": "gt", "threshold": 5.0, "weight": 3},
    {"field": "temperature", "operator": "gt", "threshold": 60.0, "weight": 1},
]


def test_composite_and_fires_when_all_met():
    firings = evaluate([composite_rule(TWO_CONDITIONS, "AND")],
                       {"vibration": 6.0, "temperature": 61.0}, NOW)
    assert len(firings) == 1
    assert firings[0].score == 100


def test_composite_and_does_not_fire_on_partial_match():
    assert evaluate([composite_rule(TWO_CONDITIONS, "AND")],
                    {"vibration": 6.0, "temperature": 20.0}, NOW) == []


def test_composite_or_fires_on_any_match_with_weighted_score():
    firings = evaluate([composite_rule(TWO_CONDITIONS, "OR")],
                       {"vibration": 6.0, "temperature": 20.0}, NOW)
    assert len(firings) == 1
    assert firings[0].score == 75  # weight 3 of total 4


def test_composite_missing_field_counts_as_unmet():
    firings = evaluate([composite_rule(TWO_CONDITIONS, "OR")], {"vibration": 6.0}, NOW)
    assert len(firings) == 1  # OR: vibration met
    assert firings[0].score == 75


def test_composite_empty_conditions_never_fires():
    assert evaluate([composite_rule([], "AND")], {"temperature": 99.0}, NOW) == []


def test_composite_unknown_logic_never_fires():
    assert evaluate([composite_rule(TWO_CONDITIONS, "XOR")],
                    {"vibration": 6.0, "temperature": 61.0}, NOW) == []


def test_composite_symbol_operators_in_conditions():
    conds = [{"field": "pressure", "operator": ">", "threshold": 3.0}]
    assert len(evaluate([composite_rule(conds)], {"pressure": 3.5}, NOW)) == 1


# ── Firing payload ───────────────────────────────────────────────────────────

def test_threshold_firing_carries_details_and_message():
    f = evaluate([threshold_rule()], {"temperature": 31.0}, NOW)[0]
    assert f.rule_id == "r1"
    assert f.rule_type == "THRESHOLD"
    assert f.metric == "temperature"
    assert f.value == 31.0
    assert f.severity == "MAJOR"
    assert f.message == "temperature gt 30.0 (current: 31.0)"


def test_composite_firing_carries_details():
    f = evaluate([composite_rule(TWO_CONDITIONS, "AND")],
                 {"vibration": 6.0, "temperature": 61.0}, NOW)[0]
    assert f.rule_id == "c1"
    assert f.rule_type == "COMPOSITE"
    assert f.severity == "CRITICAL"
    assert f.details["conditions_met"] == 2
    assert f.details["conditions_total"] == 2


def test_multiple_rules_yield_multiple_firings():
    rules = [
        threshold_rule(id="a", metric="temperature", threshold=30.0),
        threshold_rule(id="b", metric="humidity", operator="lt", threshold=20.0),
    ]
    firings = evaluate(rules, {"temperature": 31.0, "humidity": 10.0}, NOW)
    assert {f.rule_id for f in firings} == {"a", "b"}


def test_one_bad_rule_does_not_block_others():
    rules = [
        threshold_rule(id="bad", operator="banana"),
        threshold_rule(id="good"),
    ]
    firings = evaluate(rules, {"temperature": 31.0}, NOW)
    assert [f.rule_id for f in firings] == ["good"]

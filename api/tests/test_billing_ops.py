"""Unit tests for the provider-agnostic billing engine (no DB, no network).

The parts worth testing here are the deterministic ones the plan calls "the
verifiable layers": VAT maths, Peach success-code detection, webhook idempotency,
and the payment-handling branch selection. The Peach HTTP calls themselves are
SANDBOX-VERIFICATION-PENDING and are deliberately NOT tested here (no live keys).
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import hashlib
import hmac
from urllib.parse import urlencode
from uuid import uuid4

import pytest

from app.services import billing_ops
from app.services.billing_ops import _vat_split
from app.services.payments import ProviderWebhook
from app.services.peach import is_success_code, is_pending_code


# ── VAT (South Africa, 15%, VAT-exclusive subtotal) ──────────────────────────

class TestVatSplit:
    def test_round_hundred(self):
        assert _vat_split(10000) == (1500, 11500)  # R100 → R15 VAT → R115

    def test_half_cent_rounds_up(self):
        # 999 * 0.15 = 149.85 → 150 (ROUND_HALF_UP), total 1149
        assert _vat_split(999) == (150, 1149)

    def test_zero(self):
        assert _vat_split(0) == (0, 0)

    def test_total_is_subtotal_plus_vat(self):
        for sub in (1, 333, 4999, 123456):
            vat, total = _vat_split(sub)
            assert total == sub + vat


# ── Peach/OPPWA result-code families ─────────────────────────────────────────

class TestSuccessCode:
    @pytest.mark.parametrize("code", [
        "000.000.000",  # transaction succeeded
        "000.100.110",  # successfully processed (test)
        "000.300.000",  # manually reviewed, accepted
        "000.600.000",  # transaction succeeded (waiting)
    ])
    def test_success(self, code):
        assert is_success_code(code) is True

    @pytest.mark.parametrize("code", [
        "800.100.153",  # rejected (invalid CVV)
        "800.100.151",  # invalid card
        "000.200.000",  # pending — not yet success
        "100.396.101",  # cancelled by user
        "",
    ])
    def test_not_success(self, code):
        assert is_success_code(code) is False

    def test_pending_detected(self):
        assert is_pending_code("000.200.000") is True
        assert is_pending_code("000.000.000") is False


# ── Fakes ────────────────────────────────────────────────────────────────────

class _Result:
    def __init__(self, scalar=None, first=None, rows=None, one=None):
        self._scalar, self._first, self._rows, self._one = scalar, first, rows, one
    def scalar_one_or_none(self):
        return self._scalar
    def scalar_one(self):
        return self._scalar
    def mappings(self):
        return self
    def first(self):
        return self._first
    def all(self):
        return self._rows or []
    def one(self):
        return self._one


class _FakeSession:
    """Pops a queued result per execute(); records SQL for assertions."""
    def __init__(self, *results):
        self._q = list(results)
        self.sql = []
        self.commits = 0
    async def execute(self, sql, params=None):
        self.sql.append(str(sql))
        return self._q.pop(0) if self._q else _Result()
    async def commit(self):
        self.commits += 1


class _FakeProvider:
    def __init__(self, valid=True, webhook=None):
        self._valid, self._webhook = valid, webhook
    def verify_webhook(self, *, headers, raw_body):
        return self._valid
    def parse_webhook(self, *, raw_body):
        return self._webhook


def _wh(**kw):
    base = dict(event_id="pay-1", kind="payment", success=True, reference="ref1",
                token="tok1", amount_cents=11500, raw={"id": "pay-1"})
    base.update(kw)
    return ProviderWebhook(**base)


# ── process_webhook: signature + idempotency ─────────────────────────────────

class TestProcessWebhook:
    @pytest.mark.asyncio
    async def test_invalid_signature_rejected(self, monkeypatch):
        monkeypatch.setattr(billing_ops, "get_provider",
                            lambda n: _FakeProvider(valid=False))
        session = _FakeSession()
        result = await billing_ops.process_webhook(session, None, "peach", {}, b"body")
        assert result == {"ok": False, "status": "invalid_signature"}
        assert session.sql == []  # nothing written on a bad signature

    @pytest.mark.asyncio
    async def test_duplicate_is_skipped(self, monkeypatch):
        # INSERT ... ON CONFLICT DO NOTHING RETURNING id → None means replay.
        monkeypatch.setattr(billing_ops, "get_provider",
                            lambda n: _FakeProvider(valid=True, webhook=_wh()))
        called = {"handled": False}
        async def _never(*a, **k):
            called["handled"] = True
        monkeypatch.setattr(billing_ops, "_handle_payment", _never)
        session = _FakeSession(_Result(scalar=None))  # conflict → no id
        result = await billing_ops.process_webhook(session, None, "peach", {}, b"body")
        assert result == {"ok": True, "status": "duplicate"}
        assert called["handled"] is False  # replay must not be processed again
        assert session.commits == 1

    @pytest.mark.asyncio
    async def test_first_delivery_is_processed(self, monkeypatch):
        monkeypatch.setattr(billing_ops, "get_provider",
                            lambda n: _FakeProvider(valid=True, webhook=_wh()))
        async def _handle(session, redis, wh):
            return "activated"
        monkeypatch.setattr(billing_ops, "_handle_payment", _handle)
        session = _FakeSession(_Result(scalar="wid-1"))  # inserted → id
        result = await billing_ops.process_webhook(session, None, "peach", {}, b"body")
        assert result == {"ok": True, "status": "activated"}
        assert any("UPDATE webhook_events" in q for q in session.sql)
        assert session.commits == 1

    @pytest.mark.asyncio
    async def test_non_payment_kind_ignored(self, monkeypatch):
        monkeypatch.setattr(billing_ops, "get_provider",
                            lambda n: _FakeProvider(valid=True, webhook=_wh(kind="other")))
        session = _FakeSession(_Result(scalar="wid-2"))
        result = await billing_ops.process_webhook(session, None, "peach", {}, b"body")
        assert result == {"ok": True, "status": "ignored"}


# ── _handle_payment: branch selection ────────────────────────────────────────

class TestHandlePayment:
    @pytest.mark.asyncio
    async def test_success_with_checkout_activates_with_token(self, monkeypatch):
        seen = {}
        async def _pop(redis, ref):
            return {"tenant_id": str(uuid4()), "plan_code": "starter", "interval": "month"}
        async def _assign(session, redis, tid, *, plan_code, billing_interval, actor, provider, provider_ref):
            seen["provider"] = provider
            seen["provider_ref"] = provider_ref
        async def _inv(*a, **k):
            pass
        monkeypatch.setattr(billing_ops, "_pop_checkout", _pop)
        monkeypatch.setattr(billing_ops.sub_service, "assign_plan", _assign)
        monkeypatch.setattr(billing_ops, "_invoice_and_record", _inv)

        result = await billing_ops._handle_payment(_FakeSession(), None, _wh(token="TOK-42"))
        assert result == "activated"
        assert seen == {"provider": "peach", "provider_ref": "TOK-42"}

    @pytest.mark.asyncio
    async def test_success_no_checkout_renews_matched_token(self, monkeypatch):
        extended = {"n": 0}
        async def _pop(redis, ref):
            return None
        async def _sub(session, token):
            return {"id": uuid4(), "tenant_id": uuid4(), "billing_interval": "month", "plan_code": "starter"}
        async def _extend(session, sub):
            extended["n"] += 1
        async def _inv(*a, **k):
            pass
        async def _inval(redis, tid):
            pass
        monkeypatch.setattr(billing_ops, "_pop_checkout", _pop)
        monkeypatch.setattr(billing_ops, "_sub_by_token", _sub)
        monkeypatch.setattr(billing_ops, "_extend_period", _extend)
        monkeypatch.setattr(billing_ops, "_invoice_and_record", _inv)
        monkeypatch.setattr(billing_ops.ent_service, "invalidate", _inval)

        result = await billing_ops._handle_payment(_FakeSession(), None, _wh())
        assert result == "renewed"
        assert extended["n"] == 1

    @pytest.mark.asyncio
    async def test_success_no_match(self, monkeypatch):
        async def _pop(redis, ref):
            return None
        async def _sub(session, token):
            return None
        monkeypatch.setattr(billing_ops, "_pop_checkout", _pop)
        monkeypatch.setattr(billing_ops, "_sub_by_token", _sub)
        result = await billing_ops._handle_payment(_FakeSession(), None, _wh())
        assert result == "no_subscription_match"

    @pytest.mark.asyncio
    async def test_failure_with_token_goes_past_due(self, monkeypatch):
        async def _sub(session, token):
            return {"id": uuid4(), "tenant_id": uuid4(), "billing_interval": "month", "plan_code": "starter"}
        async def _inv(*a, **k):
            pass
        async def _inval(redis, tid):
            pass
        async def _rec_event(*a, **k):
            pass
        monkeypatch.setattr(billing_ops, "_sub_by_token", _sub)
        monkeypatch.setattr(billing_ops, "_invoice_and_record", _inv)
        monkeypatch.setattr(billing_ops.ent_service, "invalidate", _inval)
        monkeypatch.setattr(billing_ops.sub_service, "_record_event", _rec_event)

        session = _FakeSession()
        result = await billing_ops._handle_payment(session, None, _wh(success=False))
        assert result == "payment_failed"
        assert any("past_due" in q for q in session.sql)

    @pytest.mark.asyncio
    async def test_failure_no_match(self, monkeypatch):
        async def _sub(session, token):
            return None
        monkeypatch.setattr(billing_ops, "_sub_by_token", _sub)
        result = await billing_ops._handle_payment(_FakeSession(), None, _wh(success=False))
        assert result == "failed_no_match"

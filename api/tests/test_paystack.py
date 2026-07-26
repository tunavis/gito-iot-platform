"""Unit tests for the Paystack adapter's pure logic (no network, no live keys).

The HTTP calls (initialize / charge_authorization) are SANDBOX-VERIFICATION-PENDING
and not tested here. What IS deterministic — and worth locking down — is the webhook
signature check and the payload normalisation, so those are module-level functions
tested directly.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

import hashlib
import hmac
import json

from app.services.paystack import verify_signature, parse_event


SECRET = "sk_test_deadbeefcafef00d"


def _sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha512).hexdigest()


class TestVerifySignature:
    def test_valid_signature_passes(self):
        body = b'{"event":"charge.success","data":{"id":1}}'
        assert verify_signature(SECRET, body, _sign(SECRET, body)) is True

    def test_tampered_body_fails(self):
        body = b'{"event":"charge.success","data":{"id":1}}'
        sig = _sign(SECRET, body)
        assert verify_signature(SECRET, b'{"event":"charge.success","data":{"id":2}}', sig) is False

    def test_wrong_secret_fails(self):
        body = b'{"event":"charge.success"}'
        assert verify_signature("sk_test_other", body, _sign(SECRET, body)) is False

    def test_missing_signature_or_secret_fails(self):
        body = b"{}"
        assert verify_signature(SECRET, body, "") is False
        assert verify_signature("", body, _sign(SECRET, body)) is False


class TestParseEvent:
    def _body(self, **data):
        event = data.pop("event", "charge.success")
        base = {"id": 998877, "reference": "abc123", "status": "success", "amount": 11500,
                "currency": "ZAR", "authorization": {"authorization_code": "AUTH_xyz", "reusable": True}}
        base.update(data)
        return json.dumps({"event": event, "data": base}).encode()

    def test_charge_success_is_a_successful_payment(self):
        wh = parse_event(self._body())
        assert wh.kind == "payment"
        assert wh.success is True
        assert wh.token == "AUTH_xyz"          # the stored-card token for renewals
        assert wh.reference == "abc123"
        assert wh.amount_cents == 11500        # already in cents, passed through
        assert wh.event_id == "998877"         # transaction id → idempotency key

    def test_failed_status_is_not_success(self):
        wh = parse_event(self._body(status="failed"))
        assert wh.kind == "payment"
        assert wh.success is False

    def test_non_charge_event_is_other(self):
        body = json.dumps({"event": "subscription.create", "data": {"id": 5}}).encode()
        wh = parse_event(body)
        assert wh.kind == "other"
        assert wh.success is False

    def test_empty_body_does_not_crash(self):
        wh = parse_event(b"")
        assert wh.kind == "other"
        assert wh.success is False

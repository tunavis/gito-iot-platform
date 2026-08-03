"""The platform's first stored secret, and the guarantees it has to keep.

Every assertion here is about a failure mode rather than a feature. Encryption
that works is easy; encryption that refuses to quietly stop working is the part
worth testing, because the failure is invisible from the outside — a plaintext
credential reads back perfectly.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://test:test@localhost:5432/test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests-only-32ch")
os.environ.setdefault("MQTT_PASSWORD", "test-mqtt-password")

from unittest.mock import patch

import pytest
from cryptography.fernet import Fernet

from app.services.secrets import (
    ENV_VAR,
    PREFIX,
    EncryptedString,
    SecretCorrupt,
    SecretKeyMissing,
    decrypt,
    encrypt,
    is_encrypted,
    mask,
)

KEY = Fernet.generate_key().decode()
OTHER_KEY = Fernet.generate_key().decode()
CREDENTIAL = "chirpstack-api-key-abcdef0123456789"


def with_key(key=KEY):
    return patch.dict(os.environ, {ENV_VAR: key})


class TestItActuallyEncrypts:
    def test_round_trip(self):
        with with_key():
            assert decrypt(encrypt(CREDENTIAL)) == CREDENTIAL

    def test_the_stored_form_does_not_contain_the_secret(self):
        """The whole point. A database dump must not yield a usable credential."""
        with with_key():
            stored = encrypt(CREDENTIAL)
        assert CREDENTIAL not in stored
        assert stored.startswith(PREFIX)

    def test_the_same_input_does_not_produce_the_same_ciphertext(self):
        """Fernet carries a random IV. Identical stored values would let someone
        tell which two network servers share a credential without decrypting
        either."""
        with with_key():
            assert encrypt(CREDENTIAL) != encrypt(CREDENTIAL)


class TestItRefusesRatherThanDegrading:
    def test_no_key_refuses_to_encrypt(self):
        with patch.dict(os.environ, {ENV_VAR: ""}):
            with pytest.raises(SecretKeyMissing, match=ENV_VAR):
                encrypt(CREDENTIAL)

    def test_no_key_refuses_to_decrypt_rather_than_returning_the_stored_bytes(self):
        """The failure that would make all of this theatre: shrugging and
        handing back whatever is in the column."""
        with with_key():
            stored = encrypt(CREDENTIAL)
        with patch.dict(os.environ, {ENV_VAR: ""}):
            with pytest.raises(SecretKeyMissing):
                decrypt(stored)

    def test_a_malformed_key_is_a_config_error_not_a_crash(self):
        with patch.dict(os.environ, {ENV_VAR: "not-a-fernet-key"}):
            with pytest.raises(SecretKeyMissing, match="not a valid Fernet key"):
                encrypt(CREDENTIAL)

    def test_a_plaintext_value_in_an_encrypted_column_is_refused(self):
        """If something bypassed the column type, that must surface. Returning
        it as-is would mean a plaintext credential works perfectly and nobody
        ever finds out."""
        with with_key():
            with pytest.raises(SecretCorrupt, match="not encrypted"):
                decrypt(CREDENTIAL)

    def test_a_value_encrypted_with_a_different_key_is_refused(self):
        with with_key():
            stored = encrypt(CREDENTIAL)
        with with_key(OTHER_KEY):
            with pytest.raises(SecretCorrupt, match="could not be decrypted"):
                decrypt(stored)

    def test_a_tampered_token_is_refused(self):
        with with_key():
            stored = encrypt(CREDENTIAL)
            tampered = stored[:-4] + ("AAAA" if not stored.endswith("AAAA") else "BBBB")
            with pytest.raises(SecretCorrupt):
                decrypt(tampered)


class TestTheColumnTypeIsTheGuarantee:
    """`EncryptedString` is a column type and not a helper, so that no write path
    can forget. These assert the type itself, since that is where the guarantee
    lives."""

    def test_binding_encrypts_on_the_way_in(self):
        with with_key():
            bound = EncryptedString().process_bind_param(CREDENTIAL, None)
        assert bound.startswith(PREFIX) and CREDENTIAL not in bound

    def test_loading_decrypts_on_the_way_out(self):
        with with_key():
            t = EncryptedString()
            assert t.process_result_value(t.process_bind_param(CREDENTIAL, None), None) == CREDENTIAL

    def test_null_stays_null(self):
        """An unset credential must not become an encrypted empty string, which
        would decrypt to '' and read as 'configured'."""
        t = EncryptedString()
        assert t.process_bind_param(None, None) is None
        assert t.process_result_value(None, None) is None


class TestWhatAReadReturns:
    def test_mask_shows_enough_to_recognise_and_not_enough_to_use(self):
        assert mask(CREDENTIAL).startswith("chir")
        assert CREDENTIAL not in mask(CREDENTIAL)
        assert "abcdef0123456789" not in mask(CREDENTIAL)

    def test_a_short_secret_is_fully_masked(self):
        assert set(mask("abc")) == {"•"}

    def test_mask_of_nothing_is_nothing(self):
        assert mask(None) is None
        assert mask("") is None

    def test_is_encrypted_distinguishes_stored_from_plain(self):
        with with_key():
            assert is_encrypted(encrypt(CREDENTIAL))
        assert not is_encrypted(CREDENTIAL)
        assert not is_encrypted(None)


class TestTheStartupCheck:
    """A deployment that lost its key must not accept traffic and look healthy."""

    @pytest.mark.asyncio
    async def test_it_refuses_to_start_when_secrets_exist_and_the_key_is_gone(self):
        from unittest.mock import AsyncMock, MagicMock

        from app.services.secrets import assert_key_available_if_needed

        result = MagicMock()
        result.scalar = MagicMock(return_value=2)
        session = MagicMock()
        session.execute = AsyncMock(return_value=result)

        with patch.dict(os.environ, {ENV_VAR: ""}):
            with pytest.raises(SecretKeyMissing, match="Refusing to start"):
                await assert_key_available_if_needed(session)

    @pytest.mark.asyncio
    async def test_no_stored_secrets_means_no_key_is_required(self):
        """A single-server install that never stores a credential is not forced
        to invent one."""
        from unittest.mock import AsyncMock, MagicMock

        from app.services.secrets import assert_key_available_if_needed

        result = MagicMock()
        result.scalar = MagicMock(return_value=0)
        session = MagicMock()
        session.execute = AsyncMock(return_value=result)

        with patch.dict(os.environ, {ENV_VAR: ""}):
            await assert_key_available_if_needed(session)  # must not raise

    @pytest.mark.asyncio
    async def test_a_configured_key_short_circuits_without_querying(self):
        from unittest.mock import AsyncMock, MagicMock

        from app.services.secrets import assert_key_available_if_needed

        session = MagicMock()
        session.execute = AsyncMock()
        with with_key():
            await assert_key_available_if_needed(session)
        session.execute.assert_not_awaited()

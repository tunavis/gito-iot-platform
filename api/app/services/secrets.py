"""The platform's first stored outbound secret, and the one way it is stored.

Before this, nothing in `api/app` encrypted anything — `integrations.key_hash`
is a SHA-256 of an *inbound* key, which cannot authenticate an outbound call.
So this file sets the pattern for every later secret and is deliberately small:
one key, one algorithm, one versioned prefix, no general-purpose subsystem.

**Why encrypt at all.** The credential this protects can queue downlinks to every
device on a network server — in this deployment, the ability to actuate plant.
Row-level security is inert under the application's database role, so a plaintext
column is readable by any code path that reaches the table, by any injection that
reaches the table, and by anyone holding a backup. Encrypting with a key held
outside the database means a database dump alone is not enough.

**What it does not protect against.** An attacker with both the database and the
application environment gets the credential. That is the standard line for
self-hosted software and it is stated rather than implied.

**Enforced by construction.** `EncryptedString` is a SQLAlchemy column type, not
a helper a caller must remember to call. A router cannot write plaintext into a
column of this type, because the type encrypts on the way in. A service function
would have been one forgotten call away from a plaintext credential.
"""

from __future__ import annotations

import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

# Versioned so the scheme can be rotated later without guessing what a stored
# value is, and so an unencrypted value in one of these columns is obvious on
# sight rather than merely plausible.
PREFIX = "enc:v1:"

ENV_VAR = "SECRET_ENCRYPTION_KEY"


class SecretKeyMissing(RuntimeError):
    """No encryption key is configured, and something needs one.

    Raised rather than falling back to plaintext. A guard that degrades to a
    no-op is worse than one that fails loudly — the whole point of encrypting is
    lost the first time the code shrugs and stores the value anyway.
    """


class SecretCorrupt(ValueError):
    """A stored value is not something this module wrote."""


def _fernet() -> Fernet:
    key = os.environ.get(ENV_VAR, "").strip()
    if not key:
        raise SecretKeyMissing(
            f"{ENV_VAR} is not set. Generate one with:\n"
            f"  python -c \"from cryptography.fernet import Fernet; "
            f"print(Fernet.generate_key().decode())\"\n"
            f"and set it in the environment. It must be the same value everywhere "
            f"the API runs, and it must not live in the database."
        )
    try:
        return Fernet(key.encode())
    except Exception as e:  # noqa: BLE001 - a malformed key is a config error
        raise SecretKeyMissing(f"{ENV_VAR} is not a valid Fernet key: {e}") from e


def encrypt(plaintext: str) -> str:
    """Plaintext to `enc:v1:<token>`. Raises if no key is configured."""
    return PREFIX + _fernet().encrypt(plaintext.encode()).decode()


def decrypt(stored: str) -> str:
    """`enc:v1:<token>` back to plaintext.

    A value without the prefix raises rather than being returned as-is. Passing
    it through would mean a plaintext credential in the database reads back
    perfectly and nobody ever notices — exactly the failure encrypting was for.
    """
    if not stored.startswith(PREFIX):
        raise SecretCorrupt(
            "value in an encrypted column is not encrypted. It was written by "
            "something that bypassed EncryptedString, or the column was edited "
            "by hand. Refusing to use it."
        )
    try:
        return _fernet().decrypt(stored[len(PREFIX):].encode()).decode()
    except InvalidToken as e:
        raise SecretCorrupt(
            f"stored secret could not be decrypted — {ENV_VAR} has changed, or the "
            f"value was tampered with. Credentials are re-enterable; re-enter it "
            f"rather than guessing."
        ) from e


def is_encrypted(stored: Optional[str]) -> bool:
    return bool(stored) and stored.startswith(PREFIX)


def mask(plaintext: Optional[str], keep: int = 4) -> Optional[str]:
    """What a read returns. Enough to recognise a credential, not to use it.

    Mirrors `integrations.key_prefix`, which already shows a partial inbound key,
    so the UI has one convention for "a secret you cannot see".
    """
    if not plaintext:
        return None
    if len(plaintext) <= keep:
        return "•" * len(plaintext)
    return plaintext[:keep] + "•" * min(len(plaintext) - keep, 20)


class EncryptedString(TypeDecorator):
    """A column whose contents are encrypted at rest.

    Reads give plaintext, writes take plaintext; the database only ever holds
    `enc:v1:<token>`. Being a type rather than a helper is the guarantee: there
    is no write path that can forget.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):  # write
        return None if value is None else encrypt(value)

    def process_result_value(self, value, dialect):  # read
        return None if value is None else decrypt(value)


async def assert_key_available_if_needed(session) -> None:
    """Fail startup if encrypted secrets exist and no key is configured.

    Without this the failure surfaces at first use — which for a downlink
    credential means the first time someone tries to command a device, quite
    possibly at 2am. A deployment that lost its key should not accept traffic
    and appear healthy.

    A deployment with no encrypted secrets boots fine without a key, so a
    single-server install that never stores one is not forced to invent it.
    """
    from sqlalchemy import text

    if os.environ.get(ENV_VAR, "").strip():
        return

    encrypted = (
        await session.execute(
            text(
                "SELECT count(*) FROM integrations "
                "WHERE downlink_api_key IS NOT NULL AND downlink_api_key LIKE :p"
            ),
            {"p": PREFIX + "%"},
        )
    ).scalar() or 0

    if encrypted:
        raise SecretKeyMissing(
            f"{encrypted} stored credential(s) are encrypted and {ENV_VAR} is not set. "
            f"Refusing to start: serving requests without it would mean every "
            f"downlink fails at the moment someone needs one. Restore the key, or "
            f"clear the credentials and re-enter them."
        )

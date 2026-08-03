"""Configure a REST network server's downlink endpoint, and bind a device to it.

Only for `downlink_mode = "rest"` — a client who gives us an API token rather
than broker access. The `mqtt` mode needs no credential (it publishes to the
broker its uplinks already arrive on) and is set directly on the integration.

Run this yourself — it prompts for the credential rather than taking it as an
argument, so the key never reaches a chat transcript, a shell history file, or
a command line another process can read from /proc.

    cd api && ./.venv/Scripts/python.exe ../scripts/configure_network_server.py

It will:
  1. ask for the ChirpStack REST API base URL and an API token
  2. **verify them against the real server** before storing anything
  3. store the token encrypted (enc:v1:…) on the integration
  4. optionally bind one device to it

Nothing is written until the verification in step 2 passes. Storing a credential
that was never tried is how you find out it is wrong at 2am, from a command that
reports `sent`.
"""

from __future__ import annotations

import asyncio
import getpass
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "api"))

# Load .env so SECRET_ENCRYPTION_KEY and DATABASE_URL are available exactly as
# the container sees them.
for line in (REPO / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

os.environ.setdefault(
    "DATABASE_URL", "postgresql+asyncpg://gito:dev-password@localhost:5433/gito"
)

import aiohttp  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.database import RLSSession  # noqa: E402
from app.models.base import Device, Integration  # noqa: E402
from app.services.secrets import mask  # noqa: E402


async def verify(api_url: str, api_key: str, dev_eui: str) -> tuple[bool, str]:
    """Ask the real server about the real device before storing anything."""
    url = f"{api_url.rstrip('/')}/api/devices/{dev_eui}"
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(
                url,
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as r:
                body = (await r.text())[:200]
                if r.status == 200:
                    return True, "device found, credential accepted"
                if r.status in (401, 403):
                    return False, f"credential rejected ({r.status}): {body}"
                if r.status == 404:
                    return False, (
                        f"credential accepted but device {dev_eui} is not on this server "
                        f"— which is exactly the mistake this binding exists to prevent"
                    )
                return False, f"unexpected {r.status}: {body}"
    except Exception as e:  # noqa: BLE001
        return False, f"could not reach {url}: {type(e).__name__}: {e}"


async def main() -> int:
    engine = create_async_engine(os.environ["DATABASE_URL"], poolclass=None)
    maker = async_sessionmaker(bind=engine, class_=RLSSession, expire_on_commit=False)

    async with maker() as s:
        integrations = (
            (await s.execute(select(Integration).order_by(Integration.name))).scalars().all()
        )
        if not integrations:
            print("no integrations exist; create one in the UI first", file=sys.stderr)
            return 1

        print("\nNetwork servers:")
        for i, ig in enumerate(integrations, 1):
            configured = "downlink configured" if ig.downlink_api_url else "no downlink endpoint"
            print(f"  {i}. {ig.name}  ({ig.provider}, {configured})")
        choice = input("\nWhich one? [number] ").strip()
        integration = integrations[int(choice) - 1]

        dev_eui = input("Device dev_eui to bind and verify against: ").strip().lower()
        device = (
            await s.execute(select(Device).where(Device.dev_eui == dev_eui))
        ).scalar_one_or_none()
        if device is None:
            print(f"no device with dev_eui {dev_eui}", file=sys.stderr)
            return 1

        default_url = integration.downlink_api_url or ""
        api_url = input(
            f"ChirpStack REST API base URL{f' [{default_url}]' if default_url else ''}: "
        ).strip() or default_url
        if not api_url:
            print("a URL is required", file=sys.stderr)
            return 1

        # Hidden. Not an argument, not in history, not in this file.
        api_key = getpass.getpass("ChirpStack API token (input hidden): ").strip()
        if not api_key:
            print("a token is required", file=sys.stderr)
            return 1

        print(f"\nverifying {api_url} with device {dev_eui} ...")
        ok, detail = await verify(api_url, api_key, dev_eui)
        print(f"  {'OK' if ok else 'FAILED'}: {detail}")
        if not ok:
            print("\nnothing was written.", file=sys.stderr)
            return 1

        # EncryptedString encrypts on the way in — no explicit call, so no write
        # path can forget.
        # The mode too, or the binding resolves to "no downlink mode configured"
        # and this script would have left the server half-configured. This one
        # only ever sets up REST; `mqtt` needs no credential and is set directly.
        integration.downlink_mode = "rest"
        integration.downlink_api_url = api_url
        integration.downlink_api_key = api_key
        device.integration_id = integration.id
        await s.commit()

        print(f"\nstored on {integration.name!r}:")
        print(f"  downlink_api_url : {api_url}")
        print(f"  downlink_api_key : {mask(api_key)}  (encrypted at rest)")
        print(f"bound {device.name} ({dev_eui}) -> {integration.name}")

    await engine.dispose()

    # Prove it round-trips through the database rather than through this process.
    async with maker() as s:
        again = (
            await s.execute(select(Integration).where(Integration.id == integration.id))
        ).scalar_one()
        print(f"\nre-read from the database: {mask(again.downlink_api_key)}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

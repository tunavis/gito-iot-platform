"""Bind devices to the network server they report through.

Deliberately separate from `network_server_bindings.py`, which only reports.
This one writes, and it is meant to be read before it is run.

    docker exec -i gito-api python < scripts/bind_fleet_to_network_server.py

Only binds LoRaWAN devices (those with a `dev_eui`) that are currently unbound,
and only when exactly one ChirpStack integration exists in the tenant — with two,
"which one" is a judgement no script should make.

Reversible: `UPDATE devices SET integration_id = NULL` returns any device to the
pre-binding resolution order.
"""

import asyncio
import sys

from sqlalchemy import select, text

from app.database import get_session
from app.models.base import Device, Integration


async def main() -> int:
    gen = get_session()
    s = await gen.__anext__()
    try:
        servers = (
            (await s.execute(
                select(Integration).where(Integration.provider.like("chirpstack%"))
            )).scalars().all()
        )
        if len(servers) != 1:
            print(f"found {len(servers)} ChirpStack integrations; refusing to guess "
                  f"which devices belong to which. Bind them per device.", file=sys.stderr)
            return 1
        server = servers[0]
        await s.set_tenant_context(server.tenant_id)

        if server.downlink_mode is None:
            print(f"{server.name!r} has no downlink_mode declared. Binding devices to a "
                  f"server that cannot be dispatched to would be worse than leaving "
                  f"them unbound.", file=sys.stderr)
            return 1

        unbound = (
            (await s.execute(
                select(Device).where(
                    Device.tenant_id == server.tenant_id,
                    Device.integration_id.is_(None),
                    Device.dev_eui.isnot(None),
                )
            )).scalars().all()
        )

        if not unbound:
            print("nothing to bind — every LoRaWAN device already names a server.")
            return 0

        print(f"binding {len(unbound)} LoRaWAN device(s) to {server.name!r} "
              f"(mode={server.downlink_mode})")
        no_app = 0
        for d in unbound:
            d.integration_id = server.id
            if not d.ttn_app_id:
                no_app += 1
        await s.commit()

        print(f"  bound            : {len(unbound)}")
        if no_app:
            print(f"  awaiting an uplink: {no_app} have no application id yet. Commands to "
                  f"those are refused with that reason until they next report — which is "
                  f"honest, and self-heals.")

        rows = (await s.execute(text(
            "SELECT count(*) FILTER (WHERE integration_id IS NOT NULL) AS bound,"
            " count(*) FILTER (WHERE integration_id IS NULL AND dev_eui IS NOT NULL) AS unbound,"
            " count(*) AS total FROM devices"
        ))).mappings().one()
        print(f"\nfleet: {rows['bound']} bound, {rows['unbound']} unbound LoRaWAN, "
              f"{rows['total']} total")
        return 0
    finally:
        await gen.aclose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

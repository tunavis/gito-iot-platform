"""Apply the B METERS IWM driver to its device type, and give the UI a command schema.

Run inside the API container so the driver goes through the *real* Pydantic
validator before it reaches a row — the same one that guards PUT
/device-types/{id} — rather than being trusted because a file passed a unit test.

    docker cp drivers/b-meters-iwm-lr3-lr4.json gito-api:/tmp/iwm-driver.json
    docker exec -i gito-api python < scripts/apply_iwm_driver.py

Copy to `/tmp` and not to `/app/drivers`: `/app` is a bind mount of `api/`, so
copying there writes back out to the host and leaves a second copy of every
driver inside `api/`. Two copies of a byte-layout declaration is the one thing
this whole change exists to avoid.

Deliberately separate things, per the design: `driver` says how bytes go on the
wire, `command_schema` says what a command means to a person. They are derived
from one source here only to author them consistently the first time; after this
they are edited independently, and the driver is the one under version control.

Idempotent: re-running rewrites the same three columns.
"""

import asyncio
import json
import os
import sys

from sqlalchemy import select

from app.database import get_session
from app.models.device_type import DeviceType
from app.schemas.device_type import DeviceTypeUpdate

DRIVER_PATH = os.environ.get("DRIVER_PATH", "/tmp/iwm-driver.json")
TYPE_NAME_PREFIX = "B METERS IWM"

# Ranges and meanings transcribed from the manual, per command. The driver knows
# the byte layout; only a person needs these.
PARAM_META = {
    "day": ("integer", None, 1, 31, "Day of month"),
    "day_of_week": ("integer", None, 0, 6, "0 = Sunday, 1 = Monday …"),
    "month": ("integer", None, 1, 12, "1 = January"),
    "year": ("integer", None, 18, 100, "Years since 2000"),
    "hours": ("integer", None, 0, 23, ""),
    "minutes": ("integer", None, 0, 59, ""),
    "seconds": ("integer", None, 0, 59, ""),
    "forward_counter": (
        "integer", "L", 0, 99999999,
        "Initial consumption. Bits 31-30 select the unit and MUST match the K index.",
    ),
    "reset_backward": ("integer", None, 0, 1, "0 = do not reset, 1 = reset the counter"),
    "active": ("integer", None, 0, 1, "0 = inactive count, 1 = active count"),
    "k_index": ("integer", None, 0, 2, "0 = 1 L, 1 = 10 L, 2 = 100 L per revolution"),
    "medium": ("integer", None, 0, 1, "0 = water, 1 = hot water"),
    "alarm_threshold_reverse": ("integer", None, 0, 2, "0 = 20 L, 1 = 50 L, 2 = 100 L"),
    "loss_control_time": ("integer", None, 0, 3, "0 = 6 h, 1 = 12 h, 2 = 24 h, 3 = 48 h"),
    "transmission_vif": ("integer", None, 0, 3, "0 = litres, 1 = decalitres, 2 = hectolitres, 3 = m³"),
    "temperature": ("integer", None, 0, 1, "0 = disable, 1 = enable"),
    "low_battery_threshold_mv": (
        "integer", "mV", 0, 4294967295,
        "Low battery threshold. Documented default is 2200 — read it back with "
        "get_alarm_par first, the manual's own examples for this field are wrong.",
    ),
    "alarm_flags": (
        "integer", None, 0, 63,
        "Bit 0 magnetic, 1 removal, 2 blinding, 3 loss, 4 reverse flow, 5 low battery. "
        "Writing 0 clears every alarm.",
    ),
}


# Commands the driver knows how to encode but the UI does not offer.
#
# The driver still defines all twelve — that is the wire knowledge, transcribed
# from the manual and under version control. This list is the *affordance*: what
# a person is given a button for. Separating the two is the point of the design.
#
# Four of these can disturb the consumption data the whole fleet exists to
# report, and one of those does it as a side effect nobody would expect:
WITHHELD = {
    "set_revolution_counters": "overwrites the consumption counter directly",
    "set_meter_par": "changes the K index — litres per revolution, so every later reading",
    "set_alarm_par": (
        "whole-struct write including the transmission VIF, which is the UNIT volume is "
        "reported in; sending it to toggle one flag silently rewrites the rest"
    ),
    "reset": "forces a re-join; the manual says consumption is saved and restored, unverified",
    "set_date_and_time": "not volume, but re-times every subsequent reading",
    "set_alarm_data": "not volume, but clears alarm history",
}

# Set to True only when someone has decided, per command, that it should be
# clickable. Defaulting this to True is how a safeguard becomes a comment.
EXPOSE_WRITES = False


def build_command_schema(driver: dict) -> dict:
    """One UI entry per driver command; parameters are the fields not fixed by it."""
    schema = {}
    for name, definition in driver["commands"]["definitions"].items():
        if name in WITHHELD and not EXPOSE_WRITES:
            continue
        constants = definition.get("constants") or {}
        params = []
        for field in definition["fields"]:
            if field["name"] in constants:
                continue  # the driver fixes it; a person must not be asked
            kind, unit, low, high, note = PARAM_META.get(
                field["name"], ("integer", None, None, None, "")
            )
            param = {"name": field["name"], "type": kind, "required": True}
            if unit:
                param["unit"] = unit
            if low is not None:
                param["min"] = low
            if high is not None:
                param["max"] = high
            if note:
                param["description"] = note
            params.append(param)
        schema[name] = {
            "description": definition.get("description", name),
            "parameters": params,
        }
    return schema


async def main() -> int:
    with open(DRIVER_PATH, encoding="utf-8") as fh:
        driver = json.load(fh)

    # The real write-path validator. If this raises, nothing is written.
    validated = DeviceTypeUpdate(driver=driver).driver
    print(f"driver validated: {len(driver['commands']['definitions'])} commands, "
          f"{len(driver['acknowledgement']['response'].get('payloads', {}))} answer layout(s)")

    command_schema = build_command_schema(driver)

    gen = get_session()
    session = await gen.__anext__()
    try:
        row = (
            await session.execute(
                select(DeviceType).where(DeviceType.name.like(f"{TYPE_NAME_PREFIX}%"))
            )
        ).scalar_one_or_none()
        if row is None:
            print(f"no device type matching {TYPE_NAME_PREFIX!r}", file=sys.stderr)
            return 1

        await session.set_tenant_context(row.tenant_id)

        caps = list(row.capabilities or [])
        if "commands" not in caps:
            caps.append("commands")

        row.driver = validated
        row.command_schema = command_schema
        row.capabilities = caps
        # `decoder` is deliberately untouched. The driver carries no telemetry
        # section, so uplink decoding for every live meter stays on exactly the
        # path it is on now.
        await session.commit()

        print(f"applied to {row.name} ({row.id})")
        print(f"  capabilities : {caps}")
        print(f"  offered      : {', '.join(sorted(command_schema))}")
        print(f"  decoder      : {'unchanged' if row.decoder else 'none'}")
        if not EXPOSE_WRITES:
            print(f"  withheld     : {len(WITHHELD)} write command(s) the driver can still "
                  f"encode but the UI does not offer —")
            for name, why in sorted(WITHHELD.items()):
                print(f"                 {name}: {why}")
        return 0
    finally:
        await gen.aclose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

"""Report which devices are bound to a network server, and which are not.

Read-only. Proposes bindings from observed uplinks; it does **not** apply them.
A wrong binding dispatches confidently to the wrong server, and the only check
against that is a person who looked — which is why nothing here writes.

    docker exec -i gito-api python < scripts/network_server_bindings.py
"""

import asyncio
import sys

from sqlalchemy import text

from app.database import get_session

QUERY = """
SELECT
    i.name                                   AS server,
    i.downlink_mode                          AS mode,
    count(*)                                 AS devices,
    count(*) FILTER (WHERE d.lorawan_app_id IS NULL) AS missing_application
FROM devices d
JOIN integrations i ON i.id = d.integration_id
GROUP BY 1, 2
ORDER BY 3 DESC
"""

UNBOUND = """
SELECT
    coalesce(dt.name, '(no type)')           AS device_type,
    count(*)                                 AS devices,
    count(*) FILTER (WHERE d.dev_eui IS NOT NULL) AS lorawan,
    count(DISTINCT d.lorawan_app_id)             AS applications_seen,
    max(d.lorawan_app_id)                        AS example_application
FROM devices d
LEFT JOIN device_types dt ON dt.id = d.device_type_id
WHERE d.integration_id IS NULL
GROUP BY 1
ORDER BY 2 DESC
"""


async def main() -> int:
    gen = get_session()
    s = await gen.__anext__()
    try:
        print("BOUND")
        rows = (await s.execute(text(QUERY))).mappings().all()
        if not rows:
            print("  (none)")
        for r in rows:
            warn = f"  ** {r['missing_application']} with no application id" if r["missing_application"] else ""
            print(f"  {r['server']:<20} mode={r['mode'] or '(unset)':<6} devices={r['devices']}{warn}")

        print("\nUNBOUND — resolving by the pre-binding order")
        rows = (await s.execute(text(UNBOUND))).mappings().all()
        if not rows:
            print("  (none)")
        for r in rows:
            print(f"  {r['device_type']:<42} {r['devices']:>3} device(s), "
                  f"{r['lorawan']} LoRaWAN")
            if r["applications_seen"]:
                print(f"      observed application: {r['example_application']}"
                      f"{' (+ others)' if r['applications_seen'] > 1 else ''}")
                print(f"      → these report through a network server we can identify; "
                      f"bind them to it")
        print("\nNothing was changed. Apply bindings deliberately, per device or per type.")
        return 0
    finally:
        await gen.aclose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

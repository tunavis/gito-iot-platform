#!/usr/bin/env python3
"""Write `openapi.json` at the repo root from the FastAPI app itself.

This file is the contract the mobile app's TypeScript types are generated from
(`mobile/src/api/schema.d.ts`). Committing it means a mobile developer gets the
current API shape by pulling `main` rather than by having the right containers
running — an older local stack would otherwise produce stale types that look
completely authoritative and that nothing can distinguish from correct ones.

Generated from the source, not from a running server, for the same reason: the
schema is then a property of the commit.

Usage
-----
In the container (most reliable — it has the pinned dependency versions):

    docker exec -i gito-api python - --stdout < scripts/generate_openapi.py > openapi.json

On a host or in CI that has the API's dependencies installed:

    python scripts/generate_openapi.py            # write openapi.json
    python scripts/generate_openapi.py --check    # exit 1 if it is out of date
    python scripts/generate_openapi.py --stdout   # print, write nothing

"Installed" means at `api/pyproject.toml`'s pinned versions — `pip install -e ./api`
into a 3.11+ environment. A system Python carrying some older FastAPI fails on
import with `Router.__init__() got an unexpected keyword argument 'on_startup'`
long before it reaches the schema, which is why the container route is listed
first. CI does the install, so CI takes this path.

`--check` is what CI runs, so a pull request that changes a router without
regenerating this file fails. Without that check the committed schema rots
silently and the mobile app's types become confidently wrong, which is worse
than having no types at all.
"""

import json
import os
import sys
from pathlib import Path

# Importing the app builds the route table and the Pydantic models. Nothing here
# opens a socket — SQLAlchemy creates its engine lazily and no request is served.
# But three settings in app/config.py have no default, and Pydantic aborts the
# import if they are missing, so supply obvious placeholders for exactly those
# and only when absent. A real environment always wins.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://openapi:openapi@localhost:5432/openapi_schema_only",
)
os.environ.setdefault("JWT_SECRET_KEY", "placeholder-for-schema-generation-only-not-a-secret")
os.environ.setdefault("MQTT_PASSWORD", "placeholder-for-schema-generation-only")


def _repo_root() -> Path | None:
    """Repo root, or None when piped via stdin (`python -`), where there is no file."""
    if "__file__" not in globals():
        return None
    return Path(__file__).resolve().parents[1]


def _load_app():
    """Import the FastAPI app, whether we are in the container or at the repo root.

    In `gito-api` the working directory *is* the api package root (`/app`), so
    `app.main` imports directly. Run from the repo root, it needs `api/` on the
    path. Try the direct import first so the container case needs no file paths.
    """
    try:
        from app.main import app  # type: ignore[import-not-found]

        return app
    except ModuleNotFoundError:
        root = _repo_root()
        if root is None:
            raise
        sys.path.insert(0, str(root / "api"))
        from app.main import app  # type: ignore[import-not-found]

        return app


def render(app) -> str:
    """Serialise the schema deterministically.

    `sort_keys=True` is what makes `--check` meaningful: without a stable key
    order the same app could serialise two different ways and the check would
    fail on noise, which trains everyone to ignore it.
    """
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    app = _load_app()
    current = render(app)
    path_count = len(app.openapi().get("paths", {}))

    if "--stdout" in sys.argv:
        sys.stdout.write(current)
        return 0

    root = _repo_root()
    if root is None:
        print(
            "❌ Cannot locate the repo root (script was piped via stdin).\n"
            "   Use --stdout and redirect, e.g.\n"
            "   docker exec -i gito-api python - --stdout "
            "< scripts/generate_openapi.py > openapi.json",
            file=sys.stderr,
        )
        return 2
    output = root / "openapi.json"

    if "--check" in sys.argv:
        if not output.exists():
            print(f"❌ {output.name} is missing. Run: python scripts/generate_openapi.py")
            return 1
        if output.read_text(encoding="utf-8") != current:
            print(
                f"❌ {output.name} is out of date — the API changed but the schema "
                f"was not regenerated.\n"
                f"   The mobile app generates its TypeScript types from this file, "
                f"so leaving it stale hands mobile the wrong types.\n"
                f"   Fix: python scripts/generate_openapi.py && git add {output.name}"
            )
            return 1
        print(f"✅ {output.name} is up to date ({path_count} paths)")
        return 0

    # newline="\n" is required, not tidiness. `write_text` defaults to
    # newline=None, which on Windows translates every \n to \r\n — so running
    # this on a host rather than in the container rewrites all ~17,900 lines and
    # produces an enormous diff with no content change in it. `--check` cannot
    # catch that, because `read_text` normalises newlines on the way back in: the
    # check passes while the diff is entirely fake. The docstring above offers
    # the host command, so this path is reachable by design.
    output.write_text(current, encoding="utf-8", newline="\n")
    print(f"✅ wrote {output.name} — {path_count} paths")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

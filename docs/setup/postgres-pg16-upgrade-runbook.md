# Staging Postgres Upgrade Runbook: pg15 → pg16

**Status:** Verified against a disposable copy of the real schema (init.sql + all 23
migrations, seeded with synthetic hypertable data). Not yet run against real staging.

## Why this isn't a one-line image-tag change

Postgres data directories aren't binary-compatible across major versions — swapping
`timescale/timescaledb:latest-pg15` for `latest-pg16` in `docker-compose.staging.yml`
and restarting will make the new pg16 binary fail to start against pg15-format data
files.

**The non-obvious part, found during verification:** `latest-pg15` and `latest-pg16`
are pinned to *different TimescaleDB extension versions*, not just different Postgres
versions. At verification time, `latest-pg15` resolved to TimescaleDB `2.28.2` and
`latest-pg16` resolved to `2.25.2` — older, not newer. The two versions' internal
`_timescaledb_catalog` schema differs (columns/tables added and removed between
2.25 and 2.28), so a normal `pg_dump`/`pg_restore` fails partway through with errors
like `column "schema_change_timestamp" of relation "continuous_agg" does not exist`.

**The fix:** use a pg16 image tagged with the *same* TimescaleDB extension version as
the source, not `latest-pg16`. `timescale/timescaledb:2.28.2-pg16` exists and is
confirmed to accept a restore from a `2.28.2`-on-pg15 source cleanly.

## Pre-flight (do this first, don't assume the version)

```bash
# On the current staging Postgres, confirm the actual TimescaleDB version —
# do not assume it matches what was true at verification time.
docker exec gito-postgres-staging psql -U gito -d gito -t -c \
  "SELECT extversion FROM pg_extension WHERE extname='timescaledb';"
```

Then confirm a pg16 image exists tagged with that exact version:
`docker pull timescale/timescaledb:<that-version>-pg16`. If no exact match exists,
this needs a different plan (e.g. upgrade the TimescaleDB extension on the pg15 side
first, to align on a version that also has a pg16 build) — stop and reassess rather
than improvising a version mismatch against real data.

## Procedure (requires a maintenance window — writes must stop during the dump)

```bash
# 1. Stop the API/processor so nothing writes during the dump (staging host)
docker compose -f docker-compose.staging.yml stop api processor

# 2. Dump the running pg15 database (use the NEWER client tools — pull the matched
#    pg16 image first and dump using its pg_dump binary against the pg15 server)
docker run --rm --network <staging-network> \
  -e PGPASSWORD=<db-password> \
  timescale/timescaledb:<version>-pg16 \
  pg_dump -h gito-postgres-staging -U gito -d gito -Fc -f /tmp/staging_upgrade.dump
# (adjust to copy the dump file to somewhere durable, e.g. bind-mount a host path)

# 3. Boot a NEW pg16 container on a fresh volume (do not reuse the pg15 volume)
docker run -d --name gito-postgres-pg16 --network <staging-network> \
  -v gito_postgres_data_pg16:/var/lib/postgresql/data \
  -e POSTGRES_DB=gito -e POSTGRES_USER=gito -e POSTGRES_PASSWORD=<db-password> \
  timescale/timescaledb:<version>-pg16

# 4. Pre-create the extension, then the documented TimescaleDB restore sequence
docker exec gito-postgres-pg16 psql -U gito -d gito -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
docker exec gito-postgres-pg16 psql -U gito -d gito -c "SELECT timescaledb_pre_restore();"
docker exec gito-postgres-pg16 pg_restore -h localhost -U gito -d gito --no-owner --role=gito /tmp/staging_upgrade.dump
docker exec gito-postgres-pg16 psql -U gito -d gito -c "SELECT timescaledb_post_restore();"
```

## Verification checklist (run all of these before cutting over)

```sql
-- Table count roughly matches the source (34 in the verified test)
SELECT count(*) FROM information_schema.tables WHERE table_schema='public';

-- telemetry is a REAL hypertable, not a flat table (this is what broke on the
-- first attempt with mismatched TimescaleDB versions)
SELECT hypertable_name, num_chunks FROM timescaledb_information.hypertables;

-- Row counts match a pre-dump count you took on the pg15 source
SELECT count(*) FROM telemetry;

-- alembic is at the expected head revision
SELECT version_num FROM alembic_version;

-- A real aggregate query against hypertable data actually executes
SELECT device_id, avg(metric_value) FROM telemetry GROUP BY device_id LIMIT 5;
```

Only after all of these pass: update `docker-compose.staging.yml`'s postgres `image:`
to the matched `<version>-pg16` tag, point it at the new volume, restart
`api`/`processor`, and smoke-test the app end to end before deleting the old pg15
volume.

## Rollback

Keep the original pg15 container/volume untouched and stopped (not deleted) until the
new pg16 instance has been running cleanly for a real observation period. Rolling
back is: stop the pg16 container, restart the original pg15 container, revert the
compose file's image tag.

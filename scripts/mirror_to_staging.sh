#!/usr/bin/env bash
# ============================================================================
# Mirror local -> homelab server (192.168.0.9)
#
# Makes the server an exact duplicate of the local dev environment: local's
# code (via origin/main) plus a full clone of local's database — every tenant,
# user, device, dashboard and telemetry row.
#
# Local is the single source of truth. This DESTROYS the server's application
# database and replaces it with local's. The server is a disposable reflection.
#
# NOT copied (deliberately — copying these would break the server):
#   .env.staging, DB credentials, cookie/proxy settings, nginx-proxy-manager
#   routing. Infra config stays server-specific.
#
# Code comes from origin/main, so commit + push local first — otherwise the
# server mirrors your last pushed commit, not your working tree. The database
# is cloned directly from the local container, so DB state needs no push.
#
# Usage:  ./scripts/mirror_to_staging.sh
# Safe to re-run.
# ============================================================================
set -euo pipefail

SERVER="mark@192.168.0.9"
REPO="/opt/gito-iot"

LOCAL_PG="gito-postgres"
LOCAL_DB="gito"
LOCAL_USER="gito"

STAGING_PG="gito-postgres-staging"
STAGING_DB="gito_iot_staging"
STAGING_USER="gito_user"

COMPOSE="docker compose -f docker-compose.staging.yml --env-file .env.staging"
HOST_DUMP="/tmp/gito_mirror.dump"

# MSYS_NO_PATHCONV: Git Bash rewrites /tmp/... into a Windows path before it
# reaches the container, so every in-container path needs this guard.
d() { MSYS_NO_PATHCONV=1 docker "$@"; }

echo "==> [1/7] Version guard"
LOCAL_TS=$(d exec "$LOCAL_PG" psql -U "$LOCAL_USER" -d "$LOCAL_DB" -t -A \
  -c "SELECT extversion FROM pg_extension WHERE extname='timescaledb';")
SERVER_TS=$(ssh "$SERVER" "docker exec $STAGING_PG psql -U $STAGING_USER -d $STAGING_DB -t -A \
  -c \"SELECT extversion FROM pg_extension WHERE extname='timescaledb';\"" 2>/dev/null || echo "unreachable")
echo "    local TimescaleDB=$LOCAL_TS   server=$SERVER_TS"
if [ "$LOCAL_TS" != "$SERVER_TS" ]; then
  echo ""
  echo "!! Version mismatch — a dump from one will not restore into the other."
  echo "!! Pin the postgres image in docker-compose.staging.yml to:"
  echo "!!     timescale/timescaledb:${LOCAL_TS}-pg16"
  echo "!! then recreate the server's volume (see the deploy-staging skill)."
  exit 1
fi

echo "==> [2/7] Dump local database"
# Stream pg_dump to stdout rather than writing in-container then `docker cp`:
# that would need the container path left alone but the host path translated,
# and MSYS_NO_PATHCONV is all-or-nothing. Redirection avoids paths entirely.
d exec "$LOCAL_PG" pg_dump -U "$LOCAL_USER" -d "$LOCAL_DB" \
  -Fc --no-owner --no-privileges > "$HOST_DUMP"
echo "    $(stat -c %s "$HOST_DUMP") bytes"

echo "==> [3/7] Sync code + rebuild images on server"
ssh "$SERVER" "cd $REPO && git fetch origin && git reset --hard origin/main && git log --oneline -1"
ssh "$SERVER" "cd $REPO && \
  docker build -q -t ghcr.io/tunavis/gito-iot-platform-api:staging -f api/Dockerfile . && \
  docker build -q -t ghcr.io/tunavis/gito-iot-platform-web:staging -f web/Dockerfile ./web && \
  $COMPOSE build processor mqtt-bridge" > /dev/null
echo "    images rebuilt"

echo "==> [4/7] Stop app services (postgres stays up)"
ssh "$SERVER" "cd $REPO && $COMPOSE stop api web processor mqtt-bridge" 2>&1 | tail -2

echo "==> [5/7] Transfer dump + recreate database"
ssh "$SERVER" "cat > /tmp/gito_mirror.dump" < "$HOST_DUMP"
ssh "$SERVER" "docker cp /tmp/gito_mirror.dump $STAGING_PG:/tmp/restore.dump"
# Terminate stragglers, then drop/recreate. The 'gito' role must exist BEFORE
# the restore: TimescaleDB's bgw_job catalog stores the owning role name as a
# literal column value, and the COPY fails outright if that role is missing.
ssh "$SERVER" "
  docker exec $STAGING_PG psql -U $STAGING_USER -d postgres -c \
    \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$STAGING_DB' AND pid<>pg_backend_pid();\" >/dev/null && \
  docker exec $STAGING_PG psql -U $STAGING_USER -d postgres -c \"DROP DATABASE IF EXISTS $STAGING_DB;\" && \
  docker exec $STAGING_PG psql -U $STAGING_USER -d postgres -c \"CREATE DATABASE $STAGING_DB;\" && \
  docker exec $STAGING_PG psql -U $STAGING_USER -d $STAGING_DB -c 'CREATE EXTENSION IF NOT EXISTS timescaledb;' >/dev/null && \
  docker exec $STAGING_PG psql -U $STAGING_USER -d $STAGING_DB -c \
    \"DO \\\$\\\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='gito') THEN CREATE ROLE gito LOGIN; END IF; END \\\$\\\$;\"
" 2>&1 | grep -vE '^\s*$' | tail -4

echo "==> [6/7] Restore (timescaledb pre/post_restore)"
# pg_restore exits non-zero on any ignored error, so don't let set -e trip on
# it — the row-count check below is the real verdict.
ssh "$SERVER" "
  docker exec $STAGING_PG psql -U $STAGING_USER -d $STAGING_DB -c 'SELECT timescaledb_pre_restore();' >/dev/null && \
  docker exec $STAGING_PG pg_restore -U $STAGING_USER -d $STAGING_DB --no-owner --no-privileges /tmp/restore.dump || true; \
  docker exec $STAGING_PG psql -U $STAGING_USER -d $STAGING_DB -c 'SELECT timescaledb_post_restore();' >/dev/null
" 2>&1 | grep -E 'error|ERROR' || echo "    restored with no errors"

echo "==> [7/7] Start app services + verify"
ssh "$SERVER" "cd $REPO && $COMPOSE up -d" >/dev/null 2>&1
sleep 20

COUNTS_SQL="SELECT 'tenants',count(*) FROM tenants UNION ALL SELECT 'users',count(*) FROM users \
UNION ALL SELECT 'devices',count(*) FROM devices UNION ALL SELECT 'device_types',count(*) FROM device_types \
UNION ALL SELECT 'dashboards',count(*) FROM dashboards UNION ALL SELECT 'telemetry',count(*) FROM telemetry ORDER BY 1;"

echo ""
echo "    local:"
d exec "$LOCAL_PG" psql -U "$LOCAL_USER" -d "$LOCAL_DB" -t -A -F'|' -c "$COUNTS_SQL" | sed 's/^/      /'
echo "    server:"
ssh "$SERVER" "docker exec $STAGING_PG psql -U $STAGING_USER -d $STAGING_DB -t -A -F'|' -c \"$COUNTS_SQL\"" | sed 's/^/      /'
echo ""
echo -n "    health: "
ssh "$SERVER" "curl -s http://localhost:8090/api/health"
echo ""

# Cleanup
rm -f "$HOST_DUMP"
ssh "$SERVER" "rm -f /tmp/gito_mirror.dump; docker exec $STAGING_PG rm -f /tmp/restore.dump" || true

echo ""
echo "==> Done — server is a duplicate of local (https://dev-iot.gito.co.za)."
echo "    Telemetry may differ by a few rows if local ingested during the dump."

#!/bin/sh
# Levanta docker-compose.test.yml, corre la integración y SIEMPRE baja con `down -v`:
# si falla `up --wait`, si falla la suite o con Ctrl-C (INT/TERM). Respeta el exit code.
set -u
compose() { docker compose -f ../../docker-compose.test.yml "$@"; }
bajar() { compose down -v >/dev/null 2>&1 || true; }
trap 'bajar; exit 130' INT
trap 'bajar; exit 143' TERM
compose up -d --wait || { s=$?; bajar; exit "$s"; }
TEST_DATABASE_URL=postgresql://test:test@127.0.0.1:55433/test REDIS_HOST=127.0.0.1 REDIS_PORT=56380 pnpm run test:integration
s=$?
bajar
exit "$s"

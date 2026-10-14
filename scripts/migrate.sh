#!/usr/bin/env bash
# Aplica migrations/*.sql en orden con el rol propietario. Cada archivo se registra en
# schema_migrations (la propia 0001 crea la tabla). Idempotente: omite las ya aplicadas.
# Uso: DATABASE_URL=postgres://nexo_owner:...@127.0.0.1:5432/nexoentrega scripts/migrate.sh
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL es obligatoria}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
has_table=$(psql "$DATABASE_URL" -X -At -c "select to_regclass('public.schema_migrations') is not null")
for f in "$ROOT"/migrations/*.sql; do
  v="$(basename "$f" .sql)"
  if [ "$has_table" = t ] && [ "$(psql "$DATABASE_URL" -X -At -c "select count(*) from schema_migrations where version='$v'")" != 0 ]; then
    echo "omitida $v (ya aplicada)"; continue
  fi
  psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -f "$f"
  # 0001 se registra a sí misma; las siguientes migraciones deben incluir su INSERT
  has_table=t
  echo "aplicada $v"
done

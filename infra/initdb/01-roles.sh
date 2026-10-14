#!/usr/bin/env bash
# Se ejecuta una sola vez al crear el volumen de PostgreSQL.
# Crea el rol de la aplicación con LOGIN. Sus permisos finos (sin UPDATE ni DELETE
# sobre audit_events) los concede migrations/0001_init.sql.
set -euo pipefail
: "${NEXO_APP_PASSWORD:?NEXO_APP_PASSWORD es obligatoria}"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$NEXO_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE nexo_app LOGIN PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nexo_app')
\gexec
SELECT format('ALTER ROLE nexo_app LOGIN PASSWORD %L', :'app_password')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO nexo_app', current_database())
\gexec
SQL

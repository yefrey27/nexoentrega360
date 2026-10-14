#!/usr/bin/env bash
# Carga el seed pequeño con el rol propietario. Reinicia los datos de demostración.
# Uso: DATABASE_URL=postgres://nexo_owner:...@127.0.0.1:5432/nexoentrega scripts/seed.sh [archivo.sql]
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL es obligatoria}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -q -f "${1:-$ROOT/seeds/seed_small.sql}"
echo "seed cargado: ${1:-seeds/seed_small.sql}"

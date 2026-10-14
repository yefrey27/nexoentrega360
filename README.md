# NexoEntrega 360

Aplicación web, API HTTP y base PostgreSQL para registrar solicitudes de kits comunitarios, reservar existencias, despachar, entregar y conservar auditoría. Un asistente de IA resume solicitudes pendientes, pero nunca decide ni mueve inventario. Proyecto del examen de Spec Driven Development con IA. Todos los datos son ficticios.

## Estado
Flujo completo implementado (RF01 a RF12) con pruebas contra base real. Quedan gaps declarados: ver `docs/risks.md` y la sección 9 de `docs/runbook.md`.

## Requisitos
Docker con Compose, Node >= 20 (CI usa 22), cliente `psql` y Python 3. Versiones y pasos completos en `docs/runbook.md`.

## Arranque
```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml --env-file .env up -d db
export DATABASE_URL=postgres://nexo_owner:cambie-esta-clave-local@127.0.0.1:5432/nexoentrega
scripts/migrate.sh
scripts/seed.sh
set -a; . ./.env; set +a
cd apps/api && npm ci && npm start
```
La API sirve la interfaz en http://127.0.0.1:3000/. Limitación: no existe aún un comando único de arranque.

## Pruebas
```bash
export OWNER_DATABASE_URL=postgres://nexo_owner:cambie-esta-clave-local@127.0.0.1:5432/nexoentrega
export DATABASE_URL=postgres://nexo_app:cambie-esta-clave-app-local@127.0.0.1:5432/nexoentrega
cd apps/api && npm test
python3 scripts/export_specs.py --check
python3 scripts/validate_contracts.py
```

## Cuentas de demostración (ficticias)
`org-{a|b}-{solicitante|coordinador|bodega|auditor}@example.test`, contraseña de demostración `Nexo-Demo-2026`. Se regeneran con `scripts/seed.sh`.

## Estructura
- `specs/`: cinco SPECS (fuente Markdown y spec.json generado)
- `docs/`: arquitectura, ADR, clarificaciones, runbook, riesgos, gate-reviews
- `contracts/`: OpenAPI y esquema de salida de IA
- `apps/api`, `apps/web`: API Node y interfaz estática
- `migrations/`, `seeds/`, `infra/`, `scripts/`
- `evidence/`: trazabilidad, pruebas y bitácora de IA

## Gaps conocidos
Sin comando único de arranque, sin carga k6 ni Playwright, sin lint/build en CI, revisión móvil y de teclado pendiente, salida real de LLM pendiente.

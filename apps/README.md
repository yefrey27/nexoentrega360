# Aplicación NexoEntrega 360 (versión mínima)

Monolito simple: `apps/api` (Node 20+, Express, `pg`) sirve la API y también la web estática de `apps/web` (HTML, CSS y JS sin framework). Una sola URL y un solo proceso.

## Arranque local

```bash
# 1) Base de datos: Compose (PostgreSQL 16.4) y migración + seed con el rol propietario
cp .env.example .env
docker compose -f infra/docker-compose.yml --env-file .env up -d db
DATABASE_URL=postgres://nexo_owner:<POSTGRES_PASSWORD>@127.0.0.1:5432/nexoentrega scripts/migrate.sh
DATABASE_URL=postgres://nexo_owner:<POSTGRES_PASSWORD>@127.0.0.1:5432/nexoentrega scripts/seed.sh

# 2) Aplicación (rol nexo_app, sin permiso de UPDATE ni DELETE sobre audit_events)
cd apps/api && npm ci
DATABASE_URL=postgres://nexo_app:<NEXO_APP_PASSWORD>@127.0.0.1:5432/nexoentrega npm start
# abrir http://localhost:3000
```

Cuentas de demostración (ficticias): `org-a-solicitante@example.test`, `org-a-coordinador@example.test`, `org-a-bodega@example.test`, `org-a-auditor@example.test` y las equivalentes `org-b-...`. Contraseña: `Nexo-Demo-2026`.

## Pruebas (contra PostgreSQL real; reinician el seed)

```bash
cd apps/api
DATABASE_URL=postgres://nexo_app:...@127.0.0.1:5432/nexoentrega \
OWNER_DATABASE_URL=postgres://nexo_owner:...@127.0.0.1:5432/nexoentrega npm test
```

## Asistente de IA

`AI_PROVIDER=none` (por defecto) devuelve siempre el resumen alternativo sin IA. `AI_PROVIDER=fixture` con `AI_FIXTURE=<id>` reproduce una salida de `tests/fixtures/ai/` por el mismo validador. No hay proveedor `live` todavía.

## Lo que NO incluye esta versión

Editar un borrador desde la interfaz (la API sí: `PUT /requests/{id}`), seed de carga y prueba k6, E2E con Playwright, CI, proveedor de IA real o reproducción de un LLM real, Dockerfile de la API, limpieza de claves de idempotencia vencidas.

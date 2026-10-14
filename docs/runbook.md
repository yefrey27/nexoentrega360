# Runbook · NexoEntrega 360

Estado: BORRADOR. Los comandos salen de los archivos del repositorio; el recorrido completo en un clon limpio aún NO se ha cronometrado (RNF04, PENDIENTE).

## 1. Requisitos
- Docker con Compose, Node >= 20 (CI usa 22), cliente `psql`, Python 3 para las comprobaciones de SPECS.
- PostgreSQL fijado en 16.4 (`infra/docker-compose.yml`). Dependencias de la API fijadas en `apps/api/package-lock.json`.

## 2. Configuración
```bash
cp .env.example .env
```
Todos los valores de `.env.example` son ficticios y solo para desarrollo local. `.env` está ignorado por git. No lo suba.

## 3. Arranque
```bash
docker compose -f infra/docker-compose.yml --env-file .env up -d db
# esperar a que db esté "healthy" (docker compose -f infra/docker-compose.yml ps)
export DATABASE_URL=postgres://nexo_owner:cambie-esta-clave-local@127.0.0.1:5432/nexoentrega
scripts/migrate.sh
scripts/seed.sh
set -a; . ./.env; set +a
cd apps/api && npm ci && npm start     # puerto 3000 (PORT)
```
- El rol `nexo_app` (sin UPDATE ni DELETE sobre `audit_events`) lo crea `infra/initdb/01-roles.sh` solo cuando el volumen está vacío.
- Interfaz web: la API sirve `apps/web/` con express.static (apps/api/src/app.js:26). Abrir http://127.0.0.1:3000/ tras `npm start`.
- Limitación conocida: no existe un comando único que levante base, API y web (sección 9).

## 4. Comprobaciones
```bash
export OWNER_DATABASE_URL=postgres://nexo_owner:cambie-esta-clave-local@127.0.0.1:5432/nexoentrega
export DATABASE_URL=postgres://nexo_app:cambie-esta-clave-app-local@127.0.0.1:5432/nexoentrega
cd apps/api && npm test
```
- SPECS: `python3 scripts/export_specs.py --check`
- Contratos: `python3 scripts/validate_contracts.py` (requiere openapi-spec-validator, jsonschema y pyyaml).
- Migración: `scripts/test_migration.sh`
- Health y readiness: PENDIENTE documentar rutas y verificarlas.

## 5. Datos de demostración
`scripts/seed.sh` carga `seeds/seed_small.sql` y reinicia los datos de demostración. Cuentas: `org-{a|b}-{solicitante|coordinador|bodega|auditor}@example.test`. Las contraseñas ficticias están en el seed; para regenerar, volver a ejecutar `scripts/seed.sh`.

## 6. Fallo del proveedor de IA
El producto sigue funcionando. Con `AI_PROVIDER=none` (por defecto) el coordinador recibe un resumen determinista alternativo. Salida inválida, timeout (`AI_TIMEOUT_MS=5000`) o error del proveedor devuelven el mismo resumen alternativo; inventario y estados no cambian. Probado con los fixtures AI-VALID, AI-JSON-BAD, AI-EXTRA, AI-FOREIGN-ID, AI-INJECTION, AI-TIMEOUT, AI-ERROR y AI-DUPLICATE-ID. Para forzar uno: `AI_PROVIDER=fixture AI_FIXTURE=<id>`.

## 7. Reversión
- Aplicación: volver al tag anterior (`git checkout baseline-v1`) y reiniciar la API.
- Esquema: `scripts/migrate.sh` solo aplica migraciones hacia adelante. PENDIENTE confirmar si hay migraciones inversas. No se promete revertir datos sin copia de seguridad; copia probada: PENDIENTE.
- Compatibilidad entre versión previa y esquema migrado: PENDIENTE de verificar.

## 8. Problemas conocidos
- `01-roles.sh` solo corre con volumen vacío; si falla la conexión de `nexo_app`, ejecutar `docker compose -f infra/docker-compose.yml down -v` y volver a arrancar (borra los datos locales).
- `npm audit` reporta 2 vulnerabilidades altas en express 4.21.2; el check es `continue-on-error` y queda visible en el PR.

## 9. Gaps declarados
- Sin comando único de arranque ni de verificación (RNF04).
- Sin lint, build ni comprobación de tipos en CI.
- Carga RNF03 (seed de 2.000 solicitudes y k6): no ejecutada.
- E2E con Playwright: no implementado.
- Revisión manual a 390 y 1366 px y con teclado: no realizada (RNF05).
- Salida real de un LLM reproducida: pendiente (RF11, RF12).

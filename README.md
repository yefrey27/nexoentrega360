# NexoEntrega 360

[![CI](https://github.com/yefrey27/nexoentrega360/actions/workflows/ci.yml/badge.svg)](https://github.com/yefrey27/nexoentrega360/actions)

Aplicación web, API HTTP y base PostgreSQL para que organizaciones comunitarias registren solicitudes de kits, reserven existencias sin sobrerreservar, despachen, entreguen y conserven una auditoría inmutable.

Un asistente de IA resume solicitudes pendientes, pero **nunca decide ni mueve inventario**.

> Proyecto del examen de Spec Driven Development (SDD) con IA. Todos los datos son ficticios.

## Versión entregada

| Elemento | Valor |
|---|---|
| Versión final | tag `release-examen` · commit `d013621` (`d01362125f34a3d20f2acd317e2fc184c9d8d654`) |
| Línea base funcional | tag `baseline-v1` (flujo completo, 6/6 pruebas) |
| Integración continua | CI #22 en verde (PR #18, rama `docs/cierre-g3-g4`, 45 s); corrida 18 en verde sobre `main`, commit `3337c9e` |
| Pruebas | 79 pruebas de integración contra base real: 79 pasan, 0 fallan (local, PostgreSQL 18.6) |
| Pila | Node.js + Express (módulos ES), PostgreSQL 16.4, SQL versionado, interfaz HTML/JS/CSS estática, Docker Compose, GitHub Actions |

## Estado frente a los requisitos

Flujo completo implementado (RF01 a RF12). De 18 requisitos: **8 Cumple, 9 Parcial, 1 No cumple**.

| Resultado | Requisitos |
|---|---|
| Cumple | RF02, RF03, RF04, RF06, RF08, RF11, RNF01, RNF02 |
| Parcial | RF01, RF05, RF07, RF09, RF10, RF12, RNF04, RNF05, RNF06 |
| No cumple | RNF03 (carga) |

Los estados se declaran según la evidencia del repositorio. Lo que no está demostrado figura como brecha abierta (ver [Brechas conocidas](#brechas-conocidas)).

## Qué hace

Flujo de una solicitud:

```
BORRADOR → ENVIADA → RESERVADA → DESPACHADA → ENTREGADA
                 ╰── cancelación desde ENVIADA o RESERVADA
```

- **Reserva todo-o-nada** con cabecera `Idempotency-Key`; la reserva concurrente se resuelve con orden de bloqueo fijo (ADR-0002).
- **Aislamiento por organización:** la organización y el rol salen de la sesión, nunca del navegador. Un recurso ajeno responde 404.
- **Auditoría append-only** de cada transición.
- **Roles:** solicitante, coordinador, bodega y auditor (el auditor solo consulta).
- **Asistente de IA** con validación de la salida contra esquema y resumen determinista de respaldo si hay salida inválida, timeout o error. Por defecto `AI_PROVIDER=none`.
- Listados, tablero de operación y endpoints `/health` y `/ready`.

## Requisitos previos

Docker con Compose, Node >= 20 (CI usa 22), cliente `psql` y Python 3. Versiones y pasos completos en [`docs/runbook.md`](https://github.com/yefrey27/nexoentrega360/blob/main/docs/runbook.md).

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

La API sirve la interfaz en <http://127.0.0.1:3000/>. Comprobaciones: `GET /health` (proceso vivo) y `GET /ready` (base disponible).

> **Limitación:** no existe aún un comando único de arranque. Medido sin Docker, desde el clon hasta `/ready` tomó 20 s (umbral 900 s); el Compose no se ha ejecutado de punta a punta.

## Cuentas de demostración (ficticias)

`org-{a|b}-{solicitante|coordinador|bodega|auditor}@example.test`, contraseña `Nexo-Demo-2026`. Se regeneran con `scripts/seed.sh`.

## Pruebas y verificación

```bash
export OWNER_DATABASE_URL=postgres://nexo_owner:cambie-esta-clave-local@127.0.0.1:5432/nexoentrega
export DATABASE_URL=postgres://nexo_app:cambie-esta-clave-app-local@127.0.0.1:5432/nexoentrega
cd apps/api && npm test
python3 scripts/export_specs.py --check
python3 scripts/validate_contracts.py
```

### Integración continua

El flujo `.github/workflows/ci.yml` corre en pull requests y en push a `main` con cuatro trabajos:

1. **SPECS y contratos:** `export_specs.py --check`, validación de OpenAPI y del esquema de IA.
2. **API con PostgreSQL 16.4 real:** instalación, sintaxis, roles, migración, seed y `npm test`; los resultados se guardan como artefacto.
3. **Revisión de dependencias:** `npm audit` (no bloqueante por el hallazgo abierto de express 4.21.2).
4. **Detección de secretos:** gitleaks con historial completo (CI #22: *No leaks detected*).

### Verificaciones manuales

- **RNF04 (arranque en clon limpio):** `evidence/tests/RNF04-clon-limpio-sin-docker.txt`.
- **RNF05 (interfaz móvil, 393 px):** `evidence/RNF05-verificacion.md` y 7 capturas en `evidence/RNF05/` (formulario y listado, foco visible con teclado, sin desplazamiento horizontal). Viven en la rama `evidence/rnf-verificaciones` (commits `edb07a9` y `b930e91`) hasta que se fusione en `main`.

## Metodología SDD

Flujo seguido: constitución y aclaraciones → cinco SPEC con criterios de aceptación → arquitectura, ADR y contratos → tareas → implementación con pruebas → trazabilidad, riesgos, aceptación y gates.

- 5 SPEC con 99 criterios de aceptación en formato dado/cuando/entonces (`specs/`).
- 4 ADR en `docs/adr/`.
- Trazabilidad requisito → historia → SPEC → código → prueba en `evidence/traceability.csv`.
- Bitácora de IA con decisiones y verificaciones humanas en `evidence/ai-log/`.

## Estructura

- `specs/`: cinco SPEC (fuente Markdown y `spec.json` generado)
- `docs/`: arquitectura, ADR, clarificaciones, runbook, riesgos, gate-reviews
- `contracts/`: OpenAPI y esquema de salida de IA
- `apps/api`, `apps/web`: API Node y interfaz estática
- `migrations/`, `seeds/`, `infra/`, `scripts/`
- `evidence/`: trazabilidad, pruebas y bitácora de IA

## Brechas conocidas

| Brecha | Detalle | Referencia |
|---|---|---|
| Comando único de arranque | No existe; Compose sin ejecutar completo | RNF04 |
| Prueba de carga | Sin `seeds/seed_load.sql` ni medición con k6 (2.000 solicitudes, 20 usuarios, p95 ≤ 700 ms) | RNF03, T-05/T-26 |
| Pruebas E2E de interfaz | `tests/e2e/` solo contiene `.gitkeep`; Playwright no se ejecutó | T-24 |
| Revisión móvil y de teclado | Parcial: solo 393 px; faltan 390 px, 1366 px, tablero, detalle y recorrido completo con teclado | RNF05 |
| Salida real de un LLM | Se usan fixtures deterministas; el timeout de 5 s se probó con 300 ms | T-21 |
| Lint y build en CI | No existen | — |
| Dependencias | `npm audit`: 2 vulnerabilidades altas en express 4.21.2 (paso no bloqueante) | R-riesgos |
| PostgreSQL local | Las pruebas locales usaron 18.6; CI sí usa 16.4 | — |
| Revisión independiente | G3 y G4 los firmó el mismo autor; G1 y G2 sin decisión registrada | R-11 |

Detalle y riesgos en [`docs/risks.md`](https://github.com/yefrey27/nexoentrega360/blob/main/docs/risks.md) y en la sección 9 de [`docs/runbook.md`](https://github.com/yefrey27/nexoentrega360/blob/main/docs/runbook.md).

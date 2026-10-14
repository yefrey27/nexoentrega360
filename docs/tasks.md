# Plan de tareas

Versión 0.1.0 · Autor: Yefrey (con asistencia de IA) · Revisor: PENDIENTE (persona distinta al autor) · Fecha UTC: PENDIENTE

Cada tarea indica resultado, archivos o módulos previstos, requisito y criterio cubiertos, prueba, dependencia, responsable y condición de término. Las tareas del mismo bloque que no dependen una de otra pueden hacerse en paralelo; ninguna depende de un contrato ambiguo porque `contracts/openapi.yaml` y las SPECS fijan los límites. Responsable: Yefrey en todas, bajo la excepción de trabajo individual (confirmación de la docente: PENDIENTE de documentar). Estado: `hecha` solo cuando existe evidencia en el repositorio; `pendiente` en otro caso.

## Bloque A. Documentación y especificación (G1, G2)

| ID | Resultado | Archivos o módulos | Requisito y AC | Prueba | Depende de | Término | Estado |
|----|-----------|--------------------|----------------|--------|------------|---------|--------|
| T-A1 | Constitution con reglas comprobables | specs/constitution.md | C-01 a C-18 | revisión humana | ninguna | revisada por otra persona | borrador hecho, revisión pendiente |
| T-A2 | Registro de aclaraciones Q-01 a Q-14 | docs/clarifications.md | RF03, RF07, RF09, RF12 | revisión humana | ninguna | enviadas a la docente con fecha UTC | borrador hecho, envío pendiente |
| T-A3 | Cinco SPECS con JSON y spec.json exportado | specs/00x/spec.md y spec.json | RF01 a RF12, RNF01 a RNF06 | `python3 scripts/export_specs.py --check` | T-A2 | check en verde y revisión humana | borrador hecho, revisión pendiente |
| T-A4 | Cuatro ADR | docs/adr/ | RNF01, RNF02 | revisión humana | T-A3 | autor y revisor registrados | borrador hecho, revisión pendiente |
| T-A5 | Arquitectura y diagramas | docs/architecture.md | todos | revisión humana; comparación con código en G4 | T-A4 | diagramas coinciden con el código | borrador hecho |
| T-A6 | Contrato OpenAPI y esquema de IA | contracts/ | RF01 a RF12 | validación del documento; prueba de contrato en CI | T-A3 | CI verifica que la API cumple el contrato | borrador hecho, prueba de contrato pendiente |
| T-A7 | Gate-reviews G1 y G2 | docs/gate-reviews/ | C-12, C-13 | revisión humana | T-A1 a T-A6 | decisión y firmas de autor y revisor | plantillas hechas, decisión pendiente |

## Bloque B. Datos e infraestructura

| ID | Resultado | Archivos o módulos | Requisito y AC | Prueba | Depende de | Término | Estado |
|----|-----------|--------------------|----------------|--------|------------|---------|--------|
| T-01 | Migración inicial con restricciones, disparadores y REVOKE ejecutado | migrations/0001_init.sql | RF05, RF06, RF09, RNF02; AC-RF05-05, AC-RF09-04 | `scripts/test_migration.sh` contra PostgreSQL 16 | T-A4 | evidencia en evidence/tests/T-01-migracion.txt con 0 fallos | hecha (PostgreSQL 16.15 local) |
| T-02 | Compose con PostgreSQL 16.4 y .env.example | infra/docker-compose.yml, infra/initdb/, .env.example | RNF04 | `docker compose config` y arranque real | T-01 | `docker compose up -d db` queda sano | configuración hecha, arranque real pendiente (sin daemon aquí) |
| T-03 | Ejecutor de migraciones idempotente | scripts/migrate.sh | RNF04 | doble ejecución sin error | T-01 | segunda corrida omite lo aplicado | hecha |
| T-04 | Seed pequeño: 2 organizaciones, 4 roles por organización, SKU, inventario y datos de oráculos A-001 y A-002 | seeds/seed_small.sql, scripts/seed.sh | RF02, RNF02 | consulta de conteos y contraste con el anexo oficial de datos | T-01 | datos del anexo cargados | pendiente |
| T-05 | Seed de carga con 2.000 solicitudes | seeds/seed_load.sql | RNF03 | conteo igual a 2000 | T-04 | reproducible con un comando | pendiente |

## Bloque C. Base técnica

| ID | Resultado | Archivos o módulos | Requisito y AC | Prueba | Depende de | Término | Estado |
|----|-----------|--------------------|----------------|--------|------------|---------|--------|
| T-06 | Stack fijado con lockfiles (TypeScript, Node, React, PostgreSQL) | apps/api, apps/web, package-lock.json | RNF04 | instalación limpia con `npm ci` | T-A4 | lockfiles versionados | pendiente |
| T-07 | Esqueleto de API con health y ready | apps/api/src | RNF06; AC-RNF06-02 | prueba de integración con base detenida | T-06, T-02 | health 200 y ready 503 sin base | pendiente |
| T-08 | Logs estructurados con correlationId sin secretos | apps/api/src/logging | RNF06; AC-RNF06-05 | prueba que inspecciona logs | T-07 | ningún secreto en logs | pendiente |

## Bloque D. Aplicación

| ID | Resultado | Archivos o módulos | Requisito y AC | Prueba | Depende de | Término | Estado |
|----|-----------|--------------------|----------------|--------|------------|---------|--------|
| T-09 | Login, logout, sesiones y middleware 401, 403, 404 | módulo identidad | RF01, RF02; AC-RF01-01 a 06 | API con base real | T-07, T-04 | AC del bloque pasan | pendiente |
| T-10 | Crear, editar y enviar solicitudes | módulo solicitudes | RF03, RF04; AC-RF03-01 a 11, AC-RF04-01 a 05 | dominio y API con base real | T-09 | AC pasan | pendiente |
| T-11 | Reserva transaccional con Idempotency-Key | módulo inventario | RF05, RF07, RNF02; AC-RF05, AC-RF07, AC-RNF02 | API con base real y concurrencia | T-10 | A-001 contra A-002 da 10/7/3 | pendiente |
| T-12 | Cancelar, despachar y entregar | módulo inventario | RF04, RF06; AC-RF06, AC-RF04-06 a 08 | API con base real | T-11 | AC pasan | pendiente |
| T-13 | Auditoría append-only | módulo auditoría | RF09; AC-RF09-01 a 07 | API y SQL con rol nexo_app | T-11 | no hay edición ni borrado | pendiente |
| T-14 | Listados paginados, filtros y tablero | módulo consultas | RF08; AC-RF08-01 a 07 | API con base real y SQL independiente | T-10 | AC pasan | pendiente |
| T-15 | Interfaz web del recorrido completo a 390 y 1366 px | apps/web | RNF05; AC-RNF05-01, AC-RNF05-02 | E2E y revisión manual | T-10 a T-14 | sin desbordamiento horizontal; operable con teclado | pendiente |
| T-16 | Tag baseline-v1 (caso feliz y de rechazo) | repositorio | RF04 | pruebas del flujo | T-09 a T-13 | tag y estado de pruebas conservados | pendiente |

## Bloque E. Asistente de IA

| ID | Resultado | Archivos o módulos | Requisito y AC | Prueba | Depende de | Término | Estado |
|----|-----------|--------------------|----------------|--------|------------|---------|--------|
| T-17 | Interfaz de proveedor intercambiable y fixtures | módulo asistente, tests/fixtures/ai | RF10, RF12 | pruebas con fixtures | T-09 | provider fixture y none funcionan | hecha, evidencia: evidence/tests/t14-t23-run.txt, evidence/tests/ia-fixtures-20261014T064243Z.txt |
| T-18 | Validador de salida y resumen determinista | módulo asistente | RF11, RF12; AC-RF11-01 a 06 | pruebas de IA | T-17, T-A6 | salida inválida produce fallback | hecha, evidencia: evidence/tests/t14-t23-run.txt, evidence/tests/ia-fixtures-20261014T064243Z.txt |
| T-19 | Timeout de 5 s y manejo de fallo | módulo asistente | RF12; AC-RF12-01, 02 | pruebas de timeout y error | T-18 | fallback en menos de 6 s | hecha, evidencia: evidence/tests/t14-t23-run.txt, evidence/tests/ia-fixtures-20261014T064243Z.txt |
| T-20 | Aprobación solo del coordinador con auditoría | módulos asistente y auditoría | RF12, RF09; AC-RF12-05, 06 | API con base real | T-18, T-13 | evento de aprobación | hecha, evidencia: evidence/tests/t14-t23-run.txt, evidence/tests/ia-fixtures-20261014T064243Z.txt |
| T-21 | Una salida de LLM real o reproducción declarada | evidence/ai-log, tests/fixtures/ai/replay | RF12; AC-RF12-07 | prueba por el mismo adaptador | T-18 | origen declarado | pendiente |
| T-22 | Pruebas de inyección en observaciones | tests | RF11; AC-RF11-07 | prueba de IA | T-18 | sin cambios de estado | hecha, evidencia: evidence/tests/t14-t23-run.txt, evidence/tests/ia-fixtures-20261014T064243Z.txt |

## Bloque F. Pruebas, CI y entrega

| ID | Resultado | Archivos o módulos | Requisito y AC | Prueba | Depende de | Término | Estado |
|----|-----------|--------------------|----------------|--------|------------|---------|--------|
| T-23 | Pruebas de seguridad (401, 403, 404 cruzado, dos lecturas y dos escrituras denegadas) | tests/integration | RNF01; AC-RNF01-01 a 04 | API con base real | T-09 | resultados en evidence/tests | pendiente |
| T-24 | E2E con Playwright | tests/e2e | flujo completo | Playwright | T-15 | crear, enviar, reservar, despachar, entregar y cancelar | pendiente |
| T-25 | CI completo y workflow db.yml | .github/workflows | C-11, C-12, C-14 | ejecución en PR | T-06 | lint, tipos, pruebas, contrato, build, dependencias y secretos en verde | pendiente |
| T-26 | Carga con k6 | tests/load | RNF03; AC-RNF03-01 | k6 con 20 usuarios, 60 s, 5 s de calentamiento | T-05, T-14 | p95 menor o igual a 700 ms y errores menores a 1% | pendiente |
| T-27 | Revisión manual de móvil y teclado | evidence/tests | RNF05 | lista manual | T-15 | lista firmada | pendiente |
| T-28 | Bitácora de IA con al menos 6 intervenciones | evidence/ai-log | C-18 | revisión humana | continua | 6 intervenciones con decisión y verificación | pendiente |
| T-29 | Runbook | docs/runbook.md | RNF04, RNF06 | ejecución de los pasos en clon limpio | T-25 | arranque, comprobaciones, fallo de IA, rollback y problemas conocidos | pendiente |
| T-30 | Registro de riesgos con controles probados | docs/risks.md | todos | revisión humana | T-23 a T-26 | controles con evidencia | pendiente |
| T-31 | Matriz SPEC contra código y trazabilidad completa | evidence/traceability.csv, evidence/acceptance.md | C-15 | revisión de convergencia | T-23 a T-26 | Cumple, Parcial o No cumple con SHA final | pendiente |
| T-32 | Gate-reviews G3 y G4 | docs/gate-reviews | C-12 | revisión humana | T-31 | decisiones firmadas | pendiente |
| T-33 | Tag release-examen y PDF final | repositorio, PDF | entregables | revisión final | T-32 | PDF Examen_SDD_IA_Equipo_[nombre].pdf con URL y SHA final | pendiente |

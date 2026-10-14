# G2 · Plan y contrato

| Campo | Valor |
|-------|-------|
| Hito | G2 plan y contrato (día 2) |
| Artefactos | docs/architecture.md, docs/adr/ADR-0001 a ADR-0004, docs/tasks.md, contracts/openapi.yaml, contracts/ai-output.schema.json, migrations/0001_init.sql, infra/docker-compose.yml, .env.example |
| Versión de los artefactos | 0.1.0 |
| Commit revisado | PENDIENTE (completar con el SHA del commit que se aprueba) |
| Fecha UTC de la revisión | PENDIENTE |
| Autor | Yefrey (con asistencia de IA; ver evidence/ai-log/) |
| Revisor (persona distinta al autor) | PENDIENTE |
| Pull request | PENDIENTE (rama g2-plan) |

Esta hoja la completa una persona. "Verificado" significa que lo comprobó una máquina y se repite con el comando indicado.

## Lista de G2

| # | Comprobación | Resultado | Cómo se comprobó |
|---|--------------|-----------|------------------|
| 1 | Hay cuatro ADR con alternativas, restricciones, consecuencias y pruebas | Revisión humana | docs/adr/ |
| 2 | Cada ADR y architecture.md tienen autor y revisor registrados | **Pendiente** (revisor sin completar) | encabezado de cada archivo |
| 3 | Hay diagramas de contexto, contenedores, datos, estados y dos secuencias | Verificado | docs/architecture.md secciones 1 a 6 |
| 4 | Se identifican las fronteras de confianza | Verificado | docs/architecture.md sección 7 |
| 5 | La secuencia de reserva de architecture.md coincide con el ADR-0002 | Revisión humana | comparar sección 5 con los pasos 1 a 8 del ADR-0002 |
| 6 | El OpenAPI 3.1.1 es un documento válido | Verificado | validación con openapi-spec-validator: válido, 16 rutas |
| 7 | El esquema de salida de IA acepta una salida válida y rechaza campo extra, 4 claves de evidencia y resumen de 601 caracteres | Verificado | validación con jsonschema |
| 8 | La API cumple el contrato | **No aplica todavía** | no existe API; la prueba de contrato es T-A6 y debe correr en CI |
| 9 | La migración se aplica a una base limpia y las restricciones se comprueban | Verificado | `scripts/test_migration.sh`: 48 aprobadas, 0 fallidas, en evidence/tests/T-01-migracion.txt |
| 10 | Las pruebas de la migración detectan fallos | Verificado | mutación: sin REVOKE y sin CHECK de reservada menor o igual a física, 4 pruebas fallaron |
| 11 | El REVOKE del rol de la aplicación se ejecuta y se prueba | Verificado | nexo_app recibe permission denied en UPDATE, DELETE y TRUNCATE sobre audit_events |
| 12 | Compose levanta PostgreSQL 16.4 sano | **Pendiente** | solo se validó la sintaxis con `docker compose config`; no hay daemon de Docker en el entorno de redacción |
| 13 | El plan de tareas tiene resultado, archivos, requisito, prueba, dependencia, responsable y término | Revisión humana | docs/tasks.md |
| 14 | Las tareas incluyen migración, pruebas, integración, revisión y documentación | Revisión humana | docs/tasks.md bloques A a F |
| 15 | Diagramas y contrato se actualizarán si el código difiere | Revisión humana | regla en architecture.md y en la revisión de convergencia |

## Hallazgos

| ID | Hallazgo | Impacto | Acción propuesta | Estado |
|----|----------|---------|------------------|--------|
| H2-01 | La migración se probó en PostgreSQL 16.15, no en la imagen 16.4 fijada en Compose | Diferencia menor de parche; no se probó la imagen | Repetir `scripts/test_migration.sh` contra el contenedor 16.4 y guardar su salida | Abierto |
| H2-02 | `docker-compose.yml` no se arrancó | RNF04 sin evidencia de arranque | Ejecutar `docker compose -f infra/docker-compose.yml --env-file .env up -d db` y verificar que queda sano; anotar tiempo | Abierto |
| H2-03 | El script `infra/initdb/01-roles.sh` se probó contra un clúster local, no dentro del contenedor | El entorno de ejecución de la imagen oficial puede variar | Verificar al arrancar Compose que existe el rol nexo_app con LOGIN | Abierto |
| H2-04 | No existe prueba de contrato (API contra OpenAPI) porque no hay API | Contrato sin verificación automática | Implementarla en T-25 | Abierto |
| H2-05 | Los datos del oráculo se contrastarán con el anexo oficial en T-04 (ver H1-02) | Posible cambio de números | Contrastar | Cerrado por el autor: ver H1-02 (sin diferencias); falta contrastar el seed real al implementar T-04 |
| H2-06 | Los ADR están en estado propuesto hasta que exista revisor y fecha | G2 no se puede cerrar | Ver excepción de trabajo individual en G1 | Abierto |
| H2-07 | La limpieza de claves de idempotencia vencidas está descrita pero no implementada | La tabla crece | Añadir tarea de mantenimiento y documentarla en el runbook | Abierto |

## Decisión

- [ ] Aprobado
- [ ] Aprobado con condiciones (listarlas)
- [ ] Rechazado

Condiciones o comentarios: PENDIENTE

Firma del revisor (nombre y fecha UTC): PENDIENTE

## Evidencia

- `python3 scripts/export_specs.py --check`
- `PGHOST=... PGUSER=... scripts/test_migration.sh evidence/tests/T-01-migracion.txt`
- `docker compose -f infra/docker-compose.yml --env-file .env.example config`
- Validación de contracts/openapi.yaml y contracts/ai-output.schema.json (ver evidence/tests/T-A6-contratos.txt)
- Bitácora de IA: evidence/ai-log/AI-001.md

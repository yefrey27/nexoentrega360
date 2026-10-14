# Riesgos · NexoEntrega 360

Estado al 2026-10-14. Las pruebas locales corrieron con PostgreSQL 18.6 portable; la versión fijada (16.4) la valida el CI, cuyo resultado sobre esta rama aún NO está verificado.

| ID | Riesgo | Prob. | Impacto | Control | Evidencia | Estado |
|----|--------|-------|---------|---------|-----------|--------|
| R-01 | Doble reserva por concurrencia | Media | Alto | Reserva transaccional; prueba A-001 vs A-002 en paralelo | apps/api/test/flow.test.js | Probado (PG 18.6 local) |
| R-02 | Replay de idempotencia entre usuarios | Baja | Alto | Clave almacenada con org_id, user_id, operation y key; Q-15 | apps/api/test/idempotency.test.js, PR #12 | Probado (PG 18.6 local); mutación detectada por 2 pruebas |
| R-03 | Acceso entre organizaciones | Media | Alto | 404 cruzado y 403 por rol | flow.test.js, draft.test.js | Parcial: T-23 abierta (otro solicitante de la misma organización sobre el PUT) |
| R-04 | Fallo o salida inválida del proveedor de IA | Alta | Medio | Resumen alternativo; 8 fixtures; AI_PROVIDER=none por defecto | evidence/tests/ia-fixtures-*.txt | Probado; salida de un LLM real pendiente |
| R-05 | Servicio no distingue vivo de listo | Baja | Medio | /health y /ready diferenciados | evidence/tests/health-ready-*.txt | Probado: 200 con base arriba, 503 con base caída, recuperación sin reiniciar |
| R-06 | Arranque no reproducible en 15 min | Alta | Alto | Compose con PostgreSQL 16.4; sin comando único de arranque ni de verificación | docs/runbook.md | GAP ABIERTO (RNF04). El Compose no se ha ejecutado en la máquina de desarrollo |
| R-07 | Versión de BD local distinta de la fijada | Media | Medio | CI con PostgreSQL 16.4 | .github/workflows/ci.yml | Mitigado: CI en verde con PostgreSQL 16.4 (ci.yml línea 32), corrida CI 18 sobre main, commit 3337c9e (https://github.com/yefrey27/nexoentrega360/actions); pruebas locales 79/79 (evidence/tests/t14-t23-run.txt) |
| R-08 | Rendimiento sin medir (RNF03) | Media | Medio | Ninguno todavía | — | GAP ABIERTO: sin seed de 2.000 solicitudes ni k6 |
| R-09 | Dependencias vulnerables (express 4.21.2) | Media | Medio | npm audit visible, continue-on-error | ci.yml | ABIERTO: 2 vulnerabilidades altas sin actualizar |
| R-10 | Interfaz sin revisar en móvil ni teclado (RNF05) | Media | Medio | Ninguno todavía | — | GAP ABIERTO |
| R-11 | Revisión humana insuficiente en PRs | Alta | Alto | PRs con checklist y evidencia | PR #7 a #12 | GAP ABIERTO: reseña de otra persona no confirmada |
| R-12 | Consultas, paginación y tablero sin pruebas (RF08) | Media | Alto | Ninguno todavía | evidence/traceability.csv | GAP ABIERTO (T-14) |
| R-13 | Bitácora de IA incompleta | Alta | Medio | Registros AI-001 a AI-006 | evidence/ai-log/ | GAP ABIERTO: ninguno completo |

## Cómo se actualiza
Cada riesgo cambia de estado solo con evidencia enlazada (prueba, commit o log). Un gap no se marca cerrado sin ejecutar su prueba.

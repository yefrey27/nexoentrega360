# SPEC versus código

Pruebas locales: 79/79 (evidence/tests/t14-t23-run.txt, commit base 4dc500e).
CI: corrida CI 18 en verde sobre main, commit 3337c9e. Commit final de entrega: <SHA_FINAL>.
Resultado propuesto por requisito; el detalle por AC se completa en la sección siguiente.

| Req | SPEC | AC | Test | Resultado | Justificación |
|-----|------|----|------|-----------|---------------|
| RF01 | 001 v0.1.0 | AC-RF01-01 a 06 | security.test.js (401); flow.test.js | Parcial | Login y 401 probados; logout y hash sin prueba propia |
| RF02 | 001 v0.1.0 | AC-RF02-01 a 06 | security.test.js (lecturas y escrituras cruzadas, listados, auditoría) | Cumple | 404 entre organizaciones en cancel, dispatch, deliver, tablero y auditoría |
| RF03 | 002 v0.1.0 | AC-RF03-01 a 11 | domain.test.js (cantidad 0, negativa, decimal, 501, SKU repetido, 11 líneas, fechas, observaciones) | Cumple | Cada caso responde 422 y no crea nada |
| RF04 | 002 y 003 v0.1.0 | AC-RF04-01 a 08 | domain.test.js (transiciones denegadas por estado); draft.test.js | Cumple | 409 sin cambios desde cada estado |
| RF05 | 003 v0.1.0 | AC-RF05-01 a 05 | flow.test.js (A-001 contra A-002) | Parcial | Un solo escenario de concurrencia; confirmar rechazo multi-línea sin efectos parciales |
| RF06 | 003 v0.1.0 | AC-RF06-01 a 05 | domain.test.js (reserva, despacho, entrega, cancelación) | Cumple | Cantidades de inventario verificadas |
| RF07 | 003 v0.1.0 | AC-RF07-01 a 07 | idempotencia-20261014T075238Z.txt; flow.test.js | Parcial | Misma clave, contenido distinto, otro usuario, sin clave: probados. Retención 24 h y política de errores almacenados sin prueba |
| RF08 | 004 v0.1.0 | AC-RF08-01 a 07 | queries.test.js | Cumple | Paginación, filtros, tablero y límites. UI sin prueba automática |
| RF09 | 004 v0.1.0 | AC-RF09-01 a 07 | flow.test.js; security.test.js (auditoría) | Parcial | Falta prueba de que la API no edita ni borra el historial |
| RF10 | 005 v0.1.1 | AC-RF10-01 a 05 | ai.test.js | Parcial | ID de otra organización responde 404; falta verificar campos enviados al adaptador |
| RF11 | 005 v0.1.1 | AC-RF11-01 a 07 | ai.test.js (8 fixtures, inyección) | Cumple | Válido, JSON inválido, extra, ID ajeno, duplicado, inyección |
| RF12 | 005 v0.1.1 | AC-RF12-01 a 07 | ai.test.js; flow.test.js | Parcial | Timeout probado con 300 ms, no 5000; sin salida de LLM real (T-21) |
| RNF01 | 001, 005 | AC-RNF01-01 a 05 | security.test.js | Cumple | Más de 2 lecturas y 2 escrituras cruzadas denegadas |
| RNF02 | 003 v0.1.0 | AC-RNF02-01 a 04 | flow.test.js (concurrencia); scripts/test_migration.sh | Cumple | Base real; cantidades persistidas 10/7/3 |
| RNF03 | 004 v0.1.0 | AC-RNF03-01 | ninguno | No cumple | Sin seed de 2.000 solicitudes ni k6 (R-08) |
| RNF04 | 004 v0.1.0 | AC-RNF04-01 | CI job api-con-base-real | No cumple | Sin comando único ni prueba de clon limpio (R-06) |
| RNF05 | 002 y 004 | AC-RNF05-01, 02 | ninguno | No cumple | Sin revisión a 390 y 1366 px ni con teclado (R-10) |
| RNF06 | 001, 004, 005 | AC-RNF06-01 a 05 | ai.test.js; health-ready-20261014T081835Z.txt | Parcial | Health y ready probados; faltan logs sin secretos |

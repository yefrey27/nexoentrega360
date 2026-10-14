# Intervención de IA
ID y fecha UTC: AI-001 / 2026-10-14
Autor: yefrey navarro
Etapa: Pruebas
Herramienta y modelo conocido: Claude 
RF y AC: RF02, RF03, RF04, RF05, RF06, RF08, RNF01 / AC-RF02-03, AC-RF02-05, AC-RF02-06, AC-RF03-09, AC-RF04-05, AC-RF04-06, AC-RF04-07, AC-RF05-03, AC-RF06-01 a AC-RF06-05, AC-RF08-02 a AC-RF08-07, AC-RNF01-03, AC-RNF01-04
Contexto y versiones de archivos: enunciado del examen, specs/001 a 004 v0.1.0, contracts/openapi.yaml, commit base de la API 390e5a6

## Objetivo
Generar suites de pruebas de seguridad, dominio y consultas/tablero (tareas T-23 y T-14) que verifiquen los criterios contra la API y la base real.

## Prompt enviado
Tarea: generar suites de pruebas de la API para las tareas T-23 (seguridad y dominio) y T-14 (consultas y tablero).
RF y AC afectados: RF02, RF03 a RF06, RF08 y RNF01, según las SPECS 001 a 004 v0.1.0.
Archivos permitidos: solo `apps/api/test/security.test.js`, `domain.test.js` y `queries.test.js`; sin tocar código de producción.
Restricciones: pruebas contra la base real, datos del seed, estados finales y cantidades esperadas calculados a mano, no con el algoritmo de producción.
Verificación prevista: ejecutar `npm --prefix apps/api test` y contrastar los resultados con los AC.x
Salida relevante
Tres archivos: security.test.js, domain.test.js y queries.test.js (53 pruebas nuevas, 79 en total).

## Decisión humana
Aceptada con una corrección: la primera corrida usó `node --test` sin `--test-concurrency=1`, lo que ejecutó los archivos en paralelo sobre la misma base y canceló security.test.js (pass 76, cancelled 1). Se corrigió usando el script oficial `npm --prefix apps/api test`, que corre en serie.

## Verificación
Comando: `npm --prefix apps/api test`. Resultado: tests 79, pass 79, fail 0, cancelled 0.
Comprobado contra la base real: cancelar una solicitud ajena devuelve 403; enviar con fecha pasada devuelve 422 y la solicitud queda en BORRADOR.
Evidencia: evidence/tests/t14-t23-run.txt (commit 8e56da0). Pruebas en 4dc500e.

## Límites
Datos ficticios del seed. No se incluyeron claves ni datos reales. Las pruebas deben correr en serie porque comparten base de datos.

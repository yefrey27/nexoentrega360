# G1 · Alcance y requisitos

| Campo | Valor |
|-------|-------|
| Hito | G1 alcance y requisitos (día 1) |
| Artefactos | specs/constitution.md, docs/clarifications.md, specs/001 a 005 (spec.md y spec.json) |
| Versión de los artefactos | 0.1.0 |
| Commit revisado | PENDIENTE (completar con el SHA del commit que se aprueba) |
| Fecha UTC de la revisión | PENDIENTE |
| Autor | Yefrey (con asistencia de IA; ver evidence/ai-log/) |
| Revisor (persona distinta al autor) | PENDIENTE |

Esta hoja la completa una persona. Lo que aparece como "verificado" lo comprobó una máquina y se puede repetir con el comando indicado; no sustituye la lectura del revisor.

## Excepción de trabajo individual

El enunciado pide equipos ya conformados y un revisor distinto del autor. Mientras la docente no confirme por escrito cómo se cumple eso trabajando solo, este gate no puede darse por aprobado con una sola persona.

- Confirmación de la docente (cita textual): PENDIENTE
- Fecha UTC y canal de la confirmación: PENDIENTE
- Persona que actúa como revisor: PENDIENTE

## Lista de revisión

| # | Comprobación | Resultado | Cómo se comprobó |
|---|--------------|-----------|------------------|
| 1 | Existen cinco SPECS con historia y bloque JSON | Verificado | `python3 scripts/export_specs.py --check` informa 5 SPECS comprobadas |
| 2 | `spec.json` coincide con la fuente | Verificado | mismo comando |
| 3 | Todos los RF01 a RF12 y RNF01 a RNF06 están referenciados por alguna SPEC | Verificado | consulta sobre los `requirements` de los cinco `spec.json`: sin faltantes |
| 4 | Los ID de AC son únicos en todo el repositorio | Verificado | conteo sobre los cinco `spec.json`: sin duplicados (99 AC) |
| 5 | Cada AC tiene dado, cuando y entonces observables | Revisión humana | leer los AC de cada SPEC |
| 6 | Los AC cubren positivos, negativos, límites, permisos y fallos | Revisión humana | contrastar con las secciones de reglas del enunciado |
| 7 | Las reglas del enunciado no fueron modificadas por supuestos | Revisión humana | contrastar números: 1 a 10 líneas, 1 a 500, 100 por página, 20 solicitudes, 5 s, 600, 240, 5 recomendaciones, 24 h |
| 8 | La constitution tiene reglas con forma de comprobación | Revisión humana | tabla de 18 reglas en specs/constitution.md |
| 9 | Hay al menos seis preguntas con requisito, riesgo y propuesta | Verificado | 14 preguntas en docs/clarifications.md |
| 10 | Las preguntas que requieren al cliente fueron enviadas con fecha UTC | **No cumple** | docs/clarifications.md, tabla de estado de envío; no se enviaron, se aplican supuestos |
| 11 | Los supuestos provisionales tienen impacto y responsable | Revisión humana | docs/clarifications.md |
| 12 | Ninguna respuesta de IA se presenta como decisión del cliente | Revisión humana | docs/clarifications.md |
| 13 | SPEC, constitution y aclaraciones no contradicen el contrato OpenAPI ni los ADR | Revisión humana | contrastar con contracts/openapi.yaml y docs/adr |

## Hallazgos

| ID | Hallazgo | Impacto | Acción propuesta | Estado |
|----|----------|---------|------------------|--------|
| H1-01 | Las preguntas Q-01, 02, 03, 04, 05, 07, 09, 13 y 14 no han sido enviadas; se aplican supuestos provisionales | Si la docente responde distinto, cambian enums, validaciones y pruebas | Enviar y anotar la fecha UTC en docs/clarifications.md; subir la versión de la SPEC afectada | Abierto |
| H1-02 | Los valores del oráculo (física 10, A-001 y A-002 piden 7, resultado 10/7/3) vienen del enunciado del caso; no se contrastaron con los datos semilla oficiales del anexo porque ese archivo no estaba disponible al redactar | Un seed distinto invalida AC-RNF02-01 | Contrastar con el anexo antes de implementar T-04 y corregir SPEC-003 si difiere | Cerrado por el autor: contrastado con `acceptance-oracles.md` y `fixture-scenarios.json` del anexo oficial. Coinciden: KIT-ALIMENTO de ORG-A con existencia 10; A-001 y A-002 piden 7 cada una; reserva 10/7/3, cancelación 10/0/10, despacho 3/0/3. No hubo cambios en SPEC-003. El revisor debe confirmarlo. |
| H1-03 | AC-RF03-02 pide rechazar la cantidad 1.5 pero una columna `integer` de PostgreSQL redondea 1.5 a 2 en silencio (comprobado en la base) | La base no puede ser la única defensa de esta regla | La API debe validar entero estricto antes de tocar la base; la prueba de AC-RF03-02 debe ejecutarse contra la API, no contra la base | Abierto |
| H1-04 | RNF04 y la parte de health y readiness de RNF06 se asignaron a SPEC-004 porque no encajan en ninguna de las cinco funcionalidades | Posible lectura de cobertura forzada | Mantener y registrar la decisión; el revisor confirma | Abierto |
| H1-05 | Un solo revisor humano disponible puede no ser "persona distinta" del autor | G1 y G2 sin aprobación válida | Resolver con la docente (ver excepción) | Abierto |
| H1-06 | Q-12 (403 al leer una solicitud ajena de la misma organización) es una interpretación literal; podría esperarse 404 | Cambia AC-RF02-06 | Incluir en la consulta a la docente si se quiere confirmar | Abierto |

## Decisión

Marcar una opción y firmar:

- [ ] Aprobado
- [ ] Aprobado con condiciones (listarlas)
- [ ] Rechazado

Condiciones o comentarios: PENDIENTE

Firma del revisor (nombre y fecha UTC): PENDIENTE

## Evidencia

- Comando: `python3 scripts/export_specs.py --check`
- Archivos: specs/constitution.md, docs/clarifications.md, specs/001-identidad a specs/005-asistente-ia
- Bitácora de IA: evidence/ai-log/AI-001.md

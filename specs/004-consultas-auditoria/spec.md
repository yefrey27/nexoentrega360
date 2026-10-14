# SPEC-004 Consultas, auditoría y operación

Autor: Yefrey (con asistencia de IA) · Revisión: PENDIENTE (persona distinta) · Fecha UTC: PENDIENTE · Commit: PENDIENTE

Alcance: listados paginados, filtros, tablero, auditoría append-only, interfaz responsive y operación reproducible (health, readiness, logs, arranque desde clon limpio, carga). Exclusiones: exportaciones, reportes históricos. Dependencias: SPEC-001, SPEC-003, Q-09, Q-10.

Nota de cobertura: RNF04 (clon limpio en 15 minutos) y la parte de health/readiness de RNF06 se cubren aquí porque describen operación y observabilidad de lectura.

<!-- spec-data:start -->
```json
{
  "id": "SPEC-004",
  "version": "0.1.0",
  "name": "Consultas, auditoría y operación",
  "story": {
    "id": "HU-04",
    "as": "coordinador, bodega, solicitante o auditor",
    "want": "consultar solicitudes por estado, prioridad y zona, ver un tablero con cantidades y revisar quién hizo cada operación",
    "soThat": "pueda decidir qué atender, comprobar el inventario y demostrar la trazabilidad de cada acción"
  },
  "requirements": ["RF08", "RF09", "RNF03", "RNF04", "RNF05", "RNF06"],
  "description": "Listados con paginación máxima de 100 y filtros, tablero con conteo por estado y disponible y reservado por SKU, auditoría append-only que registra cada transición exitosa y cada aprobación de resumen, y condiciones de operación verificables.",
  "inputs": [
    {"field": "page", "type": "entero", "validation": ["mínimo 1", "por defecto 1"]},
    {"field": "pageSize", "type": "entero", "validation": ["de 1 a 100", "por defecto 20", "mayor que 100 produce 422"]},
    {"field": "status", "type": "enum opcional", "validation": ["uno de los seis estados más CANCELADA"]},
    {"field": "priority", "type": "enum opcional", "validation": ["NORMAL o ALTA"]},
    {"field": "zone", "type": "enum opcional", "validation": ["NORTE, SUR, CENTRO o RIBERA"]},
    {"field": "cabecera X-Correlation-Id", "type": "string opcional", "validation": ["si falta, el servidor genera uno", "máximo 64 caracteres seguros"]}
  ],
  "process": [
    "Autenticar y autorizar; filtrar siempre por la organización de la sesión y, para solicitantes, además por su propio identificador.",
    "Validar parámetros; valores fuera de rango o enumeraciones inválidas responden 422.",
    "Listar con orden createdAt descendente y desempate por id; devolver total, página y tamaño.",
    "Tablero: contar solicitudes por estado y sumar existencia física, reservada y disponible por SKU de la organización con consultas agregadas.",
    "Cada transición exitosa y cada aprobación de resumen inserta un evento en audit_events dentro de la misma transacción con usuario, organización, recurso, acción, instante UTC y correlationId.",
    "La API no expone operaciones de edición o borrado de eventos y el rol de la aplicación no tiene UPDATE ni DELETE sobre la tabla.",
    "GET /health responde mientras el proceso vive; GET /ready comprueba la conexión a la base y las migraciones aplicadas."
  ],
  "outputs": [
    {"condition": "consulta válida", "result": "200 con items, total, page, pageSize y solo recursos permitidos"},
    {"condition": "parámetro inválido o pageSize mayor que 100", "result": "422 con el campo inválido y sin datos"},
    {"condition": "tablero", "result": "200 con conteos por estado y disponible, reservada y física por SKU"},
    {"condition": "consulta de auditoría por el auditor", "result": "200 con eventos solo de su organización"},
    {"condition": "intento de editar o borrar un evento por la API", "result": "404 o 405 y el evento no cambia"},
    {"condition": "operación rechazada", "result": "sin evento de transición; solo un log técnico con correlationId"},
    {"condition": "health y readiness", "result": "health 200 con el proceso vivo; ready 200 solo con base y migraciones disponibles y 503 en caso contrario"}
  ],
  "businessRules": [
    "Máximo 100 elementos por página.",
    "El solicitante ve solo sus solicitudes; coordinador, bodega y auditor ven las de su organización.",
    "El listado de auditoría de la organización es solo del Auditor (Q-09); el historial de una solicitud lo ve quien puede ver esa solicitud.",
    "Cada evento incluye identidad, organización, recurso, acción, instante UTC y correlationId.",
    "Una operación rechazada no genera una transición exitosa.",
    "Estado, inventario y evento se persisten de forma consistente.",
    "Los logs son estructurados, llevan correlationId y no contienen secretos.",
    "Las pruebas de carga excluyen la IA."
  ],
  "edgeCases": [
    "Página mayor que la última: items vacío y total correcto.",
    "pageSize 100 válido, 101 y 0 inválidos.",
    "Combinación de filtros sin resultados: lista vacía, no error.",
    "Dos eventos en el mismo instante: el orden se resuelve por id.",
    "Base caída: health sigue 200 y ready 503.",
    "Un correlationId con caracteres no seguros se reemplaza por uno generado.",
    "Auditor consulta un identificador de otra organización: 404."
  ],
  "acceptanceCriteria": [
    {"id": "AC-RF08-01", "given": "2000 solicitudes sembradas en una organización", "when": "un coordinador pide pageSize 100 y luego pageSize 101", "then": "el primero responde 200 con 100 elementos y el segundo responde 422"},
    {"id": "AC-RF08-02", "given": "solicitudes en varios estados, prioridades y zonas", "when": "se filtra por status RESERVADA, priority ALTA y zone NORTE", "then": "todos los elementos devueltos cumplen los tres filtros y el total coincide con el conteo calculado a mano en la base"},
    {"id": "AC-RF08-03", "given": "dos solicitantes de ORG-A con solicitudes propias", "when": "cada uno lista solicitudes", "then": "cada uno ve solo las suyas y el coordinador ve las de ambos"},
    {"id": "AC-RF08-04", "given": "un filtro con status ENVIDA o zone inexistente", "when": "se consulta el listado", "then": "responde 422 indicando el parámetro inválido"},
    {"id": "AC-RF08-05", "given": "inventario y solicitudes de ORG-A", "when": "se pide el tablero", "then": "devuelve el conteo por estado y por SKU las cantidades física, reservada y disponible, y los números coinciden con una consulta SQL independiente"},
    {"id": "AC-RF08-06", "given": "solicitudes de ORG-A y ORG-B", "when": "un usuario de ORG-A consulta el tablero y los listados", "then": "ningún total ni elemento incluye datos de ORG-B"},
    {"id": "AC-RF08-07", "given": "una página mayor que la última", "when": "se consulta", "then": "responde 200 con items vacío y el total correcto"},
    {"id": "AC-RF09-01", "given": "una solicitud que pasa de BORRADOR a ENVIADA, RESERVADA, DESPACHADA y ENTREGADA", "when": "se consulta su auditoría", "then": "hay un evento por transición con usuario, organización, recurso, acción, instante UTC y correlationId, en orden"},
    {"id": "AC-RF09-02", "given": "una reserva rechazada con 409", "when": "se consulta la auditoría de la solicitud", "then": "no hay evento de transición y el log técnico contiene el correlationId del intento"},
    {"id": "AC-RF09-03", "given": "un evento de auditoría existente", "when": "se envían PUT, PATCH y DELETE a las rutas de eventos", "then": "responden 404 o 405 y el evento permanece idéntico"},
    {"id": "AC-RF09-04", "given": "una conexión con el rol de la aplicación nexo_app", "when": "ejecuta UPDATE y DELETE sobre audit_events", "then": "la base responde permiso denegado y las filas no cambian"},
    {"id": "AC-RF09-05", "given": "una transición forzada a fallar tras actualizar el inventario y antes del commit", "when": "se inspecciona la base", "then": "no quedan estado, inventario ni evento parciales"},
    {"id": "AC-RF09-06", "given": "un coordinador que aprueba un resumen de IA", "when": "se consulta la auditoría de la organización como auditor", "then": "existe un evento de aprobación con identidad, organización, recurso, acción, UTC y correlationId"},
    {"id": "AC-RF09-07", "given": "un coordinador o un solicitante de ORG-A", "when": "pide el listado de auditoría de la organización", "then": "responde 403, y el auditor de ORG-A obtiene 200 con eventos de su organización solamente"},
    {"id": "AC-RNF03-01", "given": "2000 solicitudes sembradas y la API en ejecución con 20 usuarios virtuales durante 60 segundos tras 5 de calentamiento", "when": "se ejecuta k6 sobre listados y tablero sin IA", "then": "el p95 es menor o igual a 700 ms, los errores son menores al 1 por ciento, y el reporte incluye hardware, herramienta, commit y fecha"},
    {"id": "AC-RNF04-01", "given": "un clon limpio del repositorio con versiones fijadas", "when": "se ejecuta el comando documentado de arranque", "then": "migraciones, seed y servicios quedan listos en 15 minutos o menos sin contar la descarga inicial de imágenes y paquetes, que se reporta aparte"},
    {"id": "AC-RNF05-02", "given": "las pantallas de listado, tablero y detalle", "when": "se revisan a 390 y 1366 píxeles con teclado", "then": "no hay desplazamiento horizontal, el flujo principal es operable con teclado, los campos tienen etiqueta y los errores están asociados"},
    {"id": "AC-RNF06-05", "given": "cualquier petición a la API", "when": "se revisan los logs", "then": "cada línea es JSON estructurado con correlationId y sin contraseñas, cookies ni tokens"},
    {"id": "AC-RNF06-02", "given": "la base de datos detenida", "when": "se llama a health y a ready", "then": "health responde 200 y ready responde 503"},
    {"id": "AC-RNF06-03", "given": "el proveedor de IA caído", "when": "se ejecuta el resto del flujo y el pipeline de CI", "then": "el flujo completo y el CI funcionan sin ningún servicio de pago ni proveedor activo"}
  ]
}
```
<!-- spec-data:end -->

## Decisiones y aclaraciones
- Q-09 (visibilidad de auditoría), Q-10 (paginación y orden). Arranque y recuperación: ver `docs/runbook.md` cuando exista.

## Riesgos y plan de prueba
- Riesgo: consultas lentas con 2000 filas. Control: índices en `(org_id, status)`, `(org_id, priority)`, `(org_id, zone)` y `(org_id, created_at DESC, id)`.
- Riesgo: eventos de auditoría perdidos. Control: inserción en la misma transacción y prueba de fallo.
- Pruebas: API con base real, SQL independiente para oráculos, k6, revisión manual de móvil y teclado.

## Historial de cambios
- 0.1.0 Borrador inicial para G1.

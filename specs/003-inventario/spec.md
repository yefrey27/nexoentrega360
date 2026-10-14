# SPEC-003 Inventario y transiciones

Autor: Yefrey (con asistencia de IA) · Revisión: PENDIENTE (persona distinta) · Fecha UTC: PENDIENTE · Commit: PENDIENTE

Alcance: reserva atómica con idempotencia, cancelación, despacho, entrega y consistencia del inventario. Exclusiones: reposición de inventario, devoluciones, rutas. Dependencias: SPEC-001, SPEC-002, ADR-0002, Q-07, Q-11.

Datos de los oráculos: A-001 y A-002 son dos solicitudes ENVIADA de la misma organización que piden el mismo SKU. Existencia física 10, reservada 0. Cada una pide 7. Resultado esperado tras competir: una reserva exitosa y la otra 409; persistido física 10, reservada 7, disponible 3. Los valores exactos del seed deben contrastarse con el anexo oficial de datos semilla; si difieren, el anexo prevalece.

<!-- spec-data:start -->
```json
{
  "id": "SPEC-003",
  "version": "0.1.0",
  "name": "Inventario y transiciones",
  "story": {
    "id": "HU-03",
    "as": "coordinador, bodega o solicitante de una organización",
    "want": "reservar, cancelar, despachar y entregar solicitudes con el inventario siempre consistente",
    "soThat": "nunca se prometa el mismo kit a dos solicitantes ni quede inventario negativo"
  },
  "requirements": ["RF04", "RF05", "RF06", "RF07", "RNF02", "RNF01"],
  "description": "Máquina de estados BORRADOR, ENVIADA, RESERVADA, DESPACHADA, ENTREGADA con CANCELADA desde ENVIADA o RESERVADA. La reserva es todo o nada, transaccional, segura ante concurrencia y con Idempotency-Key. Disponible es existencia física menos reservada.",
  "inputs": [
    {"field": "requestId", "type": "UUID en la ruta", "validation": ["pertenece a la organización del usuario, si no 404"]},
    {"field": "Idempotency-Key", "type": "cabecera string", "validation": ["obligatoria en reservar", "entre 8 y 128 caracteres visibles", "ausente produce 400"]},
    {"field": "operación", "type": "reservar, cancelar, despachar o entregar", "validation": ["permitida para el rol", "transición válida desde el estado actual"]}
  ],
  "process": [
    "Autenticar, autorizar por rol y resolver la solicitud dentro de la organización; 401, 403 o 404 antes de cualquier efecto.",
    "Reservar: en una sola transacción, registrar la clave de idempotencia acotada por organización, usuario y operación; si ya existe con el mismo hash de contenido devolver el resultado guardado; con otro hash devolver 409.",
    "Bloquear la fila de la solicitud y comprobar que el estado es ENVIADA; si no, 409.",
    "Bloquear las filas de inventario de las líneas en orden determinista por SKU y comprobar que disponible cubre cada línea; si alguna no alcanza, 409 sin modificar ninguna línea ni el estado.",
    "Aumentar reservada por línea, pasar a RESERVADA, insertar el evento de auditoría y guardar la respuesta de la clave; confirmar.",
    "Cancelar: solo el solicitante dueño desde ENVIADA o RESERVADA; si estaba RESERVADA liberar exactamente su reserva; la existencia física no cambia.",
    "Despachar: solo bodega sobre RESERVADA; disminuir existencia física y reservada en las cantidades de la solicitud.",
    "Entregar: solo coordinador sobre DESPACHADA; no altera inventario.",
    "Toda transición no permitida responde 409 conservando datos e inventario."
  ],
  "outputs": [
    {"condition": "reserva exitosa", "result": "200 con estado RESERVADA, reservada incrementada por línea, un evento de auditoría y respuesta guardada 24 horas"},
    {"condition": "disponibilidad insuficiente en alguna línea", "result": "409 con la línea afectada; ni inventario ni estado cambian; resultado guardado para la clave"},
    {"condition": "misma clave y mismo contenido", "result": "misma respuesta y estado HTTP originales sin duplicar efectos"},
    {"condition": "misma clave y contenido distinto", "result": "409 sin efectos"},
    {"condition": "falta Idempotency-Key", "result": "400 sin efectos"},
    {"condition": "transición no permitida desde el estado actual", "result": "409 sin cambios"},
    {"condition": "cancelación válida", "result": "200 CANCELADA y reserva liberada solo si estaba RESERVADA"},
    {"condition": "despacho válido", "result": "200 DESPACHADA con física y reservada reducidas"},
    {"condition": "entrega válida", "result": "200 ENTREGADA con inventario sin cambios"}
  ],
  "businessRules": [
    "Disponible = existencia física menos cantidad reservada; las tres son no negativas y reservada no supera la física (CHECK en la base).",
    "Reservar solo solicitudes ENVIADA; todas las líneas o ninguna.",
    "Cancelar RESERVADA libera exactamente la reserva; cancelar ENVIADA no toca inventario.",
    "Despachar reduce física y reservada; entregar no toca inventario.",
    "La clave de idempotencia se evalúa después de autenticar y autorizar y está acotada por organización, usuario y operación.",
    "Se almacenan resultados 200 y 409 de negocio; no se almacenan 401, 403, 404, 422 ni 5xx (Q-07).",
    "El resultado guardado se conserva al menos 24 horas.",
    "Estado, inventario y evento de auditoría se persisten en la misma transacción."
  ],
  "edgeCases": [
    "Dos peticiones simultáneas con la misma clave: una ejecuta y la otra espera y recibe el mismo resultado.",
    "Dos peticiones simultáneas con claves distintas sobre solicitudes distintas que compiten por el mismo SKU: una sola tiene éxito.",
    "Dos peticiones simultáneas con claves distintas sobre la misma solicitud: una tiene éxito y la otra recibe 409 por estado.",
    "Caída o error antes del commit: ninguna reserva parcial ni evento.",
    "Solicitud con 10 líneas donde solo la décima no alcanza: nada se reserva.",
    "Cancelar una solicitud dos veces: la segunda recibe 409 y no libera dos veces.",
    "Misma clave usada por otro usuario u otra organización: es independiente y no devuelve respuestas ajenas.",
    "Reintento tras un 5xx con la misma clave: se ejecuta de nuevo porque el 5xx no se almacena."
  ],
  "acceptanceCriteria": [
    {"id": "AC-RF05-01", "given": "una solicitud ENVIADA de 3 líneas con disponibilidad suficiente y un coordinador de su organización", "when": "reserva con Idempotency-Key", "then": "responde 200 estado RESERVADA, la cantidad reservada de cada SKU aumenta exactamente en lo pedido, la existencia física no cambia y hay un evento de auditoría"},
    {"id": "AC-RF05-02", "given": "una solicitud ENVIADA de 3 líneas donde la tercera excede la disponibilidad", "when": "el coordinador reserva", "then": "responde 409, las tres líneas conservan su reservada, el estado sigue ENVIADA y no hay evento de auditoría de reserva"},
    {"id": "AC-RF05-03", "given": "solicitudes en estados BORRADOR, RESERVADA, DESPACHADA, ENTREGADA y CANCELADA", "when": "el coordinador intenta reservar cada una", "then": "cada intento responde 409 y datos e inventario no cambian"},
    {"id": "AC-RF05-04", "given": "una solicitud ya RESERVADA con la clave K1", "when": "se envía otra reserva de la misma solicitud con la clave K2", "then": "responde 409 por estado y no se incrementa la reservada otra vez"},
    {"id": "AC-RF05-05", "given": "la fila de inventario con física 10 y reservada 0", "when": "se intenta por SQL directo dejar reservada en 11, física en -1 o reservada en -1", "then": "la base rechaza cada cambio por restricción y el valor persistido no cambia"},
    {"id": "AC-RF06-01", "given": "una solicitud RESERVADA de 7 unidades con física 10 y reservada 7", "when": "su solicitante dueño la cancela", "then": "responde 200 CANCELADA, la reservada baja a 0, la física sigue en 10 y hay un evento de auditoría"},
    {"id": "AC-RF06-02", "given": "una solicitud ENVIADA", "when": "su dueño la cancela", "then": "responde 200 CANCELADA y el inventario no cambia en ninguna cantidad"},
    {"id": "AC-RF06-03", "given": "una solicitud RESERVADA de 7 unidades con física 10 y reservada 7", "when": "bodega la despacha", "then": "responde 200 DESPACHADA, la física queda en 3 y la reservada en 0"},
    {"id": "AC-RF06-04", "given": "una solicitud DESPACHADA", "when": "el coordinador registra la entrega", "then": "responde 200 ENTREGADA y física y reservada no cambian"},
    {"id": "AC-RF06-05", "given": "solicitudes DESPACHADA, ENTREGADA y CANCELADA", "when": "su dueño intenta cancelarlas", "then": "cada intento responde 409 y nada cambia"},
    {"id": "AC-RF04-06", "given": "cada par estado-origen y operación fuera de las transiciones permitidas", "when": "se ejecuta la operación con el rol correcto", "then": "responde 409, el estado y las cantidades persistidas no cambian y no hay evento de auditoría"},
    {"id": "AC-RF04-07", "given": "una solicitud RESERVADA", "when": "un coordinador intenta despacharla y bodega intenta entregarla", "then": "ambos responden 403 y nada cambia"},
    {"id": "AC-RF04-08", "given": "una solicitud RESERVADA de un solicitante", "when": "otro solicitante de la misma organización intenta cancelarla", "then": "responde 403 y la reserva permanece"},
    {"id": "AC-RF07-01", "given": "una reserva exitosa hecha con la clave K1", "when": "se repite la misma petición con K1, mismo usuario y mismo contenido", "then": "responde igual que la original, la reservada no aumenta de nuevo y no hay un segundo evento de auditoría"},
    {"id": "AC-RF07-02", "given": "la clave K1 ya usada para reservar la solicitud S1", "when": "se envía K1 para reservar la solicitud S2", "then": "responde 409 por conflicto de contenido y S2 no cambia"},
    {"id": "AC-RF07-03", "given": "una petición de reservar sin cabecera Idempotency-Key", "when": "el coordinador la envía", "then": "responde 400 y no se modifica nada"},
    {"id": "AC-RF07-04", "given": "una clave K1 usada por un coordinador de ORG-A", "when": "otro usuario autorizado de ORG-B envía K1", "then": "se procesa de forma independiente y nunca recibe la respuesta guardada de ORG-A"},
    {"id": "AC-RF07-05", "given": "un resultado de reserva guardado con la clave K1", "when": "se consulta la tabla de claves antes de 24 horas y se reintenta K1", "then": "el resultado sigue disponible y se repite"},
    {"id": "AC-RF07-06", "given": "una reserva rechazada con 409 por disponibilidad insuficiente con la clave K1", "when": "se reintenta K1 con el mismo contenido", "then": "se repite el mismo 409 sin reevaluar, y con una clave nueva sí se reevalúa"},
    {"id": "AC-RF07-07", "given": "una reserva que provoca un 422 o un 404", "when": "se reintenta con la misma clave tras corregir la causa", "then": "se procesa normalmente porque esos resultados no se almacenan"},
    {"id": "AC-RNF02-01", "given": "A-001 y A-002 ENVIADA pidiendo 7 unidades cada una del mismo SKU con física 10 y reservada 0", "when": "dos coordinadores reservan ambas al mismo tiempo con claves distintas", "then": "exactamente una responde 200 y la otra 409, y la base persiste física 10, reservada 7 y disponible 3"},
    {"id": "AC-RNF02-02", "given": "una reserva forzada a fallar antes del commit", "when": "se inspecciona la base", "then": "no hay reserva parcial, el estado sigue ENVIADA y no hay evento ni registro de idempotencia"},
    {"id": "AC-RNF02-03", "given": "100 reservas concurrentes sobre solicitudes distintas que compiten por un SKU", "when": "terminan todas", "then": "la reservada nunca supera la física, nunca hay valores negativos y la suma de reservas exitosas coincide con la reservada persistida"},
    {"id": "AC-RNF02-04", "given": "dos peticiones simultáneas con la misma clave y el mismo contenido", "when": "se procesan", "then": "se produce un solo efecto y ambas respuestas son idénticas"}
  ]
}
```
<!-- spec-data:end -->

## Decisiones y aclaraciones
- Q-07 (qué errores se almacenan), Q-11 (catálogo global, inventario por organización). Estrategia transaccional: ADR-0002.
- Los valores 10, 7 y 3 provienen del caso de oráculos del examen; se contrastan con los datos semilla oficiales antes de implementar.

## Riesgos y plan de prueba
- Riesgo: interbloqueo entre reservas. Control: orden determinista de bloqueo por SKU.
- Riesgo: simular concurrencia con mocks. Control: pruebas con base PostgreSQL real y conexiones separadas.
- Pruebas: dominio (tabla de transiciones permitidas y denegadas), API con base real, concurrencia, idempotencia y regresión.

## Historial de cambios
- 0.1.0 Borrador inicial para G1.

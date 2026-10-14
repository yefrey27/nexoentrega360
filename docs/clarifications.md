# Registro de aclaraciones (clarification-log)

Versión 0.1.0 · Autor: Yefrey · Revisión: PENDIENTE · Fecha UTC: PENDIENTE

Este registro separa tres cosas que no deben confundirse:

- **Decisión del cliente**: respuesta de la docente. Se registra con fecha UTC y se cita textualmente.
- **Supuesto provisional**: lo que el equipo aplica mientras no hay respuesta. Tiene impacto y responsable.
- **Propuesta**: lo que el equipo sugiere al cliente. Una respuesta de IA nunca cuenta como decisión del cliente.

Los valores explícitos del enunciado prevalecen sobre cualquier propuesta o sugerencia de IA.

## Estado de envío al cliente

| Pregunta | ¿Requiere decisión del cliente? | Enviada (fecha UTC) | Respuesta (fecha UTC) |
|----------|----------------------------------|---------------------|------------------------|
| Q-01 | Sí | No enviada | Sin respuesta |
| Q-02 | Sí | No enviada | Sin respuesta |
| Q-03 | Sí | No enviada | Sin respuesta |
| Q-04 | Sí | No enviada | Sin respuesta |
| Q-05 | Sí | No enviada | Sin respuesta |
| Q-06 | No (decisión técnica, ADR-0003) | n/a | n/a |
| Q-07 | Sí | No enviada | Sin respuesta |
| Q-08 | No (decisión del equipo) | n/a | n/a |
| Q-09 | Sí | No enviada | Sin respuesta |
| Q-10 | No (decisión del equipo) | n/a | n/a |
| Q-11 | No (decisión del equipo) | n/a | n/a |
| Q-12 | Confirmación opcional (supuesto literal del enunciado; ver H1-06) | No enviada | Sin respuesta |
| Q-13 | Sí | No enviada | Sin respuesta |
| Q-14 | Sí | No enviada | Sin respuesta |

La columna "Enviada" la completa una persona cuando realmente envía el mensaje a la docente. No se rellena de antemano.

Estas preguntas no se enviaron al cliente. Se aplican los supuestos provisionales indicados en cada una, con su impacto y responsable.

## Preguntas

### Q-01 Zonas permitidas
- **Requisito afectado:** RF03, RF08 (filtro por zona), SPEC-002, SPEC-004.
- **Riesgo de no resolverla:** el filtro y la validación quedan sin lista cerrada; datos sucios por texto libre; pruebas ambiguas.
- **Propuesta:** lista cerrada de cuatro zonas de Barranquilla: `NORTE`, `SUR`, `CENTRO`, `RIBERA`.
- **Supuesto provisional:** la propuesta. **Impacto:** si cambia, se ajusta un enum, el seed y los tests. **Responsable:** Yefrey.

### Q-02 Tratamiento de zona desconocida
- **Requisito afectado:** RF03.
- **Riesgo:** aceptar una zona fuera de lista rompe filtros y reportes.
- **Propuesta:** rechazar con 422 y `field: zone`; no crear la solicitud.
- **Supuesto provisional:** la propuesta. **Impacto:** bajo. **Responsable:** Yefrey.

### Q-03 Formato de fecha requerida y visualización horaria
- **Requisito afectado:** RF03, RF09, RNF05.
- **Riesgo:** comparar "fecha anterior al momento de envío" depende de la zona horaria; sin regla, el mismo día se acepta o rechaza según el servidor.
- **Propuesta:** `fechaRequerida` es una fecha ISO 8601 `YYYY-MM-DD`, evaluada en `America/Bogota` (UTC-05:00, sin horario de verano). Se acepta si es igual o posterior a la fecha actual en Bogotá al enviar. La auditoría se guarda en UTC y la interfaz muestra la hora en Bogotá indicando "(hora de Bogotá)".
- **Supuesto provisional:** la propuesta. **Impacto:** medio; afecta validación, pruebas de límite (hoy, ayer) y presentación. **Responsable:** Yefrey.

### Q-04 Límite de observaciones
- **Requisito afectado:** RF03, RF10, RF11.
- **Riesgo:** observaciones largas aumentan el costo de la IA y la superficie de inyección.
- **Propuesta:** máximo 500 caracteres, texto plano; 422 si excede.
- **Supuesto provisional:** la propuesta. **Impacto:** bajo. **Responsable:** Yefrey.

### Q-05 Persistencia de intentos de IA
- **Requisito afectado:** RF12, RNF06.
- **Riesgo:** sin registro no se puede demostrar qué se aprobó ni diagnosticar fallos; guardar el prompt completo puede retener datos innecesarios.
- **Propuesta:** guardar en `ai_attempts` el proveedor, estado (`ok`, `invalid_output`, `timeout`, `provider_error`), duración, IDs enviados, indicador de resumen alternativo, `correlationId` y la salida validada. No guardar secretos.
- **Supuesto provisional:** la propuesta. **Impacto:** una tabla y una escritura por intento. **Responsable:** Yefrey.

### Q-06 Sesiones o tokens
- **Requisito afectado:** RF01.
- **Riesgo:** elección sin justificación.
- **Decisión del equipo (no requiere cliente):** sesiones en servidor con cookie `HttpOnly`, `SameSite=Lax` y almacenamiento del hash del identificador en base de datos. Permite cierre de sesión inmediato. Ver ADR-0003.

### Q-07 Política de reintento y errores almacenados de la idempotencia
- **Requisito afectado:** RF07, RNF02.
- **Riesgo:** guardar el error equivocado impide reintentar; no guardarlo duplica efectos.
- **Propuesta:** se almacena el resultado de respuestas 200 y de 409 de negocio (disponibilidad insuficiente, estado inválido). No se almacenan 401, 403, 404, 422 ni 5xx. Tras un 5xx se puede reintentar con la misma clave. Un 409 almacenado se repite 24 horas; para intentar de nuevo hay que usar otra clave. La clave se acota por organización, usuario y operación.
- **Supuesto provisional:** la propuesta. **Impacto:** alto; define el contrato y las pruebas AC-RF07. **Responsable:** Yefrey.

### Q-08 Formato del código de solicitud
- **Requisito afectado:** RF03.
- **Decisión del equipo:** `SOL-<ORG>-<secuencia de 6 dígitos>` generado por el servidor con una secuencia por organización. Un código enviado por el cliente se ignora.

### Q-09 Quién consulta la auditoría
- **Requisito afectado:** RF09, RF02.
- **Riesgo:** la matriz de permisos solo nombra al Auditor; sin regla, otros roles podrían ver o no ver el historial.
- **Propuesta:** el listado de auditoría de la organización es solo del Auditor. Cada rol ve en el detalle de una solicitud su historial de transiciones si puede ver esa solicitud.
- **Supuesto provisional:** la propuesta. **Impacto:** medio. **Responsable:** Yefrey.

### Q-10 Paginación, orden y límite excedido
- **Requisito afectado:** RF08.
- **Decisión del equipo:** `pageSize` por defecto 20, máximo 100; un valor mayor responde 422 (no se recorta en silencio). Orden por defecto: `createdAt` descendente y desempate por `id`.

### Q-11 Catálogo de SKU
- **Requisito afectado:** RF03, RF05.
- **Decisión del equipo:** catálogo global de SKU (código, nombre, activo) e inventario por organización en `inventory(org_id, sku_id)`. Un SKU sin fila de inventario en la organización se trata como existencia 0.

### Q-12 Lectura de solicitud ajena dentro de la misma organización
- **Requisito afectado:** RF02, RF08.
- **Supuesto literal del enunciado:** "acción prohibida sobre un recurso propio de la organización obtiene 403". Un solicitante que consulta la solicitud de otro solicitante de su misma organización recibe 403.
- **Impacto:** bajo.

### Q-13 Contenido del resumen determinista alternativo
- **Requisito afectado:** RF12.
- **Riesgo:** sin definición, el alternativo no es comprobable.
- **Propuesta:** texto fijo con el total de solicitudes, el conteo por prioridad y por zona, y una lista de hasta cinco IDs ordenados por prioridad ALTA primero, luego fecha requerida ascendente y luego código. Cada elemento cita `evidenceFields` `prioridad` y `fechaRequerida`. Se marca como "resumen automático sin IA".
- **Supuesto provisional:** la propuesta. **Impacto:** medio. **Responsable:** Yefrey.

### Q-14 Aprobación del resumen alternativo y cambios de estado
- **Requisito afectado:** RF12, RF09.
- **Riesgo:** aprobar un resumen sobre solicitudes que ya cambiaron de estado deja una constancia engañosa.
- **Propuesta:** se puede aprobar tanto el resumen de IA como el alternativo; la constancia registra el origen (`ai` o `fallback`) y los IDs. Al aprobar se muestra la advertencia si alguna solicitud ya no está ENVIADA, y la aprobación igualmente registra el estado de cada una en ese momento. Aprobar no cambia ningún estado.
- **Supuesto provisional:** la propuesta. **Impacto:** medio. **Responsable:** Yefrey.

### Q-15 Idempotency-Key entre usuarios y organizaciones
- **Requisito afectado:** RF07, RNF02.
- **Riesgo:** reutilizar una clave ajena podría devolver la respuesta de otro usuario.
- **Propuesta:** la clave se almacena con org_id, user_id, operation y key; otro usuario con la misma clave ejecuta una operación independiente.
- **Supuesto provisional:** la propuesta. **Impacto:** alto. **Responsable:** Yefrey.
- **Verificación:** caso 3 de apps/api/test/idempotency.test.js.

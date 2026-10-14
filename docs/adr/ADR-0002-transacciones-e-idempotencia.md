# ADR-0002 Estrategia transaccional e idempotencia

Estado: propuesto · Fecha UTC: PENDIENTE · Autor: Yefrey (con asistencia de IA) · Revisor: PENDIENTE (persona distinta al autor) · Commit: PENDIENTE

## Contexto
La reserva debe cubrir todas las líneas o ninguna (RF05), resistir concurrencia, no producir inventario negativo ni doble reserva (RF07, RNF02) y repetir su resultado ante reintentos con `Idempotency-Key`. Estado, inventario y auditoría deben persistirse de forma consistente (RF09).

## Restricciones
- PostgreSQL con nivel de aislamiento READ COMMITTED por defecto.
- La clave de idempotencia se procesa después de autenticar y autorizar, y se acota por organización, usuario y operación.
- Los resultados guardados se conservan al menos 24 horas.
- Q-07: se almacenan 200 y 409 de negocio; no se almacenan 401, 403, 404, 422 ni 5xx.

## Alternativas

| Alternativa | A favor | En contra |
|-------------|---------|-----------|
| A. Bloqueo pesimista de filas (`SELECT ... FOR UPDATE`) en orden determinista, todo en una transacción | Sencillo de razonar; sin reintentos de aplicación; ordenar por `sku_id` evita interbloqueos | Serializa reservas que tocan el mismo SKU |
| B. Optimista con versión y reintentos | Menos bloqueo | Más código y reintentos; riesgo de agotar intentos bajo contienda |
| C. Nivel SERIALIZABLE | Garantía fuerte sin pensar en bloqueos | Errores de serialización que hay que reintentar; más difícil de probar |
| D. Un `UPDATE` condicional por línea sin bloquear antes | Una sola instrucción atómica por línea | El todo o nada entre varias líneas necesita transacción igualmente; peor mensaje de error por línea |
| E. Cola con un solo consumidor | Elimina la concurrencia | Infraestructura adicional y latencia fuera del alcance |

Idempotencia: (i) fila en tabla con clave primaria `(org_id, user_id, operation, key)` y hash del contenido, (ii) caché en memoria (se pierde al reiniciar y no sirve con varias instancias), (iii) cabecera sin almacenamiento (no repite resultado). Se elige (i).

## Decisión
Se adopta A con idempotencia en tabla (i). Secuencia de la reserva, que es la misma de la sección 5 de `docs/architecture.md`:

1. Resolver sesión (401), comprobar rol COORDINADOR (403), exigir la cabecera `Idempotency-Key` (400) y comprobar que la solicitud existe en la organización de la sesión (404). Nada de esto toca la clave ni el inventario.
2. `BEGIN`.
3. `INSERT INTO idempotency_keys (...) ON CONFLICT DO NOTHING`. Si la fila ya existía y está confirmada: con el mismo `request_hash` (operación, solicitud y cuerpo) se devuelve la respuesta guardada; con otro, 409. Si otra transacción con la misma clave está en curso, el INSERT espera a su resultado.
4. `SELECT ... FROM requests WHERE id = ? AND org_id = ? FOR UPDATE`; si el estado no es ENVIADA, se guarda un 409 y se confirma.
5. Leer las líneas y bloquear `inventory` con `FOR UPDATE` ordenado por `sku_id` ascendente.
6. Si algún `on_hand - reserved` no cubre la cantidad de una línea, guardar la respuesta 409 en la clave y confirmar sin tocar inventario ni estado.
7. Incrementar `reserved` por línea, pasar la solicitud a RESERVADA, insertar el evento en `audit_events` y guardar la respuesta 200 en la clave.
8. `COMMIT`. Cualquier error antes del commit hace `ROLLBACK`: no queda reserva parcial, ni evento, ni clave. Los errores 5xx no se almacenan.

Orden global de bloqueo: clave, solicitud, inventario por `sku_id`. Las restricciones `CHECK` y los disparadores de la base son la última defensa si la lógica de aplicación fallara. Cancelar, despachar y entregar usan la misma disciplina de bloqueo y escriben su auditoría en la misma transacción; solo la reserva exige `Idempotency-Key`.

## Consecuencias
- Las reservas que compiten por el mismo SKU se serializan: es aceptable para el volumen del caso y demostrable con la prueba A-001 contra A-002.
- Un 409 de disponibilidad almacenado se repite durante 24 horas con la misma clave; para reintentar hay que usar otra clave.
- La tabla de claves necesita limpieza periódica de filas vencidas (tarea de mantenimiento documentada en el runbook).
- Una segunda reserva de la misma solicitud con otra clave devuelve 409 por estado.

## Pruebas de la decisión
- AC-RNF02-01: A-001 contra A-002 con base real, resultado 200 y 409 y persistido física 10, reservada 7, disponible 3.
- AC-RNF02-02: fallo forzado antes del commit sin efectos parciales.
- AC-RNF02-03: 100 reservas concurrentes sin negativos ni sobrerreserva.
- AC-RNF02-04 y AC-RF07-01 a AC-RF07-07: idempotencia, conflicto de contenido, independencia entre usuarios y qué errores se almacenan.
- Prueba a nivel SQL ya disponible: `scripts/test_migration.sh` (evidencia en `evidence/tests/T-01-migracion.txt`) comprueba restricciones, auditoría y el patrón atómico concurrente.

## Relación con el diseño
Cubre RF05, RF06, RF07, RF09, RNF02. SPEC-003.

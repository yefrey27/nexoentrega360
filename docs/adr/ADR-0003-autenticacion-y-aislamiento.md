# ADR-0003 Autenticación y aislamiento por organización

Estado: propuesto · Fecha UTC: PENDIENTE · Autor: Yefrey (con asistencia de IA) · Revisor: PENDIENTE (persona distinta al autor) · Commit: PENDIENTE

## Contexto
RF01 exige inicio y cierre de sesión con cuentas sembradas, justificando sesiones o tokens, sin selector de rol y con contraseñas con hash. RF02 y RNF01 exigen aislamiento entre organizaciones con 401, 403 y 404 diferenciados.

## Restricciones
- Un cliente sin identidad obtiene 401; acción prohibida sobre un recurso propio de su organización, 403; recurso inexistente o ajeno, 404 con cuerpo idéntico.
- La organización y el rol salen de la identidad autenticada, nunca de datos del navegador.
- Sin proveedores de identidad externos ni recuperación de contraseña.

## Alternativas

| Alternativa | A favor | En contra |
|-------------|---------|-----------|
| A. Sesión en servidor con cookie `HttpOnly` y `SameSite=Lax`, hash del identificador en base de datos | Cierre de sesión inmediato y revocación; el cliente no lee el secreto; el rol y la organización se leen de la base en cada petición | Una lectura a la base por petición; hay que proteger contra CSRF |
| B. JWT firmado de corta duración | Sin consulta por petición | Revocación y cierre de sesión difíciles; rol u organización quedan fijos en el token hasta expirar; se necesita gestionar claves |
| C. JWT con lista de revocación | Mejor revocación | Reúne los costos de ambos; más piezas |
| D. Autenticación básica HTTP | Mínimo código | Credenciales en cada petición; sin cierre real de sesión |

## Decisión
Alternativa A. Contraseñas con argon2id. El identificador de sesión es aleatorio de 256 bits; se guarda solo su hash (`sessions.id_hash`) con expiración. La cookie lleva `HttpOnly`, `SameSite=Lax` y `Secure` fuera de desarrollo. Las operaciones que cambian estado exigen `Content-Type: application/json` y la comprobación del encabezado `Origin` contra el origen permitido, lo que mitiga CSRF junto con `SameSite`.

Aislamiento en capas:
1. El middleware resuelve la sesión y entrega al caso de uso `{ userId, orgId, role }`; las cabeceras o campos `orgId` y `role` enviados por el cliente se ignoran.
2. Una matriz rol-operación en el servidor decide 403, solo después de comprobar que el recurso es de la organización.
3. Todo repositorio recibe `orgId` y lo incluye en cada consulta; no existen consultas por identificador sin organización. Un recurso ausente o ajeno produce el mismo `NotFound` y por tanto el mismo 404.
4. Las claves foráneas compuestas `(org_id, id)` en la base impiden mezclar organizaciones, por ejemplo un solicitante de otra organización en una solicitud.
5. Un solicitante que lee una solicitud ajena de su misma organización recibe 403 (Q-12).

Para evitar enumeración de usuarios se verifica un hash ficticio cuando el correo no existe, y el mensaje de error es el mismo.

## Consecuencias
- Cierre de sesión y revocación inmediatos.
- Una consulta a base de datos por petición protegida: aceptable con el volumen del caso y cubierta por la prueba de carga.
- El frontend no recibe ni conserva credenciales ni secretos.

## Pruebas de la decisión
- AC-RF01-01 a AC-RF01-06 (login, logout, expiración, hash, identidad ignorada del cliente).
- AC-RF02-01 a AC-RF02-06 y AC-RNF01-01 a AC-RNF01-04: 401, 403, 404 cruzado, dos lecturas y dos escrituras denegadas, aislamiento en listados, auditoría e IA.
- Prueba SQL: la clave foránea compuesta rechaza un solicitante de otra organización (`evidence/tests/T-01-migracion.txt`).
- Detección de secretos en CI.

## Relación con el diseño
Cubre RF01, RF02, RNF01, RNF06. SPEC-001. Responde Q-06.

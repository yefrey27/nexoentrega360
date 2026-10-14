# Constitution de NexoEntrega 360

Versión 0.1.0 · Estado: borrador para G1 · Autor: Yefrey (con asistencia de IA, ver evidence/ai-log/) · Revisión: PENDIENTE (persona distinta al autor) · Fecha UTC de aprobación: PENDIENTE · Commit: PENDIENTE

Cada regla es exigible y trae la forma de comprobarla. Una regla sin comprobación observable no pertenece a este documento.

| ID | Regla | Cómo se comprueba |
|----|-------|-------------------|
| C-01 | Toda operación se autoriza en el servidor con la identidad autenticada. La organización y el rol nunca se toman de un valor enviado por el navegador. | Pruebas de API: 401 sin identidad, 403 por rol, 404 entre organizaciones; prueba que ignora cabeceras o campos `orgId`/`role` enviados por el cliente (AC-RF01-06). |
| C-02 | Un recurso inexistente o de otra organización responde 404 con cuerpo idéntico. | Prueba que compara cuerpo y cabeceras de ambos casos (AC-RF02-01). |
| C-03 | Existencia física, cantidad reservada y disponible nunca son negativas, y reservada nunca supera la existencia. | Restricciones CHECK en la base, probadas con SQL directo en `evidence/tests/T-01-migracion.txt`; pruebas de API sobre base real. |
| C-04 | La reserva cubre todas las líneas o ninguna, dentro de una sola transacción con bloqueo de filas en orden determinista. | Prueba de concurrencia A-001 contra A-002 con resultado persistido 10/7/3; prueba de rechazo sin efectos parciales. |
| C-05 | La reserva exige `Idempotency-Key`; la misma clave con el mismo contenido repite el resultado y con contenido distinto devuelve 409. | Pruebas de integración de reintento y de conflicto (AC-RF07-xx en SPEC-003). |
| C-06 | Estado, inventario y evento de auditoría se persisten en la misma transacción. | Prueba que fuerza un fallo antes del commit y verifica que ninguna de las tres cosas cambió. |
| C-07 | La auditoría es append-only: sin endpoints de edición o borrado, y el rol de la aplicación no tiene UPDATE ni DELETE sobre la tabla. | Prueba de API (405/404) y prueba SQL con el rol `nexo_app` (permiso denegado). |
| C-08 | La salida de la IA es dato no confiable: se valida contra el esquema, los IDs se contrastan con los enviados y el texto se muestra escapado. | Pruebas de IA: JSON inválido, campo extra, ID ajeno, duplicado, inyección en observaciones; prueba de interfaz que verifica texto sin ejecutar. |
| C-09 | La IA no escribe inventario ni invoca operaciones privilegiadas; el adaptador no recibe esa capacidad. | Revisión de la interfaz del proveedor (solo recibe datos y devuelve texto); prueba de que el payload contiene únicamente los campos permitidos. |
| C-10 | Si la IA falla, hay timeout de 5 s o la salida es inválida, el sistema devuelve un resumen determinista y el resto sigue operando. | Pruebas con fixtures de fallo y timeout; prueba con proveedor `none`. |
| C-11 | Ningún secreto en el repositorio, en logs ni en respuestas. | Detección de secretos en CI; prueba de logs con correlationId sin contraseñas ni tokens. |
| C-12 | Ningún cambio se integra sin PR, revisión de una persona distinta al autor y checks de CI en verde. Un check desactivado o un test omitido se declara. | Historial de PR con revisión; gate-reviews; tabla de checks omitidos en `evidence/acceptance.md`. |
| C-13 | Cada funcionalidad se especifica y se aprueba antes de implementarse; un cambio vuelve a pasar por análisis y actualiza los artefactos afectados. | Fecha UTC y commit de aprobación de la SPEC anteriores al primer commit de código de esa funcionalidad. |
| C-14 | La fuente de cada SPEC es `spec.md`; `spec.json` es derivado y CI comprueba que coincide. | `python3 scripts/export_specs.py --check` en CI. |
| C-15 | Trazabilidad bidireccional Requerimiento → Historia → SPEC → Código → Prueba para cada RF y RNF. | `evidence/traceability.csv` sin celdas vacías salvo gaps marcados y justificados. |
| C-16 | Los oráculos de prueba se escriben antes de implementar y no usan el algoritmo de producción. | Valores esperados literales en la prueba, con fecha de commit anterior al código que cubren. |
| C-17 | Todos los datos son ficticios y las versiones están fijadas con lockfile o imagen. | Revisión del seed; lockfiles versionados; imagen `postgres:16.4` fijada en Compose. |
| C-18 | Todo uso relevante de IA queda registrado con prompt, decisión humana y verificación; la IA no aprueba sus propias salidas. | `evidence/ai-log/` con al menos seis intervenciones y declaración de IA en cada PR relevante. |

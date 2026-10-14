# ADR-0004 Integración de IA y degradación

Estado: propuesto · Fecha UTC: PENDIENTE · Autor: Yefrey (con asistencia de IA) · Revisor: PENDIENTE (persona distinta al autor) · Commit: PENDIENTE

## Contexto
El asistente resume hasta 20 solicitudes ENVIADA y sugiere cuáles revisar (RF10 a RF12). Nunca decide ni mueve inventario. Debe funcionar sin proveedor, tener pruebas reproducibles y demostrar una salida de un LLM real o una reproducción declarada.

## Restricciones
- El proveedor recibe solo requestId, zona, prioridad, fecha requerida, estado y observaciones.
- Salida esperada: `summary` hasta 600 caracteres y hasta 5 recomendaciones con `requestId` válido del conjunto enviado, `reason` hasta 240 y `evidenceFields` de 1 a 3 claves entre zona, prioridad, fechaRequerida y observaciones; sin duplicados ni propiedades extra.
- Timeout de 5 segundos; ningún servicio de pago para CI.
- Las observaciones y la salida del modelo son contenido no confiable.

## Alternativas

| Alternativa | A favor | En contra |
|-------------|---------|-----------|
| A. Interfaz `AiProvider` con implementaciones live, local, replay, fixture y none, más validador independiente y resumen determinista | CI determinista; cambio de proveedor sin tocar el dominio; degradación definida | Más código que una llamada directa |
| B. Llamar directamente a un SDK de un proveedor | Rápido | Acopla el dominio, impide CI sin pago y no tiene degradación |
| C. Dar herramientas al modelo (reservar, consultar inventario) | Más autonomía | Contradice el requisito: el modelo no mueve inventario ni invoca operaciones privilegiadas |
| D. Confiar solo en un prompt que prohíba acciones | Simple | Un prompt no es un control; la inyección de instrucciones lo eludiría |

## Decisión
Alternativa A. La interfaz es `summarize(input): Promise<string>`: recibe el payload mínimo y devuelve texto JSON sin capacidades. Un único módulo `asistente` se encarga de:
1. Resolver los IDs dentro de la organización antes de llamar al proveedor (404 si alguno falta o es ajeno; 422 si no está ENVIADA o la cantidad no está entre 1 y 20).
2. Construir el payload con la lista blanca de campos.
3. Invocar con `AbortController` y timeout de 5 s.
4. Validar con JSON Schema (`contracts/ai-output.schema.json`, `additionalProperties: false`) y luego en código: pertenencia de los IDs al conjunto enviado, ausencia de duplicados, longitudes y claves permitidas.
5. Ante salida inválida, timeout o error, producir el resumen determinista (Q-13) y responder 200 con `origin: fallback` y mensaje controlado. Un fallo del proveedor nunca produce 5xx.
6. Persistir el intento en `ai_attempts` (Q-05) y presentar el borrador como asistencia de IA o resumen automático.
7. La aprobación es una operación aparte, solo del coordinador, que escribe `audit_events`; no cambia estado, reserva ni prioridad.

Proveedores: `fixture` (CI), `replay` (respuesta real capturada, declarada como reproducción, con entrada, salida y origen guardados), `local` y `live` (opcionales), `none` (por defecto, siempre determinista). La interfaz de usuario escapa todo texto de la IA y de las observaciones.

## Consecuencias
- CI no depende de servicios externos ni de pago.
- La evidencia de LLM real puede ser una reproducción honesta; no se afirma una invocación en vivo si no la hubo.
- Mantener un validador independiente cuesta código, pero es el control que sostiene la seguridad.

## Pruebas de la decisión
- AC-RF11-01 a AC-RF11-07: válida, JSON inválido, campo extra, ID ajeno, duplicado, límites e inyección en observaciones.
- AC-RF12-01 a AC-RF12-07: timeout, fallo, proveedor none, identificación del borrador, aprobación solo del coordinador y reproducción declarada.
- AC-RF10-01 a AC-RF10-05 y AC-RNF01-05: payload mínimo, 404 sin invocar al proveedor, sin datos de otra organización.
- Prueba arquitectónica: `asistente` no importa `inventario` (lint de importaciones).

## Relación con el diseño
Cubre RF10, RF11, RF12, RNF01, RNF06. SPEC-005. Referencia: OWASP LLM01 2025.

# ADR-0001 Estructura y límites del sistema

Estado: propuesto · Fecha UTC: PENDIENTE · Autor: Yefrey (con asistencia de IA) · Revisor: PENDIENTE (persona distinta al autor) · Commit: PENDIENTE

## Contexto
NexoEntrega 360 debe ofrecer una aplicación web, una API HTTP y una base relacional persistente para dos organizaciones aisladas. El equipo es pequeño y el plazo es de siete días. El enunciado permite un monolito modular y excluye microservicios y Kubernetes.

## Restricciones
- Siete días y una sola persona, con 16 a 20 horas de dedicación.
- Reserva transaccional con varias tablas: la consistencia importa más que el aislamiento de despliegue.
- Arranque desde clon limpio en 15 minutos o menos (RNF04) con versiones fijadas.
- Sin servicios de pago para ejecutar CI ni la demostración.

## Alternativas

| Alternativa | A favor | En contra |
|-------------|---------|-----------|
| A. Monolito modular (API Node + TypeScript, SPA React, PostgreSQL) | Una sola transacción cubre estado, inventario y auditoría; un solo despliegue; pruebas con base real simples | Los límites entre módulos dependen de disciplina |
| B. Microservicios (identidad, inventario, solicitudes) | Aislamiento fuerte | Transacciones distribuidas para la reserva todo o nada; complejidad operativa fuera del alcance |
| C. Aplicación renderizada en servidor sin SPA | Menos piezas en el cliente | Peor ajuste con el E2E y las pantallas interactivas pedidas; menos separación API y UI |
| D. Backend como servicio gestionado | Menos código inicial | Dependencia externa y de pago potencial; menos control sobre transacciones y permisos |

## Decisión
Se adopta la alternativa A: un monolito modular con módulos `identidad`, `solicitudes`, `inventario`, `consultas`, `auditoria` y `asistente`, una SPA React que solo consume la API y PostgreSQL 16.4. Los módulos se comunican por interfaces explícitas y acceden a datos mediante repositorios que reciben siempre la organización de la sesión. El módulo `asistente` no depende de `inventario`.

## Consecuencias
- Positivas: la reserva es una sola transacción; el CI y la demo corren con Compose; el contrato OpenAPI es único.
- Negativas: un fallo del proceso afecta a todos los módulos; los límites se hacen cumplir con revisión y una regla de lint de importaciones.
- Riesgo residual: acoplamiento accidental; se mitiga con la regla de dependencias y revisión en PR.

## Pruebas de la decisión
- Regla de lint de importaciones que prohíbe que `asistente` importe `inventario` (CI).
- Prueba de transacción: un fallo forzado antes del commit no deja estado, inventario ni evento parciales.
- Prueba de arranque desde clon limpio en 15 minutos o menos (RNF04).

## Relación con el diseño
Ver `docs/architecture.md` secciones 1 a 3 y 7. Cubre RNF01, RNF02, RNF04.

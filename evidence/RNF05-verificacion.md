# RNF05 - Revisión manual a ancho móvil y con teclado

**Resultado: PARCIAL.** Verificación manual, no automatizada.

- Fecha: 2026-10-14
- Revisor: Yefrey Navarro
- Navegador: Brave (DevTools, modo dispositivo)
- Ancho probado: 393 px (la SPEC pide 390 px)
- Aplicación: commit de main 0c2f13d3210849cc8ec054bc3bc2f4c52f92d7db, PostgreSQL 18.6 portable, cuenta SOLICITANTE ORG-A

## Qué se observó (capturas en evidence/RNF05/)
| Aspecto | Resultado |
|---|---|
| Formulario de nueva solicitud a 393 px | Sin desbordamiento horizontal visible |
| Listado "Mis solicitudes" a 393 px | Tarjetas, filtros y paginación caben en pantalla |
| Etiquetas | Visibles en Zona, Prioridad, Fecha requerida, Observaciones, SKU, Cantidad y Estado |
| Foco con teclado | Contorno visible en Zona, Prioridad, Fecha, Observaciones, SKU y filtro Estado |
| Flujo | Se creó un borrador (SOL-ORG-A-000002) y aparece en el listado con botón Enviar |

## Qué NO se verificó (por eso es Parcial)
- Ancho exacto de 390 px (se probó 393 px).
- Ancho de 1366 px: ninguna pantalla.
- Tablero y detalle (requieren cuenta de coordinador), en ningún ancho.
- Mensaje de error de validación asociado a su campo.
- Recorrido completo solo con teclado (login, crear, enviar y navegar). Solo se comprobó que el foco es visible.
- Revisión por una persona distinta del autor.

AC-RNF05-01 y AC-RNF05-02 quedan parcialmente cubiertos.

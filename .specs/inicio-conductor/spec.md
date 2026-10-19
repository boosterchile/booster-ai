# Inicio del conductor

**Estado**: aceptada por el pedido del PO · **Fecha**: 2026-10-19

Superficie `/app/conductor`. Platform-admin y stakeholder quedan fuera.

## Entradas

- `GET /me/assignments` para el próximo tramo y la lista Después.
- La ruta en pantalla y la sugerencia de eco-routing que ya usa el viaje en ruta (`useSugerenciaRutaActiva`).
- `POST /assignments/:id/incidents` al avisar un incidente (`useReportarIncidenteMutation`).
- El wake-word real sigue en `WakeWordBanner` (`useWakeWord`) cuando el flag está prendido.

No hay ventana de entrega ni kilómetros en esa respuesta. No se inventan. No hay ETA en vivo ni puntaje. La licencia por vencer queda detrás de `INICIO_LICENCIA_CONDUCTOR_ACTIVA = false`.

## Salidas

1. `TripHeroCard` del próximo viaje: tramo, retiro con la ventana de recogida si existe, entrega con el lugar. CTA «Iniciar viaje».
2. «Iniciar viaje» abre la misma confirmación de recogida de hoy. Confirmar entrega, el GPS y el cierre con documento requerido no cambian.
3. Acciones Cómo llegar (abre la ruta en esta pantalla), Documentos (la oficina carga la guía) e Incidente.
4. Card calma «Oye Booster». No afirma que el micrófono escucha.
5. Lista Después con los otros viajes.
6. Chip «GPS activo» solo si el permiso de ubicación ya está concedido.

## Criterios de éxito

- Sin ventana de retiro, el héroe no inventa una hora.
- Un viaje en cero sigue en el empty state.
- Sentarse en la pantalla no agrega un poleo nuevo: la sugerencia de ruta conserva el suyo, y solo en ruta.

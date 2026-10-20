# Plan — Voz y acciones de conductor

1. Señal de la asignación: función pura `esConductorDelViaje(viewerUserId, driverUserId)`. Es la misma comparación que el API usa en `esConductorAsignado` (`assignments.driverUserId === user.id`). El rol no entra.
2. `/app/asignaciones/:id` usa esa función para montar `DeliveryConfirmCard` e `IncidentReportCard`. No toca documentos, chat, ruta, traza, cobra hoy ni el formulario de asignar conductor.
3. `useVoiceCommand` guarda `acceptedIntents` en un ref. Un `Set` nuevo en cada render no debe re-suscribir ni abortar el micrófono.
4. `VoiceAcceptOfferControl` e `IncidentReportCard` crean un solo reconocedor y se lo pasan al botón. Si no, el botón escucha en una instancia y la tarjeta actúa en otra.
5. El parser acepta «aceptar» / «acepto». En reposo esa frase corta no abre la confirmación (hace falta «oferta»). En confirmación, sí cierra.
6. Ofertas: sin cambio de visibilidad. `is_solo_operator` no está en `empresas`. La membresía es única por `(usuario, empresa)` y el dueño-conductor sigue siendo `dueno`.

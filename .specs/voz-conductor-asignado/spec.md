# Spec — Voz y acciones de conductor solo para quien conduce el viaje

**Estado**: pedido del PO en el mensaje del agente (2026-10-20). El único cambio de contrato es el booleano `tiene_ficha_conductor` en `GET /me`. No cambia la autorización de aceptar ofertas.

## Entradas

- Pantalla `/app/ofertas`, con exactamente una oferta pendiente.
- Pantalla `/app/asignaciones/:id`, con `assignment.driver_user_id` y el `user.id` de `GET /me`.
- Rol de la membresía activa (`dueno | admin | despachador | conductor | …`).
- `tiene_ficha_conductor` de `GET /me` para la empresa activa.
- Web Speech API del navegador (`SpeechRecognition` / `webkitSpeechRecognition`).

## Salidas

1. En `/app/asignaciones/:id`, «¿Ya entregaste la carga?» y «Reportar incidente» (botón y voz) se muestran solo si `user.id` es el `driver_user_id` de esa asignación. El administrador de la empresa que no es ese conductor no las ve.
2. «Documentos de transporte» sigue visible para quien ya podía ver la ejecución del viaje. Subir sigue reservado a `dueno | admin | despachador`.
3. Decir «aceptar oferta» en la tarjeta de Ofertas abre la confirmación, y decir «aceptar» en ese estado llama a `POST /offers/:id/accept`. El micrófono y el listener usan el mismo reconocedor.
4. La tarjeta «Aceptar por voz» de `/app/ofertas` se muestra solo si el rol de la empresa activa es `dueno` y `GET /me` trae `tiene_ficha_conductor: true` (fila viva en `conductores` de esa empresa, la de «Soy yo el conductor»). Dueño sin ficha, admin, despachador y conductor empleado no la ven. Los botones Aceptar y Rechazar, y `POST /offers/:id/accept`, no cambian.

## Criterios de éxito

- Un viewer con `user.id !== driver_user_id` no ve entrega ni incidente; sí ve documentos si el viaje ya tiene conductor.
- Un viewer con `user.id === driver_user_id` ve entrega e incidente, sea su rol `dueno` o `conductor`.
- El test de voz no inyecta un `VoiceCommandController`: mockea `SpeechRecognition`, pulsa Hablar, emite «aceptar oferta» y luego «aceptar», y comprueba el POST.
- Dueño con ficha ve la tarjeta de voz. Dueño sin ficha, admin y conductor empleado no la ven. Un admin pulsa Aceptar y el cliente llama a `POST /offers/:id/accept`.
- Datos de test sintéticos (`11.111.111-1`, `@example.com`, `TEST01`). Sin nombres ni RUT de clientes.

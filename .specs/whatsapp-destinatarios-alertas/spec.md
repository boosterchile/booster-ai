# Spec — Destinatario de WhatsApp y alertas de camión

**Estado**: aceptada por el PO el 2026-09-23 (confirmación en el hilo de revisión Twilio/WhatsApp).
**Entradas**: evento de negocio (oferta, chat no leído, asignación, alerta Teltonika, alta de conductor) y las membresías activas de la empresa.
**Salidas**: cero o más envíos Twilio al `whatsapp_e164` de las personas que pueden actuar. Un número recibe cada aviso una sola vez.

## Destinatario

| Aviso | Quién | Campo |
|---|---|---|
| Oferta nueva | Despachadores activos con WhatsApp. Si no hay ninguno, los dueños. | `usuarios.whatsapp_e164` |
| Chat no leído | Igual que la oferta, del lado que no leyó. | `usuarios.whatsapp_e164` |
| Carga asignada | Quien creó la carga, y además el destinatario si dejó un teléfono distinto. | `whatsapp_e164` del generador y `viajes.destinatario_whatsapp_e164` |
| Alerta del camión | Dueños y despachadores. Nunca el conductor. | `whatsapp_e164` |
| Activación de conductor | El teléfono escrito en el alta. | `phone` del alta |
| Respuesta del bot | Quien escribió. | `From` de Twilio |

Si dos fichas comparten el mismo número, sale un solo mensaje. `usuarios.telefono` no es canal de aviso.

## Alertas del camión (falsos positivos)

El aviso al cliente sale solo cuando el record es el evento, no cuando el IO queda pegado en los puntos siguientes:

- Desconexión (AVL 252 = 1) solo si `eventIoId` es 252.
- Jamming solo en crítico (AVL 318 = 2) y solo si `eventIoId` es 318. El warning (valor 1) sigue en el log de operación y no genera WhatsApp ni push.
- Colisión: la traza se archiva siempre. El aviso al cliente sale si no hay acelerómetro parseado, o si el pico es de al menos 3 G. Un pico entre 0 y 3 G (golpe de patio, gravedad en reposo) no avisa.

## Criterio de éxito

- Un record periódico con AVL 252 = 1 y `eventIoId` 0 no publica evento de cliente.
- AVL 318 = 1 no publica evento de cliente. AVL 318 = 2 con `eventIoId` 318 sí.
- La oferta y el chat no eligen al dueño más antiguo: eligen despachadores, y dueños solo si no hay despachador.
- La alerta de seguridad lee `whatsapp_e164` y incluye despachador y dueño.
- Dos números distintos en una asignación producen dos envíos del link; el mismo número, uno.

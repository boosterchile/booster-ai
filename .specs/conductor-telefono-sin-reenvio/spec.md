# Spec — guardar el teléfono del conductor sin reenviar la invitación

**Slug**: `conductor-telefono-sin-reenvio` · **Fecha**: 2026-10-21

Reemplaza las salidas 3 y 7 de `conductor-telefono-whatsapp` por decisión del
PO (2026-10-21). El resto de esa spec sigue vigente.

## Problema

En la ficha del conductor, guardar el WhatsApp de un conductor pendiente
genera un PIN nuevo y le manda la invitación. El PIN que la empresa ya le
entregó deja de servir. Corregir un número no debería invalidar su código.

Para un conductor con la cuenta activa el botón solo guarda el número, pero
igual dice «Guardar teléfono y reenviar invitación».

## Entradas

- `POST /conductores/:id/telefono` con `{ phone, reenviar_invitacion? }`.
  `phone` se valida igual que antes (móvil `+569XXXXXXXX`).
  `reenviar_invitacion` es booleano opcional; ausente equivale a `false`.
  Si no es booleano, 400 de validación y no escribe (el mismo 400 genérico
  que el alta devuelve para un campo que no es el teléfono).
- Ficha web, bloque «Teléfono (WhatsApp)».

## Salidas

1. Sin `reenviar_invitacion` o con `false`: actualiza `users.phone` y nada
   más. No toca `activacion_pin_hash` y no llama a
   `enviarWhatsAppActivacionConductor`. Responde `invitacion_reenviada: false`
   y sin `activation_pin`, esté la cuenta pendiente o activa.
2. Con `reenviar_invitacion: true` y la cuenta pendiente: hace lo de la
   salida 3 anterior. Guarda el número, regenera el PIN, manda el WhatsApp al
   número nuevo y devuelve `activation_pin`.
3. Con `reenviar_invitacion: true` y la cuenta activa: solo guarda el número.
   Igual que la salida 1.
4. Los 400, 403, 404, 409 y 410 de la spec anterior no cambian, y se evalúan
   antes de escribir.
5. Ficha web:
   - «Guardar teléfono» es el botón principal y manda
     `reenviar_invitacion: false`. Al responder OK actualiza el encabezado sin
     recargar y muestra «Teléfono guardado.».
   - «Guardar y reenviar invitación» solo aparece si el conductor sigue
     pendiente, y manda `reenviar_invitacion: true`. Al responder OK muestra
     `ActivationPinCard` con el PIN nuevo.
   - Los dos botones quedan deshabilitados si el número no cumple
     `/^\+569\d{8}$/` o si hay un guardado en curso.
   - El texto de ayuda del pendiente explica que guardar no cambia el PIN y
     que reenviar genera uno nuevo y deja sin efecto el anterior.

## Criterios de éxito

- Test de API en rojo antes del cambio: un pendiente sin
  `reenviar_invitacion` hoy recibe PIN nuevo y WhatsApp.
- Tests de API: salida 1 con pendiente y con activa, salida 2, salida 3,
  `reenviar_invitacion` no booleano → 400.
- Tests de web: «Guardar teléfono» manda `false` y no muestra PIN; el botón
  de reenvío solo aparece en pendiente, manda `true` y muestra el PIN.
- Sin migraciones y sin archivos protegidos.

## Compatibilidad durante el despliegue

Durante el canario puede convivir la web nueva con la API vieja, o al revés.
La API vieja ignora el campo nuevo, porque `z.object` descarta las claves
desconocidas, y se comporta como hoy. La web vieja contra la API nueva solo
guarda el número. Ningún cruce deja datos inconsistentes.

## No-objetivos

- Cambiar el bloque del email: sigue reenviando la invitación al guardar si
  el conductor está pendiente.
- Enviar el PIN por WhatsApp.
- Auditoría durable del cambio de teléfono (sigue pendiente, ver la spec
  anterior).

# Spec — teléfono WhatsApp del conductor y reenvío de invitación

**Slug**: `conductor-telefono-whatsapp` · **Fecha**: 2026-10-19

> Las salidas 3 y 7 las reemplaza `conductor-telefono-sin-reenvio`
> (decisión del PO, 2026-10-21): guardar el teléfono ya no reenvía la
> invitación salvo que se pida.

## Problema

La ficha del conductor deja corregir el email y reenviar el PIN, pero no el
WhatsApp. Si el alta enlazó un RUT que ya existía como usuario, los `update`
de `users` tampoco guardan `phone` cuando el número venía vacío. El conductor
queda inalcanzable por el canal principal.

## Entradas

- `POST /conductores/:id/telefono` con `{ phone }` validado por
  `chileanPhoneSchema` y restringido a móvil `+569XXXXXXXX` (un fijo `+562…`
  es 400). Misma autorización que `POST /conductores/:id/email`
  (`dueno` | `admin` | `despachador`) y el mismo join `conductores` → `users`
  filtrado por `empresaId`.
- Alta `POST /conductores` cuando el RUT ya es un usuario y `users.phone` está
  vacío (`null` o string en blanco).
- Ficha web: bloque «Teléfono (WhatsApp)» junto al email.

## Salidas

1. Teléfono inválido → 400 `{ error: 'telefono_invalido', message: 'Ingresa un teléfono válido (+569...)' }` y no escribe.
2. Conductor de otra empresa (o inexistente) → 404 `conductor_not_found`.
   Persona vinculada a otra empresa, a una organización o con otro rol aquí
   → 409 `identidad_vinculada` antes de escribir `users.phone` o el PIN.
3. Pendiente de login → actualiza `users.phone`, regenera el PIN como el
   reenvío por email, llama `enviarWhatsAppActivacionConductor` al número nuevo
   y devuelve `activation_pin`.
4. Cuenta ya activa → actualiza el teléfono y no devuelve PIN ni manda WhatsApp.
5. Alta con RUT existente y teléfono vacío → el `update` de `users` incluye
   `phone: body.phone`. Si ya tenía teléfono, no se pisa.
6. El cambio no entra por `PATCH /conductores/:id`.
7. En la ficha, el botón «Guardar teléfono y reenviar invitación» queda
   deshabilitado si el valor no cumple `/^\+569\d{8}$/`. Al responder OK se
   muestra `ActivationPinCard` con el PIN nuevo y el encabezado refleja el
   teléfono y el email nuevos sin recargar la página.

## Criterios de éxito

- Tests de API: OK pendiente, 400, 404 de otra empresa, alta con RUT existente
  guarda `phone`.
- Tests de web en `apps/web/src/routes/conductores.test.tsx`.
- Sin migraciones y sin archivos protegidos.

## No-objetivos

- Auditoría durable del cambio de teléfono. `auditoria_email_conductor` no
  sirve: exige email anterior/nuevo y `accion_firebase`, y no tiene columnas
  de teléfono. Hace falta una tabla nueva; queda pendiente, sin migración en
  este cambio.
- Enviar el PIN por WhatsApp (sigue sin viajar en la plantilla).
- Reescribir el teléfono de una cuenta que ya lo tenía, en el alta.

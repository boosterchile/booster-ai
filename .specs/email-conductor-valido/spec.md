# Spec: email de conductor con dominio válido

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-10-19
- Status: Draft — pendiente de aceptación del PO
- Linked: `.specs/email-real-conductor/` (email real y corrección en la ficha)

## 1. Objective

En `/app/conductores/nuevo` y en «Email de contacto» de la ficha, un email inválido se explica dentro de la app, en español y con tuteo. El mismo esquema Zod lo exige en el cliente y en la API: el dominio tiene que llevar un TLD. «Crear conductor» y «Guardar email y reenviar invitación» permanecen deshabilitados hasta que el formulario es válido.

## 2. Why now

El smoke de producción (commit `760a37b`) vio que «a@b» pasa y que los botones siguen habilitados con «abc» o con campos obligatorios vacíos. La única señal era la validación nativa del navegador.

## 3. Success criteria

- [ ] SC1 — `conductorContactEmailSchema` rechaza `abc`, `a@b` y un TLD de una sola letra. Acepta `nombre@dominio.cl` y lo guarda en minúsculas. El mensaje de formato es «Escribe un email válido, como nombre@dominio.cl».
- [ ] SC2 — `POST /conductores` y `POST /conductores/:id/email` responden 400 ante esos emails. No escriben.
- [ ] SC3 — En el alta, el mensaje aparece al escribir un email inválido y «Crear conductor» está deshabilitado si falta un obligatorio o el email no pasa el esquema.
- [ ] SC4 — En la ficha, el mismo mensaje aparece y «Guardar email y reenviar invitación» está deshabilitado hasta que el email pasa el esquema.

## 4. Fuera de alcance

No se cambia el flujo de activación, Firebase ni la auditoría. No se cargan datos en producción.

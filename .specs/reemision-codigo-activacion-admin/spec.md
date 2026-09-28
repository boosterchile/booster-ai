# Spec: reemision-codigo-activacion-admin

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-09-28
- Status: Draft — pendiente de aceptación del PO
- Linked: `.specs/alta-desde-panel-admin/spec.md` (alta de ficha e invitación; esta spec no la edita), `.specs/equipo-de-la-empresa/` (código de un solo uso), ADR-035 (RUT + clave numérica)

---

## 1. Objective

Después de crear una empresa o invitar a una persona, el platform-admin sigue viendo esas invitaciones pendientes y puede emitir un código de activación nuevo para entregárselo a la empresa. El código de ayer no se recupera: se emite otro y el anterior deja de servir.

## 2. Why now

El admin creó una empresa transportista y se generó un código de acceso. Los cambios de hoy sacaron ese código de la pantalla y no quedó forma de enviarle esa información a la empresa. La fila pendiente tiene que seguir visible, y hace falta un camino para generar un código nuevo sin rotar la invitación original ni activar la cuenta.

## 3. Success criteria

- [ ] SC1 — `GET /admin/empresas` conserva `id`, `razon_social`, `rut`, `estado`, `es_transportista` y `es_generador_carga`, y agrega `miembros_pendientes` y `dueno_pendiente`. Sin invitaciones: `miembros_pendientes: []` y `dueno_pendiente: null`.
- [ ] SC2 — `POST /admin/empresas` sigue respondiendo 201 sin persona y sin `codigo_activacion`. La empresa queda en `pendiente_verificacion`.
- [ ] SC3 — `POST /admin/empresas/:id/miembros` sigue respondiendo 201 una sola vez, con el código. Repetir responde 409 `already_member` y no rota el hash.
- [ ] SC4 — `POST /admin/empresas/:id/miembros/:membershipId/codigo`, sin body, emite un PIN nuevo solo si la membresía es de esa empresa, está en `pendiente_invitacion`, `clave_numerica_hash` es NULL y `firebase_uid` empieza por `pending-rut:`. Responde 200 con el código. La fila sigue `pendiente_invitacion`.
- [ ] SC5 — Si la persona ya activó (membresía activa, o pendiente con clave, o `firebase_uid` real) responde 409 `already_activated` y no escribe. Membresía ajena o inexistente: 404 `membership_not_found`.
- [ ] SC6 — El PIN en claro sale solo en esa respuesta 200. En base de datos queda solo el hash. El log no contiene el código, y la auditoría y el span no llevan PIN, RUT ni email.
- [ ] SC7 — Solo platform-admin. Una sesión de impersonación recibe 403 y no escribe. El guard ya está en `server.ts` sobre `/admin/empresas/*`; el handler no lo duplica.
- [ ] SC8 — En `/app/platform-admin/empresas` cada pendiente se lista (nombre, RUT, email, rol, vencimiento) y «Generar código nuevo» muestra el código una vez, con el aviso de que el anterior deja de servir. La persona no sale de la lista.

## 4. Contrato

No se persiste el PIN en claro. `POST /auth/activar` no se toca. No hay migración, correo ni WhatsApp. No se rota el código vía el POST de invitación. No se pasa la membresía a `activa`.

`expira_en` de cada pendiente es `invitado_en` + 7 días. El objeto de `miembros_pendientes` es `{ user_id, membership_id, nombre, rut, email, rol, invitado_en, expira_en }` y no trae `codigo_activacion`. Si el rol es `dueno`, el mismo objeto también va en `dueno_pendiente`. Si no hay dueño pendiente, `dueno_pendiente` es `null`. Si hay más de un dueño, gana el `invitado_en` más antiguo.

La reemisión reemplaza `activacion_pin_hash` y pone `invitado_en = now()`. La respuesta 200 trae `codigo_activacion`, `expira_en` (now + 7 días), `membership_id`, `user_id`, `rol` y `estado: pendiente_invitacion`.

## 5. Delta sobre el alta desde el panel

Este delta reemplaza, solo aquí, la ruta draft `POST /admin/empresas/:id/dueno/codigo` de `.specs/alta-desde-panel-admin/spec.md` por `POST /admin/empresas/:id/miembros/:membershipId/codigo`. El archivo de aquella spec no se edita. El listado de pendientes cubre a cualquier rol invitado, no solo al dueño; `dueno_pendiente` queda como atajo al dueño más antiguo.

## 6. Fuera de alcance

`CrearEmpresa.tsx`, `auth-activar.ts`, `me-empresa-miembros.ts`, el schema SQL, `server.ts`, `platform-admin-empresas.tsx` y `check-route-default-deny.ts`. La factory de rutas ya es ENFORCED.

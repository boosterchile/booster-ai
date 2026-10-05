# Spec: aislamiento al vincular una persona que ya existe

- Author: agente, por pedido de revisión multi-tenant
- Date: 2026-10-05
- Status: Draft — cierra un hueco de identidad contra specs ya vigentes
- Linked: `.specs/equipo-de-la-empresa/spec.md` (riesgo «solo agrega la membresía»; la clave no se toca), `.specs/alta-desde-panel-admin/spec.md` SC5, ADR-028, ADR-035

## 1. Objective

Que una empresa (o el admin de plataforma, o una organización stakeholder) pueda sumar a una persona que ya está en Booster **sin recibir un código que reescriba su clave**.

## 2. Why now

`POST /me/empresa/miembros`, `POST /admin/empresas/:id/miembros` y `POST /admin/stakeholder-orgs/:id/invitar` pisan `usuarios.activacion_pin_hash` cuando el RUT ya existe. `POST /auth/activar` acepta ese código y reemplaza `clave_numerica_hash` y `firebase_uid`, también si la cuenta ya estaba activa. Quien conoce el RUT de alguien de otra empresa obtiene su sesión.

`POST /conductores` hace lo mismo cuando el `firebase_uid` sigue en `pending-rut:`.

## 3. Success criteria

- [ ] SC1 — Persona con cuenta viva (`clave_numerica_hash` presente, o `firebase_uid` que no empieza por `pending-rut:`): se agrega la membresía en `activa`, no se escribe el usuario, la respuesta trae `codigo_activacion: null` y `vinculo: "cuenta_activa"`.
- [ ] SC2 — Persona provisoria que ya tiene código (`pending-rut:` , sin clave, con `activacion_pin_hash`): se agrega la membresía en `pendiente_invitacion`, el hash no cambia, `codigo_activacion: null`, `vinculo: "codigo_vigente"`.
- [ ] SC3 — Persona provisoria sin código: se emite un código nuevo, hasheado, una sola vez. Igual que un alta nueva (`vinculo: "nueva"` o `"provisoria_sin_codigo"`).
- [ ] SC4 — `POST /auth/activar` con un código que coincide pero la cuenta ya está viva responde 401 `invalid_credentials` y no escribe clave, pin ni Firebase.
- [ ] SC5 — Al activar una cuenta que sigue provisoria, pasan a `activa` todas las membresías `pendiente_invitacion` cuyo `invitado_en` está dentro de los 7 días.
- [ ] SC6 — `DELETE /me/push-subscription` borra solo la fila de ese usuario. El endpoint de otra persona no se elimina.

## 4. Out of scope

- Bandeja global de Teltonika (`GET /admin/dispositivos-pendientes`): el alta por IMEI que la empresa tipea ya está en `PATCH /vehiculos/:id/dispositivo`. Sacar la bandeja del panel de la empresa es un cambio de flujo, no de este arreglo.
- Consentimiento de zonas stakeholder: el modelo de ADR-028 no expresa «qué organización ve qué zona». Sigue el TODO de `stakeholder-zonas.ts`.
- Índice UNIQUE de `usuarios.rut`. Hoy es un índice no único. Un UNIQUE es migración y hay que medir duplicados antes.

## 5. Constraints

La credencial sigue siendo de la persona (ADR-035). Un código de un tercero no la reemplaza. La respuesta 401 de `/auth/activar` no distingue RUT inexistente, código malo y cuenta ya viva.

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

- [x] SC1 — Persona con cuenta viva (`clave_numerica_hash` presente, o `firebase_uid` que no empieza por `pending-rut:`): se agrega la membresía en `activa`, no se escribe el usuario, la respuesta trae `codigo_activacion: null` y `vinculo: "cuenta_activa"`.
- [x] SC2 — Persona provisoria que ya tiene código (`pending-rut:` , sin clave, con `activacion_pin_hash`): se agrega la membresía en `pendiente_invitacion`, el hash no cambia, `codigo_activacion: null`, `vinculo: "codigo_vigente"`.
- [x] SC3 — Persona provisoria sin código: se emite un código nuevo, hasheado, una sola vez. Igual que un alta nueva (`vinculo: "nueva"` o `"provisoria_sin_codigo"`).
- [x] SC4 — `POST /auth/activar` con un código que coincide pero la cuenta ya está viva responde 401 `invalid_credentials` y no escribe clave, pin ni Firebase.
- [x] SC5 — Al activar una cuenta que sigue provisoria, pasan a `activa` todas las membresías `pendiente_invitacion` cuyo `invitado_en` está dentro de los 7 días.
- [x] SC6 — `DELETE /me/push-subscription` borra solo la fila de ese usuario. El endpoint de otra persona no se elimina.

## 4. Out of scope

La bandeja Teltonika, el consentimiento de las zonas stakeholder y el índice único de `usuarios.rut` se cierran en `.specs/aislamiento-hallazgos-tenant/spec.md`. Postgres RLS no se implementa: la viabilidad del censo ya lo decidió.

## 5. Constraints

La credencial sigue siendo de la persona (ADR-035). Un código de un tercero no la reemplaza. La respuesta 401 de `/auth/activar` no distingue RUT inexistente, código malo y cuenta ya viva.

## 6. Evidencia (2026-10-06, rama `cursor/aislamiento-multi-tenant-4567`, PR #739)

Los seis criterios se marcan con el test que los prueba. El Status lo cierra el PO.

| SC | Evidencia |
|---|---|
| SC1 | `routes/me-empresa-miembros.test.ts` «reusa una cuenta ya activa sin pisar su código ni su clave»; `test/integration/alta-admin-cadena.integration.test.ts` caso 6 (`vinculo: 'cuenta_activa'`, misma clave y mismo `firebase_uid`) |
| SC2 | `me-empresa-miembros.test.ts` «no reemplaza el código de una persona que todavía no activa»; `services/vinculo-persona.test.ts` «placeholder con pin conserva el código» |
| SC3 | `me-empresa-miembros.test.ts` «emite código si la persona provisoria no tiene uno»; `test/unit/conductores.test.ts` «placeholder que ya tiene código no recibe otro PIN» |
| SC4 | `routes/auth-activar.test.ts` «código válido sobre una cuenta ya viva no reescribe la clave», «cuenta ya activada (sin código pendiente) → misma respuesta», «RUT inexistente → la MISMA respuesta que código incorrecto» |
| SC5 | `auth-activar.test.ts` «la membresía pasa a activa», «código vencido (más de 7 días) → misma respuesta»; `vinculo-persona.test.ts` «deja fuera la invitación de más de 7 días y conserva la reciente» |
| SC6 | `test/unit/webpush-route.test.ts` «endpoint de otro user no se borra: el WHERE exige el userId» |

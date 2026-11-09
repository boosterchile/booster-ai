# Spec: bordes-autenticacion

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-09
- Status: Pedida por el PO en sesión el 2026-11-09 (§10)
- Linked: `.specs/acceso-panel-plataforma/spec.md` (regla única de acceso al panel, #893; esta spec se apoya en ella), `.specs/alta-personal-booster/spec.md`, `.specs/impersonacion-auditada/`, ADR-035 (RUT + clave numérica)

---

## 1. Objective

Cinco reglas de autenticación que quedaron fuera de `acceso-panel-plataforma`, para que los bordes del login, la activación, la impersonación y las altas sigan la misma regla de acceso al panel.

## 2. Why now

La revisión previa a #893 las encontró en `main`. Ya estaban ahí antes de ese cambio y quedaron fuera de su alcance a propósito. El PO pidió cerrarlas en un PR propio.

## 3. Success criteria

- [ ] SC1 — **La activación del conductor no devuelve datos de contacto.** La respuesta 410 `already_activated` de `POST /auth/driver-activate` es `{ error, code }`, sin datos de la cuenta. La web solo mira el status y no cambia.
- [ ] SC2 — **El primer admin se crea con un correo verificado.** `GET /me` crea la cuenta para un correo de la lista de respaldo solo si el proveedor de identidad verificó ese correo (`email_verified`). Si no, responde `needs_onboarding: true` y no escribe.
- [ ] SC3 — **El código del conductor se usa una sola vez.** `POST /auth/driver-activate` escribe solo si el código sigue siendo el que se verificó y la cuenta sigue sin clave, igual que `POST /auth/activar`. Si no escribe, responde la misma 401 de un código incorrecto y no entrega sesión.
- [ ] SC4 — **La impersonación vale mientras quien impersona tenga acceso al panel.** En cada request de una sesión impersonada, de lectura o de escritura, se vuelve a leer a quien impersona y se le aplica la regla de acceso al panel. Si ya no la cumple, o no existe, responde 401 `impersonation_revoked`. Una sesión sin impersonación no hace consultas extra.
- [ ] SC5 — **Las altas no crean cuentas con un correo de la lista de respaldo.** El alta de miembros desde el panel de empresas, el alta de miembros de organizaciones stakeholder y el onboarding de una empresa rechazan, sin escribir, una cuenta nueva con un correo de la lista de respaldo, sin distinguir mayúsculas ni espacios: 409 `email_already_registered`, la misma respuesta de un correo ya usado.
- [ ] SC6 — Tests nombrados para SC1–SC5, con rojo exhibido antes de implementar (auth es dominio crítico). `pnpm run ci` corrido en el momento.

## 4. Contratos

- `POST /auth/driver-activate` 410: el cuerpo pasa de `{ error, code, synthetic_email }` a `{ error, code }` (SC1). El 200 no cambia.
- Nuevo código de error 401 `impersonation_revoked` en las superficies autenticadas, solo para sesiones impersonadas (SC4).
- `POST /admin/empresas/:id/miembros`, `POST /admin/stakeholder-orgs/:id/invitar`, `POST /empresas/onboarding` y `POST /empresas/onboarding-admin` reutilizan su 409 `email_already_registered` (SC5).

## 5. Out of scope

- Unificar el 410 de `/auth/driver-activate` con la 401: la web lo usa para mandar a la persona al login principal.
- La aprobación vieja de solicitudes de registro (modo con el flag `ADMIN_PROVISIONED_ONBOARDING` apagado): está apagada en prod; el modo vigente pasa por el onboarding (SC5).

## 6. Constraints

1. La regla de acceso es `tieneAccesoPlataforma` y la comparación con la lista es `correoEnListaRespaldo` (`apps/api/src/auth/acceso-plataforma.ts`, #893). Nada repite la regla.
2. Anti-enumeración: los rechazos de la activación siguen siendo la misma 401; el 409 de SC5 es el mismo de un correo ya usado.
3. Stack: Zod en el boundary, cero `any`, logger estructurado, coverage ≥ 80 % en código nuevo, TDD con rojo exhibido.

## 7. Approach

- `auth-driver.ts`: quitar el campo del 410; condicionar el UPDATE al hash verificado y a `clave_numerica_hash IS NULL`.
- `me.ts`: exigir `claims.emailVerified` en la creación automática.
- `impersonation-write-guard.ts`: recibe `db` y la lista; en una sesión impersonada lee a quien impersona por `id` y le aplica `tieneAccesoPlataforma` antes de todo lo demás. El gate `check-impersonation-wire-completeness` ya garantiza que ese middleware corre en todas las superficies.
- `admin-empresa-miembros.ts`, `admin-stakeholder-orgs.ts` y `services/onboarding.ts` (con la lista por opciones): `correoEnListaRespaldo` antes del INSERT.

## 8. Test list

- T1 (SC1, rojo) — `auth-driver.test.ts`: el 410 no trae `synthetic_email` ni el correo de la cuenta.
- T2 (SC2, rojo) — `me-platform-admin.test.ts`: un correo de la lista sin verificar no crea la cuenta.
- T3 (SC3, rojo) — `auth-driver.test.ts`: el predicado del UPDATE exige el hash verificado y `clave_numerica_hash IS NULL`; sin filas escritas → 401 sin sesión.
- T4 (SC4, rojo) — `impersonation-write-guard.test.ts`: lectura y escritura impersonadas con quien impersona sin acceso, suspendido o inexistente → 401 `impersonation_revoked`; con acceso → sigue igual; sesión normal → sin consulta.
- T5 (SC5, rojo) — `admin-empresa-miembros.test.ts`, `admin-stakeholder-orgs` y `onboarding`: un correo de la lista, en mayúsculas o con espacios → 409 `email_already_registered` sin INSERT.
- T6 — integración contra Postgres real de SC3 y SC4.

## 9. Rollout

Merge después de #893 y release (lo dispara el PO). Sin migración. Una sesión impersonada abierta por un admin al que ya se le quitó el acceso se corta en su request siguiente.

## 10. Decision log

- 2026-11-09 — El PO pide cerrar en esta sesión los cinco puntos que la revisión previa a #893 dejó fuera de su alcance. Se apila sobre la rama de #893, que todavía espera su visto, porque cuatro puntos tocan los mismos archivos y usan su regla de acceso.

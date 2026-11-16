# Spec: auth-correo-clave-booster-stakeholder

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-11-16
- Status: Draft — decisión de producto del PO 2026-11-16 (§10). Contratos de §4 pendientes de visto en el PR de implementación.
- Linked: [ADR-093](../../docs/adr/093-auth-correo-clave-booster-stakeholder.md) (vigente), ADR-028, ADR-034, ADR-035 (sigue vigente para generador/transportista/conductor), `.specs/alta-personal-booster/`, `.specs/acceso-panel-plataforma/`, `.specs/activacion-por-correo-t10-04/`, oneshot `#984`

---

## 1. Objective

Que el personal de Booster y los Stakeholders entren con **correo + clave** (Firebase email/password), y que un usuario **nuevo** invitado reciba un mail From `contacto@boosterchile.com` con enlace a una **UI Booster de creación de cuenta** donde consigna sus datos y elige su clave. Generador, transportista y conductor no cambian: siguen con RUT + clave numérica.

## 2. Why now

El PO cerró el 2026-11-16 el conflicto con ADR-035: correo+clave **solo** para Booster y Stakeholders. Los invitados `gerencia@boosterchile.com` y `sandoval.felipe@gmail.com` son usuarios nuevos; el alta actual (admin carga nombre+RUT → `/activar` → login-rut) **contradice** esa decisión. No hay bypass: hace falta esta spec + implementación antes de enviar mails reales de alta.

## 3. Entradas

| Actor | Entrada |
|---|---|
| Platform-admin (panel personal) | Correo del invitado Booster (usuario nuevo). Sin clave. Sin exigir nombre/RUT en el alta del admin. |
| Platform-admin (org stakeholder) | Correo del invitado Stakeholder + org (contrato actual de invitar, ajustado: sin exigir que el admin invente la clave; datos de persona en la UI de creación). |
| Sistema de correo | From canónico `Booster <contacto@boosterchile.com>` (`EMAIL_FROM`). |
| Invitado (UI creación) | Token de invitación válido (query/path). Datos: ver §4 / SC3. |
| Usuario Booster/Stakeholder ya creado | Correo + clave en `/login` con tipo `booster` o `stakeholder`. |
| Feature flags / stack | Firebase Auth; `EmailSender`; panel `/app/platform-admin/personal`; regla de acceso `.specs/acceso-panel-plataforma`. |

## 4. Salidas

| Salida | Descripción |
|---|---|
| Mail de invitación | Destinatario = correo invitado; From `contacto@`; enlace absoluto a la UI de creación; **sin** la clave; logs/spans sin secretos ni tokens en claro. |
| Cuenta creada | Fila `usuarios` activa (o el estado que fije el contrato de implementación), Firebase user con email real + password elegido por la persona, `emailVerified` coherente con el consumo del enlace. Personal Booster: `es_admin_plataforma = true` según acceso-panel. Stakeholder: membresía/`organizacion_stakeholder` según ADR-034. |
| Login | Con tipo Booster o Stakeholder, `/login` muestra correo+clave (no RUT). `signInWithEmailAndPassword` → sesión Firebase → `GET /me` → superficie correcta. |
| Resto de roles | Sin cambio: RUT + clave numérica. |

### Datos que pide la UI de creación (usuario nuevo)

Campos obligatorios (persona consigna):

1. **Nombre completo** (≥ 2 caracteres, trim, máx. alineado a `usuarios`).
2. **Correo** — precargado desde la invitación, **no editable**.
3. **Clave** — password Firebase (no clave numérica de 6 dígitos); reglas mínimas alineadas al stack/Firebase (largo mínimo; confirmación en segundo campo).
4. **Confirmar clave**.
5. **RUT** — obligatorio para personal Booster (identidad chilena en ficha); para Stakeholder: obligatorio si la org no es el caso internacional sin RUT (ADR-034 / excepción ADR-035); si aplica excepción, el campo se omite o queda opcional según tipo de org.

Fuera de esta pantalla en v1: teléfono/WhatsApp, 2FA, Google OAuth como único método de alta.

## 5. Success criteria

- [ ] SC1 — **ADR y alcance.** ADR-093 vigente: correo+clave solo Booster + Stakeholder; ADR-035 intacto para los otros tres tipos. Decision log de `.specs/alta-personal-booster` y esta spec registran el supersede. Sin bypass en prod antes del deploy de esta feature.
- [ ] SC2 — **Invitación personal Booster (usuario nuevo).** `POST` de alta (contrato §6) acepta al menos `{ email }` para el caso usuario nuevo; crea invitación pendiente con token de un solo uso / vencimiento; **no** crea la clave; envía el mail From `contacto@` con URL de creación. No exige nombre/RUT del admin en ese caso.
- [ ] SC3 — **UI de creación.** Ruta pública autenticada por token (no sesión previa). Valida con Zod. Al éxito: cuenta Firebase email+password, fila `usuarios` con los datos consignados, personal marcado según acceso-panel, token consumido, sesión iniciada o redirect a `/login?tipo=booster` con mensaje de listo. Rechazos claros si token inválido/vencido/consumido.
- [ ] SC4 — **Login por tipo.** Con `auth_universal_v1_activated=true`, selector Booster y Stakeholder muestran form **correo + clave** (no RUT). Generador / transporte / conductor siguen con RUT + clave numérica. Tras login Booster, `is_platform_admin` / panel según regla vigente.
- [ ] SC5 — **Stakeholder.** Misma credencial correo+clave y misma familia de UI de creación (o la misma ruta parametrizada por tipo de invitación). No se reutiliza `/activar` + clave numérica para altas nuevas de stakeholder bajo este ADR.
- [ ] SC6 — **From y secreto.** Mails de invitación usan `EMAIL_FROM` canónico `Booster <contacto@boosterchile.com>`. Código de activación / token nunca en logs. Sin envío real en esta rama de spec/docs.
- [ ] SC7 — **No romper lo existente.** Cuentas empresa/conductor: `/activar` y login-rut sin regresión. Cuentas Booster ya activas por RUT+clave: plan de coexistencia en implementación (aceptar login-rut **o** forzar rotación a correo+clave); documentado en el PR de código; default seguro = no dejar el selector Booster solo en RUT.
- [ ] SC8 — **Oneshot invitados.** Tras merge+deploy de la implementación: invitar `gerencia@` y `sandoval.felipe@` por el panel nuevo; **no** por el flujo RUT de #984. Until then, #984 solo lleva From `contacto@` + documentación.
- [ ] SC9 — Tests con rojo exhibido (auth es dominio crítico); coverage ≥80 % en código nuevo; `pnpm run ci` en el PR de implementación.

## 6. Contratos (borrador — los aprueba el PO en el PR de implementación)

- Alta invitación personal (ajuste sobre `POST /admin/personal-booster` **o** endpoint hermano): body mínimo `{ email }` para usuario nuevo; respuesta sin clave; `expira_en` del token.
- `GET/POST` de la UI de creación (path canónico a fijar en implementación, p.ej. `/crear-cuenta` o `/invitar/aceptar`): query/body con token; body de creación `{ full_name, password, password_confirm, rut? }` + Zod en `packages/shared-schemas`.
- Login: sin cambio de IdP; el cliente usa `signInWithEmail` cuando el tipo es `booster` \| `stakeholder`.
- Errores: token inválido / vencido / consumido; email ya registrado; RUT ya registrado; validación 400.

Detalle exacto de paths y códigos de error: se congela en el PR de implementación con visto PO si cambia contrato público.

## 7. Out of scope

- Enviar los mails reales a gerencia@ / sandoval.felipe@ desde esta rama de spec.
- Cambiar login de generador / transportista / conductor.
- Quitar `AUTH_UNIVERSAL_V1_ACTIVATED` ni volver el legacy global.
- Roles de staff acotados.
- Magic link / passkey como único método.
- Editar ADR-035 in-place (manda ADR-093).

## 8. Constraints

1. **Sin bypass:** no marcar cuentas a mano ni dictar claves; no usar solo `?legacy=1` como producto.
2. **Camino mínimo:** reutilizar `EmailSender`, Firebase `createUser` + set password (o `generatePasswordResetLink` **detrás** de la UI Booster si conviene), `requirePlatformAdmin`, From `EMAIL_FROM`. Preferir extender panel personal + una ruta web nueva frente a un segundo IdP.
3. **Evaluación de flujos existentes (2026-11-16):**
   - `/admin/personal-booster` + `/activar` + `login-rut` → **no cumple** (admin carga RUT; credencial numérica).
   - `approveSignupRequest` + `generatePasswordResetLink` → **pieza útil** para password Firebase, **insuficiente** solo: no es UI de consignación de datos ni marca personal/stakeholder ni alinea el selector.
   - Conclusión: **hace falta código nuevo** (invitación por token + UI creación + branch de login). Spec primero; implementación en PR aparte.
4. Stack: Zod en boundaries, cero `any`, cero `console.*`, logger + span + métrica en endpoints nuevos, TDD con rojo exhibido.

## 9. Approach (implementación — no en este PR de docs)

1. Schemas Zod compartidos (invitación + creación).
2. API: emitir invitación + consumir token creando Firebase user con password y fila `usuarios`.
3. Mail: plantilla propia (texto personal Booster / stakeholder) con URL absoluta.
4. Web: página de creación; `LoginUniversal` branch por tipo.
5. Ajustar alta personal / invitar stakeholder a emitir invitación en vez de código `/activar` para usuarios nuevos bajo este ADR.
6. Tests unit + integración cadena: invitar → mail (mock) → crear → login email → `/me` → panel o superficie stakeholder.

## 10. Decision log

- 2026-11-16 — El PO decide: invitados personal = usuarios nuevos; mail From `contacto@` a UI de creación donde consignan datos; login **correo + clave** para Booster y Stakeholders; resto RUT + clave. Supersede parcial de ADR-035 vía ADR-093. No enviar mails reales hasta el flujo correcto. #984 conserva el From y deja de ser vehículo de alta RUT para esos correos.
- 2026-11-16 — Evaluación: flujo invite→set-password email (signup-request) no alcanza como producto; se reutiliza como pieza. Spec + ADR en rama `cursor/auth-correo-clave-booster-stakeholder-5c7c` antes de código de feature.

# Spec: alta-cliente-autocontenida

- Author: Felipe Vicencio (PO) + agente
- Date: 2026-07-30
- Status: Draft — pendiente de aceptación del PO
- Linked: `.specs/onboarding-flow-redesign/` (programa madre — esta spec **modifica su §7 Approach**), ADR-035 (auth universal RUT + clave numérica), ADR-052 (admin-approval gate), SEC-001, `.specs/sec-001-empresa-onboarding-gate-hotfix/`

---

## 1. Objective

Que una persona aprobada complete el alta de su empresa **con un solo enlace y un solo formulario**, y quede operando — sin pasar por el login legacy (Google / email+password), que el producto está retirando.

## 2. Why now

El 2026-07-30 se activó el alta de clientes en prod y el primer caso real (cliente nuevo) **no pudo completarla**. La cadena rota, verificada en vivo:

1. El approve crea la cuenta Firebase con `auth.createUser` → **sin contraseña** y con `emailVerified=false`.
2. `POST /empresas/onboarding-admin` exige `claims.emailVerified` (`routes/empresas.ts:176`) → sin eso, 403 `email_not_verified`.
3. Para verificar el email hay que completar un password reset de Firebase… que sirve para el **login legacy**.
4. Pero ADR-035 movió a los operadores a **RUT + clave numérica**: la pantalla de login ya no ofrece Google ni email+password. El acceso legacy quedó detrás de un escape hatch (`/login?legacy=1`) al que solo se llega desde la vista `needs-rotation`.

O sea: el alta de un cliente nuevo depende hoy de un camino que la UI dejó de ofrecer. El usuario aprobado ve una pantalla que le pide una clave numérica que no tiene, sin forma evidente de avanzar.

Se agrava porque el token de onboarding vive 72 h: un cliente que no logra entrar en ese plazo obliga a re-emitir.

## 3. Success criteria

- [ ] SC1 — Un aprobado abre **un** enlace, completa **un** formulario (datos de empresa + su RUT + su clave de 6 dígitos) y termina **autenticado dentro de la app**, sin tocar Google, contraseñas ni `/login?legacy=1`.
- [ ] SC2 — Al terminar existen, en una transacción: `usuarios` (con `rut` y `clave_numerica_hash`), `empresas`, `membresias` rol `dueno` activa, y `carrier_memberships` free si marcó transportista. El token queda consumido.
- [ ] SC3 — **La frontera de SEC-001 se mantiene**: la autorización sigue siendo el token de un solo uso, verificado y consumido atómicamente. Negativos cubiertos: sin token, token consumido, token expirado, token de otra solicitud.
- [ ] SC4 — Tras cerrar sesión, esa persona entra con **RUT + clave numérica** por el flujo principal (`POST /auth/login-rut`), sin `needs_rotation`.
- [ ] SC5 — El RUT del dueño pasa a ser **obligatorio** en el alta (hoy es opcional en `empresaOnboardingInputSchema`), porque es la credencial de acceso del producto.
- [ ] SC6 — Un RUT ya registrado en `usuarios` no puede secuestrarse desde este flujo: si el RUT existe, el alta se rechaza sin revelar a quién pertenece.

## 4. User-visible behaviour

**Hoy**: enlace → login → "configura tu clave numérica" → "usar método anterior" → Google/contraseña → volver al enlace → formulario. Cinco pantallas y dos identidades.

**Con esta spec**: enlace → formulario de 4 pasos (el mismo de ahora, con RUT obligatorio y un paso nuevo "crea tu clave de 6 dígitos") → adentro.

El admin sigue entregando el enlace a mano hasta que exista el envío por email (Fase 2 del programa madre, proveedor ya decidido: Resend).

## 5. Out of scope

- Reabrir el self-service (`EMPRESA_SELF_ONBOARDING_ENABLED` sigue OFF para siempre — SEC-001).
- El envío del enlace por correo (Fase 2 del programa madre).
- La gestión del equipo por parte del cliente (frente siguiente). Ahí hay que arreglar dos defectos del flujo de conductores antes de replicarlo, detectados 2026-07-30 y elevados a regla en §6.5:
  - **`auth-driver.ts:173` pisa el email real** con el sintético (`UPDATE usuarios SET email = 'drivers+<rut>@boosterchile.invalid'`). El conductor queda sin canal de comunicación con la plataforma. `auth-universal.ts` no comete ese error.
  - **El PIN generado por el admin queda como contraseña permanente** (`updateUser({password: body.pin})`, línea 151): la credencial del conductor la conoce quien lo dio de alta. El PIN debe ser de un solo uso para que la persona **defina su propia clave**, no la clave misma.
- Retirar el login legacy (`/login?legacy=1`) — sigue existiendo para los usuarios que aún no rotaron su clave.

## 6. Constraints

1. **SEC-001 intacto**: admisión gateada por aprobación admin; el predicado de autorización es el token de un solo uso (programa madre §6.2), no el email ni la sesión.
2. **ADR-035**: la credencial de operadores es RUT + clave numérica de 6 dígitos. El alta debe producir exactamente eso.
3. **Reuso, no invención**: `hashClaveNumerica` (`services/clave-numerica.ts`), `claveNumericaSchema` (6 dígitos), el email sintético `users+<rut>@boosterchile.invalid` y el patrón de custom token de `auth-universal.ts` ya existen y están en prod. Esta spec los compone; no crea mecanismos nuevos de auth.
4. **Rate limiting obligatorio**: el endpoint queda sin sesión previa, así que necesita el mismo tratamiento fail-closed que `login-rut` (ADR-035 Alt-3).
5. **Identidad de la persona (decisión del PO, 2026-07-30)** — dos reglas que valen para TODA alta de personas, no solo para esta:
   - **Cada persona conserva su email real** como canal de comunicación con la plataforma. El email sintético (`users+<rut>@…invalid`) existe solo como identificador interno de Firebase y **nunca** reemplaza al real en `usuarios.email`. `auth-universal.ts` ya respeta esto; `auth-driver.ts:173` NO (pisa el email real al activar) — ver §5.
   - **Cada persona define su propia credencial.** Nadie más la conoce: ni el admin de Booster ni el dueño de la empresa. Un código entregado por un tercero puede servir para *probar quién sos una vez*, jamás para quedar como tu contraseña.
6. Stack Booster: Zod en el boundary, cero `any`, logger estructurado, coverage ≥80%, y clasificación en el harness default-deny (ADR-057) o el CI falla.

## 7. Approach

`POST /empresas/onboarding-admin` deja de exigir sesión Firebase y pasa a autorizar **solo por el token one-shot** (header `x-onboarding-token`), que ya verifica firma HMAC, expiración y consumo atómico.

El body suma `user.rut` (obligatorio) y `user.clave_numerica` (6 dígitos). El servicio, en la misma transacción que ya existe:

1. Consume el token (paso 0 actual, sin cambios).
2. Verifica que el RUT no esté tomado → si lo está, rechaza (SC6).
3. Crea el Firebase user con el **email sintético** `users+<rut>@boosterchile.invalid` (mismo formato que `auth-universal`), o reusa el que el approve ya creó.
4. Inserta `usuarios` con `rut` + `clave_numerica_hash`, más `empresas`, `membresias` y `carrier_memberships` como hoy.
5. Mintea un **custom token** y lo devuelve; la web hace `signInWithCustomToken` y entra.

El approve deja de generar el link de acceso (T2.0): con este diseño no hace falta. La cuenta Firebase que crea el approve queda solo como reserva del email.

## 8. Análisis adversarial del gate `emailVerified` (frontera SEC-001)

Quitar ese gate es el punto sensible de esta spec. Lo analizo antes de tocarlo, no después.

**Qué protegía.** Se heredó de `me.ts` como defensa anti-hijack: impedir que alguien con un Google sign-in de un email colisionado se apropiara de un alta. El review P0-1 del programa madre ya había resuelto ese vector **por otra vía**: la autorización se movió del email al token, justamente porque el email no es un predicado confiable (§8, "Predicado por email — rechazado").

**Qué se pierde.** Con la sesión Firebase fuera de la ecuación, quien posea el token completa el alta. El token pasa a ser credencial única.

**Por qué es aceptable.** El token es de un solo uso, firmado con HMAC-SHA256 + nonce, con TTL de 72 h y consumo atómico verificado contra el clock de la BD. Hoy `emailVerified` **no agrega nada** contra un token robado: quien lo tenga puede igualmente crearse una cuenta Firebase con ese email y verificarla, porque el approve la crea sin contraseña. El gate estorba al legítimo y no detiene al atacante.

**Riesgo residual.** Un enlace interceptado dentro de las 72 h permite un alta ilegítima. Es el mismo riesgo que el sign-off del 2026-07-06 ya aceptó para el modelo bearer-token, y no empeora: hoy ese atacante haría exactamente lo mismo pasando por el reset de contraseña.

**Mitigaciones que esta spec suma**: rate limit fail-closed en el endpoint, SC6 (un RUT ya registrado no se puede secuestrar), y el log estructurado del consumo con `correlationId`. **Mitigación pendiente**, del programa madre: con Fase 2 (Resend) el token viaja al correo del solicitante, y ahí poseerlo vuelve a probar control del email — recuperando la propiedad que el gate pretendía dar, esta vez de verdad.

**Veredicto**: el gate se retira. No es una relajación de la frontera: es sacar un control redundante que no cubre el vector que decía cubrir, y que hoy rompe el alta.

## 9. Alternatives considered

- **Dejar el gate y arreglar la UX del rodeo** (guiar al usuario a `/login?legacy=1` desde el enlace): mantiene dos identidades por persona (legacy + RUT) y apoya el alta en un flujo en retirada. Rechazada.
- **Que el admin cargue la clave numérica del cliente**: el admin conocería la credencial del cliente. Rechazada por seguridad.
- **PIN de activación como en conductores**: es el mecanismo correcto para que *la empresa* dé de alta a *su gente* (frente siguiente), pero acá no hay empresa todavía — se está creando en este mismo acto. Rechazada para este caso.

## 10. Risks

| Riesgo | Mitigación |
|---|---|
| El endpoint queda sin sesión → superficie pública nueva | Rate limit fail-closed (constraint 4) + token firmado + clasificación en el harness ADR-057 |
| RUT duplicado entre `usuarios` (colisión con un conductor ya cargado) | SC6: rechazo sin oráculo; test dedicado |
| Un alta a medias deja Firebase user huérfano | El reaper T1.7 ya persigue huérfanos por `firebase_uid`; la transacción hace rollback de la BD |
| Regresión del camino actual mientras se migra | El endpoint mantiene compatibilidad: si llega con sesión válida, sigue funcionando |

## 11. Open questions

- OQ1 — ¿La clave numérica se pide en el paso 1 del formulario (junto al RUT) o en un paso final dedicado? Propuesta: paso final, con confirmación de la clave (dos campos), para que el usuario no la elija distraído entre datos legales.
- OQ2 — ¿Qué hacer con las cuentas Firebase que el approve ya creó para altas pendientes? Propuesta: dejarlas; el flujo nuevo las reusa por email sintético o las ignora, y el reaper limpia las que expiren.

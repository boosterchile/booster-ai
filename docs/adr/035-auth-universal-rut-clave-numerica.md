# ADR-035 — Auth universal: RUT + clave numérica para todos los roles

**Status**: Accepted
**Date**: 2026-05-13
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-028 RBAC Firebase](./028-rbac-auth-firebase-multi-tenant-with-consent-grants.md), [ADR-034 Stakeholder Organizations](./034-stakeholder-organizations.md), plan `docs/plans/2026-05-12-identidad-universal-y-dashboard-conductor.md` (Wave 4)

---

## Contexto

Hoy convivien dos flows de autenticación en Booster AI:

1. **Email/password** (Firebase Auth) para shipper owners, carrier owners, stakeholders. Optional 2FA WhatsApp.
2. **RUT + PIN** (custom token Firebase) para conductores (D9). El PIN es de 6 dígitos y se rota una sola vez en la activación; luego el conductor usa email sintético + password = PIN.

Felipe (2026-05-12) clarificó:

> "URL única de acceso para cualquier usuario `app.boosterchile.com`, sin embargo evaluar si debe haber un dominio: transporte.boosterchile.com / carga.boosterchile.com / conductor.boosterchile.com / stakeholder.boosterchile.com / admin.boosterchile.com Nosotros Booster
> Auth RUT + clave numérica para todos (no solo conductor), ok"

El paradigma email/password choca con tres realidades:

- **Mobile-first**: el conductor (y muchos usuarios) operan desde celular, donde tipear emails es fricción comparado con tipear un PIN numérico + face ID.
- **Identidad chilena**: el RUT es el identificador real en Chile. La email es contacto, no credencial.
- **Multi-rol homogéneo**: un dueño-conductor (común en transporte chico) hoy maneja dos credenciales distintas; el modelo "RUT identifica la persona, rol viene de membership" colapsa eso.

## Decisión

Migrar todos los usuarios al flow universal **RUT + clave numérica de 6 dígitos**, manteniendo Firebase Auth internamente con email sintético (mismo patrón que ya usa `auth-driver.ts`).

### Selector de tipo de usuario en login

`/login` muestra 5 opciones:

1. **Generador de carga** (shipper)
2. **Transporte** (carrier)
3. **Conductor**
4. **Stakeholder**
5. **Booster** (platform admin)

El selector determina la **vista inicial** post-login, NO el rol del usuario. El rol viene de `memberships` (1 user → N memberships con roles). El selector es UI hint, no autorización.

### Subdominios

`app.boosterchile.com` es canónico. Subdominios actúan como **301 redirects con query param** `?tipo=<rol>`:

- `transporte.boosterchile.com` → `app.boosterchile.com/login?tipo=transporte`
- `carga.boosterchile.com` → `app.boosterchile.com/login?tipo=carga`
- `conductor.boosterchile.com` → `app.boosterchile.com/login?tipo=conductor`
- `stakeholder.boosterchile.com` → `app.boosterchile.com/login?tipo=stakeholder`
- `admin.boosterchile.com` → `app.boosterchile.com/login?tipo=booster`

Beneficio: branding/marketing por rol con single infra, single SSO, switch entre roles vía Layout sigue funcionando.

**Excepción admin.boosterchile.com**: evaluar hard-separation (Cloud Run separado + IP allowlist + WAF estricto) en una iteración futura por superficie de ataque reducida. No bloquea Wave 4.

### Storage de la clave

- Hash con **scrypt** (timing-safe), reusando `services/activation-pin.ts` como patrón. Nueva columna `usuarios.clave_numerica_hash` (text) — mismo formato que `activacion_pin_hash`.
- La clave plaintext nunca persiste.
- El usuario puede rotar su clave en `/perfil/seguridad` (post-Wave 4 PR 3).

### Login flow

```
POST /auth/login-rut
Body: { rut: "12.345.678-9", clave: "123456", tipo?: "conductor" }

Backend:
  1. Normalizar RUT (rutSchema).
  2. SELECT user por rut.
  3. Si user.clave_numerica_hash NULL → 410 needs_rotation (frontend
     muestra UI para setear primera clave).
  4. scrypt timing-safe verify.
  5. Si OK: createCustomToken Firebase, mint con custom claim
     `auth_method: "rut_clave"` para distinguir de email/password legacy.
  6. Return { custom_token, synthetic_email }.

Cliente:
  1. Recibe custom_token.
  2. signInWithCustomToken Firebase.
  3. Llama GET /me con el ID token resultante.
  4. AppRoute redirige por rol.
```

### Recovery flow

- **Canal único**: WhatsApp OTP (reusa pipeline 2FA Twilio existente).
- **Sin email backup**: mobile-first; si el usuario perdió WhatsApp tendrá que usar el reset admin (platform-admin levanta un nuevo PIN temporal).
- **Endpoint**:
  ```
  POST /auth/request-recovery-otp { rut }
    → Si user tiene whatsapp_e164: envía OTP de 6 dígitos vía Twilio.
    → Si no: 404 no_recovery_channel.
  POST /auth/verify-recovery-otp { rut, otp, nueva_clave }
    → Verifica OTP, hashea nueva_clave, UPDATE clave_numerica_hash.
  ```
- OTP scrypt-hasheado, expira en 10 minutos, single-use.

### Migración de usuarios existentes (Wave 4 PR 3)

Los usuarios con email/password actual pueden:

- **Auto-rotación al login**: el primer login después del deploy de Wave 4, si `clave_numerica_hash = NULL`, el backend acepta el password como credencial legacy (verifica via Firebase Auth signInWithEmailAndPassword internamente) y le pide al usuario setear una clave de 6 dígitos antes de continuar.
- **Período de coexistencia**: 30 días después del deploy. Pasado eso, email/password queda obsoleto.

### RUT NULL: caso stakeholder internacional

Como cubre ADR-034, un stakeholder de tipo `corporativo_esg` puede no tener RUT chileno (ej. mandante corporativo en EU). El servicio de auth permite `usuarios.rut = NULL` SOLO para users con única membership de tipo stakeholder con `tipo='corporativo_esg'`. Para esos, el login universal usa email + clave numérica (mismo selector pero con campo email en vez de RUT). Constraint enforced en service layer, no DB (para mantener `usuarios.rut UNIQUE NOT NULL` para todos los demás).

### Feature flag

- `AUTH_UNIVERSAL_V1_ACTIVATED`: env var server-side.
- `false` (default): `/login` es el viejo flow email/password. `/login/conductor` funciona normal. Endpoint `/auth/login-rut` puede coexistir vivo (no rompe nada).
- `true`: `/login` es el nuevo selector + RUT+clave. `/login/conductor` redirige a `/login?tipo=conductor`.
- Cliente lee desde `/me/feature-flags` (endpoint público sin auth). Cambio sin redeploy via Secret Manager → Cloud Run restart.

### Custom claim en Firebase token

- `auth_method`: `"rut_clave"` | `"email_password"` | `"google"`.
- Permite analytics (qué % de logins son por RUT) y auditoría.

---

## Alternativas consideradas

### Alt 1 — Mantener email/password universal y agregar campo RUT solo informativo

**Rechazada**. No resuelve el problema mobile-first; el usuario sigue tipeando email y password. Y mantiene la asimetría con el flow del conductor.

### Alt 2 — Magic link por WhatsApp (sin password)

**Rechazada para Wave 4**. WhatsApp dependency total — si el usuario perdió la sesión de WhatsApp queda fuera. Como backup, evaluamos para Wave futura post-launch.

### Alt 3 — PIN de 4 dígitos en vez de 6

**Rechazada**. 10⁴ vs 10⁶ es 100× más bruteforceable. Para sistemas con face ID + rate limiting, 6 dígitos es estándar (iOS).

### Alt 4 — Passkey / WebAuthn como primera opción

**Rechazada para Wave 4**. Browsers viejos en Android (muchos conductores no tienen iPhone) no soportan passkey. Mantenemos passkey como roadmap iteración 2 sobre el flow universal.

---

## Consecuencias

### Positivas

- UX mobile-first homogénea para todos los roles.
- Identidad por RUT colapsa el caso multi-rol (dueño-conductor) a 1 credencial.
- Selector de subdominios da branding sin sacrificar SSO.
- Custom claim `auth_method` habilita analytics y auditoría granular.

### Negativas

- Migración requiere período de coexistencia 30 días → complejidad transient.
- Recovery exclusivamente WhatsApp = dependencia Twilio. Mitigado con reset admin manual.
- Stakeholder internacional sin RUT requiere lógica de servicio adicional.
- Feature flag durante rollout añade superficie de testing (verificar ambos paths).

### Acciones derivadas

- Wave 4 PR 1 (este branch): backend foundation — migration 0032, service, endpoint, feature flag.
- Wave 4 PR 2: frontend selector + form RUT+clave behind flag.
- Wave 4 PR 3: migración usuarios actuales (forzar rotación) + retirar email/password legacy tras 30 días.
- Wave 4 PR 4 (opcional): recovery flow WhatsApp OTP.
- Terraform: declarar `AUTH_UNIVERSAL_V1_ACTIVATED` como secret/env var.

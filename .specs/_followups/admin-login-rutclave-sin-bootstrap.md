# GAP W1 — El platform admin no puede entrar por la UI desplegada (RUT+clave universal sin bootstrap)

**Dimensión**: web / auth · **Estado**: gap REAL confirmado con evidencia (2026-07-07 AM, smoke E2E). Bloquea el approve por UI; NO bloquea el backend (approve por REST funciona).
**Fuente**: smoke matinal del hito 2; evidencia en `docs/corfo/hito-2/evidencia/prod-login-actual.png` + `prod-login-booster-card.png`.

## Problema (verificado)

El `/login` desplegado en prod usa el **flujo RUT+clave universal** (LoginUniversal, flag `auth_universal_v1_activated` efectivamente ON en prod — el default `false` de `use-feature-flags.ts:51` es solo del cliente, no el runtime). La tarjeta "Booster" lleva a un formulario **solo RUT + Clave (6 dígitos)** con el hint "Si nunca configuraste tu clave, usa tu método anterior una vez para activarla" — **pero ese "método anterior" no tiene ningún botón/enlace en la pantalla** (ni Google ni email/clave). Es un dead-end para cuentas sin clave configurada.

La cuenta del platform admin (`dev@boosterchile.com`, allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`) verificada en BD prod: `firebase_uid` real presente, proveedores Firebase `['google.com','password']`, **pero `rut` VACÍO y `clave_numerica_hash` NULL**. Resultado: no puede ingresar por RUT (no tiene) ni por clave (no configurada), y no hay botón para el bootstrap Firebase que sí posee.

## Impacto

El panel `/app/platform-admin/signup-requests` (que SÍ existe y está ruteado) es **inalcanzable por navegador** para el admin. La aprobación de solicitudes de alta —corazón de "creación de usuarios operativa"— solo es ejecutable hoy por **REST** (`POST /admin/signup-requests/:id/approve` con bearer Firebase vía `signInWithPassword`). El backend está OK; el gap es la superficie de login del admin.

## Plan de pago (mes 9, o antes si se necesita el panel por UI)

1. **Bootstrap "método anterior" con botón real** en LoginUniversal: cuando la cuenta no tiene clave, ofrecer "Continuar con Google" / email+clave Firebase (los proveedores que la cuenta ya tiene) → autenticar → forzar set de clave numérica (activar). Hoy el texto lo promete pero no hay UI.
2. **Poblar RUT + clave** de las cuentas internas del equipo Booster (incl. el admin) o permitir login admin por Google directo sin exigir RUT.
3. Subsume el stub `login-universal-redirect-param.md` (aquel era solo el `?redirect=`; este es más profundo: la cuenta no puede autenticarse en absoluto por la UI universal).
4. Revisar si el flag `auth_universal_v1_activated` debió estar ON en prod sin el bootstrap listo (posible activación prematura — verificar quién/cuándo lo encendió).

## Nota para el informe (desviación)

M1 "creación de usuarios operativa": backend + activación verificados (202, flip, 0048, canary 100%). El **approve por UI del admin** queda como desviación — operable por REST hoy, UI pendiente del bootstrap de LoginUniversal.

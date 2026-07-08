# Login — retirar botón legacy "Crea una" (self-signup Firebase dead-end)

**Dimensión**: web / ux / security-postura · **Estado**: pendiente, gated por activación W1.
**Fuente**: review W1.2 hito-2 (2026-07-06); SC3 de `.specs/onboarding-flow-redesign/` (self-onboarding nunca se reenciende).

## Problema

`apps/web/src/routes/login.tsx` conserva el botón legacy "Crea una" que dispara el self-signup directo de Firebase. Con `EMPRESA_SELF_ONBOARDING_ENABLED=false` permanente (SC3), ese camino crea una cuenta Firebase que muere en el dead-end `/onboarding` (403). Desde W1.2 convive con el flujo correcto ("¿No tienes cuenta? Solicita acceso" → `/solicitar-acceso`), lo que confunde: dos CTAs de alta, uno funcional y otro trampa.

## Impacto

- UX: usuarios nuevos pueden elegir el camino muerto y quedar con cuenta Firebase huérfana (las recoge el reaper de ADR-057, pero es fricción evitable).
- Postura: mantiene superficie de creación de cuentas IdP sin propósito.

## Plan de pago

Tras activar W1 (flip aprobado por el PO) y verificar el E2E del flujo solicitar-acceso→approve→onboarding-admin en prod:
1. Retirar el botón "Crea una" y su handler de `login.tsx` (+ tests).
2. Dejar `/solicitar-acceso` como único CTA de alta.
3. Opcional: redirect de la página vieja `/onboarding` hacia un mensaje que apunte a solicitar-acceso.

## Ampliación de scope — retiro del flow legacy completo (PO, 2026-07-08, decisión D6)

La decisión de convergencia D6 (`.specs/hito-2-corfo-mes-8/decisiones.md`) subsume este follow-up: **el flow legacy completo de login (Google + email/password + el botón "Crea una") se retira antes de comercializar**, no solo el botón. Contexto: el diagnóstico read-only tras #572 probó que `/login?legacy=1` está roto (coerción `JSON.parse` del search param: `1` número vs `'1'` string en `login.tsx:61`) desde Wave 4; el PO optó por retirar el legacy en vez de arreglar el toggle.

### Gap conocido — rescue de needs-rotation (410) sin autoservicio (hasta el retiro)

La vista **needs-rotation** de `LoginUniversal.tsx` (cuando `/auth/login-rut` responde 410 = usuario sin clave numérica seteada) ofrece un link "Usar método anterior" → `/login?legacy=1` para que el usuario active su clave desde su método previo. **Ese link apunta al mismo `/login?legacy=1` roto**, así que hoy ese rescue **no tiene autoservicio**: el usuario quedaría en loop (needs-rotation → LoginUniversal universal → needs-rotation).

- **Riesgo actual: nulo.** Cero usuarios reales en estado 410 hoy — verificado por el PO (todas las cuentas existentes tienen clave numérica). El camino nunca se ejercita en prod.
- **Salida de producto (D6.b, mes 9)**: la activación de clave del 410 será **recovery de clave** (`recovery_otp_hash` / `recovery_otp_expires_at`, ya en `apps/api/src/db/schema.ts:629-630`) o desbloqueo por admin de empresa — **no** un login paralelo legacy.
- **No se toca en el PR corrector** (revert parcial de #572): ese PR solo retira el link "método anterior" del **selector** (`LoginUniversal.tsx`, línea del `<p>` agregado por #572) + suaviza el fallback "Solicita acceso". La vista needs-rotation y su link se retiran junto con el flow legacy completo.

### Cuando se pague el retiro del legacy

Además de los pasos 1-3 de arriba: retirar la rama `useUniversalFlow=false` de `login.tsx` (form Google + email/password + reset), la vista needs-rotation de `LoginUniversal.tsx` y el escape hatch `?legacy=1`, sustituyendo la salida del 410 por el flujo de recovery de clave. Requiere spec propia (dominio auth, TDD).

# WS2 — Descubribilidad del login bajo el modelo comercial nuevo

**Estado**: aceptada (copy aprobado por el PO en sesión 2026-07-08, ver §Copy).
**Fuente**: goal del PO 2026-07-08 — reinterpretación de WS2 al modelo
venta→credenciales (NO self-service). Relacionada: ADR-035 (login universal),
ADR-052 (signup gateado por admin), ADR-057 (boundary + harness CI),
`.specs/_followups/solicitar-acceso-cleanup.md` (trigger: este PR).

## Problema

`LoginUniversal` (paso selector) no ofrece ningún camino a quien no tiene
credenciales: ni el alta comercial (`/solicitar-acceso`) ni el método legacy
(`/login?legacy=1`, escape hatch que ya existe pero solo es descubrible desde
la vista needs-rotation). Además, el copy actual de `/solicitar-acceso`
("nuestro equipo revisará tu solicitud") sugiere *revisión de una cuenta
solicitada* — el modelo comercial vigente es otro: la empresa manifiesta
interés, Booster la contacta y **la venta gatilla las credenciales**. No es
auto-registro.

## Entradas

- `apps/web/src/components/login/LoginUniversal.tsx` — selector sin links.
- `apps/web/src/routes/solicitar-acceso.tsx` — página existente, backend
  `POST /api/v1/signup-request` vivo (no se toca).
- Copy aprobado por el PO (§Copy, decisión de framing 2026-07-08).

## Salidas

1. Selector de `LoginUniversal` con dos accesos al pie de la card:
   - "¿Tu empresa aún no está en Booster? → **Solicita acceso**" → `/solicitar-acceso`
   - "¿Usabas Google o email? → **Ingresar con método anterior**" → `/login?legacy=1`
2. `/solicitar-acceso` reframeada a manifestación de interés (§Copy).
3. Pago del follow-up `solicitar-acceso-cleanup` (dead state `'error'` +
   `FIELD_ERROR_COPY` duplicado) — trigger documentado: "el próximo PR que
   toque solicitar-acceso.tsx".

## Copy aprobado (PO, 2026-07-08 — no se altera sin re-aprobación)

**Página /solicitar-acceso** (variante "venta explícita"):
- Bajada: «Cuéntanos quién eres y te contactaremos para sumar a tu empresa a
  Booster. Esta solicitud no crea una cuenta: tus credenciales se activan al
  contratar el servicio.»
- Éxito: «Recibimos tu interés. Nuestro equipo comercial te contactará al
  correo indicado.» (neutro — conserva anti-enumeración SC-1.2.5)
- H1 y botón sin cambio ("Solicita acceso" / "Solicitar acceso").

**Links en LoginUniversal** (variante "empresa-first"): ver Salidas §1.

## Criterios de éxito

- [ ] Tests RED exhibidos antes de implementar (TDD; login = dominio auth).
- [ ] Ambos links visibles en el selector con href correctos (tests DOM).
- [ ] Copy nuevo de `/solicitar-acceso` verificado por tests; mensaje de éxito
      sigue siendo idéntico exista o no el email (anti-enumeración).
- [ ] Boundary ADR-057: cero mounts nuevos de API; clasificación existente de
      `POST /api/v1/signup-request` verificada contra el harness y citada en
      el PR (rutas web no son mounts del harness).
- [ ] `pnpm ci` verde.
- [ ] PR abierto contra `main`, MERGEABLE, con captura de la UI mostrando
      ambos links. **Sin merge** — gate del PO (ADR-072).

## Fuera de alcance

- Retiro del botón legacy "Crea una" en `login.tsx`
  (`.specs/_followups/login-retiro-boton-crea-una-legacy.md`, gated por E2E
  prod del flujo de alta).
- Cambios al backend `signup-request` o a su contrato.
- Notificación automática del equipo comercial (Fase 2, mes 9).

## Corrección post-merge #572 (PO, 2026-07-08 — decisión (b) + convergencia)

Diagnóstico read-only tras #572: `/login?legacy=1` **no** conmuta al flow
legacy — TanStack Router parsea los search params con `JSON.parse`, así que
`?legacy=1` llega como número `1` y la comparación `search.legacy !== '1'`
(string) en `login.tsx:61` nunca matchea → el flow universal gana siempre.
Bug congénito de Wave 4 (PR #185), no del #572; el link nuevo solo lo expuso.

**Decisión del PO (b) + dirección de producto**: NO se arregla el toggle. El
**flow legacy completo (Google + email/password) se retira antes de
comercializar** (decisión de convergencia, registrada en
`.specs/hito-2-corfo-mes-8/decisiones.md`). La salida futura del 410
(needs-rotation) será **recovery de clave** (`recovery_otp_hash` /
`recovery_otp_expires_at` ya existen en `schema.ts:629-630`) o admin de
empresa — **no** un login paralelo.

Cambios de este PR corrector (revert parcial de #572, ya en main):
1. Se retira del selector de `LoginUniversal` el `<p>` "Ingresar con método
   anterior" (→ `/login?legacy=1`, link roto) + su test.
2. El fallback "Solicita acceso" queda con copy más suave (puerta discreta de
   contacto comercial), aprobado por el PO 2026-07-08:
   **«¿Aún no trabajas con Booster? Conversemos»** → `/solicitar-acceso`.
3. El rescue de needs-rotation (`LoginUniversal.tsx`, vista 410) queda **sin
   autoservicio** hasta el retiro del legacy — documentado en el follow-up
   `login-retiro-boton-crea-una-legacy.md`. Cero usuarios reales en ese
   estado hoy (verificado por el PO: todas las cuentas con clave). NO se toca
   en este PR (fuera de scope, decisión (b)).

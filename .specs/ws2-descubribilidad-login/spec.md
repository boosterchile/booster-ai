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

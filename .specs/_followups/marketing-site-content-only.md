# Follow-up: sitio de contenido `apps/marketing` (build content-only, sin /signup)

**Origen**: cierre de **PR #426** (`feat/marketing-site-signup-request`) en el triage de rezagados del 2026-07-24. El PR se cerró **sin merge**; este stub existe para que la mitad viva del entregable no se pierda con él.

## Qué YA está en main (no rehacer)

La mitad `/signup` del PR **ya vive en producción por otra vía**:

- `apps/web/src/routes/solicitar-acceso.tsx` capta el mismo `{email, nombreCompleto}` y postea al mismo `POST /api/v1/signup-request`, con el mismo 202 anti-enumeración.
- El schema es el compartido (`packages/shared-schemas/.../signup-request.ts`); en #426 tuvo que derivarse local porque aún no existía.
- Backend completo de SEC-001 Sprint 2b: admin-approval, rate-limit, onboarding-token, reaper.

→ El modelo de **registro gateado** (ADR-052) está cumplido. Nada de esa parte queda pendiente.

## Qué falta (esto es el follow-up)

El **sitio de contenido público** (`apps/marketing`, Next.js 15): home, `/soluciones/*`, `/precios` (sin checkout), `/esg`, editorial, `/legal/*`.

**Decisión de producto estancada ~2 meses** — antes de construir hay que confirmar con el PO si el sitio comercial sigue en el roadmap.

## Cómo se retoma (si el PO lo aprueba)

**Build fresco content-only contra main, NO rebase de la rama de #426.** Motivos:

1. La rama arrastra la mitad `/signup` **muerta** (duplicaría lo que ya está en `/solicitar-acceso`).
2. Fundación stale: pre-pnpm-10 (ADR-075) y pre-`shared-schemas` (schema derivado local).
3. Estaba CONFLICTING contra main.

Reglas del build nuevo:

- El CTA de registro **enlaza a `/solicitar-acceso`** (apps/web). El sitio de marketing **no** capta el formulario ni habla con `POST /api/v1/signup-request` → no hay CORS nuevo, no hay kill-switch `NEXT_PUBLIC_SIGNUP_ENABLED`, no hay superficie Ley 19.628 propia.
- Sin Firebase client-side, sin checkout/PSP/DTE (gate estructural que ya traía #426).
- Si el PO quisiera **igual** captar desde el sitio de marketing, eso reabre §11 del spec original (CORS + downstream + Ley 19.628 + E2E) y es otra decisión.

## Material preservado — ⚠️ vive SOLO en la rama, no en main

Verificado 2026-07-24 contra `origin/main` y `origin/feat/marketing-site-signup-request`:

| Artefacto | ¿En main? | Dónde está |
|---|---|---|
| `.specs/marketing-site-signup-request/{spec,plan,verify,review,ship}.md` | **NO** | rama `feat/marketing-site-signup-request` |
| `docs/adr/067-marketing-site-signup-request-gated.md` | **NO** | ídem |
| `.specs/_followups/marketing-lighthouse-blocking.md` (gate Lighthouse) | **NO** | ídem |
| `.specs/_followups/onboarding-flow-redesign.md` (bug 409 approve→onboarding) | **SÍ** | main |

La rama remota **no se borró** al cerrar el PR — ése es hoy el único respaldo de esos 3 artefactos. Dos consecuencias:

1. **El número ADR-067 está libre en main** (la numeración salta 066 → 068). Si otro ADR toma el 067, revivir la rama colisiona. Decisión del PO: reservarlo, reasignarlo, o traer el ADR a main como Accepted/Superseded documental (tocar `docs/adr/` requiere su aprobación).
2. Si la rama se borra en un barrido, la spec se pierde. Rescatarla a main es un PR doc-only barato si el PO quiere el respaldo.

## Estado

- **ABIERTO** — bloqueado en decisión de producto del PO (¿sigue el sitio comercial en el roadmap?). No hay código pendiente de escribir mientras eso no se resuelva.

# Review — marketing-site-signup-request

## Devils-advocate pass (DEFINE) — 2026-06-08

Sub-agent `agent-rigor:devils-advocate`, corrido contra `spec.md` (Draft) + código vivo en `main` `517859a`.

**Resumen del veredicto:** la pieza de seguridad está bien resuelta y NO se objeta (reusar `signup-request` no reabre el vector de alta directa; eliminar Firebase client-side reduce superficie). La objeción central es de **valor**: el spec subestimaba cuán roto está el downstream y difería a una open question (OQ3) la única decisión que separa "entregar SEO valioso" de "capturar leads que nadie podrá atender".

### Corrección fáctica (incorporada)

El spec decía "el path approve→dueño NO existe". **Falso.** `approveSignupRequest` (`apps/api/src/services/signup-request.ts:164-296`) SÍ existe y hace `auth.createUser` + INSERT en `users` con `status='pendiente_verificacion'`. Lo que falta es el tramo empresa+membership, **y el conflicto 409 está ACTIVO**: `onboardEmpresa` lanza `UserAlreadyExistsError` si ya hay un `users` row → aprobar hoy produce un **usuario zombie** que no puede convertirse en dueño. Es un end-to-end roto en cadena, no tres follow-ups independientes.

### Objeciones y resolución

| # | Sev | Objeción | Resolución en spec |
|---|---|---|---|
| O1 | P1 | Construir captación funcional sobre un downstream muerto (notifier solo loguea `server.ts:554`; admin 503 por `SIGNUP_REQUEST_FLOW_ACTIVATED=false`; bug 409 activo) = leads a buzón que nadie procesa | §2/§5/§9 reescritos con el estado real (usuario zombie). Decisión de OQ3 tomada ANTES de construir (ver O2) |
| O2 | P1 | OQ3 esconde la decisión rectora (captación funcional vs "coming soon") | **Resuelto:** se construye contenido+SEO (valor real, independiente del downstream) + el form `/signup`, pero **gateado por kill-switch** `NEXT_PUBLIC_SIGNUP_ENABLED=false` → renderiza "coming soon" hasta que el downstream cierre |
| O3 | P1 | El gate §11 es prosa, no mecanismo; SC8 verifica una no-acción | **Resuelto:** el gate pasa a ser el flag `NEXT_PUBLIC_SIGNUP_ENABLED` + test que verifica coming-soon con flag off y form con flag on |
| O4 | P2 | CORS es el modo de fallo más probable del 1er deploy y no está mapeado (no es 422/429/503) | Añadido estado UI "no pudimos conectar" + T-case + verificar preflight OPTIONS en e2e |
| O5 | P2 | Rate-limit 5/15min **por IP** compartido subestimado (oficinas B2B tras NAT) | R4 sube a M; se documenta que la mitigación real vive en el rediseño del rate-limit |
| O6 | P2 | Sin contract test del 202 idempotente entre front y back | Documentado como riesgo aceptado + T de contrato mínimo del shape de request |

### No objetado

- Coherencia de seguridad: reusar `signup-request` (anónimo, no crea cuentas, solo encola) NO reabre el vector de alta directa. Residual único: contract test (O6).
- Número de ADR (OQ4): trámite.

### Archivos verificados por el sub-agent

- `apps/api/src/services/signup-request.ts:164-296` — `approveSignupRequest` precrea `users` row (contradice framing original)
- `apps/api/src/server.ts:114-120` (CORS), `227-232` (montaje sin flag), `554` (notifier solo-logging)
- `apps/api/src/routes/admin-signup-requests.ts:81` (gate 503), `config.ts:479` (`SIGNUP_REQUEST_FLOW_ACTIVATED=false`)
- `.specs/_followups/onboarding-flow-redesign.md` §1 (conflicto 409 documentado como activo)

---

## Devils-advocate pass (PLAN) — 2026-06-08

Sub-agent `agent-rigor:devils-advocate` contra `plan.md` v1 + código vivo. Veredicto: seguridad/scope OK; 2 P0 que rompían el ciclo build→test→merge + 3 P1 de estructura. Todas incorporadas en `plan.md` v2.

| # | Sev | Objeción (verificada) | Resolución en plan v2 |
|---|---|---|---|
| P0-1 | P0 | `ci.yml:107-131` escanea todos los `coverage-summary.json` sin allowlist → T1 con 1 smoke test cae <80% y NO mergea sola | T1 Acceptance: `coverage.include` acotado a lógica; T1 pasa el gate sola |
| P0-2 | P0 | `signupRequestBodySchema` (`signup-request.ts:30`) NO es `.strict()` → "contract test" mal etiquetado; acceptance "mismo estado para cualquier 202" vacuo (solo hay un shape `{ok:true}`) | T3 deriva schema cliente vía `signupRequestSchema.pick(...)` de shared-schemas (red real); T5 asserta "handler de 202 no lee body"; T6→"client body-shape test". Follow-up: backend `.strict()` |
| P1-1 | P1 | Orden difiere la pieza de mayor riesgo (form/CORS/kill-switch) al final | Reordenado: T1→T2→T3→T4→T5 (riesgo primero), contenido después; `fetch` directo fijado en T3 |
| P1-2 | P1 | T3/T4 v1 = horizontal slicing; T4 (6 páginas/100 LOC) inconsistente con SC6 contenido real | Split por valor: T7 conversión (CTA/SEO) vs T8 editorial/legal; waivers de LOC honestos por lote |
| P1-3 | P1 | SC8 testeaba render, no enforcement; `NEXT_PUBLIC_*` se inlinea client-side | T4 Acceptance: el form **no se importa** con flag off (dynamic import gated) + defensa doble nivel (flag + CORS) documentada |
| P2-1 | P2 | Test no-checkout no depende de T7; estaba al final | Movido a T2 (frontload SC4) |
| P2-2 | P2 | Lighthouse "no bloqueante hasta contenido real" = drift sin ticket | T9 crea follow-up stub con criterio de activación concreto |
| P2-3 | P2 | `/ingresar` redirect sin mecanismo fijado (afecta SEO) | T8: `redirect()` server-side 308 |
| P2-4 | P2 | Rate-limit por IP compartido | Residual aceptado (form gateado); vive en rediseño de rate-limit |

**No objetado:** coherencia de seguridad (reusar `signup-request` no reabre alta directa), trazabilidad nominal SC→T, reversibilidad (app aislada).

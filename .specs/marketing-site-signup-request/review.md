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

---

## REVIEW (fase) — 2026-06-08

Diff: 12 commits sobre `main` (~2414 ins, todo `apps/marketing/` + ADR-067 + lockfile). Sub-agents: code-reviewer + devils-advocate (obligatorios) + security-auditor + ux-designer.

### Hallazgos BLOCKING — resueltos (código)

| # | Fuente | Hallazgo | Resolución |
|---|---|---|---|
| B1 | code-reviewer | Falta `output: 'standalone'` (ADR-010 §Infra vigente, Cloud Run) | **Fix**: `next.config.ts` `output:'standalone'`; build genera `.next/standalone` (verificado). |
| B2 | code-reviewer | `vitest.config` `functions:75` ≠ gate del proyecto (80) | **Fix**: threshold → 80. |
| a11y-1 | ux-designer | Errores no asociados al input (sin `aria-describedby`/`aria-invalid`) | **Fix**: `aria-invalid` + `aria-describedby` + `id` en mensajes; test nuevo. |
| a11y-2 | ux-designer | Focus ring verde sobre botón verde = 1.48:1 (<3:1) | **Fix**: anillo neutral-900 oscuro en `globals.css` (≥3:1 sobre blanco y primary-600). |
| a11y-3 | ux-designer | Borde de input `neutral-300` = 1.52:1 (<3:1) | **Fix**: `border-neutral-500` (#73706A ≈ 5:1). |
| a11y-4 | ux-designer | Submit sin loading state perceptible | **Fix**: botón "Enviando…" + `aria-busy`; test nuevo. |
| P0-1 | devils-advocate | ADR/`page.tsx` afirmaban "defensa CORS de doble nivel" — FALSO: el endpoint público ya está montado sin gate; CORS no frena un POST no-browser | **Fix (doc)**: ADR-067 §kill-switch reescrito **+ comentario de `page.tsx` corregido** (cerrado en SHIP P1-A) — CORS no es defensa general; la inocuidad viene del downstream gateado. |
| P1-2 | devils-advocate + ux | Copy "te contactaremos" promete contacto sin notifier | **Fix**: copy del form + éxito sin promesa de contacto proactivo. |

### Resueltos (documentación)

| # | Hallazgo | Resolución |
|---|---|---|
| P1-1 | Flag build-time vendido como "flip" de runtime | ADR-067 + spec §11: documentado que habilitar = rebuild+redeploy. |
| P1-3 | ADR sobrevendía `.pick()` como mitigación del contrato 202 | ADR §residual corregido: `.pick()` cubre shape de request vs schema de dominio, no el 202 ni el schema duplicado del handler. |
| Ley 19.628 (security) | `/legal/privacidad` stub + form sin consentimiento | **Condición de §11 (BLOCKING para el flip, no para este SHIP gateado)**: política publicada + consentimiento/finalidad antes de captar PII. |
| CORS-before-flag (security) | Encender flag sin CORS = captación fallida silenciosa | §11: CORS + preflight OPTIONS verificado ANTES del flag-on. |
| code-reviewer suggestions | `lucide-react` dep muerta; T9/Lighthouse vs verify.md | **Fix**: removido `lucide-react`; verify.md/T9 ya documentan "sin cambios ci.yml + Lighthouse diferido". |

### Residuales aceptados (documentados)

- **400/2xx-no-202 → `unavailable`**: el endpoint responde contractualmente 202/422/429/503; cualquier otro status cae en "intenta más tarde". Aceptable; testeado para 4xx (403/401).
- **Foco al desmontar el form en éxito** (ux QUESTION): el `<output>` (role=status) anuncia a SR vía live region; mover foco es mejora menor diferida.
- **Sin nav/header/footer/skip-link** (ux): el sitio es shell de contenido; landmarks de navegación quedan como deuda de UX antes de exponer (no bloquea SHIP gateado).
- **`no-checkout` es denylist** (devils P2-1): garantiza ausencia de PSP/DTE catalogados; ampliar la lista si aparece un PSP nuevo.
- **`postcss` moderate transitiva de Next** (security): build-time, CI gatea solo HIGH/CRITICAL; residual aceptado.

### Flagged repo-level (fuera de scope del feature)

- **`pnpm` ignora `pnpm.overrides`** del root package.json (warning en `pnpm install`/`audit`): los overrides de seguridad (crypto-js, etc.) podrían no aplicarse. Spawneado como tarea separada (verificar + migrar a `pnpm-workspace.yaml`). No introducido por este feature.

### No objetado (sólido, verificado)

Kill-switch fail-closed (`v==='true'`), 202 no lee body (anti-enumeration, con spies), form sin rol/empresa, sin Firebase/checkout en bundle, body explícito de 2 claves, on-path del kill-switch testeado, sin secretos (gitleaks limpio), sin XSS/SSRF, sin `console.*`/PII en logs, ADR-067 bien formado.

### Veredicto

**Approved for /ship** (SHIP **gateado**: contenido/SEO desplegable + `/signup` en "próximamente" con kill-switch off). 0 BLOCKING pendientes tras la remediación. Evidencia post-fix: **61/61 tests, coverage 100% (líneas/branches/funcs/stmts), build standalone OK, biome 0, tsc 0**. Las condiciones de §11 gobiernan el flip futuro a captación (CORS + downstream + Ley 19.628 + E2E/Lighthouse) — fuera de este SHIP.

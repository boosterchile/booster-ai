# Plan: reclamar carga sin oferta (BARH-23)

> **For agentic workers:** implementar task-by-task con TDD. Checkboxes `- [ ]`.

**Goal:** El transportista de zona puede reclamar un viaje en `ofertas_enviadas` que no le fue ofrecido; el matching automático no cambia; el despacho sigue exigiendo configuración elegible.

**Architecture:** Extraer de `acceptOffer` un núcleo `asignarViajeAEmpresa` (lock viaje → assignment + supersede ofertas + ruta). El claim inserta (o reutiliza) una oferta sintética `aceptada` con canal `api`/`web` y llama ese núcleo, o crea la asignación en la misma tx con una oferta `reclamo` pendiente→aceptada. Listado de reclamables = viajes `ofertas_enviadas` en zona de la empresa **sin** oferta pendiente propia.

**Tech Stack:** Hono, Drizzle, Vitest, Zod, `@booster-ai/trip-state-machine`, `@booster-ai/logger`, React + TanStack Query.

**Spec:** [spec.md](./spec.md) (aceptada 2026-11-16). **ADR:** no abrir sin permiso PO; contratos API se validan en el PR de impl.

## Global Constraints

- Zero `any` / `console.*`; Zod en boundaries; logger con `trace_id`.
- Matching `activa` sin cambio de filtro.
- `asignaciones.oferta_id` sigue NOT NULL → el claim **siempre** deja una fila en `ofertas` (sintética o real).
- Cobertura ≥80 % código nuevo; dominio crítico: rojo exhibido en evidencia del PR.
- WIP ≤3 PRs propios; sin `--admin`; sin release desde el agente.

## Mapa de archivos

| Archivo | Rol |
|---|---|
| `apps/api/src/services/reclamar-viaje.ts` (nuevo) | Orquestación claim + span `viaje.reclamar` |
| `apps/api/src/services/offer-actions.ts` | Extraer helper compartido de asignación si reduce duplicación |
| `apps/api/src/routes/marketplace-reclamar.ts` (nuevo) o extensión `offers.ts` / `assignments.ts` | `GET` listado + `POST` claim |
| `apps/api/src/index.ts` (o mount routes) | Registrar router |
| `packages/shared-schemas/src/domain/` | Schemas request/response claim |
| `apps/api/src/services/reclamar-viaje.test.ts` | Unit |
| `apps/api/test/integration/reclamar-viaje.integration.test.ts` | Integration Postgres |
| `apps/web/src/routes/` + nav | UI listado/reclamar (parte UI) |

---

### Task 1: Service `reclamarViaje` + tests (núcleo)

**Files:**
- Create: `apps/api/src/services/reclamar-viaje.ts`
- Create: `apps/api/src/services/reclamar-viaje.test.ts`
- Create: `apps/api/test/integration/reclamar-viaje.integration.test.ts`
- Modify: `apps/api/src/services/offer-actions.ts` (solo si se extrae helper; mantener accept intacto)

**Interfaces:**
- Produces: `reclamarViaje({ db, logger, tripId, empresaId, userId, ... }) → { assignment, supersededOfferIds }`
- Errores tipados: `ViajeNoReclamableError`, `ZonaNoCubreError`, `EmpresaYaTieneOfertaError`, etc.

- [x] **Step 1–7:** Integration TDD (`reclamar-viaje.integration.test.ts`) + `reclamarViaje` (oferta sintética + `acceptOffer`). 2 tests verdes contra Postgres local.

---

### Task 2: API HTTP + Zod

**Files:**
- Create: `apps/api/src/routes/marketplace-reclamar.ts` (+ `.test.ts`)
- Modify: mount en app principal
- Create/Modify: schemas en `packages/shared-schemas`

**Contrato propuesto (visto PO en PR):**
- `GET /marketplace/viajes-abiertos` → lista reclamables (zona + `ofertas_enviadas` + sin oferta pendiente propia). Auth: carrier oficina (`puedeAceptarOfertas` o mismo gate que accept).
- `POST /marketplace/viajes/:viajeId/reclamar` → body vacío o `{}`; 201 con assignment id.

- [x] **Step 1–3:** `GET /marketplace/viajes-abiertos` + `POST /marketplace/viajes/:viajeId/reclamar` + mount ENFORCED + span `viaje.reclamar`. Métrica dedicada pendiente (siguiente commit si CI pide). UI pendiente Task 3.

---

### Task 3: UI transportista

**Files:**
- Create/Modify: ruta web bajo `/app/…` (p. ej. sección en ofertas o `/app/marketplace`)
- Modify: `apps/web/src/components/nav-items.ts`

- [x] **Step 1–3:** UI en `/app/ofertas` («Otras cargas en tu zona») + hooks marketplace + ViajeAbiertoCard + test.

---

### Task 4: Verify + handoff

- [ ] **Step 1:** `pnpm run ci` (o filtros equivalentes) en evidencia del PR.
- [ ] **Step 2:** Actualizar `verify.md` de la spec con comandos corridos.
- [ ] **Step 3:** Nota en CURRENT: BARH-23 en main / pendiente deploy.

## Fuera de este plan

- Relajar elegibilidad al despachar.
- ADR-094 (solo con permiso PO).
- BARH-24 (plan hermano).

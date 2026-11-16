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

- [ ] **Step 1:** Test unit rojo — viaje `ofertas_enviadas`, empresa con zona en región origen y **sin** oferta pendiente: claim crea assignment `asignado`, trip → `asignado`, otras ofertas pendientes → `reemplazada`.
- [ ] **Step 2:** Correr test; exhibir rojo.
- [ ] **Step 3:** Implementar tx: FOR UPDATE trip; exigir `esAceptableOferta`; verificar zona activa empresa (misma query patrón matching); insert offer sintética (`pendiente`→`aceptada` o insert directo `aceptada` + responseChannel) con `empresaId` reclamante, `proposedPriceClp` = precio vigente del viaje/ofertas o 0 documentado; insert assignment (`vehicleId` null, `agreedPriceClp` coherente); supersede otras pendientes; transición trip; crear/conciliar ruta como `acceptOffer`.
- [ ] **Step 4:** Tests verdes unit.
- [ ] **Step 5:** Integration: espejo de `aceptar-sin-vehiculo.integration.test.ts` + caso “empresa sin carrocería elegible igual reclama”.
- [ ] **Step 6:** Test: segunda empresa no puede reclamar tras el primero; empresa fuera de zona → error.
- [ ] **Step 7:** Commit `feat(matching): reclamar viaje sin oferta (service)`.

---

### Task 2: API HTTP + Zod

**Files:**
- Create: `apps/api/src/routes/marketplace-reclamar.ts` (+ `.test.ts`)
- Modify: mount en app principal
- Create/Modify: schemas en `packages/shared-schemas`

**Contrato propuesto (visto PO en PR):**
- `GET /marketplace/viajes-abiertos` → lista reclamables (zona + `ofertas_enviadas` + sin oferta pendiente propia). Auth: carrier oficina (`puedeAceptarOfertas` o mismo gate que accept).
- `POST /marketplace/viajes/:viajeId/reclamar` → body vacío o `{}`; 201 con assignment id.

- [ ] **Step 1:** Tests de ruta rojos (401/403/404/409/201).
- [ ] **Step 2:** Implementar + métrica `marketplace_reclamos_total` + span.
- [ ] **Step 3:** Verdes; commit `feat(api): endpoints reclamar carga marketplace`.

---

### Task 3: UI transportista

**Files:**
- Create/Modify: ruta web bajo `/app/…` (p. ej. sección en ofertas o `/app/marketplace`)
- Modify: `apps/web/src/components/nav-items.ts`

- [ ] **Step 1:** Test componente/hook rojo (lista + botón Reclamar).
- [ ] **Step 2:** Implementar llamada API + toast errores.
- [ ] **Step 3:** Commit `feat(web): UI reclamar cargas sin oferta`.

---

### Task 4: Verify + handoff

- [ ] **Step 1:** `pnpm run ci` (o filtros equivalentes) en evidencia del PR.
- [ ] **Step 2:** Actualizar `verify.md` de la spec con comandos corridos.
- [ ] **Step 3:** Nota en CURRENT: BARH-23 en main / pendiente deploy.

## Fuera de este plan

- Relajar elegibilidad al despachar.
- ADR-094 (solo con permiso PO).
- BARH-24 (plan hermano).

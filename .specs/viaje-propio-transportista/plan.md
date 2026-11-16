# Plan: viaje propio del transportista (BARH-24)

> **For agentic workers:** implementar task-by-task con TDD. Checkboxes `- [ ]`. Depende de rutas API ya ON (ADR-088).

**Goal:** El transportista crea un servicio fuera del matching (cliente generador registrado o externo) y lo agrupa en la misma ruta que servicios de marketplace.

**Architecture:** `POST` transportista crea `viajes` marcados `origen_alta = propio_transportista` + assignment inmediata a su empresa + ruta planificada (o enganche a ruta existente). Cliente externo en columnas expand-only. No llama matching. Reutiliza `POST /rutas/:id/servicios`.

**Tech Stack:** Hono, Drizzle, Vitest, Zod, route-planner, React.

**Spec:** [spec.md](./spec.md) (aceptada 2026-11-16). **ADR / migración contract:** no. Migración **expand-only** 0085. ADR de producto solo con permiso PO.

## Global Constraints

- Zero `any` / `console.*`; Zod en boundaries.
- Viajes propios **no** disparan `runMatching`.
- Misma elegibilidad al `PUT /rutas/:id/configuracion`.
- Cobertura ≥80 %; TDD en dominio crítico.
- WIP ≤3.

## Mapa de archivos

| Archivo | Rol |
|---|---|
| `apps/api/drizzle/0085_viajes_propios_transportista.sql` | Expand: `origen_alta`, campos cliente externo |
| `apps/api/src/db/schema.ts` | Drizzle |
| `apps/api/src/services/crear-viaje-propio.ts` | Orquestación |
| `apps/api/src/routes/viajes-propios.ts` (o bajo assignments) | HTTP |
| `packages/shared-schemas/...` | Schemas |
| `apps/web/...` | Formulario alta |
| `*.test.ts` / integration | TDD |

### Decisión de schema (propuesta en plan; visto en PR de migración)

```sql
-- expand-only
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS origen_alta text NOT NULL DEFAULT 'marketplace'
  CHECK (origen_alta IN ('marketplace', 'propio_transportista'));
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS cliente_externo_nombre text;
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS cliente_externo_rut text;
ALTER TABLE viajes ADD COLUMN IF NOT EXISTS cliente_externo_contacto text;
-- generador: reutilizar FK/empresa generadora existente del viaje si hay;
-- si el modelo hoy exige generador_id NOT NULL, documentar en Task 1 el
-- generador "placeholder" de la empresa transportista vs nullable expand.
```

Antes de escribir SQL: inspeccionar `viajes` en `schema.ts` — si `empresaGeneradoraId` (o equivalente) es NOT NULL, opciones: (a) expand a nullable solo cuando `origen_alta = propio_transportista`, o (b) exigir generador registrado en v1 del form y externo como metadata adicional. **Spec dice C (ambos):** preferir (a) con check: externo ⇒ nombre NOT NULL y generador NULL; registrado ⇒ generador NOT NULL y externos NULL.

---

### Task 1: Migración expand + schema Drizzle

**Files:** `0085_…sql`, `schema.ts`, test de migración safety si aplica.

- [ ] **Step 1:** Inspeccionar columnas actuales de `viajes` / constraints.
- [ ] **Step 2:** Escribir SQL expand-only + Drizzle; `pnpm` migration check.
- [ ] **Step 3:** Commit `feat(db): expand viajes propios transportista`.

---

### Task 2: Service `crearViajePropio` + tests

**Files:** `crear-viaje-propio.ts`, unit + integration.

**Interfaces:**
- `crearViajePropio({ empresaTransportistaId, userId, origen, destino, tipoCarga, pesoKg, cliente: { tipo: 'generador', empresaId } | { tipo: 'externo', nombre, rut?, contacto? } })`

- [ ] **Step 1:** Test rojo — crea trip `origen_alta=propio_transportista`, status adecuado (`asignado` o el que use el flujo post-assign), assignment a la empresa, **cero** ofertas, **no** llama matching (spy).
- [ ] **Step 2:** Rojo exhibido.
- [ ] **Step 3:** Implementar; ruta planificada inicial (patrón acceptOffer / sincronizar-ruta).
- [ ] **Step 4:** Test cliente externo RUT inválido → Zod 400; generador inexistente → 404.
- [ ] **Step 5:** Commit `feat(api): crear viaje propio transportista (service)`.

---

### Task 3: API HTTP

- [ ] **Step 1:** `POST /viajes-propios` (nombre final en shared-schemas) + tests ruta.
- [ ] **Step 2:** Auth: carrier `dueno|admin|despachador`.
- [ ] **Step 3:** Commit `feat(api): POST viajes propios`.

---

### Task 4: Agrupar en ruta existente

- [ ] **Step 1:** Integration: assignment propia + assignment marketplace en misma ruta vía `POST /rutas/:id/servicios`; configuración elegible OK / no elegible 422.
- [ ] **Step 2:** Ajustar validaciones si el router rechaza origen propio.
- [ ] **Step 3:** Commit `test(rutas): mezcla servicio propio + marketplace`.

---

### Task 5: UI

- [ ] **Step 1:** Formulario alta (generador select **o** campos externos) + link a rutas.
- [ ] **Step 2:** Tests UI mínimos.
- [ ] **Step 3:** Commit `feat(web): alta viaje propio transportista`.

---

### Task 6: Verify + handoff

- [ ] `pnpm run ci` en evidencia; `verify.md`; CURRENT.

## Orden de entrega respecto a BARH-23

1. Mergear plan.md (este PR docs).
2. Implementar **BARH-23** (claim) primero — desbloquea el caso “sin match de flota”.
3. Implementar **BARH-24** (viaje propio) en PR separado.
4. Un solo PR de UI puede combinar ambas superficies si WIP lo permite.

## Fuera de este plan

- Portal cliente externo.
- Import TMS.
- ADR sin permiso PO.
- Liquidación/cobra-hoy específica de propios (precio puede ser 0 / null según constraint `precio_acordado_clp` NOT NULL — usar 0 documentado o expand nullable en 0085 con visto PO si toca datos).

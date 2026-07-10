# D2 — Shell operador a D2: sidebar + 2 dashboards (parte 2)

**Estado**: aceptada (goal PO 2026-07-09). Primera migración de una superficie real a D2 (antes solo `/apariencia` usaba las primitivas).
**Recon (parte 1)**: Layout header top-bar sin sidebar; app.tsx = hub de nav pura (cero datos); todo pre-D2; conductor/platform-admin con shell propio.

## Decisiones selladas
- Shell → **sidebar persistente role-aware** en `Layout.tsx`, **drawer en móvil**, registro **operador**.
- Reciben sidebar: transportista/generador/stakeholder/perfil. **Conductor** (`conductor.tsx`) y **platform-admin** (`platform-admin.tsx`) tienen shell propio — NO se tocan.
- Dashboards (generador + transportista) migran como **hub de navegación** (cards → primitivas D2), sin agregar datos/contadores (1:1).
- Acentos hardcodeados por card (amber/success/emerald) → tokens semánticos D2.
- Ola 3 NO se construye. Deep-screens NO se migran. CompanySwitcher sigue accesible.

## Salidas
- **`components/nav-items.ts`**: `navSectionsForMe(me)` — nav role-aware (Inicio + Transporte 7+admin / Generador 4 / Stakeholder: Inicio+Zonas). Puro, testeado.
- **`components/Sidebar.tsx`**: nav vertical, item activo con **acento** (`bg-accent-50`/`text-accent-600`), padding por registro (`var(--pad-y)`/`--touch-min`), CompanySwitcher + perfil/Salir.
- **`components/Layout.tsx`**: `RegisterProvider register="operador"`; sidebar desktop (`md:block w-64`) + drawer móvil (`data-testid=mobile-drawer`, toggle por la hamburguesa existente); topbar usa el prop `title`.
- **`routes/app.tsx`**: dashboards migrados a `DashboardCard` (primitiva `Card` D2); acentos → `warning`/`success`/`primary`; data en arrays; card admin gated `isAdmin && is_transportista`.
- **`routes/apariencia-shell.tsx`** + ruta `/apariencia/shell?rol=…`: preview del shell con `me` mock (para revisión del PO + E2E sin auth).

## Verificación
- **Cero hardcode** (grep hex/rgb/px en Layout/Sidebar/nav-items/app = vacío).
- **vitest-axe** sobre shell+dashboard (app.test) sin violaciones.
- **E2E Chromium** (`e2e-local/operator-shell.spec.ts`, 4/4): sidebar transportista vs generador (role-correcto, FALLA si muestra el rol equivocado), desktop sin hamburguesa, móvil drawer abre/cierra.
- Unit: nav-items 5/5, Layout 6/6 (switcher/Salir/role-aware/drawer). apps/web **1132/1132**; coverage **83.9% lines / 78.1% branches** (gate 80/75). typecheck+build+biome ok.
- Conductor/platform-admin: NO tocados (shell propio); stakeholder ve solo Inicio+Zonas.
- Vinculante = CI clean-install (gotcha .env: el job browser copia `.env.example`).

## Fuera de alcance
Deep-screens (cargas/vehiculos/conductores) · Ola 3 · conductor/platform-admin · datos/contadores en el dashboard.

## Condición de término
Todo verde con evidencia fresca del CI. PR abierto contra `main`, **no mergeado** (gate PO, ADR-072).

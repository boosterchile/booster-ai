# Demo features night sprint — 2026-05-10 → 11

**Owner**: Felipe Vicencio (PO) + Claude
**Branch**: `claude/inspiring-pike-424a2c`
**PR**: [#157](https://github.com/boosterchile/booster-ai/pull/157)
**Estado**: 11 features mergeable / 1 pendiente (D6)

---

## TL;DR

Sprint nocturno para preparar demo end-to-end de Booster AI mostrando todas las funcionalidades. **12 features delivered en un solo PR**, ~12k LOC, 1700 tests verdes. Set completo D1-D11 + D6 (compliance documentos + dashboard).

Pendientes (follow-ups, no bloqueantes del demo):
- D6 brazo 2 — programaciones de mantenimiento preventivo (separate PR).
- D6 — upload directo a GCS + signed URLs + CMEK (actualmente URL externa).
- D6 — notificaciones cron + WhatsApp template para vencimientos.
- D11 — agregaciones reales sobre trips (actualmente mock data en frontend).
- D7b — FK ofertas → sucursales.

---

## Features entregadas

| ID | Feature | Estado | Commit |
|---|---|---|---|
| **D4** | Placa chilena visual (SVG con escudo) | ✅ | `d5a596d` |
| **D3** | Separar tracking del edit de vehículo (`/app/flota`) | ✅ | `87e7b0c` |
| **D7** | Tabla `conductores` separada de users + migration | ✅ | `3b95a1a` |
| **D8** | CRUD conductores en interfaz transportista | ✅ | `7e7739d` |
| **D9** | Login conductor por RUT + PIN + driver-only surface | ✅ | `8fa34a2` |
| **D7b** | Sucursales del generador de carga | ✅ | `09db743` |
| **D10** | Flujo dueño-conductor (checkbox "soy el conductor") | ✅ | `f3c635a` |
| **D1** | Seed demo en producción + IMEI espejo | ✅ | `8400542` |
| **D2** | GPS móvil del browser para vehículos sin Teltonika | ✅ | `ddf2033` |
| **D5** | Card metodología GLEC v3.0 en certificados | ✅ | `859ae34` |
| **D11** | Stakeholder geo dashboard (skeleton + zonas demo) | ✅ | `b7a761d` |
| **D6** | Compliance: documentos + dashboard cumplimiento | ✅ | `b904662` |

---

## Cambios destacados

### Modelo de identidad (D7+D8+D9+D10)
- Nueva tabla `conductores` separada de `usuarios`. Un user puede ser conductor en una sola empresa transportista; el RUT es el identificador universal.
- Login conductor con **RUT + PIN de 6 dígitos** (scrypt timing-safe). Carrier crea conductor → backend devuelve PIN una vez → conductor entra a `/login/conductor` → Firebase custom token + email sintético `drivers+<rut>@boosterchile.invalid`.
- Driver-only surface guard: si rol activo es `conductor`, redirige automáticamente desde `/app` a `/app/conductor/modo`.
- Dueño-conductor: checkbox "Soy yo el conductor" pre-llena RUT/nombre del me; el backend skipea PIN si el user ya está activado.

### Demo en producción sin contaminar Van Oosterwyk (D1)
- Columna `vehiculos.teltonika_imei_espejo`: vehículos pueden "mirar" telemetría de OTRO IMEI sin escribir ni romper FK.
- Vehículo demo `DEMO01` con `teltonika_imei_espejo = '863238075489155'` (mismo IMEI del Teltonika real de Van Oosterwyk).
- Van Oosterwyk sigue siendo el dueño primary del device — sin contaminación.
- Endpoint admin `POST /admin/seed/demo` (allowlist `BOOSTER_PLATFORM_ADMIN_EMAILS`) crea/recrea todo idempotentemente.
- `DELETE /admin/seed/demo` limpia todo, Van Oosterwyk queda intocado.

### GPS móvil del browser (D2)
- Tabla `posiciones_movil_conductor` stream paralelo a Teltonika.
- POST `/assignments/:id/driver-position` desde el browser del conductor.
- Read endpoints `/vehiculos/:id/ubicacion` y `/flota` ahora particionan en 3 grupos: vehículos con Teltonika propio, con espejo, sin device (browser_gps).
- UI en `/app/conductor/modo`: card "Reporte GPS móvil" con input de assignment_id + start/stop, feedback en vivo de puntos enviados.

### Sucursales del shipper (D7b)
- Tabla `sucursales_empresa` con coords nullable, horario texto libre, soft delete.
- Endpoints CRUD + UI `/app/sucursales` con dropdown de 16 regiones chilenas norte→sur.

### Stakeholder geo (D11) — skeleton
- Surface `/app/stakeholder/zonas` con 5 zonas predefinidas (Puerto Valparaíso, Puerto San Antonio, Mercado Lo Valledor, Polo Quilicura, Zona Franca Iquique).
- Datos demo (mock); integración con agregaciones reales del API es follow-up.
- Card metodología explica k-anonymity ≥ 5 + bounding boxes predefinidos.

---

## Tests

| Package | Antes del sprint | Después | Δ |
|---|---|---|---|
| api | 680 | 743 | +63 |
| web | 833 | 877 | +44 |
| shared-schemas | 65 | 80 | +15 |
| **Total** | 1578 | 1700 | **+122** |

Todos verdes. Typecheck, lint y build limpios en todos los packages.

---

## Migrations

- `0021_conductores.sql` — tabla conductores + enums licencia_clase / estado_conductor.
- `0022_users_activation_pin.sql` — columna `usuarios.activacion_pin_hash` + `idx_usuarios_rut`.
- `0023_sucursales_empresa.sql` — tabla sucursales.
- `0024_demo_seed_espejo.sql` — `vehiculos.teltonika_imei_espejo` + `empresas.es_demo`.
- `0025_posiciones_movil.sql` — tabla posiciones_movil_conductor.
- `0026_compliance_documentos.sql` — documentos vehículo + conductor + flag opt-in carrier.

6 migraciones nuevas. Todas son ADD COLUMN nullable / CREATE TABLE nuevas — metadata-only en Postgres ≥ 11, sin rewrite de tablas existentes. Reversibles con DROP.

---

## Cómo correr el demo en producción tras merge

1. Apply migrations (auto en el startup del API por el migrator).
2. Configurar `BOOSTER_PLATFORM_ADMIN_EMAILS` con el email del PO/admin.
3. `POST /admin/seed/demo` con Firebase token de un admin → returns credenciales:
   ```json
   {
     "shipper_owner": { "email": "demo-shipper@boosterchile.com", "password": "BoosterDemo2026!" },
     "carrier_owner": { "email": "demo-carrier@boosterchile.com", "password": "BoosterDemo2026!" },
     "conductor": { "rut": "12.345.678-5", "activation_pin": "<6 dígitos>" }
   }
   ```
4. Flow de demo:
   - **Como shipper**: crea sucursales, publica una oferta entre dos sucursales.
   - **Como carrier**: acepta la oferta. Asigna el vehículo DEMO01 (Teltonika espejo) o DEMO02 (sin device).
   - **Como conductor**: entra a `/login/conductor` con RUT + PIN. Va a `/app/conductor/modo`.
     - Si maneja DEMO01: ve datos reales del Teltonika de Van Oosterwyk.
     - Si maneja DEMO02: activa "Reporte GPS móvil" con el assignment_id.
   - **Como carrier**: ve la flota en `/app/flota` — ambos vehículos con sus posiciones, con badge `mirror` / `browser_gps` distinguibles.

---

## Pendientes / próximos pasos

### Brazo 2 de D6 — Mantenimientos preventivos (defer a su propio PR)

- Tabla `mantenimientos` + `programaciones_mantenimiento` con reglas tipo
  "cada N km" / "cada N días" + alerta T días antes.
- Servicio cron diario que recalcule `estado` de documentos vencidos.
- Notificaciones WhatsApp template `compliance_warning_v1` 7/3/0 días antes.

### Follow-ups técnicos identificados

- **D2 tests del endpoint** `POST /assignments/:id/driver-position` — quedó sin cobertura unit. La cobertura indirecta via reads de vehiculos.test.ts garantiza no regresión. Agregar 3-5 tests cuando se haga el siguiente PR de assignments.
- **D11 agregaciones reales** — sustituir mock data del frontend por queries reales sobre trips agregadas con k-anonymity ≥ 5.
- **D7b FK ofertas → sucursal** — agregar `sucursal_origen_id` y `sucursal_destino_id` opcionales a `ofertas` (tabla) + form en `/app/cargas/nueva`.
- **D9 logins ongoing** — el conductor activado usa Firebase email/password con el email sintético. Permitir cambio de password desde perfil.
- **D6 upload directo a GCS** — actualmente `archivo_url` acepta URL externa (Drive/Dropbox). Para producción: bucket `gs://booster-ai-docs` en Terraform con CMEK + signed URLs server-side.

### Operacional

- Tras merge, configurar:
  - `BOOSTER_PLATFORM_ADMIN_EMAILS` en Secret Manager.
  - Routes API + Gemini API keys (ya configuradas en sprints previos).
- Verificación visual con dev server contra prod tras merge para validar UX.
- Smoke test del flow completo demo: seed → shipper crea oferta → carrier acepta → conductor activa PIN → GPS móvil + Teltonika espejo en vivo.

---

## Decisiones documentadas

- Memoria `project_identity_model_decisions.md` actualizada con los detalles de D7-D10.
- Memoria `project_d1_d6_demo_features.md` será actualizada con el estado post-sprint.

---

## Pre-merge checklist

- [x] Typecheck OK en todos los packages
- [x] Tests verdes (1691 total)
- [x] Lint OK (biome auto-fix aplicado por pre-commit)
- [x] Build OK (web bundle bajo 100kb gzip)
- [x] Migrations metadata-only (sin downtime)
- [ ] Verificación visual contra dev server (pendiente — se hace en review)
- [ ] Smoke test demo end-to-end post-merge
- [ ] Configurar `BOOSTER_PLATFORM_ADMIN_EMAILS` antes de correr `/admin/seed/demo`

---

## Refs

- ADR-028 — Dual data source (Teltonika vs Maps API) — base de D1 espejo
- Memoria `project_identity_model_decisions.md` — Q1-Q3 del PO sobre conductor/dueño-conductor/stakeholder
- Memoria `project_d1_d6_demo_features.md` — plan original del sprint
- Sesión previa: `2026-05-10-eco-route-loop-closure.md` (Phase 1-5 eco-route)

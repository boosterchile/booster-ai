# Borrador de extensión de ADR-028 — activar `movil_gps` como procedencia de ruta

**Status:** PROPUESTA (no ratificada). Requiere un ADR nuevo que extienda ADR-028 y su ratificación por
el PO. **NO** edita `docs/adr/028-*.md` (los ADR ratificados no se editan; se extienden con uno nuevo).
**Origen:** hallazgo F0-0 (`hallazgo-distancia-medida-vs-estimada.md`) · decisión del PO 2026-07-13.

## Qué ya dice ADR-028 (no es invención nueva)

ADR-028 §7 (Out of scope) **ya reservó** este slot, postergado:

> *Phone-as-Telemetry como tercer nivel intermedio (PWA con `navigator.geolocation`… subido al cierre del
> trip). Sería `route_data_source = phone_gps` y nivel `secundario_modeled` con factor de incertidumbre
> 0.10 (mejor que 0.15 maps-only, peor que 0.05 Teltonika). Postergado: requiere consent flow y trabajo de
> PWA background-sync…*

La app del conductor (`posiciones_movil_conductor`) es exactamente ese canal. Esta extensión lo **promueve
de postergado a decidido**. La razón por la que se activa ahora: el hallazgo F0-0 muestra que la traza real
(Teltonika y app) hoy se descarta para la distancia; al cablearla (Propuesta A) hace falta una procedencia
que represente el canal app.

## Decisión propuesta

### 1. Nuevo valor de enum `route_data_source`: `movil_gps`
Agregar a `routeDataSourceSchema` (Zod, `packages/shared-schemas/src/domain/trip-metrics.ts`) y a
`routeDataSourceEnum` (pgEnum, `apps/api/src/db/schema.ts`). **Cambio de schema BD público** → migración +
aprobación PO (ya autorizada la dirección; falta la ratificación del ADR formal).

### 2. Nombre canónico: `movil_gps` (no `phone_gps`)
ADR-028 §7 lo llamó `phone_gps`; se adopta **`movil_gps`** por consistencia con la tabla existente
`posiciones_movil_conductor` y el naming bilingüe del stack. La extensión ADR debe declarar el rename
explícito respecto de §7 para que no queden dos nombres para el mismo concepto.

### 3. Jerarquía en `derivarNivelCertificacion()` — `movil_gps` NUNCA al nivel de `teltonika_gps`

| procedencia | naturaleza | nivel resultante | incertidumbre base |
|---|---|---|---|
| `teltonika_gps` | hardware cableado a la ignición, **no suprimible por el conductor** | `primario_verificable` | 0.05 |
| `movil_gps` | traza GPS real pero **suprimible** (app manual, foreground-only, el conductor la apaga) | `secundario_modeled` | **0.10** |
| `maps_directions` | ruta sintetizada por Routes API | `secundario_modeled` | 0.15 |
| `manual_declared` | declaración del cliente | `secundario_default` | 0.30 |

**Principio (integridad del certificado):** un dato que **el sujeto medido controla** no tiene la calidad de
hardware no-suprimible. La app es manual, foreground-only, y el conductor puede apagarla a mitad de camino →
por construcción **nunca** alcanza `primario_verificable`. Coincide con la posición ya anticipada en
ADR-028 §7 (intermedio, 0.10). La matriz §2 de ADR-028 se extiende con las filas de `movil_gps`, sujeta al
mismo downgrade por `coverage_pct` (95%/80%) y a la regla de honestidad de huecos (F0-0 §7).

### 4. Consent flow (heredado de ADR-028 §7)
ADR-028 §7 condicionó `phone_gps` a un consent flow. La activación de `movil_gps` arrastra ese requisito:
el conductor consiente el reporte de su geolocalización (Ley 19.628 / 21.719). Es parte de la extensión, no
del paso 1 (que es Teltonika).

## Relación con el fix F0-0

- **Paso 1 (spec `distancia-real-hibrida`)** usa **`teltonika_gps`** — que ya existe en el enum. **No depende
  de esta extensión.** Se puede mergear sin ratificar este ADR.
- **Esta extensión** habilita el canal app (`movil_gps`), hoy latente (0 filas en `posiciones_movil_conductor`).
  Se ratifica cuando se cablee la captura de la app a la distancia — frente posterior.

## Pendiente para ratificar (PO)
- [ ] Escribir el ADR formal (número siguiente disponible) que extiende ADR-028 con §1–§4.
- [ ] Confirmar el rename `phone_gps` → `movil_gps`.
- [ ] Consent flow del reporte GPS de la app antes de habilitar `movil_gps` en producción.

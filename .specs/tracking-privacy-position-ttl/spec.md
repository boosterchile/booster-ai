# Fix privacidad tracking público — corte de posición + TTL de token

**Slug:** `tracking-privacy-position-ttl` · **Rama:** `fix/tracking-privacy-position-ttl` · **Base:** `origin/main`

## Problema (recon verificado)

`GET /public/tracking/:token` (`get-public-tracking.ts`) devuelve `position`/`progress` **sin importar `trip.status`** — incluso `entregado`/`cancelado` — y el `tracking_token_publico` **no expira ni se revoca**. Un link filtrado/viejo expone la **ubicación ACTUAL del vehículo indefinidamente**, incluso en viajes futuros no relacionados (la query de pings es por `vehiculo_id` + `<30 min`, sin atarse a este trip). Latente hoy (PLFL57 sin reportar) pero real al escalar. El resto del endpoint ya es privacy-minded (patente enmascarada, sin RUT/precio/conductor).

## Alcance

Solo el **fix de privacidad**, en la lógica del servicio + schema. **NO se toca** el handler de ruta, la página pública (`public-tracking.tsx`), ni ningún otro comportamiento del endpoint (patente, ETA activo, etc.).

Entradas: `apps/api/src/services/get-public-tracking.ts`, `apps/api/src/db/schema.ts` (+ migración `0052`), tests.

## Criterios de éxito

### 1. Corte de `position`/`progress` por estado (allowlist, fail-closed)
`position` y `progress` (y `eta_minutes`) se exponen **solo** en estados de fulfillment activo: **`asignado`, `en_proceso`**. En cualquier otro estado (terminal `entregado`/`cancelado`/`expirado`, o pre-activo `esperando_match`/`borrador`/`emparejando`/`ofertas_enviadas`, o cualquier estado futuro) → `position=null`, `progress={null,null}`, `eta_minutes=null`. **La ruta, direcciones, tipo de carga, vehículo (tipo + patente parcial) y `status` siguen visibles** (el destinatario tiene derecho a ver que se entregó).

**Justificación del allowlist (no denylist):** `position`/`progress` reflejan el movimiento vivo del vehículo, legítimo solo mientras cumple ESTE viaje (`asignado` = en ruta a/en retiro; `en_proceso` = en tránsito). Terminado el viaje, el vehículo puede estar en otra carga → fuga. Un allowlist es fail-closed: cualquier estado nuevo/inesperado corta por defecto. Espeja `ACTIVE_TRIP_STATUSES` del front (`use-public-tracking.ts`).

### 2. TTL del token (no permanente) → token expirado = 404 neutro
Se agrega columna `asignaciones.tracking_token_expira_en timestamptz` (nullable, **override explícito**; migración **expand-only** 0052). La expiración **efectiva** se computa en el servicio (función pura `computeTokenExpiry`), sin write-path nuevo:

- `override` (columna) si está seteada — **gana** (habilita revocación manual, ver §3).
- si no: `min(terminal + TTL_AFTER_TERMINAL, acceptado + TTL_ABSOLUTE)` donde `terminal = entregado_en ?? cancelado_en` (si existe).
- si no hay terminal (viaje activo): `acceptado_en + TTL_ABSOLUTE`.

`now > expiraEfectiva` → el servicio devuelve `{ status: 'not_found' }` → **404 neutro** (idéntico a token inválido/inexistente; no filtra que el token existió).

**Constantes y justificación:**
- `TOKEN_TTL_AFTER_TERMINAL_DAYS = 7` — tras entrega/cancelación el link sigue 7 días para que el destinatario consulte el comprobante/estado; no indefinido.
- `TOKEN_TTL_ABSOLUTE_DAYS = 30` — cap absoluto desde `aceptado_en`. Garantiza **no-permanencia** incluso para viajes que nunca alcanzan estado terminal (stuck/abandonados). Un viaje abierto >30 días es anómalo en el dominio (flete doméstico Chile, <2 días típico).

**Por qué derivado y no almacenado en cada entrega:** guardar `entregado_en + N` en la columna exigiría tocar el write-path de confirmación de entrega/cancelación + backfill. Derivarlo en lectura es equivalente, cero superficie de escritura, cubre automáticamente todas las filas existentes/legacy, y la columna queda como override/revocación (§3). La columna se agrega igual (migración) — su semántica es override, NULL = derivar.

### 3. Revocación manual — cubierta por la misma columna, sin machinery nueva
No se agrega endpoint/UI de revocación (YAGNI — no lo pide el flujo hoy). Pero la columna `tracking_token_expira_en` **habilita** revocación inmediata: setearla a un instante pasado (vía TF/consola/futuro admin) → token expirado → 404. Capacidad presente, costo cero, sin construir superficie que hoy no suma.

### 4. Sin cambios fuera del fix
No se modifica el handler de ruta, la página pública, ni el comportamiento del endpoint en estados activos (posición/ETA/patente idénticos). El shape del response no cambia (mismos campos; solo más `null` en no-activos).

## Tests (TDD, dominio privacidad/telemetría → rojo exhibido)

Puros (`computeTokenExpiry`): activo → `aceptado+30d`; entregado reciente → `entregado+7d`; entregado viejo → expirado; override pasado → expirado; override futuro gana.
Servicio (`getPublicTracking`, DB mockeada):
- `entregado` con pings recientes → `position=null`, `progress` null, `eta_minutes=null`, **trip+vehículo visibles** (rojo: hoy expone position).
- `cancelado` → mismo corte.
- token expirado (`entregado_en` viejo) → `not_found` (rojo: hoy devuelve found).
- override en el pasado (revocación) → `not_found`.
- `en_proceso`/`asignado` vigente + pings recientes → **sin cambios** (position/progress/eta como hoy).

Migración: `0052` expand-only + `down/` + entrada journal (integrity test valida journal↔archivos).
Evidencia: rojo → verde; suite api, typecheck, biome, build.

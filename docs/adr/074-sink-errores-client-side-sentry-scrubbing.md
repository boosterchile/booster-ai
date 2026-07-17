# ADR-074 — Sink de errores client-side: Sentry con scrubbing PII por allowlist

**Estado**: Accepted
**Fecha**: 2026-07-16
**Decider**: Felipe Vicencio (Product Owner)
**Related**: `apps/web/src/lib/logger.ts` (TODO que exige este ADR), [ADR-071](./071-datadog-observability-gke-gateway.md) (precedente: observabilidad sin fuga de creds; `RedactingSpanExporter`), [ADR-068](./068-modelo-consentimiento-esg-19628-21719.md) (marco Ley 19.628), `infrastructure/security.tf` (slot `sentry-dsn`, reservado como "opcional"), PRs #600/#601 (incidente LatLngBounds)

---

## Contexto

El frontend (`apps/web`, PWA Vite + React 18 + TanStack Router) **no tiene sink de errores**: `logger.ts` forwardea a `console.*` y nada sale del browser. El costo quedó demostrado en julio-2026: `TypeError: l.LatLngBounds is not a constructor` crasheó `/app/flota` (outage, PR #600) y la misma clase de bug vivió **~2 meses invisible** en el preview de eco-ruta (PR #601) — crasheaba en el card de ofertas de usuarios reales y nadie lo supo, porque el único rastro era la consola del browser de la víctima.

Hechos que condicionan la solución (recon 2026-07-16):

- **React/TanStack Router capturan los errores de render/effect ANTES de `window.onerror`**: el fallback "Something went wrong!" que vio el usuario es el `CatchBoundary` **default** del router (no hay boundary propio en el código; `createRouter` en `router.tsx` no define `defaultErrorComponent` ni `defaultOnCatch`). Un handler global de window, solo, es ciego a la clase de bug que motivó este ADR.
- Por eso la captura necesita **cuatro puntos complementarios**: (1) el path del router (render/effect de rutas), (2) `window` `error`/`unhandledrejection` (async fuera de React), (3) `QueryCache`/`MutationCache` de TanStack Query (fallos de red/API), (4) `logger.error` (lo logueado explícitamente). Los cuatro convergen en un único punto de envío.
- La org Sentry `booster-chile` ya existe (región **US**), con acceso MCP desde las sesiones de trabajo; hoy tiene **0 proyectos** (sin DSN). Terraform ya reservó el slot `sentry-dsn` en el inventario de secrets.
- Precedente de PII en observabilidad: el backend interpone `RedactingSpanExporter` (`packages/otel-bootstrap/src/index.ts`) que redacta credenciales (`auth|token|access_token|key|signature|code`) en todo atributo string **antes** de exportar — el principio es "un choke point, redacción pre-export, jamás post-hoc".
- El diagnóstico de #600 costó un recon completo porque el stack llegó **minificado** (`l.LatLngBounds`). La symbolication no es nice-to-have: es la diferencia entre leer `EcoRouteMapPreview.tsx:148` y adivinar.

## Decisión

**Sentry browser SDK como sink único de errores client-side de `apps/web`**, cableado en los cuatro puntos de captura, con **todo el tráfico saliente pasando por una política de scrubbing por allowlist** (abajo). Alternativas evaluadas y descartadas:

| Opción | Por qué no |
|---|---|
| Logging propio (`POST /api/log/client` + log-metrics TF) | Hay que construir endpoint público + validación + rate-limit + dedupe + grouping, y aun así el stack llega **sin symbolication** — exactamente lo que hizo caro el incidente. Datos en casa no compensa señal ilegible |
| OTel browser SDK | Pensado para traces, no error tracking: sin grouping ni alertas de errores out-of-the-box, peso similar. El trace_id end-to-end puede agregarse después sin contradecir este ADR |
| Solo handler global + consola | No resuelve visibilidad (nada sale del browser) y es ciego a errores de render (ver Contexto) |

Lo que Sentry compra: symbolication vía sourcemaps, grouping de issues, release tracking (correlar crash ↔ deploy), alertas, y triage vía el MCP ya conectado. Alcance estricto: **solo error tracking** — sin session replay, sin performance/APM browser (coherente con ADR-071: APM browser bypasearía el control de redacción igual que ddtrace lo hacía en backend).

## Política de scrubbing (el contrato de este ADR)

**Principio: ALLOWLIST, no denylist.** `beforeSend` no "filtra" el evento: lo **reconstruye** proyectando SOLO los campos permitidos. Todo campo no listado se descarta por defecto — un campo nuevo del SDK nace descartado hasta que un supersede de este ADR lo permita.

### Se envía (allowlist exhaustiva)

- `exception.type` (p. ej. `TypeError`)
- `exception.value` (message) — **post-scrub por patrón**, ver abajo
- `stacktrace.frames`: `filename`, `function`, `lineno`, `colno` — **sin `vars`** (local variables jamás)
- Ruta de la app: **pathname puro** (sin query string, sin hash)
- `release` (versión/commit del deploy) y `environment`
- `contexts.browser` / `contexts.os` (nombre y versión)
- `timestamp`, `event_id`, `level`, tag `scrubbed` (auditoría, ver abajo)

### Se descarta SIEMPRE (nunca sale del browser)

Request/response bodies · **todos** los breadcrumbs (los automáticos de fetch/xhr/console/ui.click se **desactivan en la config de integraciones**, no se filtran después) · query params y fragments · user context completo (`sendDefaultPii=false` y objeto `user` eliminado: ni id, ni email, ni RUT, ni nombre, ni IP) · headers · cookies · `localStorage`/`sessionStorage` · payloads de red · local variables de frames · attachments · session replay (no se habilita).

### El message: scrub por patrón, no descarte total

Los messages pueden arrastrar datos ("RUT 12.345.678-9 no encontrado"). Se decide **doble barrera** en vez de descartar el message completo:

1. **Scrub por patrón** sobre `exception.value` con los datos Booster nombrados abajo → reemplazo `[REDACTED-<tipo>]` + truncado a 300 chars. Si hubo ≥1 reemplazo, el evento sale con tag `scrubbed=true` (auditar frecuencia: mucho scrub = alguien está interpolando datos en Errors, ver regla de código).
2. **Regla de código acompañante**: prohibido interpolar PII/datos de negocio en mensajes de `Error` del front. Los errores de runtime del engine (`TypeError`, `ReferenceError` — la clase de #600/#601) no interpolan datos de negocio por construcción; los de dominio los escribimos nosotros y quedan bajo esta regla.

¿Por qué no descartar el message entero? Porque #600 se diagnosticó por el message exacto ("is not a constructor"); sin él, el issue pierde la mitad de la señal técnica. Alineación Ley 19.628: minimización — tras el scrub, lo que viaja es información técnica del fallo, no datos personales.

### Datos Booster protegidos explícitamente (patrones del scrub)

- **RUT** (transportista/empresa/conductor): `\b\d{1,2}\.?\d{3}\.?\d{3}-[\dkK]\b`
- **Patentes chilenas** (formatos `LLLL99` y `LL·LL·99`, con/sin separadores)
- **Coordenadas/ubicaciones** de carga (pares decimales lat,lng)
- **Montos** de factoring/anticipo/pricing (CLP con separador de miles, UF)
- **IMEI** Teltonika (`\b\d{15}\b`)
- **Email y teléfono** (+56 9 …)
- **Credenciales en strings** — se reusa el patrón del `RedactingSpanExporter` backend: `(auth|token|access_token|key|signature|code)=…` → `[REDACTED]` (consistencia front/back)

### Contrato verificable

La política se implementa como función pura `scrubEvent(event)` con suite propia que ES el contrato:

1. **Golden test de allowlist**: un evento sintético cargado con TODO lo prohibido (user, breadcrumbs, headers, cookies, bodies, query params, vars) sale conteniendo **exactamente** los campos de la allowlist y nada más.
2. **Test de supervivencia**: `JSON.stringify(eventoSaliente)` no matchea ninguno de los patrones de PII con fixtures reales (RUT válido, patente, IMEI de 15 dígitos, coordenadas, monto, email, token).
3. Cambiar la allowlist o los patrones **exige superseder este ADR** — los tests referencian este documento.

## Consecuencias

**Positivas**: un crash de front en prod = issue con stack legible + alerta (cierra el hueco que hizo invisible #601 por ~2 meses); triage desde las sesiones vía MCP; se cierra el TODO de `logger.ts` con la costura que ese archivo ya dejó preparada.

**Negativas / riesgos aceptados**: datos técnicos viajan a Sentry US (~minimizados por allowlist; el evento post-scrub no contiene datos personales); +~25-30 KB gzip al bundle PWA; paso nuevo de CI (upload de sourcemaps a Sentry — los sourcemaps NO se sirven públicos); mantenimiento de los patrones de scrub cuando aparezcan nuevos tipos de dato sensible; el init del SDK va en try/catch y la app **jamás** se rompe por el sink (si Sentry cae, se degrada a la consola actual).

**Fuera de alcance**: backend sigue en OTel → Cloud Trace (ADR-071 intacto); sin session replay ni APM browser; la implementación (proyecto Sentry + DSN vía `VITE_SENTRY_DSN` con fuente en el slot GSM `sentry-dsn`, wiring de los 4 puntos, `scrubEvent`, sourcemaps en cloudbuild) es un goal aparte que ejecuta este contrato.

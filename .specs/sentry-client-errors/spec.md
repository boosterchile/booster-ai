# Spec — feat/sentry-client-errors (implementación de ADR-074)

## Contexto

ADR-074 (aceptado, main `a072503`) fijó: Sentry browser SDK como sink único de errores
client-side, con política de scrubbing por **allowlist** (default-deny) como contrato
verificable. DSN ya en GSM (`sentry-dsn` v2). Este feature ejecuta ese contrato.

## Entradas / salidas

- **Entrada**: cualquier error del front — render/effect de rutas (clase LatLngBounds),
  async fuera de React, fallos de red de TanStack Query, `logger.error`.
- **Salida**: evento en Sentry con SOLO los campos de la allowlist ADR-074, stack legible,
  release correlado al deploy. Sin DSN (dev/CI): no-op silencioso, cero cambio de conducta.

## Criterios de éxito

1. `scrubEvent()` pura implementa la allowlist AL PIE: golden test (evento cargado con todo
   lo prohibido → sobreviven solo los campos permitidos) + test de supervivencia (fixtures
   PII Booster — RUT, patente, coordenadas, monto CLP/UF, IMEI, email, teléfono, credencial —
   en message/breadcrumbs/body/user/query: NINGUNO sobrevive en el JSON serializado).
2. Doble barrera del message: scrub por patrón + truncado a 300 + tag `scrubbed`.
3. Los 4 puntos cableados al mismo sink: `defaultOnCatch` (router), listeners window,
   `QueryCache`/`MutationCache`, `logger.error`. TODO de `logger.ts` actualizado a ADR-074.
4. Aceptación del frente: crash tipo LatLngBounds (constructor undefined en effect bajo el
   router) → SIN wiring no se captura nada; CON wiring llega por el pipeline REAL del SDK
   (transport fake) un evento con `TypeError` + stack, pasado por `scrubEvent`.
5. Sourcemaps: `hidden` en vite (dejan de servirse públicos — hoy `sourcemap: true` los
   expone), apartados del runtime image, paso de upload en cloudbuild **soft-gated** (sin
   `sentry-auth-token` o sin DSN → skip explícito, deploy idéntico al actual).
6. Suite web + tsc + biome verdes. PR sin merge (PO).

## Notas de implementación fijadas

- `reportError` vive sobre `Sentry.getClient()` (sin client → no-op) — el sink jamás rompe
  la app (ADR-074).
- `defaultIntegrations: false` + `integrations: []` + `beforeBreadcrumb: () => null`:
  los breadcrumbs se apagan EN ORIGEN, no se filtran después.
- `platform: 'javascript'` se emite como CONSTANTE literal en la proyección (requisito de
  enrutamiento/symbolication de Sentry; no proviene del evento — cero datos). Documentado
  como nota de implementación de la allowlist.
- Ciclo de imports: `env.ts → logger.ts → error-reporting.ts → env.ts` es benigno porque
  error-reporting solo accede a `env` dentro de funciones (nunca top-level).

## Fuera de alcance

Crear proyecto Sentry / secrets (PO, ya existe DSN; `sentry-auth-token` pendiente de PO
para activar el upload). Backend (ADR-071 intacto). Session replay / APM browser (prohibidos
por ADR-074).

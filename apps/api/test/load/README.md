# apps/api/test/load/

Load test scaffold para `apps/api`. **Smoke-only en este sprint (S0)**; el suite real al volumen target se construye en S8 del roadmap production-readiness (`.specs/production-readiness/spec.md` SC-18).

## Decisión de tool

[ADR-047 — Load testing tool: k6](../../../../docs/adr/047-load-testing-tool-k6.md).

## Install

Local dev (macOS):

```bash
brew install k6
k6 version  # ≥ 0.50 recomendado por OTEL exporter nativo
```

CI / Linux (post-S8 si se decide correr en pipeline):

```bash
# GitHub Actions: usar grafana/setup-k6-action@v1
# Manual: ver https://grafana.com/docs/k6/latest/set-up/install-k6/
```

## Ejecución

### Smoke contra localhost

```bash
# (1) En otra terminal: levantar el api
pnpm --filter @booster-ai/api dev

# (2) Correr smoke
pnpm --filter @booster-ai/api load-test:smoke
```

Resultado esperado: 1 VU, 1 iteration, 1 request GET `/health`, status 200, exit 0.

### Smoke contra staging

```bash
BASE_URL=https://staging.boosterchile.com pnpm --filter @booster-ai/api load-test:smoke
```

Si el api de staging requiere autenticación en `/health`: ver `apps/api/src/routes/health.ts` — actualmente es endpoint público, no requiere token.

## Estructura del folder

| Archivo | Propósito |
|---|---|
| `smoke.k6.js` | Plomería mínima (T8 de S0). Throwaway pre-S8. |
| `README.md` | Este archivo. |
| _(futuros, S8)_ | `api-50rps-sostenido.k6.js`, `api-200rps-pico.k6.js`, `gateway-1000-tcp.k6.js`, `scenarios/` |

## No-goals (este sprint)

- Medir performance real (eso es S8).
- Integrar con CI gate (decisión pendiente, ver ADR-047 §Consecuencias).
- Cloud distributed runners (decisión post-S8 si single-runner no escala).

## Reversibilidad

Si en S8 se descubre que k6 no escala o no integra bien, ADR-047 documenta la reversibilidad explícita:

1. ADR de supersede con razón concreta.
2. Reemplazo razonable: Locust (Python) o Gatling (JVM).
3. Eliminar `smoke.k6.js` y crear el equivalente en la tool nueva.

Costo estimado de reversión: ~1 hora.

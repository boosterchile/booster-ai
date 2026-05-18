# ADR-047 — Load testing tool: k6

**Fecha**: 2026-05-18
**Estado**: Accepted
**Refs**:
- `.specs/production-readiness/spec.md` SC-18 (load test al volumen target en S8)
- `.specs/s0-housekeeping/spec.md` SC-S0.8
- `apps/api/test/load/smoke.k6.js` (smoke script mínimo introducido en T8 de S0)
- ADR-005 (telemetry IoT — defines target de 1000+ conexiones TCP concurrentes para `apps/telemetry-tcp-gateway`)

## Contexto

El roadmap maestro production-readiness incluye en S8 la ejecución del **load test al volumen target** (SC-18 de la spec maestra): 50 RPS sostenido en `apps/api`, 200 RPS pico, 1000+ conexiones TCP concurrentes en `apps/telemetry-tcp-gateway`, con budgets p95 ≤500ms api / p99 ≤1.5s / 0 connection drops sostenidos.

S8 está a ~12 semanas calendario del momento de S0. Para no llegar a S8 con cero infrastructure de load testing y bloquear el sprint mientras se evalúa la tool, S0 (T8) decide la tool y deja un smoke script funcional que verifica el flujo end-to-end (k6 install + script válido + reporte parseable). El smoke en sí no mide nada relevante; es plomería pre-S8.

Esta decisión es **explícitamente reversible hasta S8** — si durante la planificación de S8 (o el primer dry-run real) se descubre que k6 no escala al volumen target o no integra bien con OTEL, ADR de supersede mueve a otra tool sin penalizar (el smoke script es ~30 LOC, throwaway).

## Decisión

### 1. Tool elegida: **k6** (Grafana k6, OSS)

`apps/api/test/load/` usa k6 como tool de carga. CLI estándar:

```bash
brew install k6                              # macOS dev local
k6 run apps/api/test/load/smoke.k6.js        # ejecución directa
pnpm --filter @booster-ai/api load-test:smoke   # wrapper pnpm
```

### 2. Razones para k6 sobre alternativas

- **OTEL integration nativa**: k6 v0.50+ exporta métricas a OTLP HTTP/gRPC sin plugins; Booster ya usa `@opentelemetry/exporter-trace-otlp-http` en `apps/api`. Significa que las métricas del load test se ven en la misma Cloud Monitoring dashboard que el resto del stack.
- **Scripts en JavaScript**: stack del repo es TypeScript end-to-end. Reutilizable mental model + ESLint/Biome (con config relax) + revisable como cualquier código del repo. Locust requiere Python, Artillery YAML+JS híbrido menos coherente.
- **OSS + cloud opcional**: k6 binario gratis local; Grafana Cloud k6 ofrece runners cloud cuando se necesite escala distribuida (no necesario antes de S8).
- **Modelo `vus` + `iterations`**: simple y portable. Configuración declarativa (`export const options = { vus, duration, thresholds }`) en mismo archivo que el escenario.
- **Thresholds built-in**: `thresholds: { http_req_duration: ['p(95)<500'] }` aborta el run si falla el budget. Alineado con CI gate enforcement futuro.

### 3. Setup mínimo introducido en T8

`apps/api/test/load/`:
- `smoke.k6.js` (~30 LOC) — 1 request a `/health`, asserts status 200, exporta JSON summary.
- `README.md` — instrucciones de install + ejecución local + dónde conectar staging URL.

`apps/api/package.json`:
- Script `load-test:smoke`: `k6 run test/load/smoke.k6.js`.

**El smoke NO mide nada relevante**. Es plomería: verifica que (a) k6 está instalado, (b) el script compila, (c) el script puede correr contra una URL (default `http://localhost:3000`, override con `BASE_URL` env var).

### 4. Reversibilidad explícita

Esta decisión es **reversible hasta S8** sin penalty. Si durante S8 se descubre uno de:

- k6 no escala al volumen target (200 RPS pico, 1000+ TCP concurrentes).
- k6 OTEL exporter incompatible con la versión del collector instalada.
- Pricing de Grafana Cloud k6 prohibitivo si se necesita ejecución distribuida en cloud.

Entonces:
1. ADR de supersede en S8 documenta razón concreta.
2. Reemplazo razonable: Locust (Python, escala fácil con `--workers`) o Gatling (JVM, batería de assertions más rica).
3. `apps/api/test/load/smoke.k6.js` se elimina (throwaway); el reemplazo crea su propio smoke en mismo folder.

El costo de reversión es ~1 hora de Felipe (eliminar 30 LOC + crear equivalente en tool nueva).

## Consecuencias

### Positivas

- **S8 arranca con plomería lista**: no se gasta tiempo evaluando tool en S8; se mide directo.
- **OTEL en mismo dashboard**: telemetría del load test integrada sin glue code adicional.
- **CI-ready (opcional)**: el día que se quiera correr load test en CI (smoke continuo o regression test al merge), `pnpm load-test:smoke` ya existe y k6 binario es instalable en GitHub Actions trivialmente.
- **Coherencia stack**: developers que tocan tests pueden leer/escribir k6 scripts sin context-switch a Python.

### Negativas

- **Dependencia binaria externa** (`brew install k6` en dev local; `apt install k6` u official GitHub Actions setup-k6 en CI). No es `npm install`. Aceptable: similar a `gitleaks`, `terraform`, `gcloud` que también requieren install fuera del workspace.
- **Throwaway smoke**: T8 produce código que se va a reescribir en S8. Decisión consciente; spec acceptance lo requiere y es lo mínimo para validar la decisión de tool.
- **k6 cloud pricing** (si se llega a necesitar Grafana Cloud k6 para escala distribuida): ~USD 50-300/mes según volumen. Decisión futura, no en este ADR.

### No mitigadas (out of scope ADR-047)

- **Distributed load testing en cloud**: no se evalúa acá. Si S8 muestra que un solo runner local no genera suficiente carga, ADR separado evalúa runners distribuidos.
- **Integración con CI**: el smoke NO corre en CI por default en T8. Decisión cuándo activar el smoke en CI (smoke continuo o solo en branches load-test) se difiere.
- **Backend del exporter OTEL** (qué collector recibe las métricas del load test): se decide en S8 cuando exista pipeline OTEL operacional con destination Cloud Monitoring.

## Alternativas consideradas

### A. Artillery — RECHAZADA

Pros: scripts YAML + JS, npm install nativo (sin binario externo), comunidad activa.
Cons: OTEL integration vía plugin third-party (no nativo); YAML+JS híbrido menos coherente que k6 puro JS; thresholds menos expresivos.

### B. Locust — RECHAZADA

Pros: Python idiomático para casos complejos, distribución horizontal built-in (`--workers`), gran adopción en empresas.
Cons: Python no es parte del stack Booster — requiere mental switch + venv management; OTEL via plugin requiere mantención; ejecución más verbose para casos simples (clases vs funciones exportadas).

### C. Gatling — RECHAZADA

Pros: assertions ricas, ecosystem maduro JVM, reportes HTML completos por default.
Cons: Scala DSL (ahora también Java/Kotlin) — mental switch significativo; JVM startup overhead notable para smokes rápidos; OTEL integration menos directa.

### D. wrk / hey — RECHAZADA

Pros: simplicidad extrema (1 binario, 1 comando, sin script).
Cons: no permite escenarios scriptables (login → workflow → logout); sin thresholds programáticos; sin OTEL.

## Validación

- [ ] `k6 inspect apps/api/test/load/smoke.k6.js` retorna 0 (sintaxis válida).
- [ ] `pnpm --filter @booster-ai/api load-test:smoke` con `BASE_URL=http://localhost:3000` y `apps/api` running localmente retorna 0 y exporta summary.
- [ ] `apps/api/test/load/README.md` existe con instrucciones de install + ejecución + override de `BASE_URL` para staging.
- [ ] En S8 (cuando se construya el suite real), este ADR se revisita: si k6 cumple, marcar Validated. Si no, supersede.

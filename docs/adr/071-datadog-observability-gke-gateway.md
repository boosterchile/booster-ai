# ADR-071 — Datadog para observabilidad del gateway TCP en GKE

**Estado**: Accepted
**Fecha**: 2026-07-01
**Decider**: Felipe Vicencio (Product Owner) — Decisión 1 = **C** (2026-07-01)
**Related**: [ADR-001](./001-stack-selection.md) (stack + observabilidad OTel), [ADR-065](./065-automate-gke-gateway-deploy-via-dns-endpoint.md) (deploy gateway GKE), `packages/otel-bootstrap`, `CLAUDE.md` (§Observabilidad obligatoria, §Terraform 100% IaC, §Seguridad por defecto)

> **Resuelto.** El PO eligió la **Decisión 1 = C** (Datadog solo infra + logs; traces se quedan en Cloud Trace vía OTel, sin APM Datadog). Los manifests se ajustaron a esa decisión: `apm.instrumentation.enabled: false`, secret desde Google Secret Manager y CR aplicado por `kubectl` (consistente con ADR-065). Ver §Decisión y §Plan de implementación (ejecutado).

---

## Contexto

El `telemetry-tcp-gateway` corre en GKE Autopilot (`booster-ai-telemetry`, `southamerica-west1`) — es el único workload Booster en GKE; el resto vive en Cloud Run. Recibe conexiones TCP Teltonika (protocolo Codec8) de la flota de tracking.

Se propuso instalar **Datadog** en ese cluster (cambios en working tree, aún sin commitear):

- `infrastructure/k8s/datadog-agent.yaml` — `DatadogAgent` CR (Operator v2alpha1): Infrastructure Monitoring, Log Collection (`containerCollectAll: true`), **APM por Single Step Instrumentation (SSI)** inyectando el tracer `ddtrace` js:5 al gateway vía Admission Controller. Site `us5.datadoghq.com`, `env:production`.
- `infrastructure/k8s/setup-datadog.sh` — instala el Operator con `helm upgrade --install`, crea el secret `datadog-secret` desde `$DD_API_KEY`, aplica el CR y hace `rollout restart` del gateway.
- Labels/annotations Datadog en `telemetry-tcp-gateway.yaml` y `-dr.yaml`, más sección de runbook en `README.md`.

### Estado actual de observabilidad (contrato vigente)

El gateway **ya está instrumentado** según la regla no-negociable de "Observabilidad obligatoria" de `CLAUDE.md`:

- **Traces**: `apps/telemetry-tcp-gateway/src/instrumentation.ts` carga `@booster-ai/otel-bootstrap` vía `node --import` antes de `main`. El SDK OTel exporta **directo a Google Cloud Trace vía ADC** (cero collector, cero API keys) y va envuelto en un **`RedactingSpanExporter`** que **redacta credenciales bearer** antes de exportar — construido a propósito (review 2026-06-11) porque exportar un span del stream podría filtrar una credencial viva a Cloud Trace.
- **Logs**: `@booster-ai/logger` (structured logs).
- **Métricas**: custom OTel → Cloud Monitoring.

Es decir, ya existe un pipeline de observabilidad completo hacia GCP. La propuesta de Datadog **no reemplaza** ese pipeline; se superpone.

### Fricciones con el contrato del repo

1. **Doble instrumentación de APM.** SSI inyecta `ddtrace`, que monkey-patcha las mismas librerías (`http`, etc.) que ya patcha el SDK OTel. Dos capas de auto-instrumentación en el mismo proceso Node producen spans duplicados/rotos y comportamiento no determinista.
2. **Bypass del redactor (seguridad).** `ddtrace` exporta a Datadog **fuera** del `RedactingSpanExporter`. La protección anti-filtración de credenciales que hoy cubre el pipeline OTel→Cloud Trace **no aplica** al pipeline ddtrace→Datadog. Riesgo directo contra §Seguridad por defecto.
3. **Rompe "Terraform 100% IaC".** Datadog no está en Terraform; el Operator se instala imperativamente por `helm` y el CR por `kubectl apply`. Drift fuera del state.
4. **Secreto fuera de Google Secret Manager.** El script crea `datadog-secret` desde `$DD_API_KEY` del entorno, no desde GSM. §Seguridad manda GSM como source-of-truth de secretos.
5. **Costo en Autopilot.** `containerCollectAll: true` + APM en Autopilot factura por recursos de cada pod del Agent; con el volumen Teltonika conviene dimensionarlo antes de prod.

## Decisión

> Se decidió en tres frentes. La Decisión 1 era la crítica.

### Decisión 1 — Modelo de tracing → **C (elegida por el PO, 2026-07-01)**

**A. Datadog para Infra + Logs; traces siguen por OTel, y si se quieren en Datadog, vía OTLP (no SSI).**
Se deshabilita `apm.instrumentation` (SSI). El gateway mantiene una sola capa de instrumentación (OTel). Si se quieren los traces también en Datadog, se apunta el exportador OTLP de OTel al intake del Datadog Agent (dual-export desde el mismo SDK) — así los spans siguen pasando por el `RedactingSpanExporter`.

**B. APM nativo Datadog (ddtrace) y se retira OTel del gateway.**
Coherencia total con el ecosistema Datadog, pero se pierde Cloud Trace y **se pierde la redacción de credenciales** salvo reimplementarla en ddtrace. Alto costo de seguridad y de reescritura. **No recomendada.**

**✅ C. Datadog solo Infra + Logs; traces se quedan en Cloud Trace, sin Datadog APM. — ELEGIDA.**
Mínimo riesgo y esfuerzo: se deshabilita SSI y no se integra OTLP. El gateway conserva una sola capa de instrumentación (OTel → `RedactingSpanExporter` → Cloud Trace). Es el subconjunto seguro de A; el PO no necesita correlación trace-en-Datadog por ahora.

En C se pone **`apm.instrumentation.enabled: false`** en el CR; las annotations/labels del deployment quedan solo para Log Collection y tags (no hay annotation de APM). B exigiría un ADR de seguridad aparte para la redacción; no se toma.

### Decisión 2 — IaC → **manifests versionados + `kubectl` (consistente con ADR-065)**

> Corrección respecto al borrador inicial: el repo **no tiene** provider TF de Helm/Kubernetes, y sus workloads GKE (incluido el propio `telemetry-tcp-gateway`) se aplican con `kubectl`/Cloud Build, **no** por Terraform (ADR-065). Introducir un provider TF k8s solo para Datadog sería inconsistente y agregaría superficie de auth contra el cluster privado.

El `DatadogAgent` CR se mantiene como **manifest versionado** (`infrastructure/k8s/datadog-agent.yaml`) aplicado con `kubectl apply`, igual que el gateway. El Datadog Operator se instala con `helm upgrade --install` como **paso de bootstrap** documentado (`setup-datadog.sh` + README), análogo a `get-credentials`. Lo único que vive en Terraform es el **contenedor del secret** en Secret Manager (genuine GCP infra, ver Decisión 3). No se modifica §Estructura de `CLAUDE.md`: el patrón "cluster en TF, workloads por kubectl" ya es la norma vigente.

### Decisión 3 — Secreto → **GSM source-of-truth, materializado en bootstrap**

El contenedor del secret `datadog-api-key` se declara en Terraform (`security.tf`, `local.secret_names`) con placeholder; el owner puebla la versión real. El Secret k8s `datadog-secret` se materializa en el bootstrap leyendo desde GSM (`gcloud secrets versions access latest --secret=datadog-api-key`), **no** desde una env var arbitraria del operador. External Secrets Operator queda **diferido** (mismo estado que el secret del gateway, `telemetry-gateway-secrets`), a adoptar cuando se resuelva ESO para todo el cluster. `datadog-api-key` **no se monta en ningún Cloud Run** → no interactúa con el preflight de placeholders validados (INC-2026-06-19) ni con ninguna regex de `config.ts`.

## Alternativas consideradas (a la elección de herramienta)

- **Quedarse solo con OTel → Cloud Trace / Cloud Monitoring / Cloud Logging** (statu quo, sin Datadog): cero costo/dependencia nueva, pero sin la UX unificada de Datadog para infra+logs+APM que motiva la propuesta.
- **Google Cloud Managed Service for Prometheus + Cloud Ops**: nativo GCP, sin salir del stack; menor riqueza de APM que Datadog.
- **Grafana/Tempo self-hosted**: más control, más operación. Descartado por costo operativo.

## Consecuencias

**Positivas**
- Observabilidad unificada (infra + logs + opcionalmente traces) para el único workload GKE, sin romper la instrumentación OTel existente ni la redacción de credenciales (en A/C).
- Datadog gestionado por Terraform: sin drift, reproducible en DR.

**Negativas / costos**
- Nueva dependencia SaaS de pago (Datadog) y su costo en Autopilot — a dimensionar (Decisión de costo, punto 5 del contexto).
- Complejidad extra en el módulo TF del cluster (Helm provider + CRs).
- Latencia de envío a `us5` (Datadog no tiene región en Sudamérica) — aceptable para logs/infra; a validar si se hace dual-export de traces.

**Neutras / seguimiento**
- Si en el futuro se quiere trace-en-Datadog, la vía es A (dual-export OTLP desde el mismo SDK, manteniendo el `RedactingSpanExporter` en el path) — no ddtrace/SSI. Requeriría un nuevo ADR o amendment.
- Dimensionar el costo de Datadog en Autopilot a las 24h post-bootstrap (log volume Teltonika).
- No se modifica `CLAUDE.md`: el patrón "cluster en TF, workloads por kubectl" (ADR-065) ya cubre este caso.

## Plan de implementación (ejecutado — Decisión C)

1. ✅ `datadog-agent.yaml`: `apm.instrumentation.enabled: false`; se conservan `logCollection` + `orchestratorExplorer` + `clusterChecks` + tags.
2. ✅ Contenedor del secret `datadog-api-key` en `security.tf` (`local.secret_names`, placeholder + version); el owner puebla el valor real.
3. ✅ `setup-datadog.sh` reescrito como runbook: lee la key desde GSM (no del entorno), instala el Operator por Helm, materializa el Secret k8s y aplica el CR; **sin** `rollout restart` (no hay tracer que inyectar).
4. ✅ `README.md` (§Datadog) actualizado al alcance C (infra + logs; traces en Cloud Trace; secret desde GSM; ESO diferido).
5. ✅ Labels/annotations de log en `telemetry-tcp-gateway.yaml` y `-dr.yaml` (solo Log Collection + tags; sin annotation de APM).

**Acciones del owner (cloud-ops, fuera del PR):**
- `terraform apply` para crear el contenedor `datadog-api-key` en Secret Manager.
- Poblar la versión real: `echo -n "<dd-api-key>" | gcloud secrets versions add datadog-api-key --data-file=-`.
- Correr `infrastructure/k8s/setup-datadog.sh` contra el cluster.
- Verificar infra + logs en Datadog; revisar costo a 24h.

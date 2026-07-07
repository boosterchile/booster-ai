# Informe técnico — Hito 2, mes 8

**Proyecto CORFO 25IR-305522** (SmartAICargo = Booster AI) · **Beneficiario**: Felipe Vicencio (`dev@boosterchile.com`)
**Fecha de redacción**: 2026-07-06 · **Rama**: `chore/hito-2-cierre` · **Repositorio**: `boosterchile/booster-ai`
**Fuentes primarias**: [`.specs/hito-2-corfo-mes-8/plan.md`](../../../.specs/hito-2-corfo-mes-8/plan.md), [`.specs/hito-2-corfo-mes-8/decisiones.md`](../../../.specs/hito-2-corfo-mes-8/decisiones.md), [`docs/corfo/hito-2/evidencia/meta-1-crud-auth.md`](evidencia/meta-1-crud-auth.md), [`docs/corfo/hito-2/runbook-activacion-onboarding.md`](runbook-activacion-onboarding.md), `docs/handoff/CURRENT.md`

> Cada afirmación de este informe cita su respaldo verificable (`archivo:línea`, PR, ADR, query SQL o corrida de test). Donde la evidencia es parcial o el trabajo está en curso, se declara explícitamente — no se completan huecos por inferencia.

---

## 1. Resumen ejecutivo

Booster AI opera bajo un concepto rector único: **"impacta menos, transporta más"**. Todo el desarrollo del hito 2 — desde la reapertura segura de altas de usuario hasta el anclaje de la medición de huella de carbono al inicio real del viaje — se subordina a ese principio: reducir el impacto ambiental de la industria del transporte de carga terrestre monetizando la capacidad ociosa (empty-legs), mientras se transporta un volumen mayor de carga con la misma flota.

El proyecto CORFO 25IR-305522 fue presentado bajo el nombre **SmartAICargo**; el producto en desarrollo y en producción se llama **Booster AI**. Esta es la desviación #1 declarada en la §4 de este informe — no hay ambigüedad de fondo, es un cambio de marca comercial sobre el mismo desarrollo técnico, pendiente de formalización administrativa con el ejecutivo CORFO.

### Tabla de equivalencia SmartAICargo ↔ Booster AI

| Componente SmartAICargo | Equivalente en Booster AI | Evidencia |
|---|---|---|
| **MCIC-IA** | Motor de matching + pricing: `packages/matching-algorithm` (algoritmo de asignación empty-leg, greedy capacity-scoring, ADR-023) y `packages/pricing-engine` (comisión + billing, ADR-030/031) | `packages/matching-algorithm` — 108 tests / 5 archivos (corrida fresca `vitest run`, 2026-07-06); `packages/pricing-engine` — 55 tests / 3 archivos (misma corrida) |
| **MVST-IoT/BC** | Telemetría dual-source (Teltonika = dato primario / Google Maps = dato secundario modelado, ADR-028) + trazabilidad documental de DTE de terceros con retention lock (ADR-070) | `packages/codec8-parser` (parseo AVL Teltonika); `apps/api/src/services/routes-api.ts:152` (`extraComputations = ['FUEL_CONSUMPTION']`, fallback sin dispositivo, ya vivo en `main`); repositorio documental `apps/api/src/routes/transport-documents.ts` (ADR-070) |
| **MSC-ESG** | `packages/carbon-calculator` (GLEC v3.0, ADR-021/022) con huella de carbono por viaje anclada al **inicio real del conductor** (recogida → entrega, "estilo Uber") | `packages/carbon-calculator` — 69 tests / 9 archivos (corrida fresca, 2026-07-06). **El anclaje al inicio del conductor está en diseño, no implementado**: diseño de tipologías de flota + clase GLEC por configuración aprobado en ADR-073 ("Accepted", 2026-07-06) — **ADR-073 vive únicamente en la rama del PR #568 (`feat/tipologias-flota-y-huella-inicio-viaje`), abierto y sin mergear; no existe en `main` ni en esta rama de cierre**, que solo llega hasta ADR-072. El anclaje del cálculo al segmento real (recogida→entrega) tiene spec+plan aprobados por el PO en [`.specs/medicion-huella-segmento/spec.md`](../../../.specs/medicion-huella-segmento/spec.md) y [`plan.md`](../../../.specs/medicion-huella-segmento/plan.md) (13 tareas, ninguna iniciada — sin commits que las referencien). **Implementación proyectada para el mes 9** (ver §6) |
| **MGCR** | Chat en tiempo real (`GET/POST /chat`, Server-Sent Events) + scoring de conducción post-viaje | `apps/api/src/routes/chat.ts` (SSE, `text/event-stream`); `packages/driver-scoring` — 24 tests / 1 archivo (corrida fresca, 2026-07-06) |

**Nota metodológica**: las siglas MCIC-IA/MVST-IoT-BC/MSC-ESG/MGCR provienen de la carta CORFO original (fuera de este repositorio, Google Doc de la propuesta); este informe no reconstruye su significado completo por no tener esa fuente versionada — solo mapea cada componente a su implementación técnica verificable en `boosterchile/booster-ai`.

---

## 2. Cumplimiento por meta, con matriz de evidencia

La matriz completa y detallada (endpoint por endpoint, con `file:línea` y conteo de tests por corrida fresca de Vitest) vive en [`docs/corfo/hito-2/evidencia/meta-1-crud-auth.md`](evidencia/meta-1-crud-auth.md). Se resume aquí solo lo cuantificable y su estado real.

### Meta 1 — Plataforma con CRUD + auth operativos

| Capacidad | Estado | Evidencia |
|---|---|---|
| Gestión de Cargas | Operativo en `main` | 79 tests / 5 archivos (`trip-requests-v2.ts`, `offers.ts`) |
| Gestión de Envíos/Viajes | Operativo en `main` | 91 tests / 7 archivos (`assignments.ts` + `packages/trip-state-machine`) |
| Gestión de Usuarios (alta operativa) | Código operativo en `main`; **activación en prod gateada por runbook** | 121 tests / 10 archivos (86 api + 35 web) — PR [#565](https://github.com/boosterchile/booster-ai/pull/565), **estado real verificado vía `gh pr view 565 --json state,mergedAt`: `MERGED`, `mergedAt: 2026-07-07T00:36:41Z`**, commit `62453ae` |
| Auth / Roles | Operativo en `main` | 50 tests / 6 archivos (Firebase ID token, RBAC 6 roles, ADR-028/035) |
| Vehículos/Flota (bonus) | CRUD base operativo en `main` | 26 tests unit + 4 integration |

**Reapertura segura de altas de usuario (W1)**: la cadena `POST /solicitar-acceso` (público, anti-enumeración, 202 siempre) → aprobación admin → token HMAC-SHA256 one-shot con TTL 72h → `/onboarding-admin?token=` → alta de empresa + rol `dueno` está en `main` (PR #565, mergeado). El flujo llega en el mismo PR a un estado deliberado de **"mergeable + inerte"**: todo el código vive detrás de dos flags en `false` (`ADMIN_PROVISIONED_ONBOARDING_ENABLED`, `SIGNUP_REQUEST_FLOW_ACTIVATED`), documentado en [`docs/corfo/hito-2/runbook-activacion-onboarding.md`](runbook-activacion-onboarding.md).

Las 4 condiciones bloqueantes de activación (reaper T1.7 agendado en Cloud Scheduler, secreto `ONBOARDING_TOKEN_SIGNING_SECRET` rotado a valor real, TTL 72h ratificado, sign-off del modelo bearer-token) quedaron **cumplidas con acta firmada por el PO el 2026-07-06** (runbook, Paso 4: *"Firma: Felipe Vicencio, PO"*).

**Estado real de activación en producción al momento de escribir este informe**: los pasos 5 a 8 del runbook (flip de ambos flags vía Terraform, deploy con gate humano en el Environment `production`, primer tick manual del reaper, checklist E2E de aceptación contra prod, monitoreo de 2 horas post-deploy) son responsabilidad exclusiva del PO, con credenciales `gcloud`/`gh` reales, y estaban programados para ejecutarse la noche del 2026-07-06. Este informe se redacta antes de esa ejecución y no puede verificar su resultado.

**[ACTUALIZAR AL CIERRE: estado activación]**

**Trace E2E en producción**: [TRACE E2E PROD — pendiente de la activación de esta noche]

### Meta 2 (redefinida por el PO) — IMEI self-service + 2 sensores + fallback sin dispositivo

| Entrega | Estado real (verificado vía `gh pr view <n> --json state,mergedAt`) |
|---|---|
| IMEI Teltonika configurable por la empresa en su propia UI | PR [#566](https://github.com/boosterchile/booster-ai/pull/566) — **`OPEN`, no mergeado**. `PATCH /vehiculos/:id/dispositivo` (Zod `^\d{15}$`, RBAC tenant-scoped, manejo de estados `rechazado`/`reemplazado` según decisiones D2/D3) implementado en la rama `feat/vehiculo-imei-self-service`, no integrado a `main` |
| 2 sensores (ubicación + temperatura) visibles por envío | PR [#567](https://github.com/boosterchile/booster-ai/pull/567) — **`OPEN`, no mergeado**. Simulador de temperatura Dallas (perfil frío 2–8 °C), IO genérico ya soportado por `codec8-parser` |
| Fallback Google Maps para flota sin dispositivo Teltonika | **Ya vivo en `main`** (no depende de PR abierto): `apps/api/src/services/routes-api.ts:152` setea `extraComputations = ['FUEL_CONSUMPTION']` cuando hay `vehicleInfo` disponible; modelo dual-source formalizado en ADR-028 (Accepted, 2026-05-10) |
| **1 dispositivo real activo del piloto** | Verificado con query de solo lectura contra Cloud SQL prod, `scripts/db/agent-query.sh` (2026-07-06) — ver detalle abajo |

**Evidencia del dispositivo real del piloto** (query ejecutada el 2026-07-06 contra la base de datos de producción, resultado sin exponer PII — patente truncada a 2 caracteres, IMEI truncado a 6 dígitos):

```sql
SELECT v.id AS vehiculo_id,
       LEFT(v.patente, 2) || '***' AS patente_parcial,
       LEFT(v.teltonika_imei, 6) || '*********' AS imei_parcial,
       COUNT(*) AS puntos_30d,
       MIN(t.timestamp_device) AS desde,
       MAX(t.timestamp_device) AS hasta
FROM telemetria_puntos t
JOIN vehiculos v ON v.id = t.vehiculo_id
WHERE v.teltonika_imei IS NOT NULL
  AND t.timestamp_device >= now() - interval '30 days'
GROUP BY v.id, v.patente, v.teltonika_imei
ORDER BY puntos_30d DESC
LIMIT 5;
```

| vehiculo_id | patente_parcial | imei_parcial | puntos_30d | desde | hasta |
|---|---|---|---|---|---|
| `6487dac2-…` | `VF***` | `863238*********` | **105.856** | 2026-06-07 02:38:51 UTC | 2026-07-07 01:53:39 UTC |

Una segunda query confirma que este es el **único** vehículo de la flota con `teltonika_imei` no nulo (`SELECT COUNT(*) FROM vehiculos WHERE teltonika_imei IS NOT NULL` → `1`). No hay inflación de la cifra: hay exactamente un dispositivo Teltonika registrado en la flota, y es el mismo que transmite activamente hace 30 días continuos.

**Nota de honestidad sobre M2**: las tres piezas de código (IMEI self-service, sensor de temperatura, tipologías de flota — ver §4) están desarrolladas y con tests, pero viven en tres PRs abiertos (#566, #567, #568) que **no están mergeados a `main`** al momento de escribir este informe. Solo el fallback Maps y la evidencia del dispositivo real cuentan como "en producción" hoy.

**M3 y M4** (ciclo formal de usuarios y entrevistas) se declaran exclusivamente en §4, sin evidencia fabricada.

---

## 3. Resultados parciales de la carta de compromiso

Este repositorio no contiene una copia versionada de la carta de compromiso original del proyecto 25IR-305522 (ni en `docs/corfo/` ni en `.specs/`) — solo la transcripción del plan de ejecución del hito 2 ([`.specs/hito-2-corfo-mes-8/plan.md`](../../../.specs/hito-2-corfo-mes-8/plan.md), a su vez transcrita de un Google Doc externo el 2026-07-06). Por tanto, **este informe no reproduce cifras de compromiso** (montos, hitos de facturación, metas numéricas de la carta) que no puede verificar contra una fuente citable dentro del repositorio.

Los resultados parciales verificables **desde el código vivo** son los reportados en §2: plataforma con CRUD + auth operativa en producción (Meta 1), redefinición de Meta 2 aprobada por el PO con evidencia de 1 dispositivo piloto activo, y el diseño (no implementación) del anclaje de huella al inicio del viaje. Cualquier cifra de avance porcentual contra la carta de compromiso debe obtenerse directamente del documento original, fuera del alcance verificable de este repositorio.

---

## 4. Desviaciones

Tabla de desviaciones tal como fue acordada en el plan de ejecución (`.specs/hito-2-corfo-mes-8/plan.md`, §4), verbatim:

| # | Desviación | Plan correctivo |
|:-:|---|---|
| 1 | Marca SmartAICargo → Booster AI | Tabla de equivalencia; consultar formalización con ejecutivo CORFO |
| 2 | Reescritura greenfield del prototipo localStorage | Ejecutada; positiva (producción GCP). Explicar meses 1–4 |
| 3 | M3: ciclo formal ≥5 usuarios no ejecutado | Evidencia real: 1 piloto con dispositivo activo. Ciclo formal mes 9 (desbloqueado por W1) |
| 4 | M4: 3 entrevistas pendientes; modelo disperso en ADRs | Entrevistas + documento consolidado mes 9 |
| 5 | Blockchain simulado → trazabilidad DTE/SII + Retention Lock | ADR antes del mes 10: Hyperledger o modificación formal |
| 6 | Apps nativas → PWA multi-rol (ADR-008) | TWA/Capacitor antes del mes 18, o modificación de indicador |
| 7 | Gemini directa → Vertex AI ADC (ADR-037) | Solo declarar |
| 8 | Link de onboarding manual (email = Fase 2) | Swap del notifier de email mes 9 |

### Detalle de M3 y M4 (sin eufemismos)

**M3 — Ciclo formal de validación con ≥5 usuarios: NO ejecutado.** No hay evidencia de un ciclo formal con 5 o más usuarios finales. La única evidencia real y verificable es **1 piloto con 1 dispositivo Teltonika activo**, respaldada por la query de §2 contra `telemetria_puntos` (105.856 puntos en 30 días continuos). El plan de corrección: el ciclo formal queda desbloqueado recién ahora que W1 (alta de usuarios operativa) cierra el candado que impedía onboardear usuarios reales a escala — se ejecuta en el mes 9, no en este hito. No se fabrican usuarios ni pruebas para simular cumplimiento.

**M4 — 3 entrevistas + modelo de negocio consolidado: pendiente.** No hay evidencia en este repositorio de que las 3 entrevistas se hayan realizado. El modelo de negocio existe, pero **disperso** en varios ADRs (026, 027, 030, 031) y un playbook (001) — ver §5 — no en un documento único consolidado. Plan correctivo: entrevistas + documento consolidado en el mes 9.

### Desviación 2 — contexto (greenfield)

ADR-001 documenta que Booster AI es una reescritura greenfield de "Booster 2.0" (stack Express + Prisma + npm workspaces + Python FastAPI híbrido), motivada por deuda técnica acumulada (346 usos de `any`, 395 `console.*`, ~15% de cobertura de tests) y por el requisito de TRL 10 del cierre CORFO (auditoría de seguridad profesional, 80%+ coverage, observabilidad APM, WCAG 2.1 AA, plan DR probado). Los meses 1–4 del proyecto se explican por esta reescritura completa, no por un simple ajuste incremental.

---

## 5. Modelo de negocios

El modelo de negocio de Booster AI está documentado en decisiones arquitectónicas y de producto separadas — consistente con la desviación #4 (M4: "disperso en ADRs"), que este informe no resuelve unificando artefactos nuevos (fuera de alcance de este hito), solo referencia lo existente:

- **[Playbook 001 — Posicionamiento competitivo Chile + LATAM](../../../playbooks/001-posicionamiento-competitivo.md)** (Accepted, 2026-05-05): posicionamiento de una frase ("la única plataforma de logística terrestre B2B en LATAM que cierra el viaje y entrega el certificado IFRS S2"), tres pilares de mensaje, cinco segmentos objetivo priorizados (S.A. abiertas CMF retail/CPG primero), anti-posicionamiento explícito y roadmap competitivo a 24 meses.
- **[ADR-026 — Modelo de membresías del transportista y revenue diversificado](../../../docs/adr/026-carrier-membership-tiers-and-revenue-model.md)** (Accepted, 2026-05-05): modelo asimétrico — el generador de carga (shipper) opera "estilo Uber" (sin tier, comisión transaccional al cierre); el transportista (carrier) tiene tiers de membresía escalonados con fee mensual recurrente y beneficios (device Teltonika subsidiado en el tier premium, prioridad de matching, trust score).
- **[ADR-027 — Modelo de pricing v1](../../../docs/adr/027-pricing-model-uniform-shipper-set-with-tier-commission-roadmap.md)** (Accepted, 2026-05-10): formaliza el modelo "uniform shipper-set" sin comisión ni billing activados, principio rector "prefer no cobrar nada bien a cobrar mal rápido".
- **[ADR-030 — Pricing v2: activación de comisión + billing recurrente](../../../docs/adr/030-pricing-v2-activation-commission-and-billing.md)** (Accepted, supersede ADR-027): decide arquitectónicamente la activación de comisión, implementa la foundation técnica (`packages/pricing-engine`, tablas Drizzle, servicio de liquidación) detrás del flag `PRICING_V2_ACTIVATED` (default `false`) — diferido hasta cumplir criterios de mercado (≥30 carriers activos, ≥3 meses sin incidentes, T&Cs firmadas ≥80%, sandbox del proveedor DTE validado).
- **[ADR-031 — Pricing v2: escala mínima de activación](../../../docs/adr/031-pricing-v2-activacion-escala-minima.md)**: condiciones cuantitativas adicionales de activación.

No existe, dentro de este repositorio, un documento único que consolide estos ADRs en un modelo de negocio narrativo integral — esa consolidación es precisamente el compromiso de la desviación #4 para el mes 9.

---

## 6. Plan mes 9–24

### Medición de huella sobre el segmento real (`medicion-huella-segmento`)

Spec y plan aprobados por el PO ([`.specs/medicion-huella-segmento/spec.md`](../../../.specs/medicion-huella-segmento/spec.md), diseño aprobado 2026-06-24; [`plan.md`](../../../.specs/medicion-huella-segmento/plan.md)). El plan define **13 tareas** (Task 1 a Task 13, todas con TDD explícito en el dominio crítico — migraciones, GLEC, máquina de estados), **ninguna iniciada**: no hay commits en el historial que referencien los archivos nuevos del plan (`confirmar-recogida-viaje.ts`, `geofence-origen.ts`, `resolver-opt-in-huella.ts`, `geocodificar-origen.ts`, `posicion-segmento.ts`). Resumen de las 13:

1–2. Migraciones: flag opt-in de huella (`empresas.carbon_measurement_enabled`, `trips.carbon_measurement_override`) + origen geocodificado (`trips.origin_latitude/longitude`).
3. Resolver de opt-in efectivo (override de viaje ?? OR generador/transportista).
4. Geocodificar y persistir el origen al crear el viaje (Routes API, degradable).
5. Guard `esConfirmableRecogida` en `packages/trip-state-machine`.
6. Servicio `confirmar-recogida-viaje.ts` (handler de recogida, CAS atómico idempotente, espejo de `confirmar-entrega-viaje.ts`).
7. Endpoint `PATCH /carrier/assignments/:id/confirmar-recogida`.
8. Detector de geofence + radio configurable (`GEOFENCE_RADIUS_M`, default 150 m).
9. Disparo híbrido en la PWA del conductor (geofence sugiere + tap confirma).
10. Enrutamiento de fuente de posición por tipo de vehículo (Teltonika o browser, sin merge de streams).
11. Distancia real sobre el segmento `[pickedUpAt, deliveredAt]` (retorno de `kmCubiertos`, hoy descartado por `calcular-cobertura-telemetria.ts:88`).
12. Cómputo de huella real + umbral binario de cobertura (~80%, vía `derivarNivelCertificacion`).
13. Degradación explícita por peso ausente (nunca `0`).

### W4b/W4c pendientes de este hito

- **W4b** (registro de flota en UI — alta/edición de unidades de arrastre y carrocerías en `vehiculos.tsx`/`flota.tsx`): pendiente, depende de que el PR #568 (W4a, tipologías de flota) se mergee primero.
- **W4c** (acción "Iniciar viaje" del conductor como ancla de la medición de huella): **no implementada** — verificado que `apps/web/src/routes/conductor.tsx` no contiene ningún trigger de transición `asignado→en_proceso` ni llamado a `confirmar-recogida`. Es exactamente el gap que cierra la tarea 6/7 del plan `medicion-huella-segmento` arriba.

### Fase 2 — notificación por email real

Hoy el enlace de onboarding se entrega manualmente (copia/pega del admin) — `apps/api/src/services/notifications/signup-request-email.ts:66` implementa `LoggingSignupRequestNotifier`, que solo loguea, detrás de la interfaz `SignupRequestNotifier`. Fase 2 (mes 9) implementa un notifier real (SMTP/proveedor transaccional) sobre la misma interfaz, sin tocar el resto del flujo.

### Bitrén 0..N arrastres

El modelo de tipologías de flota aprobado (D1/D4, ADR-073 en PR #568) soporta **0..1 unidad de arrastre** por asignación como deuda explícita — Chile permite bitrenes (1 tracto + 2 semirremolques) con permiso especial (D.S. 158 MTT). Follow-up trackeado: [`.specs/_followups/flota-bitren-0-n-arrastres.md`](../../../.specs/_followups/flota-bitren-0-n-arrastres.md) (tabla puente `viaje_unidades_arrastre`, `UNIQUE(viaje_id, posicion)`, guard `N≤2` tras flag `BITREN_ENABLED`).

### Reconciliación de Terraform pendiente

El runbook de activación (Paso 2) advierte explícitamente: *"el plan trae drift conocido de PRs previos sin aplicar (ej. #520/#530/#535/#554 redis-auth)"* — cualquier `terraform apply` debe distinguir el cambio propio del drift acumulado antes de aplicar. Esta reconciliación de drift queda pendiente como tarea de infraestructura separada, no resuelta por este hito.

### Retiro del subsistema demo

`DEMO_MODE_ACTIVATED` (`apps/api/src/config.ts:495`, default `false`) y el flujo asociado (`docs/qa/demo-accounts.md`) siguen activos en el repositorio. El retiro completo del subsistema demo es una decisión de producto declarada por el PO pero **sin spec ni ADR que la trackee todavía** dentro de este repositorio — se declara aquí como intención pendiente de formalizar, no como trabajo en curso.

### Follow-up stubs creados hoy (2026-07-06)

Siete stubs nuevos en `.specs/_followups/`, todos mergeados a `main` junto con el PR #565:

- **`flota-bitren-0-n-arrastres.md`** — deuda 0..1 arrastre vs bitrenes 0..N (D1.1), plan de pago con tabla puente.
- **`login-link-url-https.md`** — `loginLinkUrl` acepta `http://` de forma inconsistente con `onboardingLinkBaseUrl` (exige `https://`); hallazgo de bajo riesgo del fix round final de W1.
- **`login-retiro-boton-crea-una-legacy.md`** — el botón legacy "Crea una" en `login.tsx` sigue disparando el self-signup Firebase muerto (`EMPRESA_SELF_ONBOARDING_ENABLED=false` permanente, SC3); confunde con el flujo correcto "Solicita acceso".
- **`login-universal-redirect-param.md`** — `LoginUniversal` (RUT+clave, flag `AUTH_UNIVERSAL_V1_ACTIVATED` hoy OFF) no honra `?redirect=`; gate antes de activar ese flujo.
- **`router-mocks-audit-critical-flows.md`** — lección sistémica del hallazgo B1: los tests de `login.tsx` mockeaban `@tanstack/react-router` completo y ocultaron un no-op silencioso de navegación; auditar el mismo patrón en otros flujos críticos.
- **`runbook-tuteo.md`** — el runbook de activación usa voseo ("Sos el PO") en vez del tuteo chileno que exige `docs/copy-guide.md`; requiere firma del PO por no ser un cambio mecánico.
- **`solicitar-acceso-cleanup.md`** — `SubmitState = 'error'` es dead code en `solicitar-acceso.tsx` (el manejo real de errores pasa por `errorMessage`, no por `state`).

Existen además tres stubs adicionales creados el mismo día, **pero viven únicamente en ramas de PR abiertas sin mergear** (no están en `main` ni en esta rama de cierre): `retiro-derivacion-unit-type-create.md` (rama del PR #568), `imei-reconciliacion-integration-test-postgres.md` y `vehiculos-router-otel-spans.md` (ambos en la rama del PR #566).

---

## 7. Extra cuantificado — lo construido más allá del compromiso

- **4 PRs de este hito**: [#565](https://github.com/boosterchile/booster-ai/pull/565) `MERGED` (2026-07-07T00:36:41Z, commit `62453ae`, alta de usuarios operativa E2E); [#566](https://github.com/boosterchile/booster-ai/pull/566), [#567](https://github.com/boosterchile/booster-ai/pull/567), [#568](https://github.com/boosterchile/booster-ai/pull/568) — los tres **`OPEN`, sin mergear** al momento de escribir (verificado vía `gh pr view <n> --json state,mergedAt` el 2026-07-06).
- **Tests verdes por package/app** (corridas frescas Vitest, node 24, 2026-07-06 — subconjunto más relevante al hito, no el total del monorepo):

  | Package/app | Tests | Archivos |
  |---|---|---|
  | `apps/api` | 1.657 (2 skipped) | 139 |
  | `apps/web` | 1.096 | 115 |
  | `packages/trip-state-machine` | 34 | 2 |
  | `packages/carbon-calculator` | 69 | 9 |
  | `packages/matching-algorithm` | 108 | 5 |
  | `packages/pricing-engine` | 55 | 3 |
  | `packages/driver-scoring` | 24 | 1 |
  | `packages/shared-schemas` | 252 | 11 |
  | **Suma de este subconjunto** | **3.295** | **285** |

  Quedan fuera de esta suma otros packages/apps del monorepo (`document-service`, `whatsapp-bot`, `certificate-generator`, `codec8-parser`, `factoring-engine`, `carta-porte-generator`, etc.) — no se declara un total del monorepo por no haberlos corrido en esta sesión.

- **Migración 0048** (tipologías de flota — enums `categoria_unidad`/`tipo_unidad`/`tipo_carroceria`, FK `asignaciones.unidad_arrastre_id`): existe únicamente en la rama del PR #568 (`apps/api/drizzle/0048_tipologias_flota.sql`), **no está en `main` ni en esta rama de cierre**.
- **ADR-072** ("Disciplina inline: plugins como conocimiento opcional", Accepted 2026-07-06) — mergeado y presente en esta rama (reescribe el `CLAUDE.md` del repo). **ADR-073** ("Tipologías de flota y clase GLEC derivada de la configuración", Accepted 2026-07-06) — **existe solo en la rama del PR #568, sin mergear**; no es parte de `main` todavía.
- **17 deny rules de gobernanza sobre el agente**: declaradas en `.specs/hito-2-corfo-mes-8/decisiones.md` §D5(b) — *"deny rules duras aplicadas a `.claude/settings.local.json` (17 reglas: terraform apply, gcloud run update/deploy/update-traffic, secrets add/create, scheduler run/resume, gh pr merge, push a main/force, gh api mutante, agent-query -y)"*. **Nota importante**: esta sección D5 vive únicamente en la versión de `decisiones.md` de la rama `feat/vehiculo-imei-self-service` (PR #566, abierto sin mergear); la versión de `decisiones.md` de esta rama de cierre llega solo hasta D4. `.claude/settings.local.json` no está versionado en git (es configuración local por máquina/sesión) — no se pudo inspeccionar su contenido directamente desde este árbol de trabajo; se cita el texto declarado en el spec.
- **Hardening SEC-001** (verificado con `git log`, no todo mergeado todavía):
  - **Denylist de `ROTATE_ME_*`**: `assertStrongSecret` en `apps/api/src/services/onboarding-token.ts` rechaza cualquier secreto que empiece con ese prefijo — **mergeado en `main`** vía PR #565.
  - **CAS anti-TOCTOU en reconciliación de IMEI**: commit `003137e` "fix(api): CAS en reconciliación de IMEI evita TOCTOU con rechazo" — vive en la rama del PR #566, **sin mergear**.
  - **Primer test explícitamente nombrado IDOR**: `apps/api/test/unit/vehiculos.test.ts:609` — *"IDOR cross-tenant: vehículo no pertenece a la empresa activa → 404 (NO 403)"* — también en la rama del PR #566, **sin mergear**.
  - **Primera métrica de negocio como counter** (`apps/api/src/observability/business-metrics.ts`, `getBusinessCounter`, distinto de los spans de `business-span.ts` que ya existían): archivo nuevo, creado en el commit `003137e` de la rama del PR #566, **sin mergear**.
- **Runbook de activación de onboarding con acta firmada**: [`docs/corfo/hito-2/runbook-activacion-onboarding.md`](runbook-activacion-onboarding.md), 8 pasos, acta de ratificación de TTL + sign-off del modelo bearer-token firmados por el PO el 2026-07-06 — **mergeado, presente en esta rama**.
- **1 dispositivo Teltonika real activo** en el piloto, con 105.856 puntos de telemetría en los últimos 30 días continuos (query directa contra Cloud SQL prod, ver §2) — es, además, el único vehículo de la flota con `teltonika_imei` no nulo.

---

*Informe generado en la rama `chore/hito-2-cierre`, para acompañar el cierre del hito 2 (mes 8) del proyecto CORFO 25IR-305522. Referencias completas de código y tests en las fuentes primarias citadas en el encabezado.*

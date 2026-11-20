# Spec: trl10 — definición de término de TRL 10

- Autor: Felipe Vicencio (PO), redactado con Claude
- Fecha: 2026-10-07
- Estado: Vigente (ADR-082)
- Reemplaza a: [`.specs/production-readiness/spec.md`](../production-readiness/spec.md) como definición de término
- Fuente de la línea base: verificación del repo y de GitHub Actions del 2026-10-07. Los datos de prod citados como «22-09» vienen de `docs/handoff/CURRENT.md` y no se re-verificaron. Todas las líneas «Hoy» se re-verificaron el 2026-11-20 (`main` `e7ad3c6c`, prod `93f084f1`) contra el repo, GitHub Actions y GCP en solo lectura; el detalle y el plan de trabajo están en [`docs/handoff/2026-11-20-plan-trl10.md`](../../docs/handoff/2026-11-20-plan-trl10.md). Esa sesión no tuvo acceso a la BD: lo que depende de datos de prod cita `docs/handoff/CURRENT.md` del 20-11.

---

## 1. Objetivo

Llevar Booster AI a TRL 10 según [ADR-082](../../docs/adr/082-objetivo-trl10-supersede-precomercial.md): producto en operación comercial, certificado externamente, con calidad verificable por CI y operación endurecida. Esta spec es la única definición de término. TRL 10 se declara cuando todos los criterios `T10-NN` están marcados con su evidencia.

## 2. Reglas

- Cada criterio es binario y lo verifica un tercero con la evidencia indicada. «Produjo salida» no basta: la evidencia es la del criterio.
- Un criterio se marca `[x]` en el PR que aporta su evidencia, con el enlace o el output.
- Cambiar un criterio exige una enmienda en §8 con la decisión del PO. Quitar uno que dependa de un ADR exige un ADR que lo marque `No perseguido`.
- Las fases se ejecutan en orden (A → D). Las gestiones con terceros de la fase E arrancan en la fase A y corren en paralelo, porque sus plazos no dependen del desarrollo.
- Dentro de la fase activa hay como máximo tres frentes en ejecución y tres PRs propios abiertos (`CLAUDE.md`).

## 3. Criterios

### Fase A — Producto real en operación

- [ ] **T10-01 Huella medida.** Dos viajes reales en prod, uno con FMC150 y otro sin él, cierran con `emisiones_kgco2e_reales` poblado o con degradación explícita registrada (`*Actual = null`, métrica data-quality y certificación degradada). Nunca `0`. Evidencia: la query del Slot 1 de `docs/frentes-vivos.md`. Hoy (20-11, sin acceso a la BD desde la sesión que verificó; dato de `docs/handoff/CURRENT.md` del 20-11): hay 10 certificados en prod y la evidencia E4 y E7 del handoff (un viaje de punta a punta sin el PO y un viaje sin FMC150 con su métrica data-quality) sigue pendiente. La regla de distancia plausible reemplazó la discusión del hueco detenido: cinco certificados se reemitieron en versión 2 el 11-19. No se cumple.
- [ ] **T10-02 Conductor operativo.** Un viaje pasa de creado a cerrado en prod sin intervención manual del PO, con un conductor activado por su empresa, y el flujo activar → recogida → posición → entrega → certificado tiene E2E verde en CI. Evidencia: la query del Slot 3. Hoy (20-11): el E2E `flujo-conductor.spec.ts` corre por PR y pasó en la última corrida de #748 (`171b7d1c`). En prod sigue pendiente un viaje de creado a certificado sin intervención del PO (E4 de `docs/handoff/CURRENT.md`). No se cumple.
- [ ] **T10-03 Superficie demo retirada.** `grep -rl 'es_demo\|isDemo\|DEMO_\|demo\.boosterchile' apps packages infrastructure` excluyendo migraciones históricas devuelve 0 archivos, y `demo.boosterchile.com` no resuelve. Hoy (20-11): #748 se mergeó (`e7ad3c6c`) con el visto del PO y no está desplegado: prod corre `93f084f1` y la migración 0088 espera el próximo release. El grep da 1 archivo, `infrastructure/removed-demo.tf` (de #790; se borra después de su apply). El registro DNS `demo.boosterchile.com` y el cert con demo (`booster-ai-cert-47e8c1ae`) siguen en GCP hasta el `terraform apply`. Falta: release, comprobar que la 0088 se aplicó (con `STRICT_MIGRATION_ORDERING=false` un release verde no lo prueba), el apply y el PR que borra `removed-demo.tf`.
- [ ] **T10-04 Activación por canal real.** La activación del conductor y del dueño sale sola por WhatsApp o correo en prod. Evidencia: un conductor nuevo activado sin que el PO le entregue el código. Hoy (20-11): pendiente la evidencia E3 de `docs/handoff/CURRENT.md` (un conductor activado solo por canal). Los invitados de BARH-21 no confirmaron su cuenta. No se cumple.
- [ ] **T10-05 Certificado primario.** Al menos un viaje real con CAN + Teltonika y cobertura ≥ 95 % emite un certificado `primario_verificable` (ADR-077). Hoy (20-11): los certificados de prod son todos secundarios (`docs/handoff/CURRENT.md`). En la flota más grande solo 2 de 12 vehículos tienen fuente y capacidad de estanque configuradas. Es configuración de vehículos más un viaje con cobertura ≥ 95 %, no código. No se cumple.
- [x] **T10-06 Infra sin drift.** `Terraform Drift Check` verde en tres corridas programadas seguidas sobre `main`. Cumplido (29-10): 7 corridas programadas seguidas en verde sobre `main` `1b10cfa3`, del 2026-10-23 al 10-29 (run ids `39980855802`, `40102974166`, `40204581020`, `40368063242`, `40542865629`, `40732980967` y `40921170472`; `gh run list --workflow terraform-drift.yml --event schedule`). Al 20-11: la programada del 11-16 falló por una diferencia (faltaba la variable del remitente en el api) y las del 11-17, 11-18 y 11-19 volvieron a verde.
- [x] **T10-07 Security programado verde.** La corrida semanal de `security.yml` pasa en verde dos semanas seguidas. Hoy (20-11): tres corridas semanales seguidas en verde después de la migración a zod 4: 11-02 (`41429055502`), 11-09 (`42604142793`) y 11-16 (`43850018543`) (`gh api …/workflows/security.yml/runs?event=schedule`). Marcado el 2026-11-20 por decisión del PO.

### Fase B — Calidad verificable

- [x] **T10-08 Coverage 80 en todo.** Líneas, ramas, funciones y sentencias ≥ 80 % en cada app y package con código, y CI lo exige. Evidencia: `vitest.config.ts` de cada workspace y `ci.yml` con umbral 80 en las cuatro métricas. Hoy (20-11): `ci.yml:22-25` exige 80 en las cuatro métricas y los 29 `vitest.config.ts` (9 apps y 20 packages) declaran 80 en las cuatro; ningún workspace con `src/` carece de config. Marcado el 2026-11-20 por decisión del PO.
- [x] **T10-09 Sin stubs.** `packages/carta-porte-generator` y `packages/document-indexer` (7 LOC con `TODO`) se implementan o se eliminan. `apps/matching-engine` y `apps/notification-service` se cierran en T10-21. Hoy (20-11): los dos packages no existen en `main` desde #750. Marcado el 2026-11-20 por decisión del PO; la parte de los microservicios se cierra en T10-21.
- [x] **T10-10 E2E de los flujos críticos por PR.** Hay specs Playwright que corren en cada PR que toca `apps/web/**` o `apps/api/src/**` para: generador publica carga, transportista acepta oferta, conductor ejecuta viaje, admin crea organización stakeholder, stakeholder consulta zonas, tracking público por enlace y login con RUT y clave. Hoy (20-11): los siete flujos tienen spec en `apps/web/e2e-conductor/` (`flujo-marketplace`, `flujo-conductor`, `flujo-stakeholder`, `login-rut-clave`) y el filtro `conductor` de `e2e-pr.yml` incluye `apps/web/**` y `apps/api/src/**`. Última corrida verde en un PR: la de #748 (`171b7d1c`, 2026-11-20). Marcado el 2026-11-20 por decisión del PO.
- [ ] **T10-11 Accesibilidad.** `@axe-core/playwright` corre en cada flujo de T10-10 con 0 violaciones `serious` o `critical`, y un informe de auditoría WCAG 2.1 AA de esos flujos (`docs/audits/wcag-YYYY-MM-DD.md`) no deja hallazgos AA abiertos. Hoy (20-11): axe corre en los cuatro specs de flujo y en `a11y-teclado.spec.ts` por el helper `e2e-conductor/a11y.ts`. `docs/audits/wcag-2026-10-09.md` cierra sus 8 hallazgos y deja pendiente la escucha con lector de pantalla de los 7 flujos, que hace una persona (`wcag-escucha-lector-pantalla.md`). No se cumple hasta esa escucha.
- [ ] **T10-12 Reglas del stack.** En `apps/*/src` y `packages/*/src` sin tests: 0 `any`, 0 `@ts-ignore` y 0 `console.*` fuera del sink de errores del logger; cada `as unknown as` va precedido de un parse Zod. Hoy (20-11): 0 `@ts-ignore`; `console.*` solo en el sink `apps/web/src/lib/error-reporting.ts`; queda 1 `any` (`apps/api/src/lib/validation.ts:35`, `Hook<any, any, any>`) y 2 `as unknown as`: `cache-combustible-flota.ts:124` va tras un `safeParse` y `jobs/hc001-fuente-combustible-can.ts:83` no. No se cumple por el `any` y ese cast.
- [x] **T10-13 Aislamiento documentado.** `docs/rls-exemptions.md` lista cada tabla sin `empresa_id` y su razón, y coincide con `TENANT_FREE_TABLES` de `scripts/lint-rls.mjs`. Hoy (20-11): `docs/rls-exemptions.md` existe y `pnpm lint:rls`, que falla si el documento no coincide con `TENANT_FREE_TABLES`, pasa en `main`. Marcado el 2026-11-20 por decisión del PO.
- [ ] **T10-14 CI rápido.** p95 del tiempo de reloj de CI por PR ≤ 10 min sobre los últimos 50 PRs, medido con la API de Actions y registrado en el PR. Hoy (20-11): la medición del 10-09 daba p95 6,6 min (`docs/perf/ci-p95-2026-10-09.md`). Repetida el 20-11 con el mismo método sobre las 50 ramas más recientes (11-16 a 11-20): p50 8,0 · **p95 10,8** · máximo 11,8 min; las dos más lentas son de `e2e-pr.yml`. No se cumple. La medición se hizo con `gh api` porque `medir-ci-p95.mjs` recibió 401 con el token de la sesión.

### Fase C — Operación endurecida

- [x] **T10-15 Métricas de negocio.** `packages/otel-bootstrap` exporta métricas a Cloud Monitoring y aparecen descriptores `custom.` o `workload.` de viajes entregados, certificados emitidos y data-quality de huella. Hoy (20-11): Monitoring tiene 32 descriptores `workload.googleapis.com`, entre ellos `viajes_entregados_total`, `certificados_emitidos_total` y `huella_cobertura_degradada_total` (REST `metricDescriptors`). Marcado el 2026-11-20 por decisión del PO.
- [ ] **T10-16 Errores de backend agregados.** Los errores no controlados de api, telemetry-processor, telemetry-tcp-gateway y whatsapp-bot llegan a un agregador (Error Reporting o Sentry) con alerta. Hoy (20-11): `@booster-ai/logger` emite `ReportedErrorEvent` (`packages/logger/src/error-reporting.ts`) y lo usan api, telemetry-processor, telemetry-tcp-gateway y whatsapp-bot. `infrastructure/error-reporting.tf` define la métrica y en prod la alerta «Backend: errores no controlados (Error Reporting)» está habilitada. Falta ver un error real de cada servicio agrupado en Error Reporting antes de marcar.
- [x] **T10-17 SLOs.** `google_monitoring_slo` con alerta de burn-rate para api, web, telemetry-tcp-gateway (99,5 %), telemetry-processor (99,5 %) y whatsapp-bot (99 %). Hoy (20-11): en prod hay 7 SLO en los cinco servicios (api y web con disponibilidad y latencia; gateway 99,5 %, processor 99,5 %, whatsapp-bot 99 %) y sus 7 alertas «SLO burn» están habilitadas (Monitoring REST `services` y `alertPolicies`). Marcado el 2026-11-20 por decisión del PO.
- [x] **T10-18 Runbooks y on-call.** Existen `docs/runbooks/on-call.md` con la ventana real de respuesta, `docs/runbooks/post-mortem-template.md`, y runbooks de mandato de cobro e incidentes GLEC además de los `service-*.md` actuales. Hoy (20-11): existen `on-call.md` (ventana fijada por el PO el 2026-10-08), `post-mortem-template.md`, `mandato-de-cobro.md` e `incidentes-glec.md`. Marcado el 2026-11-20 por decisión del PO.
- [ ] **T10-19 Load test.** En un entorno que no es prod: api a 50 RPS sostenidos y 200 de pico con p95 ≤ 500 ms y p99 ≤ 1,5 s; gateway con 1 000 conexiones TCP concurrentes sin caídas sostenidas. Reporte en `docs/perf/load-test-YYYY-MM-DD.md`. Hoy (20-11): hay spec (`.specs/load-test-t10/`) y `docs/perf/load-test-runbook.md`, sin reporte fechado. Staging no existe (`docs/handoff/CURRENT.md`), así que no hay entorno donde correrlo. No se cumple.
- [ ] **T10-20 DR probado.** Drill según ADR-082 §3: restauración de Cloud SQL por PITR y reconstrucción desde Terraform, con RTO y RPO medidos dentro de los objetivos. Reporte en `docs/runbooks/dr-drill-YYYY-MM-DD.md`. Hoy (20-11): hay spec (`.specs/dr-drill-t10-20/`) y `docs/runbooks/dr-drill.md`, sin reporte fechado de una corrida. No se cumple.

### Fase D — Funcionalidades comprometidas

- [ ] **T10-21 Microservicios extraídos (ADR-048).** `matching-engine`, `notification-service` y `document-service` corren en Cloud Run con imagen propia (no `gcr.io/cloudrun/placeholder`), atienden tráfico de prod, tienen coverage ≥ 80 % y un rollback drill documentado. Hoy (20-11): los tres corren imagen propia (`93f084f1`). En el api, `MATCHING_VIA_MICROSERVICE`, `MATCHING_SHADOW`, `NOTIFICATIONS_VIA_MICROSERVICE` y `NOTIFICATIONS_SHADOW` están en `false`. En 30 días matching-engine y notification-service no recibieron ninguna request HTTP y document-service 2. El `allowFailure` de sus deploys se quitó (#879). El rollback drill no tiene registro de una corrida. No se cumple.
- [ ] **T10-22 Wake-word (ADR-036).** Un controlador real de Picovoice reemplaza el stub de `apps/web/src/services/wake-word.ts` y se activa con flag sin nuevo deploy. Evidencia: test que carga el controlador con flag encendido y una prueba en un dispositivo. Hoy (20-11): el controlador de Porcupine está en `apps/web/src/services/wake-word.ts` y la clave llega en runtime por `GET /me/wake-word`. `WAKE_WORD_VOICE_ACTIVATED=false` en prod y no hay registro de la prueba en un dispositivo. No se cumple.
- [ ] **T10-23 Eco-routing en tiempo real (ADR-012 Capa 1).** Durante un viaje activo se detecta congestión en < 60 s, la sugerencia llega al conductor en < 5 s, su respuesta queda registrada y hay una métrica de adopción. Evidencia: test de integración y un viaje real con al menos una sugerencia. Hoy (20-11): existe `eco-routing-tiempo-real.integration.test.ts`. `ECO_ROUTING_REALTIME_ACTIVATED=false` en prod y no hay un viaje real con sugerencia. No se cumple.
- [ ] **T10-24 Observatorio Coquimbo (ADR-012 Capa 2).** Endpoints de observatorio, dashboard interno y entrega al municipio con contraparte identificada, con agregación mínima de 10 vehículos por bucket. Evidencia: acta o correo de recepción del municipio. Hoy (20-11): los endpoints y las métricas `observatorio.*` están en prod. Falta la contraparte municipal y su acta o correo de recepción, a cargo del PO (`.specs/observatorio-coquimbo/spec.md`). No se cumple.
- [ ] **T10-25 Mandato de cobro (ADR-080).** Las seis precondiciones de §6 tienen evidencia escrita, el flujo está activado en prod y al menos un ciclo de cobro quedó conciliado. Hoy (20-11): `MANDATO_COBRO_ACTIVATED=false`. `.specs/mandato-de-cobro/activacion.md` (estado al 10-10) tiene las precondiciones 1, 2, 3, 4 y 6 pendientes. La fecha de control es el 2026-11-30: si la precondición 3 no se cumple, el peak de enero a marzo de 2027 se opera en modo conector, y la decisión se registra en `docs/handoff/CURRENT.md`.

### Fase E — Certificación y comercial (gestiones con terceros, arrancan en la fase A)

- [ ] **T10-26 Pentest externo.** Contrato con proveedor, auditoría ejecutada, 0 hallazgos P0/P1 abiertos. Reporte en `docs/audits/security-pre-launch-YYYY-MM-DD.md`. Hoy (20-11): `docs/audits/security-rfp.md` v2 dice «listo para enviar (PO)». El repo no registra que se haya enviado.
- [ ] **T10-27 Certificación GLEC v3.0 externa.** Certificado emitido por auditor tercero, en `docs/compliance/`. Hoy (20-11): `docs/compliance/glec-rfp.md` v2 redactado. El repo no registra que se haya enviado.
- [ ] **T10-28 Legales revisados por abogado.** T&C v3, aviso de privacidad y consentimientos conformes a la Ley 21.719 (vigente desde 2026-12-01), contratos por rol y adendum del mandato, cada uno con `lawyer_review: <fecha>` en el frontmatter. Hoy (20-11): los cinco documentos de `docs/legal/` (T&C v3, aviso de privacidad v2, consentimientos v2, contratos por rol v1 y adendum del mandato v1) están en `estado: borrador` con `lawyer_review: pendiente`. La Ley 21.719 rige desde el 2026-12-01.
- [ ] **T10-29 Precios publicados.** La página pública de precios coincide con ADR-079. Hoy (20-11): la ruta pública `/precios` existe en la web (`apps/web/src/router.tsx`). No se verificó en prod ni contra ADR-079: el proxy de la sesión bloquea `boosterchile.com`.
- [ ] **T10-30 Cliente con contrato.** Al menos un cliente que no opera el PO, con contrato firmado, viajes reales, un ciclo de facturación procesado y certificados emitidos, con feedback en `docs/handoff/<fecha>-cliente-1.md`. Hoy (20-11): 0 contratos firmados; no existe `docs/handoff/*-cliente-1.md`.

## 4. Fuera de alcance

Emisión de DTE (ADR-069). Capas 3 y 4 de ADR-012. Apps nativas (ADR-008). Internacionalización. SOC 2 Type II. HA regional y DR multi-región antes del primer contrato con SLA (ADR-058, condición de reversión).

## 5. Criterios de la spec anterior que no pasan

| Spec anterior | Por qué |
|---|---|
| SC-4, SC-5, SC-6, SC-7 | Cumplidos en sustancia (ADR-043, archivo de raíz en `docs/archive/`, ADR-046 con `check-adr-numbering`, ADR-056) |
| SC-11 (parte DTE), SC-14, flujo «cumplimiento emite DTE» de SC-15 | ADR-069 y ADR-080 |
| SC-19 tal como estaba (failover a clúster DR) | ADR-081; lo reemplaza T10-20 |
| SC-28, SC-30 | Reglas de planificación de la spec anterior; ADR-048 ya decide la estrategia de extracción |

## 6. Línea base al 2026-10-07 (verificada)

- Prod = `main` `0008fa6`: release `37451757913` en verde el 2026-10-06. Los 6 releases desde #733 salieron en verde.
- CI y Security en verde en `main`; E2E nocturno contra prod en verde el 2026-10-07.
- Terraform Drift Check en rojo (2026-10-06).
- Multi-tenant cerrado el 2026-10-06 (59 migraciones en prod).

## 7. Preguntas abiertas

- **OQ-1** — Entorno para T10-19. Opciones: workspace de Terraform efímero que se levanta solo para el load test, o proyecto GCP separado. Decide el PO antes de la fase C.
- **OQ-2** — Presupuesto de la fase E (auditorías y asesoría legal). Lo fija el PO; no bloquea el envío de los RFP.
- **OQ-3** — El cierre con Corfo tiene compromisos propios por mes de proyecto (validación con ≥ 5 usuarios en el mes 9, entre otros; `.specs/hito-2-corfo-mes-8/plan.md`). La carta de compromiso original no está en el repo; si exige algo que no está en §3, se agrega por enmienda.

## 8. Enmiendas

- 2026-10-07 — Versión inicial. Decisiones del PO: DR por restauración con HA al primer SLA; extracción de microservicios, wake-word, eco-routing en tiempo real y observatorio Coquimbo entran a TRL 10; programa por fases manteniendo el tope de tres frentes y tres PRs.
- 2026-11-20 — Sin cambio de criterios. Se actualizan las líneas «Hoy» de los 30 criterios. El PO decidió el 2026-11-20 marcar T10-07, T10-08, T10-09, T10-10, T10-13, T10-15, T10-17 y T10-18 con la evidencia de su línea «Hoy»; los de las fases B y C quedan así declarados como adelantos.

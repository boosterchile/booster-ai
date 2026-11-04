# Spec: trl10 — definición de término de TRL 10

- Autor: Felipe Vicencio (PO), redactado con Claude
- Fecha: 2026-10-07
- Estado: Vigente (ADR-082)
- Reemplaza a: [`.specs/production-readiness/spec.md`](../production-readiness/spec.md) como definición de término
- Fuente de la línea base: verificación del repo y de GitHub Actions del 2026-10-07. Los datos de prod citados como «22-09» vienen de `docs/handoff/CURRENT.md` y no se re-verificaron.

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

- [ ] **T10-01 Huella medida.** Dos viajes reales en prod, uno con FMC150 y otro sin él, cierran con `emisiones_kgco2e_reales` poblado o con degradación explícita registrada (`*Actual = null`, métrica data-quality y certificación degradada). Nunca `0`. Evidencia: la query del Slot 1 de `docs/frentes-vivos.md`. Hoy (22-09): el viaje con Teltonika cumple; los 4 sin Teltonika son de un generador de prueba y no hay métrica data-quality.
- [ ] **T10-02 Conductor operativo.** Un viaje pasa de creado a cerrado en prod sin intervención manual del PO, con un conductor activado por su empresa, y el flujo activar → recogida → posición → entrega → certificado tiene E2E verde en CI. Evidencia: la query del Slot 3. Hoy (22-09): el E2E no ejercita la activación y 1 de 7 conductores está activado.
- [ ] **T10-03 Superficie demo retirada.** `grep -rl 'es_demo\|isDemo\|DEMO_\|demo\.boosterchile' apps packages infrastructure` excluyendo migraciones históricas devuelve 0 archivos, y `demo.boosterchile.com` no resuelve. Hoy (22-09): 45-52 archivos y el dominio responde 200.
- [ ] **T10-04 Activación por canal real.** La activación del conductor y del dueño sale sola por WhatsApp o correo en prod. Evidencia: un conductor nuevo activado sin que el PO le entregue el código. Hoy (22-09): `CONTENT_SID_ACTIVACION_CONDUCTOR` no está montado en el api y el secreto `resend-api-key` no existe.
- [ ] **T10-05 Certificado primario.** Al menos un viaje real con CAN + Teltonika y cobertura ≥ 95 % emite un certificado `primario_verificable` (ADR-077). Hoy (22-09): los 5 certificados son `secundario_modeled`.
- [ ] **T10-06 Infra sin drift.** `Terraform Drift Check` verde en tres corridas programadas seguidas sobre `main`. Hoy: rojo desde 2026-08-16; la última corrida (2026-10-06) también falló.
- [ ] **T10-07 Security programado verde.** La corrida semanal de `security.yml` pasa en verde dos semanas seguidas. Hoy (21-09): gitleaks semanal rojo desde 2026-05-04 por la site key de reCAPTCHA en `9b4a44c`.

### Fase B — Calidad verificable

- [ ] **T10-08 Coverage 80 en todo.** Líneas, ramas, funciones y sentencias ≥ 80 % en cada app y package con código, y CI lo exige. Evidencia: `vitest.config.ts` de cada workspace y `ci.yml` con umbral 80 en las cuatro métricas. Hoy: `apps/api` y `apps/web` tienen umbral 75 en ramas y funciones; cuatro apps más, 75 en ramas; `ci.yml:21-23` exige 75 en ramas. El API midió 81,77 % de ramas en #739, así que subir su umbral no debería romper.
- [ ] **T10-09 Sin stubs.** `packages/carta-porte-generator` y `packages/document-indexer` (7 LOC con `TODO`) se implementan o se eliminan. `apps/matching-engine` y `apps/notification-service` se cierran en T10-21.
- [ ] **T10-10 E2E de los flujos críticos por PR.** Hay specs Playwright que corren en cada PR que toca `apps/web/**` o `apps/api/src/**` para: generador publica carga, transportista acepta oferta, conductor ejecuta viaje, admin crea organización stakeholder, stakeholder consulta zonas, tracking público por enlace y login con RUT y clave. Hoy: solo el del conductor existe, y el filtro de `e2e-pr.yml` no incluye `apps/api/src/**`.
- [ ] **T10-11 Accesibilidad.** `@axe-core/playwright` corre en cada flujo de T10-10 con 0 violaciones `serious` o `critical`, y un informe de auditoría WCAG 2.1 AA de esos flujos (`docs/audits/wcag-YYYY-MM-DD.md`) no deja hallazgos AA abiertos. Hoy: axe está instalado y no se usa en ningún E2E.
- [ ] **T10-12 Reglas del stack.** En `apps/*/src` y `packages/*/src` sin tests: 0 `any`, 0 `@ts-ignore` y 0 `console.*` fuera del sink de errores del logger; cada `as unknown as` va precedido de un parse Zod. Hoy: 32 `any` (28 son `Context<any, any, any>` en helpers `require*`), 10 `as unknown as` sin revisar.
- [ ] **T10-13 Aislamiento documentado.** `docs/rls-exemptions.md` lista cada tabla sin `empresa_id` y su razón, y coincide con `TENANT_FREE_TABLES` de `scripts/lint-rls.mjs`.
- [ ] **T10-14 CI rápido.** p95 del tiempo de reloj de CI por PR ≤ 10 min sobre los últimos 50 PRs, medido con la API de Actions y registrado en el PR.

### Fase C — Operación endurecida

- [ ] **T10-15 Métricas de negocio.** `packages/otel-bootstrap` exporta métricas a Cloud Monitoring y aparecen descriptores `custom.` o `workload.` de viajes entregados, certificados emitidos y data-quality de huella. Hoy (22-09): 0 descriptores custom.
- [ ] **T10-16 Errores de backend agregados.** Los errores no controlados de api, telemetry-processor, telemetry-tcp-gateway y whatsapp-bot llegan a un agregador (Error Reporting o Sentry) con alerta. Hoy: Sentry solo en web.
- [ ] **T10-17 SLOs.** `google_monitoring_slo` con alerta de burn-rate para api, web, telemetry-tcp-gateway (99,5 %), telemetry-processor (99,5 %) y whatsapp-bot (99 %). Hoy: solo api y web (`infrastructure/slo.tf`).
- [ ] **T10-18 Runbooks y on-call.** Existen `docs/runbooks/on-call.md` con la ventana real de respuesta, `docs/runbooks/post-mortem-template.md`, y runbooks de mandato de cobro e incidentes GLEC además de los `service-*.md` actuales.
- [ ] **T10-19 Load test.** En un entorno que no es prod: api a 50 RPS sostenidos y 200 de pico con p95 ≤ 500 ms y p99 ≤ 1,5 s; gateway con 1 000 conexiones TCP concurrentes sin caídas sostenidas. Reporte en `docs/perf/load-test-YYYY-MM-DD.md`. Hoy: solo existe un smoke k6 y no hay entorno no-prod (ver OQ-1).
- [ ] **T10-20 DR probado.** Drill según ADR-082 §3: restauración de Cloud SQL por PITR y reconstrucción desde Terraform, con RTO y RPO medidos dentro de los objetivos. Reporte en `docs/runbooks/dr-drill-YYYY-MM-DD.md`.

### Fase D — Funcionalidades comprometidas

- [ ] **T10-21 Microservicios extraídos (ADR-048).** `matching-engine`, `notification-service` y `document-service` corren en Cloud Run con imagen propia (no `gcr.io/cloudrun/placeholder`), atienden tráfico de prod, tienen coverage ≥ 80 % y un rollback drill documentado. Hoy: los tres en placeholder; los dos primeros son esqueletos de 15 LOC.
- [ ] **T10-22 Wake-word (ADR-036).** Un controlador real de Picovoice reemplaza el stub de `apps/web/src/services/wake-word.ts` y se activa con flag sin nuevo deploy. Evidencia: test que carga el controlador con flag encendido y una prueba en un dispositivo.
- [ ] **T10-23 Eco-routing en tiempo real (ADR-012 Capa 1).** Durante un viaje activo se detecta congestión en < 60 s, la sugerencia llega al conductor en < 5 s, su respuesta queda registrada y hay una métrica de adopción. Evidencia: test de integración y un viaje real con al menos una sugerencia.
- [ ] **T10-24 Observatorio Coquimbo (ADR-012 Capa 2).** Endpoints de observatorio, dashboard interno y entrega al municipio con contraparte identificada, con agregación mínima de 10 vehículos por bucket. Evidencia: acta o correo de recepción del municipio.
- [ ] **T10-25 Mandato de cobro (ADR-080).** Las seis precondiciones de §6 tienen evidencia escrita, el flujo está activado en prod y al menos un ciclo de cobro quedó conciliado. Hoy: modo conector, `.specs/mandato-de-cobro/` no existe; §6 fija una fecha de control al 2026-11-30.

### Fase E — Certificación y comercial (gestiones con terceros, arrancan en la fase A)

- [ ] **T10-26 Pentest externo.** Contrato con proveedor, auditoría ejecutada, 0 hallazgos P0/P1 abiertos. Reporte en `docs/audits/security-pre-launch-YYYY-MM-DD.md`. Hoy: `docs/audits/security-rfp.md` redactado y sin enviar.
- [ ] **T10-27 Certificación GLEC v3.0 externa.** Certificado emitido por auditor tercero, en `docs/compliance/`. Hoy: `docs/compliance/glec-rfp.md` redactado y sin enviar.
- [ ] **T10-28 Legales revisados por abogado.** T&C v3, aviso de privacidad y consentimientos conformes a la Ley 21.719 (vigente desde 2026-12-01), contratos por rol y adendum del mandato, cada uno con `lawyer_review: <fecha>` en el frontmatter. Hoy: borradores; los T&C v2 todavía describen emisión de DTE (contradice ADR-069).
- [ ] **T10-29 Precios publicados.** La página pública de precios coincide con ADR-079. Hoy: `www` redirige a la app y no hay ruta de precios.
- [ ] **T10-30 Cliente con contrato.** Al menos un cliente que no opera el PO, con contrato firmado, viajes reales, un ciclo de facturación procesado y certificados emitidos, con feedback en `docs/handoff/<fecha>-cliente-1.md`. Hoy: 0 contratos firmados.

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

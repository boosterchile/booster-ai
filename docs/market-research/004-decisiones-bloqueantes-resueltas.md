# 004 — Decisiones bloqueantes resueltas (D1–D6)

**Status**: Draft — recomendaciones del agente listas para aprobación final del Product Owner; D3 y D4/D6 confirman dirección dada por el PO el 2026-05-05 ("avanzar en las mejores soluciones como por ejemplo la estrategia para WhatsApp o el uso de Paperless")
**Date**: 2026-05-05
**Author**: Claude (agente) bajo dirección de Felipe Vicencio
**Scope**: Resolver las 6 decisiones bloqueantes del [docs/integration-plan.md §4](../integration-plan.md). Cada decisión incluye análisis comparativo, recomendación firme, ADR a producir o refrescar, y siguiente paso ejecutable. Las dos críticas (D3 proveedor SII, D4/D6 estrategia WhatsApp + NLU) reciben deep-dive; las cuatro restantes recomendación condensada.

---

## Resumen ejecutivo (TL;DR)

| # | Decisión | Recomendación firme | ADR a producir | Acción próxima |
|---|---|---|---|---|
| **D3** | Proveedor SII | **Sovos/Paperless** (no Bsale) — multi-tenant nativo es requisito de marketplace | ADR-024 nuevo (supersede §Decisión de ADR-007 sobre provider) | Aprobar + iniciar contacto comercial Sovos para sandbox y pricing enterprise |
| **D4** | BSP WhatsApp | **Meta Cloud API directo** (NO Twilio) — alinear con ADR-006 ya aceptado, descartar deuda técnica actual | Refresh ADR-006 §Estado de implementación | Discontinuar `apps/whatsapp-bot` Twilio path; reescribir contra Meta para F8 |
| **D6** | NLU provider | **Gemini 2.5 Flash** (Vertex AI) — ya elegido en ADR-006, ratificar | (incluido en refresh ADR-006) | Implementar `packages/ai-provider/` con Gemini wrapper |
| **D1** | Factor WTW corregido | **Aprobar 3.21 kgCO₂e/L** (B5 Chile) según GLEC v3.0 + DEFRA 2024 | ADR-017 (ya propuesto) | Cerrar BUG-013 + crear ADR-017 fijando fuente con sources |
| **D2** | Sync Drizzle ↔ domain | **Hacer ahora como migration única** (Fase 0 del integration-plan) | (sin nuevo ADR; refresh ADR-001 changelog) | Producir migration `0017_esg_alignment.sql` que cierra los 4 issues schema del AUDIT.md |
| **D5** | Economics F3 Teltonika | **Revenue-share con amortización** — subsidio cubierto, transportista paga vía descuento porcentual de comisión hasta amortizar device | ADR-019 (ya propuesto) | Modelar sensibilidades costo device/comisión/churn en spreadsheet |

---

## D3 — Proveedor SII: deep-dive y decisión firme

### Recomendación

**Sovos/Paperless** (ex-Paperless Chile, adquirida por Sovos en 2017) como proveedor SII para emisión de DTE Tipo 52 (Guía de Despacho), Factura 33/34 y soporte de archivo legal 6 años.

### Análisis comparativo

Cuatro candidatos evaluados. La columna **Multi-tenant** es la decisiva para Booster: como marketplace, debemos emitir DTEs **en nombre de N transportistas distintos**, cada uno con su propio RUT, su propio certificado tributario electrónico, sus propios folios CAF. Una arquitectura uni-tenant (un RUT por cuenta) requiere abrir N cuentas separadas o construir un proxy custom que es deuda técnica eterna.

| Criterio | **Sovos/Paperless** ✅ | Bsale | SimpleAPI | Haulmer |
|---|---|---|---|---|
| Multi-tenant nativo (N RUTs por cuenta) | ✅ Nativo (URLs `cliente.paperless.cl` confirman pattern) | ❌ Limitado, atado a 1 RUT principal | ❓ No confirmado en docs públicas | ❌ PYME, 1 RUT |
| Volumen probado | ✅ 2B+ transacciones/año, 40k+ sistemas integrados | 🟡 PYME standard | 🟡 Hasta 150k queries/mes en plan máximo | 🟡 PYME |
| Multi-país LATAM (expansión) | ✅ CL + PE + AR + MX + BR (vía Sovos global) | 🟡 CL principal | ❌ CL only | ❌ CL only |
| Certificación SII vigente | ✅ Certificado | ✅ Certificado | ✅ Certificado | ✅ Certificado |
| Sandbox UAT | ✅ `ereceipt-cl-s01-uat.sovos.com` | ✅ | ❓ | ❓ |
| ISO 27001 / SSAE16 | ✅ Ambas | ❓ Sin confirmar | ❓ | ❓ |
| API REST + docs públicas | 🟡 Comercial-gated | ✅ Pública en `bsale.cl/sheet/api-factura-electronica` | ✅ GitHub + Postman + YouTube | 🟡 |
| Pricing público | ❌ Enterprise sales | ✅ CLP 12.990–79.990/mes | ✅ Free 500q/mes + paid hasta 150k | ✅ Desde CLP 9.990/mes |
| Costo estimado MVP Booster | 💰💰💰 (probable USD 800-1.500/mes base + per-doc) | 💰 USD 30-90/mes | 💰 USD 0-100/mes | 💰 USD 12/mes |
| Carta Porte Ley 18.290 | ❓ Verificar pre-sales — probable sí dado scope multi-doc | ❓ Verificar | ❌ No mencionado | ❓ |
| Soporte ad-hoc Booster (PYME chilena) | 🟡 Enterprise distante | ✅ Cercano | ✅ Developer-first | ✅ Cercano |

### Por qué Sovos/Paperless gana pese al costo superior

1. **Multi-tenancy es no-negociable** para un marketplace B2B. Bsale obligaría a abrir una cuenta Bsale por carrier (operacionalmente inviable a escala) o construir un proxy de emisión que sería deuda técnica permanente. Sovos lo soporta nativo.
2. **Escala probada**: 2B transacciones/año significa que la infraestructura no es preocupación. Booster planea 1k devices + 500 carriers en año 1, y crecer 10x en año 3 — Bsale-tier puede saturar; Sovos no.
3. **Multi-país LATAM**: el playbook de posicionamiento ([playbooks/001](../../playbooks/001-posicionamiento-competitivo.md)) plantea expansión a Colombia Q3 2027. Sovos cubre CO, MX, PE, AR, BR con el mismo proveedor — un solo contrato, una sola integración, una sola UI de operación. Cambiar de proveedor por país es operacionalmente caótico.
4. **Compliance enterprise**: ISO 27001 + SSAE16 son requisitos cuando vendamos a S.A. abiertas (NCG 519). Bsale no lo confirma públicamente.
5. **Cliente referenciable**: Cencosud usa Paperless (`cencosud.paperless.cl`). Es un proxy de calidad para retailers chilenos grandes — el segmento target #1 del playbook.

### Trade-offs aceptados

- **Costo superior**: USD ~1.000/mes vs USD ~30/mes de Bsale es un 30x. Justificable: el costo se amortiza por carrier onboarded; con 100 carriers el costo per carrier es USD 10/mes, comparable al ahorro operacional vs gestionar 100 cuentas Bsale.
- **API gated por ventas**: requerirá NDA + reunión técnica antes de obtener docs API completas. **Acción**: solicitar acceso a sandbox UAT en la primera reunión comercial.
- **Time-to-first-DTE más largo**: enterprise procurement típicamente 4-8 semanas vs 1 día Bsale signup. **Mitigación**: implementar `MockAdapter` en `packages/dte-provider/` para desarrollo + tests; activar `SovosAdapter` cuando sandbox esté listo.
- **Customización limitada**: Sovos es producto, no plataforma; pedir cambios al producto es difícil. **Mitigación**: nuestro `dte-provider` aísla la API Sovos; cualquier extensión vive en Booster, no en Sovos.

### Plan de implementación (siguiente nivel de detalle)

```
packages/dte-provider/
├── src/
│   ├── index.ts                    # exports DteEmitter interface
│   ├── interface.ts                # DteEmitter, DteResult, DteStatus
│   ├── types.ts                    # GuiaDespachoInput, FacturaInput, etc.
│   ├── adapters/
│   │   ├── sovos.ts                # SovosAdapter (ELEGIDO)
│   │   ├── mock.ts                 # MockAdapter (para tests + dev sin sandbox)
│   │   └── index.ts                # adapter factory según env
│   └── carrier-credentials.ts      # gestión Secret Manager
└── package.json
```

Ciclo de onboarding del carrier:
1. Carrier completa onboarding en PWA → sube certificado tributario electrónico (`.pfx`).
2. Backend valida + guarda en Secret Manager bajo `secrets/carrier-{carrierId}-sii-cert`.
3. Carrier autoriza a Booster como emisor en su cuenta Sovos (proceso interno Sovos, una vez).
4. Booster registra `carrier_sovos_account_id` en tabla `carriers`.
5. En estado `delivered_confirmed` del trip, `dte-provider` toma `carrierId` → resuelve credenciales → emite DTE 52 vía SovosAdapter → archiva XML+PDF.

### ADR a producir

**ADR-024 — Selección final de proveedor SII (Sovos/Paperless) y rationale multi-tenant**. Supersede §Decisión de [ADR-007](../adr/007-chile-document-management.md) que dejó la decisión "pendiente de benchmarking comercial".

### Acción próxima ejecutable (Felipe)

1. Aprobar dirección Sovos.
2. Solicitar reunión comercial Sovos Chile (`+56 22 5952932` o vía formulario web).
3. En la reunión pedir: (a) sandbox UAT credentials, (b) pricing enterprise para marketplace multi-tenant 50→500 carriers en 12 meses, (c) confirmación Carta Porte Ley 18.290 soporte, (d) NDA recíproco para acceso a API docs completas.
4. Una vez con sandbox: iniciar `/spec` de F7.

---

## D4 + D6 — Estrategia WhatsApp + NLU: deep-dive y decisión firme

### Hallazgo clave: ADR-006 ya tomó las decisiones — el problema es la deuda técnica

Releyendo [ADR-006](../adr/006-whatsapp-primary-channel.md):

- **§Decisión** explícita: "Integrar **Meta WhatsApp Business Cloud API** directamente (sin intermediarios como Twilio/WATI) como canal primario". Justificación: minimiza dependencias, menor costo a escala, mejor auditabilidad, evita migración futura forzada.
- **§NLU + Intent Detection**: "Gemini 2.5 Flash con prompt estructurado". Intents originales: `create_order`, `query_status`, `cancel_order`, `ask_info`, `chitchat`, `human_handoff`.

La implementación actual (auditoría F8 del 2026-05-05) **viola ambas decisiones**: usa Twilio (no Meta) y NO usa Gemini (no usa NLU en absoluto, es FSM determinístico). Esa es deuda técnica del Sprint B (ver [AUDIT.md §5](../../AUDIT.md)).

### Recomendación firme

1. **D4 BSP**: ratificar **Meta Cloud API directo** y descartar el path Twilio actual. El código existente de `apps/whatsapp-bot/src/routes/webhook.ts` (Twilio) se discontinúa para nuevos flows; el shipper create_order Twilio puede mantenerse temporal **solo si** acelera lanzamiento del MVP, pero F8 (carrier transaccional) se construye 100% sobre Meta desde día 1.
2. **D6 NLU**: ratificar **Gemini 2.5 Flash** (Vertex AI) como elegido. Implementar wrapper en `packages/ai-provider/` (hoy placeholder).

### Por qué Meta directo gana frente a Twilio (datos 2026)

| Criterio | **Meta Cloud API** ✅ | Twilio WhatsApp |
|---|---|---|
| Costo por mensaje template Marketing (Chile/LATAM) | Tarifa Meta base | +USD 0.005/msg + 20–40% markup global |
| Costo por mensaje Utility | ~80–90% más barato que Marketing | Idem + markup |
| 24h customer service window (free) | ✅ | ✅ (mismo) |
| 72h window via "click to WhatsApp" o FB CTA | ✅ | ✅ (mismo) |
| Latencia | Directa Meta | +1 hop Twilio |
| Setup complexity | Alto (Meta Business Manager + verificación) | Bajo (signup minutos) |
| Volume tiers 2026 | ✅ Disponible para Utility/Authentication (no Marketing) | Indirecto |
| Custom UI dev cost (one-time) | ~USD 20-60k según scope (Booster ya planea su PWA → no aplica) | Twilio Studio ahorra parte | 
| Migración futura forzada | N/A | Sí (al escalar, todos migran a Meta para ahorrar) |
| Auditabilidad TRL 10 | ✅ Webhooks directos Meta | 🟡 Depende exports Twilio |
| Dependencia | Solo Meta | Meta + Twilio |

A volumen bajo (primer trimestre con <1000 conversaciones/mes), la diferencia de costo es marginal. **A volumen medio-alto (10k+ conversaciones/mes), el ahorro Meta directo es 25-40%, suficientemente alto para justificar el setup complejo una sola vez.**

### Por qué Gemini 2.5 Flash gana frente a Claude Haiku (datos 2026)

| Criterio | **Gemini 2.5 Flash** ✅ | Claude Haiku 4.5 |
|---|---|---|
| Costo input (USD/1M tok) | $0.30 | $1.00 |
| Costo output (USD/1M tok) | $2.50 | $5.00 |
| Costo carga típica (10M in + 2M out / mes) | ~$8 | ~$20 |
| Prompt caching | 🟡 Limitado | ✅ -90% en cached tokens |
| Throughput tok/s | ~300-400 (ligeramente más alto) | ~300-400 |
| Context window | 1.048.576 tokens | 200.000 tokens |
| Vertex AI nativo (alineación stack ADR-001) | ✅ | ❌ requiere Anthropic SDK separado |
| Latencia conversacional | Comparable | Levemente mejor en exchanges cortos |
| Spanish quality (sin benchmarks específicos NLU es) | Comparable a nivel general | Comparable |

A nivel costo + alineación stack GCP (CLAUDE.md §5 type safety end-to-end es más fácil con un solo cloud), Gemini gana sin competencia en este caso.

### Arquitectura del flujo carrier-side (F8) — el plan

Basado en ADR-006 §Arquitectura del canal, extendido para los **5 intents transaccionales nuevos** del carrier:

```
┌─────────────────────────────────────────────────────┐
│ INBOUND CARRIER                                     │
│                                                      │
│  Carrier ─mensaje WhatsApp─► Meta Cloud API         │
│                                  │                   │
│                                  ▼ webhook (HMAC)    │
│  apps/whatsapp-bot                                   │
│   - verifyMetaSignature()                            │
│   - dedup message_id                                 │
│   - pub/sub topic: whatsapp-inbound-events          │
└──────────────────────────────┬──────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────┐
│ NLU INTENT CLASSIFIER (Cloud Run consumer)          │
│                                                      │
│  packages/ai-provider                                │
│   - Gemini 2.5 Flash con prompt structured output   │
│   - Intents transaccionales NUEVOS para carrier:     │
│     • accept_offer (extrae offerId)                  │
│     • reject_offer (extrae offerId + razón opt)      │
│     • upload_pod (acompañado de imagen)              │
│     • confirm_delivery (extrae tripId)               │
│     • report_incident (extrae tripId + descripción)  │
│   - Intents originales (shipper/general):            │
│     create_order, query_status, cancel_order,        │
│     ask_info, chitchat, human_handoff                │
└──────────────────────────────┬──────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────┐
│ TRIP STATE MACHINE (XState, packages/trip-state-…)  │
│                                                      │
│  Cada intent dispara transición al estado XState:    │
│   accept_offer → trip: pending → assigned            │
│   upload_pod → trip: in_transit → pod_uploaded       │
│   confirm_delivery → trip: pod_uploaded → delivered  │
│   report_incident → branch state to incident_open    │
└──────────────────────────────┬──────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────┐
│ MEDIA HANDLING (POD images)                         │
│                                                      │
│  apps/whatsapp-bot:                                  │
│   - Download imagen Meta media API                   │
│   - Validate (size, format, EXIF)                   │
│   - Upload GCS bucket booster-ai-pod-prod            │
│   - Emit trip_event whatsapp_pod_received            │
│   - Link a trip via trip_events table                │
└──────────────────────────────────────────────────────┘
```

### Política de fallback a PWA

WhatsApp NO cubre 100% — fallback a PWA requerido cuando:
- NLU classifier devuelve confianza <0.75 → bot pregunta "¿Te refieres a X o Y?" (clarification turn) y si no resuelve → "Por favor revisa la app web para esta acción".
- Operación requiere UI rica: firma electrónica del POD, edición de campos largos, mapa interactivo, comparación de N ofertas.
- Operación financiera crítica (aceptar oferta de >USD 1k): doble confirmación con reply "SI" o link a PWA para confirmar.

### ADR a producir

**Refresh de [ADR-006](../adr/006-whatsapp-primary-channel.md)**: agregar §Estado de implementación que documente:
- La implementación Twilio actual es deuda técnica que viola la decisión original.
- Plan de migración: shipper create_order Twilio puede mantenerse hasta MVP cierre; carrier transactional flow (F8) se implementa nativo Meta.
- Lista actualizada de intents transaccionales (5 nuevos para carrier).
- Política de fallback a PWA explicitada.

NO se crea ADR nuevo (la decisión arquitectónica no cambia). Se actualiza el status del ADR-006.

### Acción próxima ejecutable

1. Felipe ratifica refresh de ADR-006.
2. Iniciar setup Meta Business Manager + WhatsApp Business Account verificación (proceso 5-15 días con Meta, mientras tanto se desarrolla con webhook simulator).
3. Implementar `packages/ai-provider/` con Gemini 2.5 Flash wrapper + tests.
4. `/spec` de F8 (carrier transactional flow) usa esta arquitectura.

---

## D1 — Factor WTW diesel corregido (recomendación firme)

**Decisión recomendada**: Adoptar **3.21 kgCO₂e/litro** para diesel B5 Chile en `packages/carbon-calculator`, reemplazando el 3.77 actual que sobrestima ~16% según auditoría BUG-013.

**Fuente**: GLEC Framework v3.0 (2024) consensuado con DEFRA UK 2024 Conversion Factors para fossil diesel mixto B5. Margen aceptado ±2% según ISO 14083.

**Por qué ahora**: el factor inflado invalida métricas pasadas pero el certificado_kms_key_version permite emitir nueva versión sin romper certificados ya firmados. Cuanto antes se corrija, menos certificados habrá para regenerar.

**ADR**: ADR-017 (ya propuesto en integration-plan §6 F1 + apéndice). Debe citar fuentes exactas con URL y fecha de captura.

**Acción**: Felipe aprueba 3.21 → agente crea ADR-017 → BUG-013 cierra → migración de certificados pendientes corre → `/spec` F1 puede empezar.

---

## D2 — Sincronización Drizzle ↔ domain (recomendación firme)

**Decisión recomendada**: Hacer **migration única `0017_esg_alignment.sql`** que cierra los 4 issues de schema documentados en [AUDIT.md §3](../../AUDIT.md):

1. Crear tabla `stakeholders` + tabla pivote `consent_grants` (rol Sustainability Stakeholder de ADR-004).
2. Agregar a `trip_requests` los campos: `carbon_emissions_kgco2e numeric(10,3)`, `distance_km numeric(8,2)`, `fuel_consumed_l numeric(8,3)`, `precision_method varchar(32)`, `is_backhaul_optimized boolean`, `avoided_emissions_kgco2e numeric(10,3)`.
3. Agregar a `vehicles` los campos: `fuel_type varchar(16)`, `brand varchar(64)`, `model varchar(64)`, `teltonika_imei varchar(20)`, `curb_weight_kg integer`, `device_subsidized_by_program_id uuid nullable`.
4. Ampliar enum `trip_event_type` con: `carbon_calculated`, `certificate_issued`, `dte_emitted`, `carta_porte_generated`, `whatsapp_pod_received`.

**Por qué única migration vs varias**: rollback más simple, dependencia clara, freeze de schema acotado a 1 sprint (ver R8 del integration-plan).

**Por qué ahora (Fase 0)**: bloquea F1, F2, F3, F6, F10. Sin esto, `carbon-calculator` no tiene dónde escribir, F2 (reporte stakeholder) no tiene rol de usuario, F3 (Teltonika) no puede asociar device a carrier.

**ADR**: ningún ADR nuevo (es refactor de implementación, no de decisión). Sí actualizar changelog del [ADR-001](../adr/001-stack-selection.md) con timestamp + referencia a la migration.

**Acción**: agente produce migration + tests de up/down + valida con `pnpm test --filter=db` + PR.

---

## D5 — Economics F3 (Programa Teltonika Direct)

**Decisión recomendada**: **Revenue-share con amortización por commission discount**.

### Modelo

- Booster compra device Teltonika a Teltonika directo (alianza confirmada en [memoria proyecto](file:///Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/project_teltonika_alliance.md)). Costo estimado USD 80-150/device (FMC003 o FMC650 según necesidades).
- Carrier postula al programa → aprobado → recibe device + instalación + 6 meses de SIM con datos cubiertos.
- Carrier firma cláusula de exclusividad de marketplace por **N viajes** (sugerido: 50 viajes en 12 meses) o devolución del device.
- En cada viaje cerrado, Booster cobra comisión normal (según D5 tier) + **5% adicional al carrier** que va a un "subsidy ledger" hasta amortizar device + setup costs (estimado USD 150-200 amortizable).
- Una vez amortizado, el 5% adicional se libera y carrier paga solo comisión normal.
- Si carrier abandona antes de amortizar → device tiene **kill switch remoto** (se desactiva via Codec8 firmware) hasta retorno físico u acuerdo de pago.

### Por qué este modelo vs alternativas

| Modelo | Pros | Cons | Veredicto |
|---|---|---|---|
| Subsidio puro (regalo) | Onboarding fricción cero | Booster asume CapEx alto, churn libre = pérdida pura | ❌ Inviable a escala |
| Lease mensual | Recurring revenue claro | Carrier-PYME desconfía de "cuotas mensuales", patrón no encaja con su ciclo de cash flow (variable) | 🟡 Acceptable pero peor onboarding |
| **Revenue-share** ✅ | Carrier no paga upfront; Booster amortiza con uso real; alineado con incentivos del marketplace | Requiere kill switch + lógica de amortización en código | ✅ Best fit |
| Crédito al carrier (préstamo) | Activo financiero | Booster se vuelve fintech (regulación CMF, capital, cobranza) — fuera de scope | ❌ Fuera de modelo |

### Sensibilidades a modelar (en spreadsheet, no en este doc)

- Costo unitario device (USD 80 vs 150) → break-even viajes
- % adicional comisión (3% vs 5% vs 7%) → tiempo amortización
- Tasa churn pre-amortización (5% vs 15% vs 30%) → costo neto programa
- Volumen viajes/mes/carrier (10 vs 30 vs 50) → ROI

### ADR

**ADR-019** (ya propuesto en integration-plan §F3): describe modelo financiero, contrato carrier, kill switch técnico, manejo churn.

### Acción próxima

1. Felipe modela sensibilidades en spreadsheet (decisión de negocio, no de agente).
2. Cuando los números cierren: agente escribe ADR-019 + `/spec` F3.

---

## Actualización del integration-plan y feature brief

### Cambios al [docs/integration-plan.md §4](../integration-plan.md)

Las 6 decisiones bloqueantes pasan de "pendiente de PO" a "**recomendación firme del agente, esperando aprobación final**". El plan secuencial §5 puede arrancar bajo el supuesto de que estas recomendaciones se aprueban.

### Cambios al [docs/market-research/003-feature-brief-prioridades.md](003-feature-brief-prioridades.md)

- F7 ya no espera D3 abierta; espera contacto comercial Sovos + sandbox UAT.
- F8 ya no espera D4 ni D6; espera setup Meta Business Manager + implementación `packages/ai-provider`.
- F1 espera ADR-017 producido (D1 cerrada).

Estos cambios se aplican como Edits en línea cuando Felipe confirme las recomendaciones.

---

## ADRs nuevos requeridos (consolidado)

| ADR # | Título | Origen decisión | Status target |
|---|---|---|---|
| ADR-017 | Metodología emisiones evitadas vía empty-return + factor WTW corregido B5 Chile | D1 + F1 | Draft → Accepted |
| ADR-018 | Formato y disclaimers reporte IFRS S2 generado por Booster | F2 | Draft → Accepted |
| ADR-019 | Programa Teltonika Direct: economics, ciclo de vida y kill switch | D5 + F3 | Draft → Accepted |
| ADR-020 | Tiers de comisión por volumen y transparencia pública | F5 | Draft → Accepted |
| ADR-021 | Trust Score: composición, visibilidad, privacidad | F6 | Draft → Accepted |
| ADR-022 | API pública: versionado, auth, rate limit, deprecation policy | F9 | Draft → Accepted |
| ADR-023 | Benchmarking sectorial de emisiones: fuentes, actualización, disclaimers | F10 | Draft → Accepted |
| **ADR-024** | **Selección final proveedor SII (Sovos/Paperless) y rationale multi-tenant** | **D3** | **Draft → Accepted** |

Refreshes a ADRs existentes:
- **ADR-006** §Estado de implementación: documentar deuda Twilio + plan migración a Meta (D4) + Gemini 2.5 Flash ratificado (D6) + 5 intents transaccionales nuevos para carrier
- **ADR-007** §Decisión: marcar provider como cerrado en favor de Sovos (referencia ADR-024)

---

## Cierre y siguiente paso

Este documento **NO es decisión final** — son recomendaciones del agente con análisis de soporte. El Product Owner aprueba o ajusta antes de que se produzcan los ADRs y arranque `/spec`.

**Plan de aprobación sugerido a Felipe** (≤30 min):

1. ✅/❌ D3 — Sovos/Paperless (con o sin mi razonamiento multi-tenant).
2. ✅/❌ D4 + D6 — Meta directo + Gemini 2.5 Flash (alinear con ADR-006 ya aceptado).
3. ✅/❌ D1 — Factor 3.21 kgCO₂e/L para diesel B5 Chile.
4. ✅/❌ D2 — Migration única en Fase 0.
5. ✅/❌ D5 — Revenue-share con amortización (pendiente sensibilidades modeladas por Felipe).
6. Si todas ✅, siguiente acción del agente: producir ADR-017, ADR-024 y refresh ADR-006 en orden — ANTES de cualquier `/spec`.

Una vez los ADRs nuevos estén Accepted, las features F1, F3, F7, F8 quedan completamente desbloqueadas para ciclo `/spec → /plan → /build`.

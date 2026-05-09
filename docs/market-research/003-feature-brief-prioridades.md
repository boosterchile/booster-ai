# 003 — Feature brief derivado del market research (prompt para próximas sesiones)

**Status**: Accepted — orden P0→P3 aprobado por Product Owner el 2026-05-05; F7/F8 auditados (verdict en §Estado de implementación auditado)
**Date**: 2026-05-05 (creado) · 2026-05-05 (aprobado y actualizado con auditoría)
**Author**: Claude (agente) bajo dirección de Felipe Vicencio
**Scope**: Sintetiza los hallazgos del [001](001-competidores-chile-latam-2026-q2.md) y [002](002-follow-up-acciones.md), incorpora la **alianza directa Booster ↔ Teltonika** (no via BlackGPS), y propone 10 features priorizadas P0–P3 que cierran gaps identificados en el panorama competitivo. Cada feature está formulada para disparar `/spec` en una sesión separada.

---

## Cómo usar este documento

**Como prompt en una nueva sesión Claude Code**:

```
Lee @docs/market-research/003-feature-brief-prioridades.md y procede así:

1. Confirma comprensión de las 10 features y sus fuentes competitivas (≤5 líneas).
2. Por orden P0 → P1 → P2 → P3, ejecuta /spec para cada feature
   en sesiones separadas — NO en un solo mega-spec.
3. Para cada /spec, cita explícitamente:
   - El gap competitivo que cierra (con link a 001 ó 002)
   - Los ADRs existentes con los que se relaciona
   - Las dependencias técnicas declaradas en este brief
4. Al cerrar cada spec, propón el siguiente ADR si la decisión
   arquitectónica no está cubierta por ADR-001..016 existentes.
5. NO implementes (no /build) hasta que el Product Owner apruebe
   cada spec individualmente.

Restricciones (no negociables, ver CLAUDE.md):
- Cero deuda técnica desde day 0.
- Evidence over assumption.
- ADRs para decisiones arquitectónicas.
- Type safety end-to-end (Drizzle → Zod → TanStack Query).
- Observabilidad desde el primer endpoint.
```

**Como referencia interna**: archivo de planning compartido entre Felipe y agentes futuros que entren cold a una sesión de implementación de roadmap.

---

## Contexto consolidado (lo que el agente DEBE saber antes de actuar)

### Posicionamiento ratificado por el research

> Booster AI es la única plataforma de logística terrestre B2B en LATAM que **cierra el viaje** Y **entrega el certificado IFRS S2** firmado, sin que el shipper escriba una línea de cálculo, y aprovechando los retornos vacíos como fuente certificable de CO₂ evitado.

### Mandato regulatorio que justifica la urgencia

- **NCG 519 CMF Chile (oct 2024)**: obliga a sociedades anónimas abiertas a reportar IFRS S1/S2 desde **año fiscal 2026** (publicación 2027). IFRS S2 requiere métricas Scope 3 verificables — donde transporte upstream/downstream cae directo.
- **Ley 21.455 Marco Cambio Climático**: empresas con ventas >100.000 UF (~USD 4M) deben medir + reportar huella de carbono. Vigente.
- **Ningún proveedor SFC-certified opera en LATAM**, según búsqueda Smart Freight Centre (ver 001 §3.C). Cuadrante "marketplace + GLEC certificado en LATAM" está vacío.

### Activos competitivos confirmados de Booster

1. Stack greenfield cero deuda técnica (CLAUDE.md §Principios).
2. Modo `exacto_canbus` GLEC v3.0 (ver `packages/carbon-calculator/`, en validación post-auditoría BUG-013).
3. Multi-rol PWA (ADR-008) — único en LATAM, todos los competidores tienen apps separadas.
4. WhatsApp como canal primario (ADR-006) — adopción ~85% del transportista chileno.
5. Doc tributaria + porte chileno integrados (ADR-007).
6. **Alianza directa con Teltonika** (sin reseller) — habilita programas de hardware-as-a-service que un reseller como BlackGPS no puede igualar. *Recientemente confirmado por Product Owner*.

### Mapa competitivo actualizado (de 001/002)

| Cluster | Actores | Estado |
|---|---|---|
| Marketplace + carbono certificado LATAM | **VACÍO** | Tennders en beta solo Europa; Carga Inteligente con métrica no certificada; Avancargo "real-time emission" sin GLEC |
| Marketplace empty-returns CL | Fleteretorno (cms 10-15%, 1 árbol nativo/envío) + Carga Inteligente | Sin certificación auditable |
| Marketplace B2B carga LATAM | Avancargo (AR/CL, B Corp), Liftit (CO/CL/MX/EC, 147 emp), Carryt (CO/BR ex-Liftit BR), Frete.com (BR unicornio) | Crecientes pero sin foco GLEC |
| Telemetría IoT con Teltonika | BlackGPS (CL/CO/PE, +300k devices, **reseller** — competidor frontal de Booster ahora que tenemos Teltonika directo) | Sin marketplace, sin carbono |
| Route optimization / TMS | SimpliRoute, Drivin, Beetrack/DispatchTrack | Sin matching abierto, sin carbono certificado |
| Carbon calc certificado | EcoTransIT (DE), Pledge→Blue Yonder (UK→US), BearingPoint LogEC (DE) | Sin presencia LATAM, no marketplace |

---

## Las 10 features priorizadas

> Convención: cada feature tiene un **Trigger competitivo** (qué del research la motiva), **Outcome** (resultado observable), **Dependencias técnicas** (ADRs/packages), y **Anti-scope** (lo que NO incluye para no caer en feature creep).

---

### P0 — Diferencial competitivo único; cierran gaps que nadie en LATAM tiene

#### F1 — Certificado de empty-return CO₂ evitado firmado

- **Trigger competitivo**: Fleteretorno regala "1 árbol nativo por envío" como gimmick (no certificable); Carga Inteligente reporta "33 ton CO₂ reducido" sin metodología (no auditable). Frete.com dice "nunca rode vazio" sin metodología publicada. **Nadie convierte el matching de backhaul en evidencia auditable de Scope 3 evitado** — Gap #6 del 001.
- **Outcome**: cuando el matching algorithm enlaza una carga con un transportista que retornaba vacío, se emite un **certificado adicional de "CO₂ evitado vía empty-return optimization"** firmado con KMS, con metodología publicada (delta entre escenario contrafactual `viaje vacío` y `viaje con carga`). Descargable por shipper.
- **Dependencias**: ADR-005 (telemetría), ADR-016 (GLEC v3.0), `packages/matching-algorithm/`, `packages/carbon-calculator/`. Nuevo: `packages/avoided-emissions-calculator/` o módulo dentro de carbon-calculator.
- **Anti-scope**: NO compensación nominal de carbono (no somos registry de offsets); NO emitimos CER ni REDD; sí emitimos métrica de *reducción* trazable a viaje real.
- **ADR sugerido**: 017 — Metodología de cálculo de emisiones evitadas vía empty-return matching.

#### F2 — Reporte IFRS S2 agregado descargable por shipper

- **Trigger competitivo**: NCG 519 obliga IFRS S2 desde FY 2026. Ningún competidor entrega un reporte listo. Hoy el equipo Sustainability del shipper compila Excel a mano o paga consultoría USD 5-20k/año.
- **Outcome**: dashboard "ESG Reporting" en el rol Stakeholder/Sustainability (ADR-004) que genera con un click: PDF firmado + CSV crudo + JSON + XBRL (formato ISSB) con todos los certificados PADES del período (mes/trimestre/año), agrupados por categoría Scope 3.4/3.9 (upstream/downstream transport).
- **Dependencias**: ADR-004 (rol Stakeholder), ADR-008 (PWA), ADR-016 (GLEC), `packages/ai-provider` opcional para narrativa textual del reporte.
- **Anti-scope**: NO somos auditores; el reporte tiene los datos firmados pero la opinión la da el auditor del cliente (KPMG/EY/PwC/Deloitte). NO incluye Scope 1/2 del cliente — solo Scope 3 transporte.
- **ADR sugerido**: 018 — Formato y disclaimers del reporte IFRS S2 generado por Booster.

#### F3 — Tier Booster Premium con device Teltonika incluido (REESCRITO post-D5)

> ⚠️ **Modelo cambió 2026-05-05** (PO decisión D5): el subsidio Teltonika **ya no es programa standalone con amortización 5% comisión**. Ahora es **beneficio del tier Premium** del modelo de membresías del carrier ratificado en [ADR-026](../adr/026-carrier-membership-tiers-and-revenue-model.md). Esta feature implementa el lado "Premium tier + entrega del device" del modelo; F11 implementa la infraestructura de membresías subyacente.

- **Trigger competitivo**: alianza directa Booster ↔ Teltonika ([memoria proyecto](file:///Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/project_teltonika_alliance.md)) + modelo de membresías ADR-026 habilitan diferencial defensible. BlackGPS (reseller) no puede igualar el precio fabricante; Carga Inteligente / Avancargo / Liftit no tienen modelo de membresías escalonado.
- **Outcome**: el carrier que se afilia al tier **Booster Premium** (~CLP 120k/mes) recibe device Teltonika + instalación + 12 meses SIM con datos. Booster cubre USD ~440 año 1 por carrier; ingreso anual Premium USD ~1.536 → margen positivo desde mes 4 de retención. Up-grade y down-grade gestionados por F11 (billing engine).
- **Dependencias**: F11 (billing engine + membresías), ADR-005 (Teltonika Codec8), ADR-026 (membresías), `packages/shared-schemas/src/domain/onboarding.ts` para ciclo de vida del fulfillment del device (orden → envío → instalación → activación → kill switch si churn).
- **Anti-scope**: NO somos importador formal de hardware (partner logístico); NO crédito al carrier (no fintech); NO incluimos hardware no-Teltonika; NO subsidio fuera del tier Premium.
- **ADR vinculado**: [ADR-019](#) (a producir, scope reducido a fulfillment + kill switch técnico) + [ADR-026](../adr/026-carrier-membership-tiers-and-revenue-model.md) (modelo de membresías, ya Accepted).

---

### P1 — Pricing + trust; alinean economía y reducen fricción de adopción

#### F4 — Pricing engine empty-return aware con explicación al usuario

- **Trigger competitivo**: brokers tradicionales (Avancargo, Liftit) son opacos sobre el spread; Fleteretorno/Carga Inteligente cobran flat 10-15% sin diferenciar. Ninguno **explica al shipper por qué un precio es bajo**.
- **Outcome**: cuando una oferta de transportista es menor por aprovechar un retorno, la UI del shipper muestra: "Este precio incluye un descuento de X% porque el camión retornaba vacío a tu destino. CO₂ evitado estimado: Y kg. [Ver metodología]". Pricing engine en `packages/pricing-engine` ya existe — extenderlo con flag `is_backhaul_optimized`.
- **Dependencias**: ADR-004, `packages/pricing-engine`, `packages/matching-algorithm`, F1 (certificado de evitado para cerrar el loop con una métrica concreta).
- **Anti-scope**: NO predicción ML de precios óptimos (eso es F* futuro); NO subasta inversa entre transportistas (mantener Uber-like push directo per ADR-004).
- **ADR sugerido**: refresh menor a ADR-004 si el modelo Uber-like no contemplaba esta variante visible al shipper.

#### F5 — Tier de comisión por volumen del shipper

- **Trigger competitivo**: Fleteretorno tiene comisión escalonada (15% < 20 envíos/mes < 10% < 30/mes < tarifa fija). ADR-009 indica "comisión transaccional" como modelo Booster pero sin tiers. Lock-in del shipper de alto volumen es defensa competitiva clásica.
- **Outcome**: tabla de tiers en `packages/pricing-engine/src/commission.ts` con: free tier (primeros N envíos para nuevos shippers), comisión decreciente por volumen mensual rolling, tier enterprise con fee fijo + SLA. Visible públicamente en el sitio (transparencia es parte del posicionamiento).
- **Dependencias**: `packages/pricing-engine`, base de datos de viajes históricos por shipper (Drizzle), página pública en `apps/web` o `apps/marketing-site` (ADR-010).
- **Anti-scope**: NO descuentos por categoría de carga, NO precios negociados ad-hoc en MVP (mantener simple), NO tier basado en behavior ESG (eso es F10).
- **ADR sugerido**: 020 — Tiers de comisión por volumen y transparencia pública.

#### F6 — Trust score combinado del transportista visible pre-match

- **Trigger competitivo**: Camiongo (ADR-009) y otros marketplaces ocultan info del transportista hasta que el shipper acepta — el shipper compra "a ciegas". BlackGPS expone telemetría pero no rating. **Nadie combina rating + telemetría histórica + cumplimiento DTE en un score único pre-match**.
- **Outcome**: cada transportista tiene un Trust Score (0-100) calculado con: (a) rating promedio shippers, (b) % viajes completados sin incidentes, (c) % entregas a tiempo derivadas de telemetría real, (d) % DTE generados sin issues, (e) tiempo de respuesta a ofertas. Score visible al shipper en el flujo de aceptación + composición del score auditable.
- **Dependencias**: ADR-005 (telemetría), ADR-007 (DTE), ADR-008 (PWA — vista del shipper), `packages/trust-score` nuevo o módulo en `packages/matching-algorithm`.
- **Anti-scope**: NO score de crédito del transportista (no somos fintech); NO publicación pública de ratings individuales por nombre (privacidad); NO score derivable de PII sensible (RUT, conducir, etc.).
- **ADR sugerido**: 021 — Trust Score: composición, visibilidad, y privacidad.

---

### P2 — Trinchera local; defensivos frente a entrantes extranjeros

#### F7 — DTE + Carta Porte fully-automatic al cierre del viaje

- **Estado auditado 2026-05-05**: `NOT_STARTED`. ADR-007 está aceptado y detallado pero `packages/dte-provider`, `packages/carta-porte-generator`, `apps/document-service` y `packages/trip-state-machine` son scaffolding (placeholder index.ts + package.json sin deps). Cero integración con SII, cero generación de PDF. Requiere `/spec` fresca. **Bloqueante**: decisión Product Owner sobre proveedor SII (ADR-007 recomienda Bsale pero contrato no firmado) + sandbox credentials disponibles.
- **Trigger competitivo**: ADR-007 ya cubre la decisión arquitectónica. Trinchera defensiva más importante frente a Tennders/Avancargo/Liftit que no pueden replicar sin compromiso ingeniería de meses con SII.
- **Outcome**: al estado `delivered_confirmed` del trip state machine, el sistema emite automáticamente: (1) DTE Guía de Despacho válida ante SII, (2) Carta de Porte Ley 18.290 con código QR. Ambos descargables por las partes y archivados con retention legal (6 años).
- **Dependencias**: ADR-007, `packages/dte-provider`, `packages/carta-porte-generator`, `apps/document-service`. Validar SII production credentials.
- **Anti-scope**: NO factura electrónica del viaje (ese es DTE separado, fuera de scope inicial); NO emisión de retenciones laborales del transportista; NO integración inmediata con Aduanas (eso es feature export).
- **ADR sugerido**: ninguno nuevo si ADR-007 ya cubre — sí actualizar status del ADR con timestamp de implementación cuando esté operativo.

#### F8 — WhatsApp flujo transaccional completo (no solo notificaciones)

- **Estado auditado 2026-05-05**: `PARTIAL_NOTIFICATIONS_ONLY` (~15% del scope ADR-006). Existe `apps/whatsapp-bot` con webhook Hono + `packages/whatsapp-client` dual (Meta + Twilio), pero la implementación actual está **hardcoded a Twilio** (ADR-006 especifica Meta Cloud API) y solo cubre el flujo *shipper create_order* via XState (greeting → origin → destination → cargo type → submit). **Cero implementación carrier-side**: no hay accept/reject offer, ni POD upload, ni confirm delivery, ni report incident. `packages/trip-state-machine` y `packages/ai-provider` (NLU) son placeholders. Requiere `/spec` fresca + refresh ADR-006 sobre dilema Twilio-MVP-vs-Meta-target.
- **Trigger competitivo**: ADR-006 establece WhatsApp como canal primario. Necesitamos: aceptar/rechazar oferta, subir foto guía firmada (POD), confirmar entrega, reportar incidencia — **todo desde WhatsApp**, sin abrir la PWA. Ningún competidor hispanohablante tiene esto (Avancargo tiene DriverApp, Liftit app propia, Tennders no LATAM).
- **Outcome**: bot WhatsApp con NLU (Meta Cloud API + LLM intent classifier) que mapea mensajes/imágenes a acciones del trip state machine. Fallback a la PWA solo cuando estrictamente necesario (firma manual, edición de campos largos).
- **Dependencias**: ADR-006, `apps/whatsapp-bot`, `packages/whatsapp-client`, `packages/trip-state-machine`, `packages/ai-provider` para NLU.
- **Anti-scope**: NO chat humano-a-humano shipper↔driver vía Booster (privacidad + escalación de soporte); NO grupos WhatsApp; NO video/voz; NO operaciones críticas que requieran UI rica (firma electrónica, mapa interactivo).
- **ADR sugerido**: refresh ADR-006 si scope actual era notificaciones-only.

---

### P3 — Compliance + escalamiento; preparan expansión y enterprise

#### F9 — API pública shipper-side para integración con TMS/ERP

- **Trigger competitivo**: SimpliRoute tiene SAP/Oracle NetSuite/Magento/VTEX. Drivin tiene ISO 27001 + integraciones enterprise. Carga Inteligente, Avancargo, Liftit no las tienen visibles. **Vender a un retailer grande (Cencosud, Walmart Chile, Falabella) requiere integración con su TMS/ERP** — sin API pública el deal no cierra.
- **Outcome**: REST API pública versionada (v1) + SDK TypeScript con: publicar carga, consultar estado, descargar certificado, descargar DTE/Carta Porte, listar transportistas elegibles. Auth con API key + OAuth 2.0 para flujos delegados. OpenAPI 3 spec publicado. Rate limit + auditoría de uso.
- **Dependencias**: `apps/api`, ADR-001 (Hono), nuevo `packages/sdk-typescript`, decisión de auth (probablemente extiende lo de ADR-013 si ya existe pattern de DB access).
- **Anti-scope**: NO GraphQL en MVP (mantener REST simple); NO webhooks bidireccionales en V1 (solo polling); NO white-label (eso es feature enterprise distinta).
- **ADR sugerido**: 022 — API pública: versionado, auth, rate limit y deprecation policy.

#### F10 — Dashboard ESG histórico del shipper con benchmark sectorial

- **Trigger competitivo**: ningún competidor entrega al equipo Sustainability del shipper una vista histórica de su impacto. Es **feature de retention**: una vez que el shipper carga 6 meses de viajes, las métricas históricas son irreemplazables. Refuerza F2.
- **Outcome**: vista del rol Stakeholder/Sustainability con: (a) histórico mensual de % CO₂ evitado, (b) intensidad de emisiones (gCO₂e/t·km) vs benchmark sectorial publicado por industria (retail, minería, agroindustria), (c) ranking interno de carriers preferidos por eficiencia de carbono, (d) progreso vs meta de reducción anual auto-declarada.
- **Dependencias**: F2 (reportería), F1 (evitados), `packages/carbon-calculator`, `apps/web` rol Stakeholder, datos de benchmark sectorial (probablemente curados manualmente al inicio o derivados de reportes públicos sectoriales — fuente externa).
- **Anti-scope**: NO comparación entre shippers individuales nominales (compliance/competition); NO recomendaciones de "cambia a este carrier" automatizadas (decisión queda en el shipper); NO predicción ML de emisiones futuras.
- **ADR sugerido**: 023 — Benchmarking sectorial de emisiones: fuentes, actualización y disclaimers legales.

---

## Resumen y orden de ejecución sugerido

| Prioridad | Feature | Why ahora | Effort estimado | Dependencia bloqueante |
|---|---|---|---|---|
| P0 | F1 — Certificado empty-return CO₂ evitado | Diferencial único + sin equivalente regional | M (3-5 sprints) | BUG-013 cerrado |
| P0 | F2 — Reporte IFRS S2 descargable | NCG 519 vigente FY 2026 | M (3-5 sprints) | F1 + cert PADES operativo |
| P0 | F3 — Programa Teltonika Direct | Aprovecha alianza Teltonika; bloquea BlackGPS | L (5-8 sprints, incluye logística HW) | Acuerdo comercial Teltonika finalizado |
| P1 | F4 — Pricing empty-return aware UI | Cierra loop con F1 | S (1-2 sprints) | F1 |
| P1 | F5 — Tier comisión por volumen | Onboarding fricción cero PYME | S (1-2 sprints) | — |
| P1 | F6 — Trust Score combinado | Elimina compra "a ciegas" | M (3-4 sprints) | ADR-005 + ADR-007 operativos |
| P2 | F7 — DTE + Carta Porte automáticos | Trinchera defensiva | M-L (auditado NOT_STARTED, 5-7 sprints) | Decisión PO sobre proveedor SII (Bsale recomendado) + sandbox creds |
| P2 | F8 — WhatsApp flujo transaccional | Activación transportista | M (auditado 15% — refresh ADR-006 + 3-5 sprints) | Decisión Meta vs Twilio + NLU provider (Gemini/Claude via ai-provider) |
| P3 | F9 — API pública shipper-side | Habilita ventas enterprise | M (3-5 sprints) | Modelo de auth definido |
| P3 | F10 — Dashboard ESG histórico | Retention Sustainability | S-M | F1 + F2 |
| **P1** | **F11 — Engine de membresías + billing recurrente (NUEVA, post-ADR-026)** | **Habilita F3 Premium + revenue diversificado** | **L (5-7 sprints + integración pasarela)** | **Webpay Plus (CL) + Mercado Pago (multi-país) decididos 2026-05-06; tablas Drizzle Fase 0** |
| **P2** | **F12 — Pronto Pago / Factoring inverso al transportista (NUEVA 2026-05-06)** | **Diferencial vs Tennders ES (ya lo usa); fidelización lado oferta + revenue stream adicional; nadie en LATAM lo tiene formalizado** | **XL (8-12 sprints + capital de trabajo + análisis riesgo crediticio)** | **Decisión: capital propio vs partnership con factoring chilena (Tanner, Engie, BancoEstado Microempresas) vs licencia financiera Booster propia** |

**Mi recomendación de secuencia**: F1 → F2 → F4 → F3 (paralelo a F1/F2 si recursos lo permiten) → F6 → F5 → F7-validación → F8 → F9 → F10.

---

## Restricciones para el agente que ejecute

1. **No implementes sin spec aprobada por Felipe**. Cada feature dispara `/spec` separado.
2. **Cita siempre la fuente competitiva** en el spec (link a 001 ó 002 con #section).
3. **Si una feature requiere decisión arquitectónica nueva, propón el ADR antes de la spec** — no enterres decisiones en spec text.
4. **Respeta el stack ADR-001** (Hono, Drizzle, TanStack, Zod, Pino, OpenTelemetry, GCP). Cualquier nueva dep mayor → ADR.
5. **Type safety end-to-end** desde el primer schema Drizzle hasta el cliente. Si aparece un boundary sin Zod, créalo antes de seguir.
6. **Observabilidad desde el primer endpoint**: logs estructurados con correlationId, span OTel, métrica custom si aplica. No "se agrega después".
7. **Cero `any`, cero `console.*`, cero secretos**. Biome + gitleaks + pre-commit los bloquean — confirma antes de PR.
8. **Tests cubren ≥80%** de lo nuevo, bloqueante en CI desde el primer PR.
9. **Naming bilingüe** (CLAUDE.md): TS en inglés camelCase, SQL en español snake_case sin tildes, UI labels español natural.
10. **Cuando dudes**: pregunta al Product Owner antes de avanzar, no asumas.

---

## Cierre

Este brief es una propuesta consolidada del agente, no una decisión. **El Product Owner aprueba o ajusta antes de iniciar `/spec` por cada feature**. Cualquier cambio a este brief amerita un reporte 004 en lugar de editar este in-place (history matters).

**Próximo paso para Felipe**:
1. ~~Revisar las 10 features y el orden propuesto.~~ ✅ Aprobado 2026-05-05.
2. ~~Marcar las que tienen luz verde para `/spec`.~~ ✅ Todas P0→P3 en orden.
3. ~~Confirmar que F7 y F8 deben re-validarse.~~ ✅ Auditados — F7 NOT_STARTED, F8 PARTIAL_NOTIFICATIONS_ONLY (~15%). Ambos requieren `/spec` fresca + decisiones bloqueantes (proveedor SII para F7; Meta vs Twilio + NLU provider para F8).
4. ~~Decidir si F3 requiere acuerdo comercial Teltonika previo.~~ ✅ Acuerdo OK confirmado por PO 2026-05-05; F3 puede arrancar `/spec` sin esperar.
5. ~~Decidir creación de `playbooks/`.~~ ✅ Carpeta creada con [001-posicionamiento-competitivo.md](../../playbooks/001-posicionamiento-competitivo.md).

**Acciones pendientes que bloquean el inicio de `/spec` por feature**:

| Feature | Bloqueante | Decisión requerida del PO |
|---|---|---|
| F1 | BUG-013 (auditoría GLEC) cerrado | Aprobar factor WTW corregido a ~3.2-3.3 kgCO₂e/L (ver [docs/research/013-glec-audit.md](../research/013-glec-audit.md)) |
| F2 | F1 + cert PADES operativo | — (se desbloquea con F1) |
| F3 | Acuerdo Teltonika ✅ ya OK | Definir economics del programa: subsidio cubierto vs lease vs revenue-share |
| F4-F6 | Sin bloqueantes mayores | — |
| F7 | Decisión proveedor SII | Confirmar Bsale (recomendado en ADR-007) o evaluar alternativas (Paperless, Acepta) |
| F8 | Estrategia BSP | Definir: Twilio MVP + Meta migration roadmap, o Meta directo asumiendo costo onboarding |
| F9-F10 | Sin bloqueantes mayores | — |

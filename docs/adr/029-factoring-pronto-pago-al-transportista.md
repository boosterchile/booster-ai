# ADR-029 — Factoring / Pronto pago al transportista como diferenciador comercial

**Status**: Proposed
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes**: nada
**Related**:
- [ADR-027 Pricing model v1](./027-pricing-model-uniform-shipper-set-with-tier-commission-roadmap.md) §6 (declara que factoring se diseña en ADR separado cuando se activen los primeros 50 trips/mes liquidables)
- [ADR-026 Carrier membership tiers](./026-carrier-membership-tiers-and-revenue-model.md) (factoring escala como upsell del tier Premium)
- [ADR-007 Chile document management](./007-chile-document-management.md) (Guía de Despacho + Factura SII como instrumento factorizable)
- [ADR-024 SII provider Sovos](./024-sii-provider-sovos-with-multi-vendor-strategy.md) (DTE Tipo 33 / Tipo 52 que factura el carrier)
- Memoria: [project_payment_factoring_strategy.md](file:///Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/project_payment_factoring_strategy.md) (estrategia validada vs Tennders ES)
- Memoria: [project_current_state.md](file:///Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/project_current_state.md)

---

## Contexto

Los transportistas PYME en Chile sufren un problema operativo crónico: **flujo de caja**. Un viaje entregado y facturado a un shipper grande (retail, minería, agroindustria) suele cobrarse a 30/60/90 días según las condiciones del shipper. Mientras tanto el carrier ya pagó combustible, peajes, sueldo del conductor, mantención del vehículo. El gap entre "entregar" y "cobrar" es el primer determinante de quiebra de PYMEs logísticas en Chile (Banco Central CL, 2024 — referencia investigación pendiente de archivo).

Booster AI, al ser el **facturador del marketplace** (ADR-027 §3, ADR-024), tiene visibilidad end-to-end del momento exacto en que un trip se liquida (`confirmed_by_shipper` + DTE Tipo 52 emitido). Esto crea una oportunidad asimétrica que **competidores como BlackGPS, Mudafy, FlexMove, Carga Inteligente NO tienen** porque ninguno actúa como facturador. La oportunidad: ofrecer **pronto pago / adelanto de factoring** al carrier dentro de 24-72h post-entrega, descontando del shipper a 30/60d a través de un partner financiero o capital propio.

El precedente comercial existe: **Tennders (España)** lo ofrece como diferenciador clave con tasas 1.5-3.5% del monto adelantado, y reporta 18% MoM growth en adopción del feature (públicamente, blog Tennders Q3 2024 — referencia archivable a captura). Ese diferencial generó tracción suficiente para que Tennders pivoteara su modelo a "marketplace + fintech" en lugar de solo marketplace.

A 2026-05-10 Booster AI **no opera monetizado** (ADR-027 declara explícitamente "modo demostración no monetizado" hasta que se cumplan criterios de activación). Este ADR es **prospectivo**: define el modelo, las decisiones técnicas anticipadas y los criterios de activación para que cuando llegue el momento (post-50 trips/mes liquidables) la implementación sea inmediata.

---

## Decisión

Adoptar **factoring/pronto pago al transportista** como **producto financiero opcional**, integrado al marketplace pero comercializado como upsell separado. Modelo:

### 1. Producto: "Booster Cobra Hoy"

Servicio opt-in del carrier, activable per-trip o como standing order:

- Carrier completa entrega → DTE Tipo 52 emitido al shipper.
- Carrier ve botón "Cobra hoy" en `/asignaciones/:id` (frontend nuevo).
- Click → desglose claro:
  - Monto trip: `$X CLP`
  - Comisión Booster (per ADR-026 tier): `$C CLP` (deducción siempre)
  - Tarifa pronto pago: `$F CLP` (% sobre el neto)
  - **Recibís hoy**: `$X − $C − $F CLP`
- Carrier confirma → Booster transfiere a su cuenta (PSP partner) en ≤24h hábiles.
- Booster cobra al shipper en la fecha original del DTE (30/60/90d). Diferencia = ingreso financiero de Booster.

### 2. Tarifas del pronto pago

Estructura simple y transparente (alineado con ADR-027 §"sin gaming"):

| Plazo original del shipper | Tarifa pronto pago |
|---|---:|
| 30 días | 1.5% del neto |
| 45 días | 2.2% |
| 60 días | 3.0% |
| 90 días | 4.5% |

Cobramos sobre el `monto_neto_carrier_clp` (post-comisión), no sobre `agreedPriceClp` bruto. Esto:
- Mantiene la comisión Booster (ADR-026) intacta como revenue independiente del producto financiero.
- Hace transparente al carrier que **2 cobros distintos** ocurren (operacional vs financiero).
- Permite que el carrier compare con factoring tradicional (banco, cooperativa, otra fintech) — Booster compite con tarifa.

**No hay tarifa adicional por urgencia (24h vs 72h)** porque el ROI de Booster es financiero (curve premium del shipper), no operacional. Más rápido = mejor experiencia, mismo costo para Booster.

### 3. Riesgo crediticio: 100% sobre el shipper, 0% sobre el carrier

**Booster asume el riesgo de no-pago del shipper**, no del carrier. Esto es deliberado:
- El carrier ya entregó. Booster ya tiene el DTE Tipo 52 cesionable.
- El shipper tiene contrato comercial con Booster (no con el carrier directamente; ADR-027 §3 facturador).
- Cobranza efectiva del shipper es responsabilidad de Booster (o del partner financiero a quien se factoriza).

**Underwriting del shipper** previo al onboarding:
- Score crediticio Equifax/Sentinel/Dicom (vía API CMF-aprobada).
- Antigüedad operacional ≥2 años + RUT activo SII + sin morosidad CMF.
- Límite de exposición revolving por shipper (ej. máximo `$50M CLP` neto adelantado simultáneo). Excedido el límite, "Cobra hoy" se bloquea para nuevos trips de ese shipper hasta que el shipper pague.

Shippers no-aprobados pueden seguir usando el marketplace **sin la opción de pronto pago para sus carriers** (carriers cobran a la fecha original). Esto NO es exclusión del marketplace — es exclusión del producto financiero.

### 4. Capital del programa: partner financiero, no balance sheet propio

Booster NO es banco ni intermediario financiero regulado por CMF. El capital de cada adelanto viene de:

**Opción A (preferida) — Partner factoring SaaS chileno**:
- Toctoc, Mafin, Increase, Cumplo, Bci Factoring, Chita son nombres con APIs de cesión electrónica de DTE.
- Booster opera como originador / "cara visible" del producto. Cobra una comisión técnica al partner por el origin (típicamente 0.3-0.5% del monto cedido) y el partner mantiene la diferencia con la tarifa al carrier.
- Ventajas: 0 capital propio, 0 regulación CMF, 0 riesgo balance.
- Desventajas: dependencia operacional + tarifa para el carrier es algo más alta que si Booster financiase con su capital.

**Opción B (complementaria, post-3 meses opt-in si la opción A no es competitiva)** — Línea de crédito propia con banco:
- Booster establece línea de crédito revolving con banco partner (BCI, Itaú, Santander) garantizada por la cesión de DTEs.
- Tarifa al carrier baja ~0.5pp (1.5% → 1.0% a 30d, etc.) — mejor competencia.
- Booster asume cierto float pero con riesgo crediticio limitado al underwriting del shipper.
- Decisión de activar opción B requiere ADR superseding (no parte de este ADR).

**Decisión inicial**: opción A. Iniciar conversaciones con 2-3 partners (al menos 1 con API REST production-ready) en paralelo. Sin capital propio, sin regulación nueva.

### 5. Cumplimiento legal Chile

- **Ley 19.983** (Mérito Ejecutivo de Factura): la factura electrónica + DTE acreditación de cesión es título ejecutivo. Cesión a Booster (o partner) debe registrarse en el RPCV (Registro Público de Cesiones de Crédito) del SII. Sovos / partner gestiona esto vía API.
- **Anti-money laundering (Ley 19.913)**: KYC del carrier al onboarding (RUT + verificación SII + dueño identificado), KYC del shipper, monitoreo de transacciones inusuales (UAF reportable >USD 10k).
- **CMF Reg General N°449**: aplica a "casas de pago" reguladas. Como Booster opera SOLO en partner mode (opción A), NO entra al ámbito CMF. Si pivotea a opción B con capital propio, requiere consulta legal previa (probable inscripción como "operador de tarjetas" o similar).
- **Tributación**: la diferencia entre "monto adelantado al carrier" y "monto cobrado al shipper" es ingreso financiero de Booster. IVA exento (operación financiera Art. 12-E DL 825). Impuesto Renta normal.

### 6. Estructura técnica

| Componente | Ubicación | Responsabilidad |
|---|---|---|
| **Cálculo de tarifa** | `packages/factoring-engine/src/tarifa.ts` | función pura `calcularTarifaProntoPago({ monto_neto, plazo_dias, shipper_score })`. Tests >95% coverage. |
| **Underwriting shipper** | `packages/factoring-engine/src/underwriting.ts` | función pura `evaluarShipper({ rut, equifax, sii_status })` → `{ approved, limit_clp, expires_at }`. Decisión cacheada 30 días. |
| **Estado del adelanto** | `apps/api/src/db/schema.ts` (nueva tabla `adelantos_carrier`) | UUID, trip_id, carrier_id, monto_adelantado, tarifa, partner_id, estado (`solicitado | aprobado | desembolsado | cobrado_a_shipper | mora`), fechas. |
| **Cesión electrónica DTE** | `apps/document-service/src/cesion-dte.ts` | wrapper sobre Sovos cesión API per shipper-side DTE. |
| **Partner integration** | `packages/factoring-partner-toctoc.ts` (o nombre del partner) | cliente HTTP del partner factoring (cesión, desembolso, status). |
| **Service de orquestación** | `apps/api/src/services/cobra-hoy.ts` | flow completo: trigger desde POST /me/asignaciones/:id/cobra-hoy → underwriting check → cesión DTE → desembolso partner → INSERT adelantos_carrier. |
| **Frontend UI** | `apps/web/src/routes/asignacion/$id.tsx` (botón + modal de confirmación) + `apps/web/src/routes/me/cobra-hoy/index.tsx` (historial) | UX simple: 1 botón, 1 confirmación, 1 status tracker. |

### 7. Estado actual: NO implementar todavía

Este ADR es `Proposed`, no `Accepted`. La implementación queda **bloqueada** hasta:

- [ ] ADR-027 v2 implementado y operativo (cobro de comisión activo por ≥3 meses)
- [ ] ≥50 trips liquidados/mes durante ≥3 meses consecutivos
- [ ] Al menos 1 partner factoring (toctoc/mafin/increase/cumplo) con LOI firmado y sandbox API funcional
- [ ] Underwriting de ≥10 shippers prototipo aprobados
- [ ] Tarifas confirmadas con partner (puede que el cuadro §2 cambie)
- [ ] Marketing/legal: T&Cs específicas para "Booster Cobra Hoy" firmadas digitalmente al opt-in
- [ ] OpEx aceptable: tasa de aprobación shipper ≥70% (si menor, el producto no genera adopción suficiente)

Cuando estos criterios se cumplan, el PO aprueba este ADR (cambia status a `Accepted`) y se inicia el sprint de implementación (estimado 6-8 semanas).

---

## Consecuencias

### Positivas

- **Diferenciador comercial único en LATAM** vs BlackGPS, Mudafy, FlexMove, Carga Inteligente, Frete.com (ninguno es facturador, ninguno puede ofrecer adelanto sobre DTE).
- **Revenue stream secundario** sustancial. Estimación conservadora: 30% de carriers activos opt-in × 1.5-4.5% tarifa promedio × volumen liquidado = ingreso financiero comparable a la comisión transaccional cuando el marketplace madure.
- **Lock-in carrier**: carriers que dependen del cash flow inmediato no migran a competidores que les cobran 30-60d.
- **Datos crediticios**: Booster acumula histórico de pagos shipper-by-shipper, vital para refinar underwriting + opcionalmente vender data agregada anonymizada (data product B2B, futuro).
- **Sin reinvención** de fintech: opción A delega operación regulada al partner.

### Negativas / costos

- **Dependencia operacional** del partner. Si el partner cae u opera con SLA bajo, "Booster Cobra Hoy" se cae. Mitigación: 2 partners activos en paralelo (failover).
- **Fricción legal del onboarding shipper**: shippers grandes no aceptan terms de cesión sin negociación. Mitigación: empezar con shippers SME (que tienen tarifas peores con factoring tradicional, mayor incentivo).
- **Costo de underwriting**: cada shipper nuevo requiere consulta Equifax/Sentinel/Dicom que tiene costo (USD 1-3 por consulta). Mitigación: caché 30 días + threshold mínimo de "trips esperados" antes de underwriting (no underwrite shippers que tendrán &lt;3 trips).
- **Riesgo reputacional** si un shipper no paga y Booster reclama judicialmente — mancha la relación con el ecosistema. Mitigación: políticas de cobranza pre-judicial estrictas + comunicación proactiva.
- **CapEx en compliance**: KYC/AML automatizado, RPCV integration, partner integration, son ~3 meses de eng + USD 5-10k/año en SaaS.

### Riesgos abiertos a futuro

| Riesgo | Mitigación propuesta |
|---|---|
| **Regulación CMF cambia** y exige inscripción como operador financiero | Quedarse en opción A (partner) hasta que el volumen justifique. Consulta legal previa a opción B. |
| **Partner factoring quiebra** | Diversificación: 2 partners activos. Failover documentado en runbook. |
| **Default rate &gt; 3% del volumen adelantado** (el partner no cubre defaults; Booster los come) | Underwriting ajustado mes a mes con feedback del partner. Threshold de exposición por shipper. |
| **Competencia replica el feature** | First-mover advantage 12-18 meses (Tennders ES tomó eso para tener 70% market share factoring transport ES). Booster tiene además el certificado ESG como segundo diferenciador no-replicable. |

### Acciones derivadas (cuando se active)

1. **Spec técnica detallada** en `docs/specs/cobra-hoy-v1.md` (post-aprobación).
2. **Migration `0010_adelantos_carrier.sql`** con tabla + índices + constraints + RLS.
3. **`packages/factoring-engine`** con tests unit (tarifa pura) + integration (con sandbox del partner).
4. **`apps/document-service`** wire de cesión DTE (out-of-stub).
5. **Endpoints**:
   - `POST /me/asignaciones/:id/cobra-hoy` (request adelanto)
   - `GET /me/asignaciones/:id/cobra-hoy/cotizacion` (preview de tarifa, antes de confirmar)
   - `GET /me/cobra-hoy/historial` (lista de adelantos del carrier)
   - `GET /admin/adelantos` (admin Booster, vista global)
6. **UI carrier**: botón en `/asignaciones/:id` + flow modal + página historial.
7. **Métricas**:
   - `factoring.adelantos_solicitados_dia` / `aprobados_dia` / `desembolsados_dia` (counters)
   - `factoring.monto_adelantado_clp_total_mes` (sum)
   - `factoring.tarifa_promedio_pct_mes` (gauge)
   - `factoring.aprobacion_rate_underwriting_shipper_mes` (% aprobados)
   - `factoring.default_rate_volumen_adelantado_mes` (% no-pago shipper)
   - `factoring.tiempo_solicitud_a_desembolso_horas` (P50/P95)
8. **Runbook `docs/runbooks/cobra-hoy-disputas.md`**: cobranza pre-judicial, partner failover, ajuste de underwriting.

---

## Validación

- [ ] Memoria `project_payment_factoring_strategy.md` confirma estrategia
- [ ] ADR-027 referencia este ADR en §"Acciones derivadas §3" (pendiente de update post-merge)
- [ ] Status: **Proposed** — NO implementar hasta criterios de activación cumplidos
- [ ] Próxima revisión: cuando ADR-027 v2 esté Accepted o cuando el primer partner LOI sea firmado, lo que ocurra primero

---

## Notas

- Este ADR es **estratégico**, no implementacional. Cierra el ciclo de monetización futura empezando con: (1) ADR-027 pricing v1 → no monetizado hoy, (2) ADR-027 v2 cobro de comisión → cuando se cumplan criterios, (3) ADR-029 factoring → cuando el cobro esté establecido.
- La memoria del PO sobre Tennders ES es **explícitamente** la inspiración. La diferencia es que Booster ya nace como facturador (ADR-024 + ADR-027), Tennders pivoteó después.
- Cualquier cambio del modelo (tarifas, partners, opciones A/B/C) requiere ADR superseding.
- Cuando se active, este ADR es candidato fuerte para auditoría externa pre-launch (firma de un legal CMF + un consultor financiero) — el costo (~USD 10-15k) es trivial vs el riesgo regulatorio.

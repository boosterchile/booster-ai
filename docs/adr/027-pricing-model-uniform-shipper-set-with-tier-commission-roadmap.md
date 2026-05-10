# ADR-027 — Modelo de pricing v1: uniform shipper-set + comisión y billing diferidos a v2

**Status**: Accepted
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes**: nada (formaliza retroactivamente el modelo de pricing implementado en `apps/api` y declara qué está fuera de v1).
**Related**:
- [ADR-004 Modelo Uber-like y roles](./004-uber-like-model-and-roles.md) (define la noción de marketplace shipper↔carrier)
- [ADR-023 Matching algorithm v1](./023-matching-algorithm-v1-greedy-capacity-scoring.md) (matching usa `proposedPriceClp`, no influye sobre él)
- [ADR-026 Carrier membership tiers](./026-carrier-membership-tiers-and-revenue-model.md) (define los tiers cuya comisión escalonada es out-of-scope de v1)
- [ADR-024 SII provider Sovos](./024-sii-provider-sovos-with-multi-vendor-strategy.md) (DTE/Guía de Despacho con monto del viaje)
- [ADR-007 Chile document management](./007-chile-document-management.md) (trigger de liquidación)
- Memoria: [project_payment_factoring_strategy.md](file:///Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/project_payment_factoring_strategy.md) (factoring/pronto pago como diferenciador futuro)

---

## Contexto

Cualquier marketplace requiere modelo de pricing explícito antes de procesar dinero real. A 2026-05-10 Booster AI tiene:

- **Implementado** en `apps/api`:
  - `trips.proposedPriceClp` (nullable, integer CLP) — sugerido por shipper al crear el request
  - `offers.proposedPriceClp` (notnull, copia del trip al crear oferta)
  - `assignments.agreedPriceClp` (notnull, copia de la offer al aceptar)
  - Flujo: shipper sugiere → matching propaga el precio idéntico a las N ofertas → primera aceptación congela el precio en el assignment
- **No implementado**:
  - **Comisión Booster** (% del marketplace): cero columnas en BD, cero código de cálculo, cero tests
  - **Billing engine**: cobro recurrente de membership fees, dunning, prorrateo — `packages/pricing-engine` y un futuro `packages/billing-engine` son ambos stubs/inexistentes
  - **Pricing dinámico** (distancia, surge, scarcity, descuento empty-backhaul) — sólo descrito en ADR-004
  - **Negociación post-match**, **penalty por cancelación**, **descuento por backhaul** al shipper, **multi-currency**
  - **Liquidación al carrier** (transfer/factoring/pronto pago)
- **Decidido en otros ADRs pero no realizado**:
  - ADR-026 §2 define 4 tiers (`Free 12% / Standard 9% / Pro 7% / Premium 5%`) + fees mensuales (`$0 / $15k / $45k / $120k`). Tablas `membership_tiers` + `carrier_memberships` no creadas.
  - ADR-024 establece Sovos como provider SII; emisión real pendiente.
  - ADR-007 establece que la liquidación se dispara al `confirmed_by_shipper`.

Sin un ADR de pricing existe el riesgo de:

1. **Cobrar antes de tiempo** sin trazabilidad (ej. agregar columna `commission_amount` en una migration sin discusión y "facturar" la comisión sin DTE válido).
2. **Liquidar mal al carrier** porque no hay claridad sobre quién es el "facturador" (Booster cobra al shipper y paga al carrier, vs Booster es passthrough donde shipper paga directo al carrier).
3. **Dispersión de lógica de pricing** en services en lugar de un package puro testeable.
4. **Discrepancia con SII** (DTE Guía de Despacho debe declarar monto consistente con `agreedPriceClp`).

Este ADR cierra el modelo v1 (lo que está vivo + lo que NO está) y declara la secuencia mínima para llegar a v2 antes de monetizar.

---

## Decisión

### 1. Modelo de pricing v1: uniform shipper-set, no negociación, no comisión cobrada

**Reglas firmes (vigentes hoy)**:

1. **Shipper sugiere precio** al crear el `trip_request`:
   - Campo `proposed_price_clp` opcional (nullable, integer CLP, `>= 0`).
   - Si null: el sistema usa `0` como precio propuesto en la oferta (señal de "carrier propone").
   - Validado por `packages/shared-schemas/src/trip-request-create.ts` con Zod.
2. **Matching propaga precio idéntico** a las N ofertas:
   - `runMatching()` (en `apps/api/src/services/matching.ts:196-211`) copia `trip.proposedPriceClp ?? 0` a cada `offers.proposedPriceClp`.
   - El precio NO entra al scoring (ver ADR-023 §1) — todas las ofertas para un trip tienen el MISMO precio.
3. **Aceptación congela el precio** en el assignment:
   - `acceptOffer()` (en `apps/api/src/services/offer-actions.ts:122`) copia `offer.proposedPriceClp` a `assignments.agreedPriceClp`.
   - **No hay negociación post-match**. El primer carrier que acepta acepta el precio tal cual.
4. **Booster NO cobra comisión en v1**.
   - No existe columna `commission_amount` ni `commission_rate` en BD.
   - No se emite DTE en este momento. La operación es de "demostración + telemetría" (Wave 1-3 sin facturación).
   - Carriers reciben asignaciones gratis. Shippers no pagan a Booster (sólo al carrier por fuera del marketplace, mecanismo informal).

**Reglas firmes (NO vigentes en v1; explícitamente excluidas)**:

| Regla | Excluida porque |
|---|---|
| Surge / scarcity pricing dinámico | Sin volumen para calibrar señal de demanda; cualquier coeficiente sería arbitrario |
| Descuento empty-backhaul al shipper | Requiere que el matching marque `is_backhaul_optimized=true` antes del precio (out-of-order respecto al diseño actual, donde matching no conoce este factor) |
| Multi-currency | Operación 100% Chile, CLP único; introducir USD/USDT antes de necesitarlo es complejidad gratis |
| Penalty / refund por cancelación | Sin contratos firmados con carriers que aceptarían descuento; tema legal antes que técnico |
| Negociación post-match | Cambia la semántica de `acceptOffer` (no es atómico) y abre superficie de gaming |

### 2. Cuándo se cobra: trigger explícito de "liquidación"

Definimos **liquidación** como el momento en que se calcula el monto final, se emite DTE (vía Sovos, ADR-024), y se prepara payout al carrier. Hoy ese momento NO ocurre; cuando ocurra (v2), será disparado por:

```
trip.status === 'entregado'
  AND assignment.confirmed_by_shipper IS NOT NULL
  AND no hay disputa abierta
  → emitir liquidacion(assignmentId)
```

`liquidacion()` será una función pura (en `packages/pricing-engine/`) que dado `(assignment, carrier_membership_tier)` devuelve:

```typescript
type Liquidacion = {
  monto_bruto_clp: number;            // = assignment.agreedPriceClp
  comision_pct: number;                // = tier.commission_pct (12/9/7/5)
  comision_clp: number;                // = round(monto_bruto * comision_pct / 100)
  monto_neto_carrier_clp: number;      // = monto_bruto - comision_clp
  iva_comision_clp: number;            // = round(comision * 0.19) — Chile IVA 19%
  total_factura_booster_clp: number;   // = comision + iva_comision (lo que Booster factura al carrier)
  fecha_liquidacion: Date;
  tier_aplicado: 'free' | 'standard' | 'pro' | 'premium';
};
```

Esta forma garantiza:
- **Sin dispersión**: la única fuente de verdad de comisión es esta función + tabla `carrier_memberships`.
- **Auditable**: dado un `assignmentId` se puede recomputar la liquidación y comparar con la persistida.
- **Independiente del flujo de cobro**: la liquidación es un cálculo; el cobro real (transferencia, factoring) lo hace `billing-engine` aparte.

### 3. Booster es facturador (no passthrough)

Cuando se active liquidación (v2), Booster:
- **Emite DTE Tipo 33 (Factura Electrónica)** al carrier por el monto `total_factura_booster_clp` (comisión + IVA).
- El carrier es **emisor de la Guía de Despacho Tipo 52** al shipper por `agreedPriceClp` (Booster lo emite *en nombre de* via Sovos con certificado del carrier — ver ADR-024 y ADR-007).
- El **flujo de dinero** (v2): shipper paga al carrier por el `agreedPriceClp` (mecanismo TBD: transferencia directa o escrow Booster); Booster factura al carrier por la comisión.

Esto se justifica porque:
- Carriers PYME no quieren que Booster les retenga "su" plata (rechazo cultural a marketplaces escrow).
- Comisión de Booster es un servicio profesional facturable con IVA, no parte de la operación logística.
- Mantiene a Booster fuera del régimen de "casa de pago" / fintech regulada por CMF.

**Excepción identificada (memoria `project_payment_factoring_strategy.md`)**: existe una oportunidad de "pronto pago al transportista" (Booster adelanta el `agreedPriceClp` × `(1 - factoring_fee)` al carrier dentro de 24-72h, descontando del shipper a 30/60 días). Esto es **revenue stream adicional + diferenciador competitivo (Tennders ES lo hace)**. Diseñar bajo un ADR-029 separado cuando se activen los primeros 50 trips/mes liquidables.

### 4. Estructura técnica obligatoria

Cuando se implemente v2 (criterios al final), debe respetarse:

| Componente | Ubicación | Contrato |
|---|---|---|
| **Cálculo de liquidación** | `packages/pricing-engine/src/liquidacion.ts` | función pura, sin I/O, 100% testeable |
| **Tablas de tiers** | `apps/api/src/db/schema.ts` (tablas `membership_tiers`, `carrier_memberships`) | per ADR-026 §2-§5 |
| **Cobro recurrente (membership fees)** | `packages/billing-engine/` | Cloud Scheduler → cron mensual → `cobrarMembership(empresaId, mes)` |
| **DTE emisión** | `apps/document-service/` (hoy stub) | wrapper Sovos per ADR-024 |
| **Service de liquidación** | `apps/api/src/services/liquidar-trip.ts` | orquesta: lookup tier, llamar `liquidacion()`, persistir, emitir DTE |
| **Tests** | `packages/pricing-engine/test/`, `packages/billing-engine/test/` | mín. 30 tests cubriendo cada tier × edge cases (precio 0, slack, IVA round, etc.) |

**Prohibido**: lógica de pricing inline en `apps/api/src/routes/` o `services/`. Todo cálculo de dinero pasa por `pricing-engine`.

### 5. Versionado de la metodología de pricing

Toda liquidación persistida lleva `pricing_methodology_version` (string semver, ej. `pricing-v2.0-cl-2026.06`). Espejo de ADR-021 para emisiones:

- `MAJOR`: cambio de modelo (ej. uniform → auction)
- `MINOR`: cambio de tier table (nuevos tiers, % distinto)
- `PATCH`: corrección de bug sin impacto en monto >0.5%

Liquidaciones emitidas quedan con su `pricing_methodology_version` original; cambios futuros no las re-emiten. Auditable end-to-end vs facturas SII.

### 6. Estado actual = "demostración no monetizada", explícitamente

Este ADR **declara** que la operación a 2026-05-10 es:
- **No monetizada** desde el punto de vista de Booster (cero comisión cobrada, cero membership fee cobrado).
- **Habilitada** desde el punto de vista del marketplace (matching, telemetría, certificados ESG funcionan; los carriers entregan; los shippers reciben certificados).
- **No facturable** desde el punto de vista SII (cero DTE emitidos vía Sovos en producción).

Cualquier cambio de monetización requiere ADR explícito + acción contractual (T&Cs actualizadas, consent del carrier al cargo).

---

## Consecuencias

### Positivas

- **Cero deuda fiscal**: no hay liquidaciones huérfanas ni cobros sin DTE.
- **Pricing controlado en un solo lugar futuro**: `packages/pricing-engine`. Imposible que dos services calculen comisiones distintas.
- **Carriers no perciben fricción de cobro en piloto**: incentiva onboarding gratis para Wave 1-3.
- **Negociación cero gaming**: precio fijo desde el shipper, todos los carriers ven el mismo número, primer en aceptar gana.
- **Ruta clara a factoring** como diferenciador comercial vs BlackGPS / Mudafy / FlexMove (memoria menciona Tennders ES como referencia validada).
- **Compatibilidad con ADR-024 + ADR-007**: el trigger de liquidación es exactamente `confirmed_by_shipper`, alineado con todo el resto de la cadena documental.

### Negativas / costos

- **Booster opera a pérdida operacional** mientras dure el modo "no monetizado" — costo cubierto por capital, no por revenue.
- **Carriers no internalizan el costo del marketplace** hasta v2; cuando se active comisión existirá fricción de comunicación / churn esperado de baseline.
- **Sin pricing dinámico**, ofertas no se ajustan a oferta/demanda; en regiones con baja densidad de carriers el shipper paga lo mismo que en regiones competitivas (subsidio cruzado implícito).
- **Greenfield obliga implementar billing-engine antes de cobrar el primer peso**: estimado 3-4 semanas (ver §"Acciones derivadas").
- **Riesgo de "se quedó así para siempre"**: el modo no-monetizado es cómodo y se puede prolongar más allá de lo razonable. Mitigación: criterio de activación duro al final.

### Acciones derivadas (orden estricto)

1. **No agregar columnas de comisión** a `assignments` ni a otra tabla sin que ADR-027 sea superseded.
2. **Crear ADR-028 RBAC/Auth** (independiente, ya en plan).
3. **Crear ADR-029 Factoring/Pronto pago** cuando exista demanda — out-of-scope hoy.
4. **Para v2 (criterios de activación, abajo)**:
   1. Crear migration `0019_pricing_v2.sql`: tablas `membership_tiers` (seed con los 4 tiers de ADR-026), `carrier_memberships`, `liquidaciones`, `facturas_booster_clp`. Drop migration tested en dev.
   2. Implementar `packages/pricing-engine/src/liquidacion.ts` con tests de 30+ casos. Coverage 100% bloqueante.
   3. Implementar `packages/billing-engine/` con cobro mensual de membership fees (Cloud Scheduler + dunning de 3 reintentos, 7d entre cada uno).
   4. Implementar `apps/api/src/services/liquidar-trip.ts` triggered desde el handler de `confirmed_by_shipper`.
   5. Integrar Sovos para emisión real de DTE Tipo 33 (Booster→carrier) y Tipo 52 (carrier→shipper, en nombre de).
   6. Activar T&Cs nuevas + consent UX en la web app antes del primer cobro.
5. **Métricas a instrumentar**:
   - `pricing.liquidaciones_emitidas_dia` (counter)
   - `pricing.monto_liquidado_clp_total_mes` (sum)
   - `pricing.comision_promedio_pct_mes` (gauge)
   - `pricing.dte_emision_failure_rate` (% de liquidaciones que no logran emitir DTE en <60s)
   - `pricing.carrier_churn_post_cobro` (carriers que dejan de aceptar ofertas dentro de los 30d post-primer-cobro)
6. **Runbook `docs/runbooks/liquidacion-disputa.md`**: cómo operar disputa de liquidación (carrier alega monto incorrecto, DTE rechazado por SII, etc.).

### Criterios de activación de v2

Esto NO se mergea hasta que se cumplan **TODOS**:

- [ ] ≥30 carriers activos con ≥1 trip aceptado por mes (escala mínima para que comisión sea revenue real)
- [ ] ≥3 meses de operación sin incidentes serios de matching o telemetría
- [ ] T&Cs nuevas firmadas digitalmente por ≥80% de carriers activos
- [ ] Sandbox Sovos: 100% de trips piloto generan DTE válido (sin rechazo SII)
- [ ] Migration `0019_pricing_v2.sql` aprobada y ensayada en staging con dataset real

---

## Validación (estado actual de v1)

- [x] Ningún archivo de `apps/`/`packages/` calcula comisión hoy (verificado vía `grep -rn 'commission\|comision' apps/ packages/ --include='*.ts'` el 2026-05-10)
- [x] `packages/pricing-engine/src/index.ts` es stub de 7 líneas
- [x] `packages/billing-engine/` no existe (pendiente)
- [x] `apps/document-service/` es esqueleto sin emisión real
- [x] Trip flow `proposed → offers → assignment` con precio uniforme funciona (cubierto por tests existentes)
- [x] T&Cs públicas reflejan modo "no-monetizado" (pending verificación con legal — ver Acciones §6)

---

## Notas

- Este ADR es deliberadamente **conservador**. Prefiere "no cobrar nada bien" a "cobrar mal rápido". El costo de un mal cálculo de pricing en producción es contractual y reputacional, no sólo técnico.
- La estructura técnica del §4 es **mandatoria** — no se acepta PR que agregue lógica de pricing/comisión fuera de `packages/pricing-engine` o que persista comisiones sin la migration definida en §"Acciones derivadas §4.1".
- Cuando llegue v2, este ADR debe ser superseded por un nuevo ADR que cite explícitamente esta sección y cierre los criterios de activación.

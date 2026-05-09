# ADR-026 — Modelo de membresías del transportista y revenue diversificado

**Status**: Accepted
**Date**: 2026-05-05
**Decider**: Felipe Vicencio (Product Owner)
**Related**:
- [ADR-004 Modelo Uber-like y roles](./004-uber-like-model-and-roles.md) — vigente para shippers; este ADR extiende para carriers
- [ADR-005 Telemetría IoT](./005-telemetry-iot.md) — habilitador del beneficio Teltonika Direct
- [docs/market-research/004-decisiones-bloqueantes-resueltas.md §D5](../market-research/004-decisiones-bloqueantes-resueltas.md)
- [Memoria proyecto: Alianza Teltonika directa](file:///Users/fvicencio/.claude/projects/-Volumes-Pendrive128GB-Booster-AI/memory/project_teltonika_alliance.md)

---

## Contexto

[ADR-004](./004-uber-like-model-and-roles.md) estableció el modelo Uber-like para Booster: matching push real-time, comisión transaccional, sin spread oculto. El feature brief 003 §F3 (Programa Teltonika Direct Onboarding) inicialmente propuso financiar el subsidio del device Teltonika vía amortización passive (5% adicional de comisión hasta cubrir USD 150-200 de costo).

El Product Owner aprobó D5 el 2026-05-05 con un **cambio estructural**: el subsidio del device Teltonika **no es amortización passive** sino **beneficio incluido en un tier de membresía premium del transportista**. Adicionalmente clarificó la asimetría del modelo:

- **Generadores de carga (shippers)**: usan la plataforma como Uber — sin tier complejo de membresía, fricción cero al onboarding, comisión transaccional transparente al cierre.
- **Transportistas (carriers)**: tienen **tipos de membresía** con beneficios escalonados, pagos recurrentes, y el device subsidiado es perk del tier alto.

Esta asimetría refleja que el transportista es la cara "productiva" del marketplace (capacidad ofertada), donde Booster invierte en retención y up-sell; el shipper es la cara "consumidora" (demanda) donde Booster optimiza para fricción cero.

## Decisión

### 1. Modelo asimétrico shipper vs carrier (ratificación + extensión)

| Dimensión | Shipper (Generador de carga) | Carrier (Transportista) |
|---|---|---|
| Modelo de acceso | Uber-like, free signup, comisión transaccional | Tiers de membresía + comisión transaccional |
| Pricing recurrente | No (solo paga al cerrar viaje) | Sí, fee mensual según tier |
| Comisión sobre transacción | Sí, ver tiers F5 (ADR-020) por volumen | Sí, descuento progresivo según tier |
| Onboarding | Self-service en minutos vía PWA o WhatsApp | Self-service para tier free; high-touch para tier premium |
| Up-sell | Limitado (más volumen → mejor tier comisión F5) | Activo (free → standard → premium) |
| Beneficios no transaccionales | Reporte IFRS S2 (F2), dashboard ESG (F10) | Trust score boost, device Teltonika, prioridad matching, soporte humano |

### 2. Cuatro tiers de membresía del transportista

| Tier | Nombre | Fee mensual (CLP) | Quién | Beneficios principales |
|---|---|---|---|---|
| 0 | **Booster Free** | $0 | Cualquier carrier registrado | Acceso al marketplace, recibe ofertas, comisión 12% por viaje cerrado, soporte vía FAQ + bot WhatsApp |
| 1 | **Booster Standard** | ~$15.000 (USD ~16) | Carrier activo con mínimo 5 viajes/mes | Comisión reducida 9%, prioridad media en matching, badge "Verificado" en perfil, soporte vía agente humano en horario hábil |
| 2 | **Booster Pro** | ~$45.000 (USD ~48) | Carrier mediano con flota >2 vehículos | Comisión reducida 7%, prioridad alta matching, **trust score boost +5**, dashboards básicos, integración con sistemas contables externos vía export, soporte humano 24/5 |
| 3 | **Booster Premium** | ~$120.000 (USD ~128) | Carrier mediano-grande con compromiso ESG | Comisión reducida 5%, prioridad máxima matching, **trust score boost +10**, **device Teltonika incluido + instalación + 12 meses SIM + datos**, dashboards avanzados ESG (su huella propia), case study marketing co-branded opcional, soporte humano 24/7 |

### 3. Programa Teltonika Direct como beneficio del tier Premium (no programa standalone)

El subsidio del device Teltonika **se integra dentro del tier Booster Premium**:

- Carrier paga fee mensual Premium (~$120.000) → Booster cubre device + instalación + SIM + datos.
- Costo cubierto por Booster: estimado USD ~150 device + USD ~50 instalación + USD ~20/mes × 12 SIM = USD ~440 año 1 por carrier Premium.
- Ingreso anual de Premium por carrier: USD ~128/mes × 12 = USD ~1.536. **Margen contributivo positivo desde año 1** asumiendo retención 12 meses.
- Ratio break-even: si carrier abandona Premium en mes 4, Booster recupera ~USD 512 vs cubrió ~USD 200 device+install — aún positivo.

Esto reemplaza el modelo "amortización 5% comisión" del feature brief 003 §F3.

### 4. Cláusulas de revocación y kill switch

- Si carrier downgrade de Premium → Pro/Standard/Free dentro de los primeros 12 meses: device debe devolverse u el carrier paga residual del costo (USD 150 - meses_activos × USD 12.5).
- Kill switch técnico: el device Teltonika tiene firmware que permite desactivar reporting si carrier abandona sin pagar residual. **Implementación**: comando MQTT/Codec8 con `device_id` que pone el device en estado `DEACTIVATED` (no reporta GPS, no participa en matching).
- Trigger de kill switch: 30 días de impago tras downgrade + N intentos de cobranza fallidos. NO automático — requiere acción admin (humano).

### 5. Movilidad entre tiers

- Up-grade: instantáneo, prorrateado por días restantes del mes.
- Down-grade: aplica al siguiente ciclo mensual (no prorrateo). Carrier mantiene beneficios del tier hasta fin de mes.
- Tier auto-asignado: nuevos carriers entran como Free; sistema sugiere up-grade cuando alcanzan umbrales de actividad (≥5 viajes/mes → sugerir Standard).

### 6. Pricing dinámico a futuro (no MVP)

Los fees mensuales son fijos en MVP. A futuro (post-PMF), considerar pricing dinámico por:
- País (CL vs CO vs MX — ajustar a poder adquisitivo local).
- Tamaño de flota (1 vehículo → fee menor; 50 vehículos → fee enterprise individualizado).
- Tipo de carga primaria (refrigerada, peligrosa, contenedores → tiers especializados).

Estos cambios se documentan en ADR-026a/b/c según evolución, no se cocinan en el MVP.

### 7. Generadores de carga (shippers) — confirmación del modelo Uber-like

Para evitar ambigüedad, este ADR ratifica que **shippers NO tienen tiers de membresía**:

- Shipper se registra free.
- Comisión transaccional al cerrar viaje, con tiers por volumen mensual ([ADR-020 F5](#)) — pero esto es descuento de comisión, no membresía.
- Beneficios no transaccionales (reporte IFRS S2 F2, dashboard F10) son **incluidos** sin pago adicional para todos los shippers — son producto, no tier.
- **Excepción futura**: si emerge demand explícita de un tier "Booster Enterprise Shipper" con SLA, soporte dedicado, white-label, API priority — se evalúa post-PMF en ADR separado. NO en MVP.

## Consecuencias

### Positivas

- Revenue diversificado: comisión transaccional + fees recurrentes membresía → más predecible que solo transaccional.
- Subsidio Teltonika alineado con incentivo correcto: solo carriers comprometidos (que pagan Premium) reciben el device — selección natural reduce churn.
- Tier Premium es vehículo de marketing potente: "carriers Premium tienen telemetría real-time + huella certificada" es story vendible al shipper.
- Asimetría shipper/carrier honra realidad económica: el lado "supply" (carriers) es donde se invierte en retención; el lado "demand" (shippers) es donde se reduce fricción.

### Negativas / costos

- Complejidad operacional: 4 tiers requieren UI de gestión, lógica de billing, manejo de up/down grades.
- Cobranza de fees mensuales: requiere integración con pasarela de pago (Webpay, Khipu, Mercado Pago) — work adicional.
- Soporte humano 24/5 (Pro) y 24/7 (Premium) requiere staffing — costo operacional creciente con N carriers Pro/Premium.
- Riesgo de canibalización: si un carrier Premium hace solo 5 viajes/mes, paga $24.000 en comisiones (vs $36.000 si fuera Free). El fee Premium $120.000 - delta comisión $12.000 = $108.000 neto a Booster — sigue positivo, pero requiere modelar a fondo.

### Acciones derivadas

1. Crear tabla `carrier_memberships` en Drizzle con `carrier_id`, `tier_id` (FK), `started_at`, `ends_at`, `monthly_fee_clp`, `auto_renew`.
2. Crear tabla `membership_tiers` con `id`, `name`, `monthly_fee_clp`, `commission_pct`, `priority_boost`, `trust_score_boost`, `teltonika_device_included` (bool), `support_sla`, `description_es`.
3. Implementar billing engine en `packages/billing-engine/` (nuevo) — gestión de cobros recurrentes, prorrateo, dunning.
4. Modificar `packages/pricing-engine` para que comisión consulte tier de membresía del carrier (no solo volumen del shipper F5).
5. Modificar `packages/matching-algorithm` para que `priority_boost` del tier influya en el orden de notificación de ofertas a carriers eligibles.
6. UI:
   - `apps/web` rol Carrier: vista de membresía actual, comparativa de tiers, botón up/downgrade, historial de cobros.
   - `apps/web` rol Admin: dashboard de membresías por tier, MRR (Monthly Recurring Revenue), churn rate.
7. Programa Teltonika Direct (F3) reescribe spec para encajar como beneficio del tier Premium, no programa standalone.
8. Integration con pasarela de pago — decisión separada (sugerencia: Webpay Plus por dominancia local Chile, considerar Khipu para débito automático).

## Validación

- [ ] Migration `0018_carrier_memberships.sql` corrida.
- [ ] Tabla `membership_tiers` seed con los 4 tiers descritos.
- [ ] `packages/billing-engine` operativo con tests.
- [ ] UI de membresía operativa para rol Carrier.
- [ ] Pasarela de pago integrada y operativa.
- [ ] Primer carrier Premium activado y device entregado.

## Impacto en feature brief 003

- **F3 reescribe spec**: ya no es "Programa Teltonika Direct Onboarding" standalone, es "Beneficio premium del tier Booster Premium". El módulo de logística HW se mantiene; el modelo financiero cambia.
- **F5 (Tier comisión por volumen del shipper)**: sigue vigente, no se confunde con membresías del carrier.
- **F6 (Trust Score)**: incorpora `trust_score_boost` del tier de membresía como input al cálculo.
- **F nueva F11**: gestión de membresías + billing engine — agregar al feature brief 003 como P1.

## Histórico

- 2026-05-05: Modelo asimétrico shipper-uber + carrier-tiered aprobado. Subsidio Teltonika integrado en tier Premium.

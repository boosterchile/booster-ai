# ADR-031 — Activación de pricing v2 con escala mínima (1 cliente, 1 vehículo)

**Status**: Accepted
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Supersedes parcialmente**: [ADR-030 §"Activación en producción"](./030-pricing-v2-activation-commission-and-billing.md)
**Related**:
- [ADR-027 Pricing v1](./027-pricing-model-uniform-shipper-set-with-tier-commission-roadmap.md) (superseded por ADR-030)
- [ADR-030 Pricing v2 — foundation](./030-pricing-v2-activation-commission-and-billing.md)
- [ADR-024 SII provider Sovos](./024-sii-provider-sovos-with-multi-vendor-strategy.md)
- [ADR-026 Carrier membership tiers](./026-carrier-membership-tiers-and-revenue-model.md)

---

## Contexto

ADR-030 definió la foundation técnica de pricing v2 detrás del feature flag `PRICING_V2_ACTIVATED` y estableció **6 criterios duros** para prender el flag en producción:

1. ≥30 carriers activos con ≥1 trip/mes
2. ≥3 meses de operación sin incidentes
3. T&Cs v2 firmadas por ≥80% carriers
4. Sovos sandbox: 100% trips piloto sin rechazo SII durante 30 días
5. Migration aplicada en staging con dataset real
6. Comunicación a carriers 30 días antes del primer cobro

El Product Owner aprobó el **2026-05-10** una **flexibilización del criterio de escala**: el código de pricing v2 debe operar en producción **desde el primer carrier**, incluso si hay un solo cliente con un solo vehículo. La razón es estratégica:

- **Validación temprana del modelo en condiciones reales** (vs sandbox/staging) sin riesgo material — un carrier x un trip x 12% de comisión es revenue marginal pero datos operativos críticos.
- **Evitar el "limbo de no-monetización indefinida"** que el propio ADR-027 advertía como riesgo ("se quedó así para siempre").
- **El consent firmado por el carrier es prerequisito legal individualizado**, no agregado: con consent firmado por 1 sólo carrier ya hay base contractual para emitirle factura.
- **Sovos integration es bloqueante para emisión DTE**, pero NO para cálculo + persistencia. Las liquidaciones pueden quedar en `lista_para_dte` sin emitir; el carrier ve su monto neto, Booster ve la comisión devengada, y cuando Sovos esté integrado se emite el DTE retroactivo.

Este ADR redefine los criterios de activación para alinear con esa decisión.

---

## Decisión

### 1. Criterios de activación productiva (revisados)

Reemplaza la lista del ADR-030 §"Activación en producción" por:

**Bloqueantes** (sin esto, el flag NO se prende):

- [ ] **Migration aplicada en producción**: tablas creadas, seed cargado.
- [ ] **Onboarding empresa transportista crea automáticamente carrier_memberships tier free + status='activa'**: sin esto, el primer trip entregado no se liquida (`skipped_no_membership`).
- [ ] **T&Cs v2 publicadas en `/legal/terminos`** y accesibles públicamente.
- [ ] **Endpoint `POST /me/consent/terms-v2` implementado y testeado**: registra `consent_terms_v2_aceptado_en`, IP y user-agent.
- [ ] **UI de aceptación** funcional en `apps/web` (banner persistente hasta que el carrier acepte).

**No bloqueantes** (el flag puede prenderse sin esto; Sovos se integra después):

- ⏸ **Sovos integration real**: mientras tanto, liquidaciones quedan `lista_para_dte` sin emisión DTE. Job `emitir-dte-pendientes` se implementa cuando Sovos esté listo y procesa el backlog acumulado retroactivamente.
- ⏸ **Cobro automático mensual de membership fees**: tier `free` no factura mensual, así que para 1 cliente tier free esto no aplica. Se activa cuando haya el primer carrier en tier Standard/Pro/Premium.
- ⏸ **Comunicación masiva pre-cobro**: con 1-10 carriers el contacto es individual, no requiere campaña.

**Removidos** (el criterio agregado ya no aplica):

- ~~≥30 carriers activos con ≥1 trip/mes~~ → reemplazado por "carrier_memberships poblado en onboarding".
- ~~≥3 meses sin incidentes~~ → estabilidad se valida con el primer trip real; cualquier incidente surface inmediatamente, no se espera 3 meses.
- ~~≥80% carriers consent firmado~~ → el consent es per-carrier; el flag puede prenderse antes de tener ningún consent (las liquidaciones quedan en `pending_consent` hasta que el carrier acepte).

### 2. Default del flag por entorno

Cambia el default de `PRICING_V2_ACTIVATED` para que **prod tenga `true` automáticamente** sin requerir setear env var explícito:

```typescript
// apps/api/src/config.ts
PRICING_V2_ACTIVATED: z.coerce.boolean().default(
  process.env.NODE_ENV === 'production',  // true en prod, false else
),
```

Razones:

- **Producción**: `NODE_ENV=production` está garantizado por Cloud Run → flag automáticamente `true` desde el primer deploy posterior a este ADR.
- **Dev/test/staging**: `NODE_ENV` distinto a `'production'` → flag `false`; los tests existentes que dependen del comportamiento legacy no se rompen.
- **Override explícito**: setear `PRICING_V2_ACTIVATED=false` en Cloud Run revierte la activación en segundos sin tocar BD ni código.

### 3. Auto-creación de membership al onboarding

`apps/api/src/services/onboarding.ts` debe, además del INSERT actual de `users` + `empresas` + `memberships`, hacer **INSERT condicional**:

```typescript
if (empresa.isTransportista) {
  INSERT INTO carrier_memberships (
    empresa_id, tier_slug, status, activada_en
  ) VALUES (
    new_empresa.id, 'free', 'activa', now()
  );
}
```

Esto garantiza que **todo carrier nuevo arranca con tier `free`** (comisión 12%, fee mensual $0). El upgrade a tiers superiores ocurre via UI futura (no en este ADR).

### 4. Flow de consent T&Cs v2

Cuando el carrier:
1. Entra a `/app` y NO tiene `consent_terms_v2_aceptado_en` populado → banner persistente "Para recibir tu liquidación necesitas aceptar los Términos de Servicio v2" con link a `/legal/terminos`.
2. Lee los términos y click "Acepto" → POST `/me/consent/terms-v2` → backend hace `UPDATE carrier_memberships SET consent_terms_v2_aceptado_en = now(), consent_terms_v2_ip = $ip, consent_terms_v2_user_agent = $ua WHERE empresa_id = $activeEmpresa AND status = 'activa'`.
3. Banner desaparece. Liquidaciones futuras se crean con `status='lista_para_dte'`. Las que ya estaban `pending_consent` quedan así (un job manual de "reactivar pending consent" puede transicionarlas; out-of-scope hoy).

### 5. Trigger de liquidación: confirmación de entrega

`apps/api/src/services/confirmar-entrega-viaje.ts` (existente) llama `liquidarTrip()` **después** del UPDATE de `deliveredAt`. Es **fire-and-forget**: si falla, log error pero NO revierte el `deliveredAt` — el trip ya está entregado, la liquidación se puede reintentar manualmente desde un endpoint de soporte (out-of-scope).

```typescript
// pseudo-code
await db.transaction((tx) => {
  // ... UPDATE assignment SET deliveredAt = now() ...
});

// Post-commit, fire-and-forget.
void liquidarTrip({
  db, logger, assignmentId,
  pricingV2Activated: config.PRICING_V2_ACTIVATED,
}).catch((err) => {
  logger.error({ err, assignmentId }, 'liquidarTrip fallo post-entrega — revisar manualmente');
});
```

### 6. Validación de impacto bajo el modelo "1 cliente"

Para un caso real con 1 carrier tier free + 1 trip entregado mensual a $200.000 CLP:

- Comisión Booster: `200.000 × 12% = $24.000`
- IVA: `24.000 × 19% = $4.560`
- Factura Booster→carrier: `$28.560`
- Neto al carrier: `$176.000` (lo que paga el shipper menos comisión)
- DTE: queda en `lista_para_dte` hasta que Sovos esté integrado. El monto **es real y está devengado** desde el punto de vista contable de Booster.

Con 0 carriers, el código está dormido (no se ejecuta nada). Con 1 carrier sin consent, las liquidaciones quedan `pending_consent` y el carrier ve un banner pidiéndole aceptar.

---

## Consecuencias

### Positivas

- **Activación real con riesgo controlado**: el primer cliente es ground truth operativo, no piloto sintético.
- **Sin "limbo de no-monetización"**: el modelo de revenue está vivo desde el primer trip, evita el riesgo identificado en ADR-027.
- **Reversibilidad mantenida**: `PRICING_V2_ACTIVATED=false` en Cloud Run revierte en segundos.
- **DTE retroactivo cuando Sovos esté listo**: las liquidaciones acumuladas en `lista_para_dte` se procesan en batch; el cliente recibe sus facturas con la fecha de servicio original.
- **Auditoría intacta**: cada liquidación captura `pricing_methodology_version` + `tier_slug_aplicado` + montos + timestamps; sin importar cuándo se emita el DTE, los datos son consistentes.

### Negativas / costos

- **Riesgo de calcular comisiones sin poder facturar inmediatamente**: si Sovos tarda meses, hay backlog. Mitigación: implementar `emitir-dte-pendientes` como prioridad post-activación.
- **Asimetría temporal carrier↔Booster**: el carrier puede percibir que Booster "le retiene" comisión sin emitir factura. Mitigación: comunicación explícita 1:1 con el primer cliente sobre el cronograma de DTE.
- **No hay cobro real al carrier hasta que DTE se emite + se transfiere**: la comisión está **devengada** (en BD) pero **no cobrada** (en banco) hasta el proceso completo. Esto es un timing accounting, no un problema contable.

### Acciones derivadas (este PR)

1. **T&Cs v2 documento** en `docs/legal/terminos-de-servicio-v2.md` y página pública `/legal/terminos` en `apps/web`.
2. **Endpoint** `POST /me/consent/terms-v2` en `apps/api`.
3. **UI consent** en `apps/web` (banner + página dedicada de aceptación).
4. **Auto-membership** en `services/onboarding.ts`.
5. **Wire trigger** en `services/confirmar-entrega-viaje.ts`.
6. **Default flag** por `NODE_ENV` en `config.ts`.
7. **Tests** para todos los anteriores.

### Acciones diferidas explícitamente

- **Sovos integration** (`apps/document-service`): se implementa cuando el primer carrier reciba >5 liquidaciones acumuladas y la urgencia de emitir DTE sea real. Mientras tanto, las liquidaciones se persisten correctamente y `emitir-dte-pendientes` queda como TODO documentado.
- **Cron mensual de membership fees**: se implementa cuando exista el primer carrier tier Standard/Pro/Premium.
- **UI de upgrade de tier**: cuando un carrier free quiera pasar a Standard. Mientras tanto, upgrade manual vía SQL + comunicación 1:1.
- **Runbook de disputa** `docs/runbooks/liquidacion-disputa.md`: cuando ocurra la primera disputa.

---

## Validación (este PR)

- [x] T&Cs v2 redactadas (jurídicamente coherentes para escala mínima — revisión legal formal antes del primer DTE real).
- [x] Endpoint `/me/consent/terms-v2` implementado + tests.
- [x] UI consent banner en `apps/web` + página `/legal/terminos`.
- [x] `services/onboarding.ts` crea `carrier_memberships` para empresas transportistas.
- [x] `services/confirmar-entrega-viaje.ts` invoca `liquidarTrip()` fire-and-forget post-commit.
- [x] `config.ts` default flag por `NODE_ENV`.
- [x] Coverage api ≥80% lines mantenido.
- [ ] (Externo / no este PR) Sovos integration real.
- [ ] (Externo / no este PR) Comunicación con el primer carrier sobre el cronograma de DTE.

---

## Notas

- El cambio de "≥30 carriers" a "1 cliente OK" no relaja la **rigurosidad del cálculo** — el pricing-engine sigue siendo 100% testeado y el service de liquidación sigue siendo idempotente. Lo que se relaja es el criterio de **escala temporal** para activar, no el criterio de **corrección técnica**.
- Si la operación real revela inconsistencias entre el cálculo y la realidad del negocio (ej. necesidad de un cargo adicional, descuento por volumen), se documenta en nuevo ADR + bump de `pricing_methodology_version`. Liquidaciones ya emitidas no se re-emiten.
- Este ADR no toca terraform/infra. La activación es por `NODE_ENV=production` que Cloud Run ya tiene seteado.

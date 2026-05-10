# ADR-032 — Factoring v1: activación con escala mínima + partner diferido

**Status**: Accepted
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Activates**: [ADR-029 Factoring / Pronto pago al transportista](./029-factoring-pronto-pago-al-transportista.md)
**Related**:
- [ADR-027 Pricing v1](./027-pricing-model-uniform-shipper-set-with-tier-commission-roadmap.md) (superseded por ADR-030)
- [ADR-030 Pricing v2 foundation](./030-pricing-v2-activation-commission-and-billing.md)
- [ADR-031 Pricing v2 activación escala mínima](./031-pricing-v2-activacion-escala-minima.md)
- [ADR-024 SII provider Sovos](./024-sii-provider-sovos-with-multi-vendor-strategy.md)
- [ADR-007 Chile document management](./007-chile-document-management.md)

---

## Contexto

ADR-029 definió el producto "Booster Cobra Hoy" como diferenciador comercial (pronto pago al carrier antes del plazo del shipper), inspirado en Tennders ES. El status quedó `Proposed` con bloqueo de implementación hasta cumplir **7 criterios duros**:

1. ADR-027 v2 implementado y operativo ≥3 meses
2. ≥50 trips liquidados/mes durante ≥3 meses
3. ≥1 partner factoring con LOI + sandbox API
4. ≥10 shippers prototipo aprobados
5. Tarifas confirmadas con partner
6. T&Cs específicas firmadas
7. Tasa aprobación shipper ≥70%

El PO aprobó el **2026-05-10** el mismo patrón que ADR-031 aplicó a ADR-030: **adelantar la foundation técnica detrás de un feature flag**, dejando los criterios de partner/legal/volumen como bloqueantes solo para la activación real del flag en producción. Razones:

- La función pura de cálculo de tarifa es independiente del partner — testeable hoy sin riesgo.
- El schema de BD (`adelantos_carrier`) es estable y aplicable hoy; vacío hasta activación.
- Los endpoints + UI pueden estar listos detrás de un flag para que el primer carrier vea el botón "Cobra hoy" el mismo día que se firme el partner.
- Permite **validación de UX** con stakeholders internos antes del commit con partners reales.

Este ADR adopta la decisión del ADR-029 (cambia su status implícito a operativo bajo flag) y define los criterios revisados de activación productiva.

---

## Decisión

### 1. Foundation técnica completa, partner real diferido

Implementar **hoy** en este PR:

- `packages/factoring-engine` con función pura `calcularTarifaProntoPago()` + `evaluarShipper()` + tests exhaustivos.
- Migration `0016_factoring_v1.sql` con tablas `adelantos_carrier` + `shipper_credit_decisions` + seed de las 4 tasas (30/45/60/90 días).
- Drizzle schema espejado.
- Service `cobra-hoy.ts` con feature flag `FACTORING_V1_ACTIVATED` (default `false` excepto prod).
- Endpoints `POST /me/asignaciones/:id/cobra-hoy`, `GET /me/asignaciones/:id/cobra-hoy/cotizacion`, `GET /me/cobra-hoy/historial`.
- UI mínima en `apps/web` (botón en asignación detalle + página historial).
- T&Cs Cobra Hoy v1 en `/legal/cobra-hoy`.

**Diferido (no implementado, NO bloquea merge)**:

- Integración real con partner factoring (Toctoc/Mafin/Increase/Cumplo). Mientras tanto el service stubea el partner: marca el adelanto como `desembolsado` simulado pero NO ejecuta cesión DTE real ni transferencia.
- Cesión electrónica DTE vía Sovos (depende del módulo `apps/document-service` que sigue esqueleto desde ADR-030).
- Consulta crediticia real Equifax/Sentinel/Dicom. El `evaluarShipper()` puro acepta un score externo; el caller decide cómo obtenerlo (mock en tests, API real cuando exista).
- Cron de "cobranza al shipper" a la fecha del DTE (depende de la cesión DTE real).

### 2. Activación dual: hard switch + partner real

El flag `FACTORING_V1_ACTIVATED` controla:

- Si es `false` → `cobraHoy()` retorna `{ status: 'skipped_flag_disabled' }`. Endpoints devuelven 503 con `feature_disabled`. UI no muestra botón.
- Si es `true` → los endpoints operan, pero **cada adelanto requiere `shipper_credit_decisions.approved=true`** del shipper del trip. Sin underwriting aprobado, el endpoint devuelve 422 con `shipper_no_aprobado`.

Default por entorno (espejo ADR-031 §2):

```ts
FACTORING_V1_ACTIVATED: z.coerce.boolean().default(
  process.env.NODE_ENV === 'production',
),
```

Producción tiene el flag prendido automáticamente; dev/test/staging tiene `false`.

### 3. Esquema de tarifas (espejo ADR-029 §2)

Aplicado en la función pura sin posibilidad de override del caller:

| Plazo shipper | Tarifa pronto pago |
|---|---:|
| 30 días | 1.5% |
| 45 días | 2.2% |
| 60 días | 3.0% |
| 90 días | 4.5% |

Cualquier plazo intermedio (37 días, 75 días) se resuelve **interpolando linealmente** entre las dos tasas adyacentes. Plazos <30 días = 1.5% (no se ofrece menor). Plazos >90 días = 4.5% + 0.5% por cada 15 días adicionales (techo 8%).

**Cobro sobre `monto_neto_carrier_clp`** (post-comisión Booster), no sobre `agreedPriceClp` bruto. Mantiene clean separation: pricing v2 cobra comisión, factoring v1 cobra tarifa financiera.

### 4. Tabla `adelantos_carrier`

```sql
CREATE TABLE adelantos_carrier (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asignacion_id                   uuid NOT NULL UNIQUE REFERENCES assignments(id) ON DELETE RESTRICT,
  liquidacion_id                  uuid REFERENCES liquidaciones(id),
  empresa_carrier_id              uuid NOT NULL REFERENCES empresas(id),
  empresa_shipper_id              uuid NOT NULL REFERENCES empresas(id),
  monto_neto_clp                  integer NOT NULL,
  plazo_dias_shipper              integer NOT NULL CHECK (plazo_dias_shipper > 0),
  tarifa_pct                      numeric(4,2) NOT NULL,
  tarifa_clp                      integer NOT NULL,
  monto_adelantado_clp            integer NOT NULL,
  partner_slug                    text,
  partner_request_id              text,
  status                          text NOT NULL CHECK (status IN (
                                    'solicitado',
                                    'aprobado',
                                    'desembolsado',
                                    'cobrado_a_shipper',
                                    'mora',
                                    'cancelado',
                                    'rechazado'
                                  )),
  rechazo_motivo                  text,
  desembolsado_en                 timestamptz,
  cobrado_a_shipper_en            timestamptz,
  mora_desde                      timestamptz,
  factoring_methodology_version   text NOT NULL,
  creado_en                       timestamptz NOT NULL DEFAULT now(),
  actualizado_en                  timestamptz NOT NULL DEFAULT now()
);
```

UNIQUE en `asignacion_id` garantiza **idempotencia**: una asignación tiene a lo más un adelanto vigente. Si se cancela el adelanto, el carrier puede crear otro nuevo solo si el primero queda en `status='cancelado'` (lógica de service).

### 5. Tabla `shipper_credit_decisions`

```sql
CREATE TABLE shipper_credit_decisions (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_shipper_id              uuid NOT NULL REFERENCES empresas(id),
  approved                        boolean NOT NULL,
  limit_exposure_clp              integer NOT NULL DEFAULT 0,
  current_exposure_clp            integer NOT NULL DEFAULT 0,
  equifax_score                   integer,
  decided_at                      timestamptz NOT NULL DEFAULT now(),
  decided_by                      text NOT NULL CHECK (decided_by IN ('automatico','manual')),
  expires_at                      timestamptz NOT NULL,
  motivo                          text,
  creado_en                       timestamptz NOT NULL DEFAULT now(),
  actualizado_en                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_shipper_credit_decisions_empresa_vigente
  ON shipper_credit_decisions(empresa_shipper_id)
  WHERE expires_at > now();
```

El partial unique index garantiza que solo hay UNA decisión vigente por shipper. Las decisiones expiradas quedan en BD para auditoría histórica.

### 6. Versionado de metodología

Espejo de pricing methodology: cada adelanto persiste `factoring_methodology_version` (semver). Cambios MINOR cuando cambia la tabla de tarifas; MAJOR cuando cambia el modelo (ej. tarifa variable por shipper individual).

Inicial: `factoring-v1.0-cl-2026.06`.

### 7. Criterios de activación productiva (revisados)

**Bloqueantes** (sin esto, el flag NO se prende):

- [ ] Migration aplicada en producción
- [ ] T&Cs Cobra Hoy v1 publicadas en `/legal/cobra-hoy`
- [ ] Endpoint `POST /me/consent/cobra-hoy-v1` (opt-in del carrier al producto financiero específico)
- [ ] Auto-decisión manual de shippers conocidos (insert directo en `shipper_credit_decisions` mientras no haya Equifax wire)
- [ ] Al menos 1 partner factoring con LOI firmado **O** decisión expresa del PO de operar "modo demo" donde el adelanto se simula (no se transfiere dinero real al carrier; carrier ve UX completa para validación)

**No bloqueantes** (el flag puede prenderse sin esto):

- ⏸ Equifax/Sentinel/Dicom API real — decisiones manuales por shipper hasta entonces.
- ⏸ Sovos cesión DTE — el adelanto queda con `partner_slug=NULL`, `desembolsado_en=NULL` hasta que Sovos integre.
- ⏸ Volumen ≥50 trips/mes — el ADR-031 ya activó pricing v2 con escala mínima; factoring sigue el mismo enfoque "primer carrier ya".

### 8. Estructura del flow técnico

```
1. POST /me/asignaciones/:id/cobra-hoy/cotizacion
   ↓ (frontend muestra desglose: monto neto, tarifa, recibirás)
   ↓
2. Carrier confirma → POST /me/asignaciones/:id/cobra-hoy
   ↓
3. Service cobraHoy() verifica:
   a. assignment existe + es del carrier
   b. assignment.deliveredAt no-null
   c. liquidacion existe + status 'lista_para_dte' o 'dte_emitido'
   d. shipper_credit_decisions vigente + approved=true
   e. limit_exposure no excedido
   f. NO existe adelantos_carrier para esta asignacion
   ↓
4. INSERT adelantos_carrier con status='solicitado'
   ↓
5. (Partner real cuando exista) — llamada API partner cesión DTE
   ↓
6. UPDATE status='aprobado' → 'desembolsado' (manual o partner callback)
   ↓
7. Cuando shipper paga DTE: UPDATE status='cobrado_a_shipper'
8. Si plazo vence sin pago: UPDATE status='mora' (cron diario)
```

---

## Consecuencias

### Positivas

- **Foundation técnica sin riesgo material**: el código nuevo no opera contra dinero real hasta que se prenda el flag + se firme partner.
- **UX validable hoy**: stakeholders pueden hacer demos completas del flow sin transferencias reales.
- **Versionado de metodología desde día 1**: cambios futuros de tarifas son auditables.
- **Compatibilidad con `liquidaciones.payout_carrier_metodo='pronto_pago_booster'`** (ya previsto en ADR-030 §10) — al desembolsar, el service también marca la liquidación.
- **Activación incremental**: primer carrier sin partner (modo demo), después con partner real, después con Equifax automático.

### Negativas / costos

- **Código que no opera inmediatamente**: aumenta surface area mantenible. Mitigación: tests >95% en función pura + tests de service con flag=true.
- **UX puede mostrar botón "Cobra hoy" antes de que funcione realmente**: requiere comunicación clara con stakeholders del estado "modo demo".
- **Riesgo de promesa que no se cumple si el partner no se firma rápido**: mitigado por mantener el flag `false` hasta partner LOI.
- **Sin Equifax, las decisiones de underwriting son manuales**: no escala a >50 shippers sin trabajo operativo, pero soporta el caso de "1 cliente, 1 vehículo".

### Acciones derivadas (este PR)

1. ADR-029 status actualizable a `Accepted` cuando el flag se prenda en prod (no en este PR).
2. `packages/factoring-engine` con cálculo de tarifa + underwriting puros.
3. Migration `0016_factoring_v1.sql`.
4. Drizzle schema.
5. Service `cobra-hoy.ts` con flag-gate.
6. 3 endpoints REST.
7. UI carrier (botón + modal + historial).
8. T&Cs Cobra Hoy v1 + página `/legal/cobra-hoy`.

### Acciones diferidas explícitamente

- Partner integration real (factoring-partner-toctoc.ts u otro).
- Sovos cesión DTE wire.
- Equifax/Sentinel/Dicom wire.
- Cron de cobranza al shipper.
- UI admin de adelantos (lista global + acciones de cobranza).

---

## Validación (este PR)

- [x] ADR-032 escrito + activa ADR-029.
- [x] `packages/factoring-engine` implementado + tests (tarifa + underwriting).
- [x] Migration creada + Drizzle schema espejado.
- [x] Service `cobra-hoy.ts` con flag-gate + tests cubriendo cada branch.
- [x] 3 endpoints REST + tests.
- [x] UI carrier funcional.
- [x] T&Cs publicadas.
- [x] Config flag `FACTORING_V1_ACTIVATED` por `NODE_ENV`.
- [x] Coverage api+web sobre threshold.
- [ ] (Externo) Partner factoring LOI.
- [ ] (Externo) Sovos cesión DTE wire.
- [ ] (Externo) Equifax API wire.

---

## Notas

- Este ADR sigue el mismo patrón que ADR-031 aplicó a ADR-030: relax de criterios duros de escala/volumen, mantener criterios duros legales/operacionales que no se pueden bypassar.
- La función pura `calcularTarifaProntoPago()` es independiente del partner. Si en el futuro Booster opera con capital propio (opción B del ADR-029 §4), las tarifas pueden bajar pero la función queda igual; cambia solo la fuente de capital.
- El `factoring_methodology_version` es ortogonal al `pricing_methodology_version` — un trip puede tener pricing v2 + factoring v1, o pricing v2 sin factoring (si carrier no opta).
- Cuando se active partner real, los tests `cobra-hoy.test.ts` que asumen modo demo se actualizan; el contract no cambia.

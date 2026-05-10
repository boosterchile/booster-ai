# ADR-028 — Modelo dual de fuente de datos: Teltonika (datos primarios) vs Google Maps (datos secundarios)

**Status**: Accepted
**Date**: 2026-05-10
**Decider**: Felipe Vicencio (Product Owner)
**Technical contributor**: Claude (Cowork) actuando como arquitecto de software
**Related**:
- [ADR-005 Telemetría IoT](./005-telemetry-iot.md) — pipeline Teltonika
- [ADR-016 GLEC v3.0 compliance](./016-glec-v3-compliance.md) — factores corregidos
- [ADR-017 Metodología de cálculo de emisiones + factor WTW diesel B5](./017-emissions-methodology-and-wtw-factor.md) — define `precision_method`
- [ADR-026 Carrier membership tiers](./026-carrier-membership-tiers-and-revenue-model.md) — base del modelo de tiers

---

## Contexto

El feature de "ruta verde + behavior coaching" requiere que Booster opere
sobre **dos fuentes de datos posibles** de un mismo viaje, con consecuencias
muy distintas para la auditabilidad del certificado de huella de carbono:

1. **Teltonika presente** (Standard/Verified/Enterprise tier): el dispositivo
   reporta GPS pings, velocidad, eventos green-driving (IO 253/254/255),
   ignition, odómetro y, si tiene CAN bus, consumo real de combustible. La
   medición es **dato primario** bajo GLEC §4.4 nivel 1.

2. **Sin Teltonika** (Basic tier o ad-hoc): el viaje se conoce solo por
   declaración del cliente (origen, destino, vehículo declarado, hora). La
   ruta se modela con Google Routes API (`computeRoutes` con `vehicleInfo`
   y `extraComputations: ['FUEL_CONSUMPTION']`). La medición es **dato
   secundario modeled** bajo GLEC §4.4 nivel 2.

ADR-017 ya define `precision_method ∈ {exacto_canbus, modelado, por_defecto}`,
que captura la calidad de la medición de combustible/distancia, **pero no
captura explícitamente**:

- Cuál fue la fuente del polyline efectivamente recorrido (telemetría real
  vs simulación Routes API vs declaración manual).
- Qué porcentaje del viaje quedó cubierto por la fuente principal cuando
  hay pérdida de señal Teltonika mid-trip.
- Cuál es el **nivel de certificación** resultante, leído por el
  `certificate-generator` para elegir entre template "primario verificable"
  vs template "secundario estimativo".
- Cuándo el sistema debe degradar automáticamente (ej. cobertura
  Teltonika < 80% → no se emite cert primario aunque el carrier sea
  Verified).

Sin estas piezas explícitas, dos riesgos materializan:

- **Greenwashing accidental**: emitir un certificado "verificable" sobre un
  trip cuyo polyline real solo cubre el 40% (resto modeled). Esto es
  inadmisible bajo GLEC §4.4 y bajo cualquier auditoría SBTi/CDP.
- **Subutilización del valor del dato**: tratar todo como `por_defecto` por
  no tener el modelo dual, perdiendo el diferencial comercial del tier
  Verified (cliente paga por dato auditable, recibe estimativo).

---

## Decisión

### 1. Tres dimensiones de calidad del dato, ortogonales entre sí

Se mantiene `precision_method` (ADR-017) y se introducen **dos dimensiones
adicionales** en `trip_metrics`. Las tres se persisten y se evalúan
independientemente:

| Dimensión | Pregunta que responde | Valores |
|---|---|---|
| `precision_method` (existente) | ¿Cómo medimos el combustible/distancia? | `exacto_canbus`, `modelado`, `por_defecto` |
| `route_data_source` (NUEVO) | ¿De dónde viene el polyline real recorrido? | `teltonika_gps`, `maps_directions`, `manual_declared` |
| `coverage_pct` (NUEVO) | ¿Qué fracción del viaje cubre la fuente principal? | `0.0..100.0` |

`source` (existente, valores `modeled | canbus | driver_app`) se **deprecia
en favor de `route_data_source`** en una migración incremental: el campo
`source` queda en BD por backwards-compatibility hasta que todos los trips
históricos tengan `route_data_source` poblado, después se remueve en una
ADR posterior.

### 2. Nivel de certificación derivado, no auto-declarado

`trip_metrics.certification_level` es **derivado** de las tres dimensiones
arriba al momento de emitir el certificado. El cliente (transportista o
shipper) **NO puede setearlo manualmente**. Función pura, vive en
`packages/carbon-calculator/src/certificacion/`:

```ts
export function derivarNivelCertificacion(input: {
  precisionMethod: PrecisionMethod;
  routeDataSource: RouteDataSource;
  coveragePct: number;
}): NivelCertificacion;

export type NivelCertificacion =
  | 'primario_verificable'      // GLEC §4.4 nivel 1
  | 'secundario_modeled'         // GLEC §4.4 nivel 2 con calibración
  | 'secundario_default';        // GLEC §4.4 nivel 2 sin calibración (último fallback)
```

Matriz de derivación:

| precision_method | route_data_source    | coverage_pct | → nivel                  |
|------------------|----------------------|--------------|--------------------------|
| `exacto_canbus`  | `teltonika_gps`      | ≥ 95%        | `primario_verificable`   |
| `exacto_canbus`  | `teltonika_gps`      | 80–95%       | `secundario_modeled`     |
| `exacto_canbus`  | `teltonika_gps`      | < 80%        | `secundario_modeled`     |
| `modelado`       | `teltonika_gps`      | ≥ 80%        | `secundario_modeled`     |
| `modelado`       | `teltonika_gps`      | < 80%        | `secundario_modeled`     |
| `modelado`       | `maps_directions`    | (cualquiera) | `secundario_modeled`     |
| `por_defecto`    | `maps_directions`    | (cualquiera) | `secundario_modeled`     |
| `por_defecto`    | `manual_declared`    | (cualquiera) | `secundario_default`     |
| (cualquier)      | `manual_declared`    | (cualquiera) | `secundario_default`     |

**Threshold de cobertura para nivel primario**: 95%. El 5% de holgura
absorbe los huecos típicos de pérdida de señal urbana (túneles, edificios)
sin penalizar al carrier. Por debajo de 95% pero por encima de 80%, el
viaje queda en secundario modeled con `factor_incertidumbre` aumentado
proporcionalmente.

### 3. Factor de incertidumbre publicado

`trip_metrics.uncertainty_factor` es decimal en [0.0, 1.0] que el
certificate-generator imprime visiblemente (ej. "12.4 ± 0.6 kg CO₂e con
α = 0.05"). Se calcula así:

| Nivel                    | Base | Modificadores                                                                 |
|--------------------------|------|-------------------------------------------------------------------------------|
| `primario_verificable`   | 0.05 | + 0.01 si CAN bus reporta diff > 5% vs perfil del vehículo                    |
| `secundario_modeled`     | 0.15 | + (1.0 - coverage_pct/100) × 0.20 si la cobertura cayó por debajo de 95%      |
| `secundario_default`     | 0.30 | + 0.10 si tipo de vehículo declarado no matchea Routes API `vehicleInfo`      |

Los baselines (0.05, 0.15, 0.30) provienen de ISO 14083 §5.2 data quality
default tier + GLEC v3.0 Annex B.

### 4. Selección automática de template de certificado

`packages/certificate-generator` recibe el `nivel_certificacion` y
selecciona uno de **dos templates**:

| Nivel                      | Template               | Header                                                  | Disclaimer principal                                                                                                  |
|----------------------------|------------------------|---------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| `primario_verificable`     | `cert-primario.html`   | "Certificado de Huella de Carbono — Datos Verificables" | "Cálculo basado en telemetría GPS + CAN bus del vehículo. Auditable bajo GLEC v3.0 §4.4 nivel 1, ISO 14083, SBTi/CDP." |
| `secundario_modeled` o `secundario_default` | `report-secundario.html` | "Reporte Estimativo de Huella de Carbono"            | "Cálculo basado en datos secundarios modelados (factores SEC Chile 2024 + Google Routes API). NO auditable como dato primario bajo SBTi/CDP. Para upgrade a certificado verificable, contactar a Booster para activar telemetría Teltonika." |

Ambos templates llevan firma KMS (`firmar-kms.ts`, ya existe), el hash
SHA-256 de los datos de entrada, y `methodology_version` (ADR-017 §2). La
diferencia es **solamente** semántica/visual + el disclaimer prominente,
no técnica — los dos son PDFs PADES auténticos y no manipulables.

### 5. Hybrid coverage: cómo se calcula `coverage_pct`

Para trips con telemetría Teltonika, `coverage_pct` se calcula así en el
`telemetry-processor` al cierre del trip:

```
coverage_pct =
  (km_cubiertos_por_pings_continuos / km_totales_estimados) × 100
```

- `km_cubiertos_por_pings_continuos`: suma de distancias entre pings
  consecutivos del trip donde el gap temporal < 60s (umbral de "señal
  continua"). Gaps > 60s NO se cuentan como cobertura — el polyline real
  en ese tramo es desconocido.
- `km_totales_estimados`: distancia entre origen y destino vía Routes API
  (Maps Directions con tráfico).

Si `coverage_pct = NULL` (no hay telemetría), se setea explícitamente a 0
para forzar el path secundario en la matriz.

### 6. Compatibilidad con membership tiers (ADR-026)

| Tier carrier (ADR-026) | precision_method esperado | route_data_source esperado | nivel típico             |
|------------------------|----------------------------|----------------------------|--------------------------|
| Basic                  | `por_defecto`              | `maps_directions`          | `secundario_modeled`     |
| Standard               | `por_defecto` o `modelado` | `teltonika_gps` (si activo) | `secundario_modeled`     |
| Verified               | `modelado` o `exacto_canbus` | `teltonika_gps`           | `primario_verificable`   |
| Enterprise             | `exacto_canbus` (CAN obligatorio) | `teltonika_gps`         | `primario_verificable`   |

El UI de admin/transportista debe **prevenir** que un Verified emita certs
sin telemetría suficiente: si `coverage_pct < 95%`, mostrar warning antes
de generar cert + ofrecer reintento de captura de telemetría faltante.

### 7. Out of scope (próximas ADRs)

- **Phone-as-Telemetry** como tercer nivel intermedio (PWA con
  `navigator.geolocation` persistido en IndexedDB y subido al cierre del
  trip). Sería `route_data_source = phone_gps` y nivel `secundario_modeled`
  con factor de incertidumbre 0.10 (mejor que 0.15 maps-only, peor que
  0.05 Teltonika). **Postergado**: requiere consent flow y trabajo de PWA
  background-sync que no es prerequisite del feature de ruta verde.
- **Multi-leg trips con fuentes mixtas** (un leg con Teltonika, otro
  manual): será cubierto cuando se introduzca multi-leg planning. Por ahora
  cada leg lleva su propio `route_data_source` y el `nivel_certificacion`
  del trip se reduce al peor de los legs.
- **Streaming de actualización de cert**: si un trip arranca como
  `secundario_default` y luego llega telemetría retroactiva (ej. el
  dispositivo subió backlog), el cert se reemite — out of scope inicial,
  ver ADR posterior.

---

## Consecuencias

### Positivas

- **Greenwashing imposible por construcción**: el nivel de certificación
  es derivado, no auto-declarado, y la matriz es publicable como evidencia
  ante auditor.
- **Diferenciación comercial clara**: Verified/Enterprise tiers tienen
  valor concreto (cert auditable) que Basic no puede entregar. Justifica
  el upsell a transportistas que tengan clientes corporates.
- **Compatibilidad con ADR-016/017 sin breaking change**: `precision_method`
  sigue intacto. Solo se agregan dos campos (`route_data_source`,
  `coverage_pct`) y se materializa el nivel derivado.
- **Path de degradación seguro**: pérdida de señal mid-trip no rompe el
  sistema; degrada a secundario modeled con incertidumbre aumentada,
  consistente con GLEC §4.4 ladder.
- **Routes API es feature universal**: la sugerencia de ruta verde
  pre-trip funciona idéntica para ambos tiers; solo difiere la medición
  posterior y el cert resultante. Mismo código, dos outputs.

### Negativas

- **Migración de schema**: añadir dos columnas a `trip_metrics` requiere
  migración Drizzle + backfill de los trips históricos. Backfill: trips
  con `source = 'canbus'` pasan a `route_data_source = 'teltonika_gps'` +
  `coverage_pct = 100` (asumimos cobertura completa históricamente porque
  no fue tracked); trips con `source = 'modeled'` pasan a `maps_directions`
  + `coverage_pct = 0`.
- **Costo Routes API** se distribuye entre tiers: Basic paga 100% por su
  cuenta (o se subsidia con margen). Verified/Enterprise lo absorben en su
  membership. Modelar en pricing de tiers (issue separado a ADR-026).
- **Complejidad de UX**: el shipper Verified ve "tu cert es secundario
  porque la cobertura cayó al 78%" y necesita entender qué hacer. Requiere
  copywriting cuidadoso + path de remediation (re-captura de telemetría
  faltante o aceptar nivel reducido).

### Riesgos / mitigaciones

| Riesgo | Mitigación |
|---|---|
| Auditor cuestiona el threshold 95% para nivel primario | Documentar referencia: ISO 14083 §5.2 default tier, GLEC v3 Annex B sample size guidance, EcoTransIT Annex 7 |
| Carrier Verified se queja de "downgrades" frecuentes por falta de cobertura urbana | Phase 0 incluye dashboard `cobertura_promedio` por dispositivo: detectar dispositivos crónicamente bajo umbral → reposición de hardware o ajuste de antena |
| Cliente Basic se siente "ciudadano de segunda" | Marketing del upsell debe enfatizar **auditabilidad para Scope 3**, no calidad del cálculo (que es honesto en ambos casos) |
| `coverage_pct = NULL` en trips legacy → cálculo roto | Backfill obligatorio antes del release del nuevo cert generator. El campo se hace `NOT NULL` con default 0 después del backfill |
| Routes API caída → trips Basic no se pueden crear | Fallback a `manual_declared` (último nivel — `secundario_default`); reportar API outage al admin |

---

## Plan de implementación (referencia para PRs subsecuentes)

Este ADR define la decisión. Los PRs que la implementan en orden:

1. **PR-A** (esta ADR + sin código): merge ADR-028 a main como decision-of-record.
2. **PR-B** (Fase 0.1 — domain types): extender `packages/shared-schemas/domain/trip-metrics.ts` con `routeDataSourceSchema`, `nivelCertificacionSchema`, `coveragePctField`, `uncertaintyFactorField`. Sin migración aún — pure types.
3. **PR-C** (Fase 0.2 — calculator): extender `packages/carbon-calculator` con función `derivarNivelCertificacion` + `calcularFactorIncertidumbre`. Tests exhaustivos de la matriz §2 + tabla §3.
4. **PR-D** (Fase 0.3 — DB migration): Drizzle migration agregando `route_data_source`, `coverage_pct`, `certification_level`, `uncertainty_factor`. Backfill SQL para trips históricos. Deprecación de `source` (queda nullable, no se borra todavía).
5. **PR-E** (Fase 0.4 — certificate templates): split del actual `cert-primary` template en dos (`cert-primario.html` y `report-secundario.html`). Selector basado en `nivel_certificacion`. Disclaimer prominente en secundario.
6. **PR-F** (Fase 0.5 — API integration): `apps/api/src/services/calcular-metricas-viaje.ts` actualizado para escribir los nuevos campos al cerrar trip. Integración con telemetry-processor para calcular `coverage_pct`.
7. **PR-G y siguientes**: Fase 1 (eco-route suggestion), Fase 2 (driver scoring), Fase 3 (coaching IA), Fase 4 (network optimization). Cada fase puede subdividirse en múltiples PRs.

Cada PR pasa CI (lint + typecheck + test + coverage ≥80% + security) y se
mergea a `main`, disparando deploy automático vía `release.yml`.

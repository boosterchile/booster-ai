# ADR-012 — Observatorio Urbano + Gemelos Digitales + Eco-Routing Real-Time

**Status**: Accepted
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-005 Telemetría IoT](./005-telemetry-iot.md), [ADR-009 Análisis competitivo](./009-competitive-analysis-and-differentiators.md), [ADR-004 Sustainability Stakeholder](./004-uber-like-model-and-roles.md)

---

## Contexto

La reducción de huella de carbono no depende solo de medir: depende de **actuar en tiempo real** sobre factores que afectan emisiones (congestión, rutas subóptimas, detenciones evitables). Booster AI tiene dos oportunidades distintas pero complementarias:

1. **Eco-routing en tiempo real** — durante un trip activo, sugerir al conductor rutas alternativas o paradas temporales cuando la situación de tráfico hace que la ruta actual sea ineficiente energéticamente.
2. **Observatorio urbano** — agregar datos de miles de trips a lo largo del tiempo, por comuna, para identificar patrones de flujo (días/horarios/fechas con más/menos movimiento). Primer piloto: Coquimbo.
3. **Gemelos digitales** — representación virtual de la flota y la ciudad, útil para simulación (¿qué pasaría si agregamos 100 vehículos eléctricos?), planificación urbana (municipios), y predicción (ML sobre patrones históricos).

Estas tres capacidades son diferenciadores únicos frente a la competencia (ADR-009) y abren una **línea de revenue B2G** (business-to-government) además de enriquecer la propuesta de valor para shippers y carriers.

## Decisión

Implementar las tres capas como módulos distintos pero conectados dentro del monorepo, alimentados por el mismo pipeline de telemetría del ADR-005.

### Capa 1 — Eco-routing en tiempo real (durante trip activo)

**Propósito**: asesorar al conductor cuando la ruta actual se vuelve subóptima por tráfico/clima.

**Cómo funciona**:

```
Durante un trip activo:
  1. telemetry-processor detecta evento con speed < 10 km/h sostenido >60s en un punto
  2. Publica a topic `traffic-condition-events`
  3. eco-routing-service (Cloud Run consumer) analiza:
     - ¿Hay alternativa viable vía Routes API v2?
     - ¿La alternativa ahorra tiempo o reduce emisiones?
     - ¿Vale la pena el re-routing (cambio > 10% en métrica)?
  4. Si sí → publica `route-suggestion-event`
  5. notification-service envía al driver via Web Push en PWA
  6. Driver ve card con:
     - "Congestión detectada en <lugar>. Ahorrarías 8 min y 1.2 kg CO2e yendo por <alternativa>."
     - Botón "Aceptar sugerencia" / "Seguir ruta actual"
  7. Si acepta: Routes API emite nueva polilínea, driver navega via Google Maps embedded
  8. Acción queda en `route_suggestions` tabla para ML training futuro
```

**Variantes**:

- **Sugerencia de parada**: si tráfico es muy denso y alternativa no es viable, sugerir "Detente 15 min en <punto seguro>. Volveremos a recalcular ruta cuando baje la congestión." Reduce idling emissions.
- **Sugerencia de eco-driving**: si CAN bus Teltonika muestra RPM muy alto o aceleraciones bruscas, notificar coaching "Baja 500 RPM para ahorrar combustible". (Solo con consent del carrier.)

**Módulos**:
- `apps/eco-routing-service` — nueva app Cloud Run
- `packages/traffic-condition-detector` — lógica de detección de congestión desde telemetría
- `packages/route-alternatives-evaluator` — scoring de rutas alternativas (tiempo + emisiones + seguridad)

### Capa 2 — Observatorio urbano

**Propósito**: proveer insights agregados de flujos de transporte por área geográfica (comuna, región) a municipios, stakeholders y al propio equipo de Booster para data science.

**Piloto**: **Coquimbo** (región IV). Elección basada en:
- Ciudad de tamaño medio (rica en patrones observables sin saturación estilo Santiago)
- Actividad portuaria + agroindustrial (mix diverso de tipos de carga)
- Disponibilidad de contraparte municipal para colaboración

**Métricas por comuna**:

1. **Flujos por día/hora/fecha**
   - Vehículos/hora en cada corredor vial
   - Heatmaps por franja horaria (06-09, 09-12, 12-15, 15-18, 18-21, 21-06)
   - Comparativas día laboral vs fin de semana
   - Comparativas por tipo de vehículo (liviano vs pesado)

2. **Congestión**
   - Segmentos con velocidad promedio más baja que la del año anterior
   - Eventos de stop-and-go
   - Horas críticas por corredor

3. **Emisiones**
   - Total CO2e generado por transporte de carga en la comuna / período
   - CO2e evitado por empty-leg matching (valor diferenciador)
   - Emisiones por tipo de vehículo

4. **Origen-destino (OD matrix)**
   - De dónde salen las cargas de la comuna
   - A dónde llegan las cargas que ingresan
   - Flujos inter-comunales

5. **Vehículos activos**
   - Cantidad de vehículos con al menos un trip en la comuna / período
   - Crecimiento mes a mes

**Arquitectura**:

```
BigQuery (cold storage de telemetry_events + trips)
    ↓
Dataform SQL transformations (cada hora)
    ↓
BigQuery materialized views: urban_flow_metrics_hourly
    ↓
apps/api/src/routes/observatory/* (endpoints agregados)
    ↓
apps/web/src/roles/admin/observatory/ (vistas internas)
apps/web/src/roles/stakeholder/observatory/ (vistas para stakeholders autorizados)
Marketing: observatorio-urbano/<comuna> (landings comerciales para municipios)
```

**Privacidad**:
- **Agregación mínima**: no se muestran vehículos individuales en observatorio público; solo conteos y promedios. Granularidad mínima: 10 vehículos en el bucket para publicar.
- **Anonimización**: los IDs de vehículos/carriers no salen del sistema interno. Observatorio expone solo agregados.
- **Consent**: carriers consienten la agregación al onboarding (default opt-in; pueden opt-out sin penalización).

**Modelo de negocio B2G**:
- **Municipio Coquimbo piloto** gratis primeros 6 meses a cambio de colaboración institucional + case study.
- **Tiers** (ADR-010): Observatorio Básico UF 50/mes, Premium cotizar.
- **Dashboard exportable** en PDF mensual automático al municipio.

### Capa 3 — Gemelos digitales

**Propósito**: representar virtualmente **la flota** y **la ciudad** para simulación, predicción y planificación.

**Dos gemelos distintos**:

#### Gemelo de flota (per-carrier)

Representa el estado + historia completa de la flota de un carrier específico:
- Cada vehículo con su historial de trips, mantenimientos, eficiencia de combustible
- Simulación: "¿qué pasaría si reemplazo este camión diésel por eléctrico?" → proyecta costos + emisiones en 12 meses
- Predicción: "próximo mantenimiento recomendado del vehículo X" basado en patrones CAN bus
- Optimización: "reordenar asignaciones driver-vehicle basado en compatibilidad"

**Consumidores**: carrier (self-service), admin (vista agregada), stakeholder (si es mandante corporativo con consent del carrier).

#### Gemelo de ciudad (per-comuna)

Representa la estructura vial + patrones de flujo de una comuna:
- Red vial (desde OpenStreetMap + enriquecido con observaciones de Booster)
- Demanda de transporte proyectada por hora/día (ML sobre histórico)
- Simulación: "¿cómo cambia el flujo si cierran la calle X por obra?"
- Simulación: "¿cuánto CO2e evitamos si 30% de los carriers adoptan vehículos eléctricos?"
- Integración con modelos de tráfico de terceros (waze Data for Cities, Google Traffic) cuando sea posible

**Consumidores**: municipios (B2G), stakeholders regulators, data scientists internos de Booster, universidades asociadas (UC, UTFSM, etc.).

**Tech**:
- **Digital twin framework**: construido custom con `packages/digital-twin`
- **Motor de simulación**: SimPy (Python) — corre en Cloud Run Jobs bajo demanda
- **Visualización**: `apps/web/.../observatory/twin/` — mapas interactivos (Mapbox o Google Maps), time-lapse, scenarios side-by-side
- **ML**: Vertex AI AutoML para predicción de demanda; custom models en Vertex AI Training

### Integración con stakeholders ESG

El módulo **observatorio** enriquece la oferta al Sustainability Stakeholder (ADR-004):

- Auditor: puede cross-validar emisiones reportadas vs. flujos observados en comuna
- Corporate Mandator: ve que su supply chain contribuye X% del CO2e total de transporte en comuna Y
- Regulator: accede a datos agregados para políticas públicas
- Investor: proyecciones de gemelo digital alimentan análisis de cartera ESG

Esto multiplica valor del rol Sustainability Stakeholder sin requerir nuevos datos.

## Consecuencias

### Positivas

- **Diferenciador defensible**: ninguna plataforma chilena (Camiongo, CargaRápido, etc.) ofrece esto. Competir requiere años de acumulación de datos.
- **Nueva línea de revenue B2G**: municipios son cliente serio con presupuesto. UF 50/mes × 10 comunas = ingreso recurrente significativo.
- **Valor ESG enriquecido**: stakeholders reciben datos contextuales, no solo números de trips individuales. Aumenta willingness-to-pay.
- **Círculo virtuoso de datos**: más carriers → más telemetría → mejor observatorio → más municipios interesados → más credibilidad → más carriers.
- **Eco-routing reduce emisiones reales**: no solo "reporta menos", sino que **evita emisiones** cambiando comportamiento. Diferenciador de marketing.
- **Base para productos futuros**: gemelo digital puede escalar a "simulador de políticas públicas de transporte" con universidades/gobierno.

### Negativas

- **Complejidad técnica alta**: simulación, ML, visualización geoespacial, agregaciones BigQuery — cada pieza requiere expertise. Mitigar con:
  - Piloto Coquimbo acotado (no intentar todo Chile day 1)
  - Reuso de componentes existentes (Vertex AI, Mapbox, BigQuery)
  - Priorizar eco-routing > observatorio > gemelo (orden de ROI)
- **Privacidad crítica**: un observatorio mal anonimizado viola Ley 19.628 y destruye confianza de carriers. Mitigar:
  - Agregación mínima (10+ vehículos por bucket)
  - Consent explícito en onboarding
  - Auditoría legal antes de primera publicación
  - Feature flag para desactivar publicación si se detecta riesgo
- **Costos de infra**: BigQuery queries frecuentes + simulaciones ML + mapas interactivos cuestan. Mitigar:
  - Materialized views (no queries raw cada vez)
  - Caché agresivo de agregados (TTL 1h)
  - Cobrar al cliente (B2G) el costo variable
- **Dependencia de volumen de datos**: con 50 carriers, los observatorios son estadísticamente pobres. Mitigar lanzando observatorios solo cuando hay masa crítica (ej. 100+ vehículos activos en la comuna).

## Implementación (prioridad)

### Fase 1 — Eco-routing (Q3 2026)

Requiere: pipeline telemetría funcional (ADR-005), Routes API OAuth (ADR-009 2.0).

Entregables:
- `apps/eco-routing-service`
- `packages/traffic-condition-detector`
- `packages/route-alternatives-evaluator`
- Integración en driver PWA
- Tabla `route_suggestions` en BigQuery
- Métricas de adopción (% sugerencias aceptadas)

### Fase 2 — Observatorio Coquimbo (Q4 2026)

Requiere: ≥50 carriers activos en región IV con telemetría.

Entregables:
- Dataform transformations BigQuery
- Materialized views `urban_flow_metrics_*`
- Endpoints API observatorio
- Dashboard admin interno (vista `/admin/observatory/coquimbo`)
- Dashboard municipal completo (piloto comercial con municipio de Coquimbo)

### Fase 3 — Gemelo de flota (Q1 2027)

Requiere: Fase 2 funcional + ML pipeline básico (predicción mantenimientos).

Entregables:
- `packages/digital-twin`
- Simulador SimPy en Cloud Run Jobs
- UI visualización per-carrier
- Primeros 3 carriers piloto

### Fase 4 — Gemelo de ciudad + expansión observatorio (Q2-Q3 2027)

Requiere: Fases 1-3 + contratos B2G firmados.

Entregables:
- Modelo predictivo de demanda por comuna
- Simulador de escenarios multi-comuna
- Expansión a Santiago, Valparaíso, Concepción

## Nuevos apps y packages

### Apps nuevas

- `apps/eco-routing-service` (Fase 1)
- `apps/digital-twin-simulator` (Fase 3) — opcionalmente Python en Cloud Run

### Packages nuevos

- `packages/traffic-condition-detector`
- `packages/route-alternatives-evaluator`
- `packages/urban-observatory-queries` — queries BigQuery tipadas
- `packages/digital-twin` — modelo de dominio + interfaces

### Total post-ADR-012

El monorepo pasa de 9 apps (post-ADR-010) a **10-11 apps** según fases; y de 16 packages a **~20 packages**.

## Validación

- [ ] Eco-routing: durante trip, la detección de congestión se dispara en <60s
- [ ] Sugerencia llega al driver en <5s tras detección
- [ ] ≥30% de sugerencias son aceptadas (meta inicial)
- [ ] Observatorio Coquimbo: dashboards reflejan datos reales actualizados cada hora
- [ ] Agregación respeta mínimo 10 vehículos por bucket publicado
- [ ] Municipio Coquimbo usa el dashboard al menos 1x/semana durante piloto
- [ ] Gemelo flota: predicción de mantenimiento con precisión >70% sobre validación histórica
- [ ] Gemelo ciudad: simulación de escenario produce resultados en <5 min para 100K eventos
- [ ] Ninguna vulneración a Ley 19.628 en auditoría del observatorio público

## Referencias

- [ADR-005 Telemetría IoT](./005-telemetry-iot.md)
- [ADR-004 Modelo Uber-like + Sustainability Stakeholder](./004-uber-like-model-and-roles.md)
- [ADR-009 Competitive analysis](./009-competitive-analysis-and-differentiators.md)
- SimPy — Discrete Event Simulation: https://simpy.readthedocs.io/
- Vertex AI AutoML: https://cloud.google.com/vertex-ai/docs/automl/overview
- OpenStreetMap: https://www.openstreetmap.org/

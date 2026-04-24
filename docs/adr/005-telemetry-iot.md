# ADR-005 — Arquitectura de telemetría IoT a escala (1000+ dispositivos Teltonika)

**Status**: Accepted (amendment 2026-04-23 v2: clarificación sobre reemplazo de Fleet Engine)
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-001](./001-stack-selection.md), [ADR-004 Modelo Uber-like](./004-uber-like-model-and-roles.md)

## Amendment v2 — Reemplazo de Google Maps Fleet Engine

Google Maps Platform Fleet Engine (el producto managed que ofrece dispatch + tracking + ETAs) **requiere acuerdo comercial con mínimo de 20,000 viajes mensuales** para ser aprovisionado. Booster AI, como producción TRL 10 comercial, debe operar desde day 1 sin ese volumen y sin esperar whitelisting de Google.

La arquitectura propuesta en este ADR **reemplaza 1:1 las capacidades de Fleet Engine** con componentes managed de GCP ya disponibles, sin degradar funcionalidad:

| Capacidad Fleet Engine | Reemplazo production-grade |
|------------------------|----------------------------|
| Vehicle tracking real-time | Teltonika Codec8 → Pub/Sub → `telemetry-processor` → Firestore real-time listeners |
| Last-known position O(1) | Redis `vehicle:{id}:position` con TTL 5 min |
| Dispatch de trips | `apps/matching-engine` propio (scoring multifactor — ver ADR-004) |
| ETA calculation | Routes API v2 `computeRoutes` bajo demanda (OAuth ADC, no API key) |
| Multi-stop optimization | Route Optimization API `optimizeTours` |
| Distance matrix | Routes API v2 `computeRouteMatrix` |
| Trip lifecycle | `packages/trip-state-machine` (XState) — ADR-004 |
| Driver app sync | Firestore SDK con security rules por rol — ADR-008 |
| Historical tracking | BigQuery particionada por día, retención 7 años |
| Incident replay | Pub/Sub snapshot 24h + BigQuery cold path |

Fleet Engine se re-evaluará cuando Booster AI supere los 20,000 viajes/mes y Google apruebe el acuerdo comercial. Hasta entonces, esta arquitectura es la solución production-grade.

---

## Contexto

Booster AI debe soportar **posicionamiento en tiempo real** de vehículos desde dos fuentes:

1. **Dispositivos Teltonika FMS150** instalados en camiones — fuente confiable y continua 24/7, reporta por protocolo binario Codec8 sobre TCP.
2. **PWA del conductor** (apps/web en rol driver) — reporta posición del smartphone mientras el conductor está en un trip activo, vía HTTP JSON autenticado.

Volumen objetivo: **1000 dispositivos Teltonika con proyección de crecimiento**. Esto implica:

- Telemetría cada 30s → ~33 eventos/s baseline, ~100 eventos/s en peak (inicio/fin de jornada)
- ~3M eventos/día, ~90M eventos/mes, ~1.1B eventos/año
- Conexiones TCP persistentes 24/7 desde los 1000 dispositivos
- Crecimiento esperado: 10K dispositivos en 24-36 meses

**Cloud Run NO es adecuado para el gateway TCP** porque:
- Cloud Run está diseñado para HTTP request/response, no TCP persistente
- El modelo scale-to-zero mata conexiones largas
- Concurrency limits (1000 requests/instance) no calza con modelo de conexión TCP persistente
- Timeouts máximos de 60 minutos invalidan conexiones continuas

## Decisión

### Arquitectura de tres capas

```
┌─────────────────────────────────────────────────────────┐
│ CAPA 1 — INGESTIÓN                                      │
│                                                          │
│  Teltonika devices ─TCP Codec8─► telemetry-tcp-gateway  │
│                                  (GKE Autopilot)         │
│                                       │                  │
│  PWA driver ──HTTP/JSON───────►  api /v1/telemetry      │
│                                  (Cloud Run)             │
│                                       │                  │
│  Ambos producen: TelemetryEvent canónico                │
└───────────────────┬─────────────────────────────────────┘
                    ▼
            Pub/Sub topic: telemetry-events
                    │
┌───────────────────┴─────────────────────────────────────┐
│ CAPA 2 — PROCESAMIENTO                                  │
│                                                          │
│  telemetry-processor (Cloud Run push subscription)      │
│    - Deduplicación (hash de event_id)                   │
│    - Validación plausibilidad (velocidad, salto geo)    │
│    - Enriquecimiento (reverse geocoding, geofencing)    │
│    - Correlación con Trip activo                        │
│                                                          │
│  Escribe a 2 destinos                                   │
└─────────────┬────────────────────────────┬──────────────┘
              ▼                            ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│ HOT — Firestore         │  │ COLD — BigQuery         │
│ vehicles/{id}/position  │  │ telemetry_events_*      │
│ TTL 5 min               │  │ Particionada por día    │
│ Real-time sync a web    │  │ Analytics + ML training │
└─────────────────────────┘  └─────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│ CAPA 3 — DISTRIBUCIÓN REAL-TIME                         │
│                                                          │
│  Firestore listeners en apps/web (rol shipper/admin)    │
│  ven la última posición del vehículo automáticamente    │
│                                                          │
│  Filtros por Security Rules:                            │
│    - Shipper solo ve vehículos de sus trips activos     │
│    - Carrier ve sus propios vehículos                   │
│    - Admin ve todo                                       │
└─────────────────────────────────────────────────────────┘
```

### Elecciones por componente

| Componente | Tecnología | Por qué |
|------------|-----------|---------|
| TCP gateway Teltonika | **GKE Autopilot** | Maneja conexiones persistentes 24/7 nativamente. Autopilot = serverless GKE (paga por uso real). Auto-escala pods. HPA configurado por conexiones activas. |
| Protocolo | **Codec8** (Teltonika nativo) | Definido por fabricante. Binario eficiente (packets de ~40 bytes promedio). Parser en `packages/codec8-parser`. |
| Bus de eventos | **Pub/Sub** | Managed, escala a millones de eventos/s, at-least-once delivery, ordering keys opcional. Push subscription → Cloud Run. |
| Procesador | **Cloud Run** con Pub/Sub push | Escala con tráfico, paga por ejecución. Un service por tipo de evento (flexibility futura). |
| Hot storage | **Firestore** | Real-time listeners nativos en web. Security Rules para filtrado por rol. Sub-colección `vehicles/{id}/position`. |
| Cold storage | **BigQuery** | Particionado por día, clustering por vehicle_id. Ingesta streaming (BigQuery Storage Write API). Query para analytics ESG + ML. |
| Real-time a apps | **Firestore SDK en web** | Listeners con diff, reconecta automático, funciona offline (cache local). No requiere WebSocket custom. |
| Monitoring | **Cloud Monitoring custom metrics** | Eventos/segundo por gateway pod, lag de procesamiento, dispositivos activos, dispositivos offline > 10 min. |

### El evento canónico `TelemetryEvent`

Definido en `packages/shared-schemas`:

```typescript
// Boceto, se materializa en código
const TelemetryEvent = z.object({
  event_id: z.string().uuid(),          // genera ingestor, usado para dedup
  source: z.enum(['teltonika', 'pwa']),
  source_device_id: z.string(),          // IMEI Teltonika o device_id de PWA
  vehicle_id: z.string().uuid(),         // resuelto por ingestor
  trip_id: z.string().uuid().optional(), // si hay trip activo
  timestamp_device: z.string().datetime(),  // cuando el dispositivo lo midió
  timestamp_ingested: z.string().datetime(),// cuando Booster lo recibió
  position: z.object({
    lat: z.number(),
    lng: z.number(),
    accuracy_m: z.number().optional(),
    altitude_m: z.number().optional(),
    heading_deg: z.number().optional(),
    speed_kmh: z.number().optional(),
  }),
  sensors: z.object({                    // solo Teltonika via CAN bus
    fuel_level_pct: z.number().optional(),
    rpm: z.number().optional(),
    engine_temp_c: z.number().optional(),
    odometer_km: z.number().optional(),
    ignition: z.boolean().optional(),
  }).optional(),
  battery: z.object({
    voltage_v: z.number().optional(),
    external_power: z.boolean().optional(),
  }).optional(),
});
```

**Garantías**:
- `event_id` UUID v4 generado en el ingestor → dedup en procesador.
- `timestamp_device` vs `timestamp_ingested` captura latencia de red.
- Schema compartido entre gateway TCP, api HTTP, procesador y consumidores.

### Codec8 parser (paquete dedicado)

`packages/codec8-parser` provee:
- `parseCodec8Packet(buffer: Buffer): TelemetryEvent[]` — convierte un packet binario Teltonika a eventos canónicos.
- Manejo de todos los AVL IO elements documentados por Teltonika.
- Ack generation para cerrar el handshake TCP.
- Tests deterministas contra fixtures binarios reales.

Esto **independiza al resto del sistema del protocolo Teltonika**. Si mañana entra otro fabricante (ej. Ruptela, Queclink), se implementa su parser y produce el mismo `TelemetryEvent`.

### Deduplicación y validación de plausibilidad

En `apps/telemetry-processor`:

- **Dedup**: Redis SET `dedup:{event_id}` con TTL 24h. Si el evento llega nuevamente (ack perdido, retry), se rechaza.
- **Plausibilidad**:
  - Velocidad > 150 km/h → flag como anómalo (probable GPS glitch)
  - Salto geográfico > distancia × velocidad × 2 → flag
  - Timestamp futuro > 5 min → reject
  - Lat/Lng fuera de bounds Chile + Latam → flag (puede ser dispositivo en pruebas)

Los eventos flagged se escriben igual pero con `is_anomalous=true` para no perder información y permitir debugging.

### Asociación evento → Trip activo

El procesador consulta Redis `driver:{driver_id}:active_trip` para determinar si el evento pertenece a un trip en curso. Si sí:

- Enriquece con `trip_id`
- Actualiza métricas del trip en real-time (distancia recorrida, tiempo, consumo estimado)
- Dispara cálculo incremental de huella de carbono

Si no hay trip activo, el evento se guarda igual (útil para analytics, debugging, y tracking histórico de dispositivos) pero no afecta estado de trip.

### Carbon footprint durante el viaje

Diferencia clave vs Booster 2.0: el cálculo **NO se hace al final del trip**, se hace **incrementalmente durante el viaje**:

- Por cada `TelemetryEvent` con `sensors.fuel_level_pct` o `odometer_km` (vía CAN bus Teltonika) → cálculo exacto de combustible consumido desde el último evento.
- Si no hay CAN bus (PWA) → estimación basada en distancia × factor de emisión del vehículo (kg CO₂e/km GLEC v3.0).
- Suma acumulada en `trip.carbon_emissions_kgco2e_current`.
- Al cierre del trip → snapshot final + certificado ESG.

### Matching-engine integration (Uber-like awareness)

El procesador también publica a `vehicle-availability-events` cuando detecta:
- Un vehículo con ignition=off + estado "not-on-trip" durante >5min → considerado "disponible" en su ubicación actual.
- Un vehículo que completa un trip → disponible en el destino.

Esto alimenta al matching engine (ADR-004) para ofrecer empty-legs automáticamente.

## Consecuencias

### Positivas

- **Escala a 10K+ dispositivos** sin cambio arquitectónico (GKE Autopilot + Pub/Sub + BigQuery son horizontales).
- **Desacoplado**: nuevos consumidores (ML pipeline, third-party integrations) se suscriben al topic sin tocar ingestión.
- **Real-time sin WebSockets custom**: Firestore maneja conexiones, reconexión, diff, offline cache.
- **Auditabilidad TRL 10**: cada evento tiene `event_id` único, timestamps device vs ingested, y queda en BigQuery 5+ años.
- **Multi-vendor futuro**: el `TelemetryEvent` canónico + parser por fabricante permite añadir Ruptela, Queclink, etc.

### Negativas

- **Complejidad operativa**: 5 piezas managed (GKE, Pub/Sub, Firestore, BigQuery, Cloud Run) vs una DB monolítica. Mitigado con Terraform + runbooks.
- **Costo de Firestore con 1000 vehículos**: cada actualización de posición es 1 write. ~33 writes/s × 86400s ≈ 2.8M writes/día. Firestore cobra ~$0.18/100K writes → ~$5/día en writes. Manejable.
- **Latencia de procesamiento**: evento viene del dispositivo → gateway → Pub/Sub → procesador → Firestore. Total esperado <2s. Para casos donde se necesita <100ms, usar WebSocket custom sería más rápido. Ese nivel de latencia no es requisito actual.
- **Debugging de eventos perdidos**: dead-letter queue obligatorio en Pub/Sub subscription; runbook `debugging-lost-telemetry` cubrirá el proceso.

## Implementación inicial

### Apps

- `apps/telemetry-tcp-gateway` — Node.js server TCP en GKE Autopilot. Kubernetes Deployment con HPA por CPU + métricas custom (conexiones activas). Network Load Balancer (TCP) con IP estática pública.
- `apps/telemetry-processor` — Cloud Run con Pub/Sub push subscription. Max concurrency 10 (para control de rate a Firestore/BigQuery). Auto-escala.

### Packages

- `packages/codec8-parser` — parser puro, testeable, sin deps de red.
- `packages/telemetry-schema` — `TelemetryEvent` Zod + tipos compartidos.

### Infra (Terraform)

- GKE Autopilot cluster (regional, multi-zone para HA desde day 1 — producto comercial TRL 10)
- Pub/Sub topic `telemetry-events` + dead-letter topic `telemetry-events-dlq`
- Firestore (modo Native, región southamerica-east1)
- BigQuery dataset `booster_telemetry` con tabla `events` particionada por día
- IAM: SAs dedicadas para gateway, processor, con mínimo privilegio
- Cloud Monitoring alertas: events/s por debajo de baseline, latencia p95 > 5s, DLQ no vacío

## Validación

- [ ] Simulador de 10 dispositivos Teltonika inyecta a gateway local → events llegan a Pub/Sub
- [ ] Procesador consume y escribe correctamente a Firestore + BigQuery
- [ ] Duplicado del mismo evento es rechazado por dedup
- [ ] Evento con lat/lng fuera de Chile es flagged
- [ ] Listener en apps/web ve la posición actualizándose en tiempo real
- [ ] Load test con 1000 simulated devices durante 1h sin pérdida de eventos
- [ ] Dashboard Cloud Monitoring muestra: events/s, lag, DLQ, dispositivos activos

## Referencias

- Teltonika FMS150 Codec8 Protocol: https://wiki.teltonika-gps.com/view/Codec
- GKE Autopilot: https://cloud.google.com/kubernetes-engine/docs/concepts/autopilot-overview
- Firestore real-time listeners: https://firebase.google.com/docs/firestore/query-data/listen
- Pub/Sub at-least-once: https://cloud.google.com/pubsub/docs/subscriber
- Booster 2.0 Codec8 implementation reference: `../../Booster-2.0/backend/src/iot/codec8.ts`

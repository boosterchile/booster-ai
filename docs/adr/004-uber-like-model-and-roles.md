# ADR-004 — Modelo Uber-like con 5 roles y matching carrier-based

**Status**: Accepted (amendment 2026-04-23 v2 — añadido 5to rol Sustainability Stakeholder)
**Date**: 2026-04-23
**Decider**: Felipe Vicencio (Product Owner)
**Related**: [ADR-001](./001-stack-selection.md), [ADR-005 Telemetría IoT](./005-telemetry-iot.md), [ADR-007 Gestión documental Chile](./007-chile-document-management.md), [ADR-008 PWA multi-rol](./008-pwa-multirole.md)

---

## Contexto

Booster AI opera como una **plataforma tipo Uber para transporte de carga** en el mercado chileno (con vocación latinoamericana). El modelo no es un marketplace estático de ofertas, sino un sistema de **matching en tiempo real** basado en disponibilidad actual de vehículos, posición geográfica y capacidad.

El mercado objetivo incluye empresas de transporte (carriers) con flotas pequeñas/medianas y conductores independientes (carrier-unipersonal). La disciplina contractual del sector es baja: las órdenes suelen generarse vía WhatsApp o llamadas telefónicas, sin trazabilidad digital previa a Booster AI.

Esto fuerza cinco decisiones fundacionales:

1. **Cinco roles de usuario** con interfaces diferenciadas (amendment v2: añadido 5to rol).
2. **Matching a nivel carrier, no driver** — respeta la jerarquía real (el dueño decide qué viajes toma su flota).
3. **Soporte de carrier-unipersonal** — el caso donde carrier y driver son la misma persona.
4. **Trip lifecycle explícito** — estados del viaje modelados como máquina de estados, no como flags ad-hoc en BD.
5. **Observabilidad de datos ESG por terceros autorizados** — mandantes corporativos y auditores acceden a datos de sostenibilidad con consent explícito del shipper/carrier.

## Decisión

### Cinco roles de usuario

| Rol | Quién es | Qué hace en la plataforma |
|-----|----------|--------------------------|
| **Shipper** | Empresa o persona que necesita transportar carga | Publica necesidad de transporte, recibe ofertas, acepta, paga, rastrea en tiempo real, califica |
| **Carrier** | Dueño de empresa de transporte (o independiente) | Registra flota y conductores, recibe ofertas de carga, acepta/rechaza, asigna a un conductor, supervisa sus viajes, recibe pago, factura |
| **Driver** | Conductor asignado a un viaje específico | Recibe notificación de viaje asignado, acepta, ejecuta trayecto, captura documentos, reporta incidencias, confirma entrega |
| **Admin** | Staff interno Booster | Gestiona usuarios, resuelve disputas, audita operaciones, genera reportes corporativos, configura parámetros (pricing, áreas de cobertura) |
| **Sustainability Stakeholder** | Mandante corporativo, stakeholder ESG interno, auditor externo, regulador o inversor con interés en la huella de carbono de terceros | Accede a dashboards agregados de métricas ESG, exporta reportes estandarizados (GLEC, GHG Protocol, GRI, SASB, CDP, ISO 14064), consulta certificados verificados de trips, suscribe a reporte periódico. **Solo lectura** + audit trail completo. |

### Subtipos de Sustainability Stakeholder

El rol tiene un campo `stakeholder_type` en metadata para ajustar permisos y UX:

| Subtipo | Contexto típico | Permisos característicos |
|---------|-----------------|--------------------------|
| `corporate_mandator` | Empresa cliente final (ej. Walmart Chile) que contrata via un shipper intermediario | Ve métricas agregadas de su cadena de suministro; accede a certificados ESG de los trips asociados |
| `internal_sustainability` | CSO o equipo ESG de shipper/carrier | Ve métricas detalladas de su propia organización; exporta reportes internos |
| `auditor` | Firma externa (PwC, Deloitte, Bureau Veritas) | Acceso temporal (ventana limitada) a datos para auditar un período específico; audit trail obligatorio |
| `regulator` | Ministerio de Medio Ambiente, SMA | Acceso legal según marco regulatorio (Ley 21.600 Delitos Económicos y Ambientales, futura regulación carbono) |
| `investor` | Fondo ESG, banco con cartera sostenible | Métricas de portfolio con anonimización según consent |

### Relación de entidades

```
User (cuenta Firebase Auth)
  └─ puede tener uno o más Role: [shipper, carrier, driver, admin]

Carrier
  └─ tiene muchos Drivers (1:N)
  └─ tiene muchos Vehicles (1:N)
  └─ pertenece a un User (owner)

Caso especial: Carrier unipersonal
  └─ El mismo User tiene roles [carrier, driver]
  └─ El Carrier tiene exactamente 1 Driver = el owner
```

Un User con rol `carrier` siempre tiene registro en tabla `Carrier`. Un User con rol `driver` siempre tiene registro en `Driver` **y** referencia al `Carrier` al que pertenece (incluso si es carrier-unipersonal, el driver referencia al carrier consigo mismo).

Un User con rol `sustainability_stakeholder` tiene registro en tabla `SustainabilityStakeholder` con scopes de acceso (qué shippers/carriers/trips puede observar, otorgados por consent). Ver sección siguiente.

### Acceso consent-based de Sustainability Stakeholders

Los stakeholders ESG **no tienen acceso por defecto** a datos de ningún shipper o carrier. Cada acceso requiere un **consent explícito**:

```
SustainabilityStakeholder
  ├─ id (UUID)
  ├─ user_id (FK a User)
  ├─ organization_name, organization_rut
  ├─ stakeholder_type (enum: corporate_mandator | internal_sustainability | auditor | regulator | investor)
  └─ scopes[]: ConsentGrant
      ├─ granted_by_user_id (quién otorgó el consent)
      ├─ scope_type (shipper | carrier | trip_portfolio | organization)
      ├─ scope_id (UUID del shipper/carrier/trip)
      ├─ granted_at, expires_at (nullable — para auditorías con ventana)
      ├─ data_categories[] (carbon_emissions, routes, distances, fuels, certificates)
      ├─ revoked_at (nullable)
      └─ consent_document_url (PDF firmado con el acuerdo)
```

**Flujo de onboarding de un Sustainability Stakeholder**:

1. Shipper/Carrier invita al stakeholder via email (form en su UI → genera link con token)
2. Stakeholder se registra con datos de organización y acepta términos de uso ESG
3. Shipper/Carrier define el `scope` específico en el formulario de consent:
   - Qué organizaciones/trips puede ver
   - Qué categorías de datos (emisiones, distancias, combustibles)
   - Ventana temporal (permanente o con expiración)
4. Se genera documento PDF de consent firmado digitalmente por ambas partes, archivado en Cloud Storage con retention
5. Stakeholder accede a su dashboard con el scope otorgado

**Revocación**: Shipper/Carrier puede revocar el acceso en cualquier momento desde su UI. El stakeholder pierde acceso inmediato; los datos exportados previamente son de responsabilidad del stakeholder (cubierto en términos de uso).

**Audit trail obligatorio**: cada consulta, export o descarga del stakeholder se registra en tabla `stakeholder_access_log` (user_id, scope_id, action, timestamp, ip, user_agent). BigQuery para analytics. Acceso a este log restringido a Admin + el propio stakeholder + el shipper/carrier que otorgó el consent.

### Flujo de matching carrier-based

```
1. SHIPPER publica CargoRequest
   (origen, destino, tipo de carga, peso, volumen, deadline, tipo de vehículo requerido)

2. MATCHING ENGINE evalúa candidates
   - Filtra carriers con vehículos disponibles
   - Scoring multifactor: distancia a origen, capacidad, rating, precio histórico,
     emisión estimada
   - Genera lista ranked de carriers candidatos

3. PLATAFORMA envía oferta push al CARRIER (no al driver)
   - Canal: Web Push (PWA Service Worker) + FCM + WhatsApp fallback
   - Ventana de aceptación: configurable (ej. 3 min en horario peak, 10 min off-peak)

4. CARRIER acepta o rechaza
   - Si rechaza o expira: matching engine pasa al siguiente candidato
   - Si acepta: ofertas a otros candidatos se cancelan

5. CARRIER asigna driver
   - En UI del carrier: lista de sus drivers disponibles
   - Selecciona driver + vehicle
   - Caso unipersonal: auto-asignado a sí mismo

6. DRIVER recibe notificación "nueva carga asignada"
   - Canal: Web Push al PWA en el teléfono del conductor
   - Muestra detalles del trayecto + botón "Iniciar viaje"

7. DRIVER inicia trayecto
   - Click "Iniciar viaje" dispara:
     - Trip state: requested → accepted → driver_en_route
     - Telemetría empieza a tracking (ver ADR-005)
     - Cálculo de huella de carbono empieza
     - Countdown de ETA al pickup

8. DRIVER en pickup
   - Captura documentos pre-pickup (foto de carga, carta porte firmada)
   - Estado: driver_en_route → pickup_completed → in_transit

9. DRIVER en entrega
   - Captura documentos post-entrega (foto, firma táctil receptor, acta)
   - Estado: in_transit → delivered

10. SHIPPER confirma recepción
    - Estado: delivered → confirmed_by_shipper
    - Dispara cálculo final de:
      - Huella de carbono (ver ADR-003 del 2.0 para metodología GLEC v3.0)
      - Precio final (base + extras si hubo desvíos)
      - Certificado ESG

11. Ambos califican
    - Shipper califica al carrier (y driver)
    - Carrier y driver califican al shipper
    - Estado: confirmed_by_shipper → completed_rated

12. Facturación y pago
    - Genera DTE (ver ADR-007 gestión documental Chile)
    - Triggering pago según configuración (a los N días)
```

### Trip lifecycle como máquina de estados

Estados:

```
requested
  ↓ (matching engine asigna)
offered_to_carrier
  ↓ (carrier acepta)
accepted
  ↓ (carrier asigna driver)
driver_assigned
  ↓ (driver acepta)
driver_en_route
  ↓ (driver llega y carga)
pickup_completed
  ↓
in_transit
  ↓ (llega a destino)
delivered
  ↓ (shipper confirma)
confirmed_by_shipper
  ↓ (rating)
completed_rated

Estados de excepción desde cualquier estado activo:
  → carrier_rejected   (desde offered_to_carrier)
  → carrier_timed_out  (desde offered_to_carrier)
  → driver_rejected    (desde driver_assigned)
  → cancelled_by_shipper
  → cancelled_by_carrier
  → failed             (incidente, vehículo averiado, accidente)
  → disputed           (disputa abierta)
```

Implementación: `packages/trip-state-machine` con **XState**. Cada transición:
- Tiene guardas (precondiciones)
- Emite eventos al Pub/Sub `trip-events` topic
- Persiste snapshot en PostgreSQL
- Actualiza Firestore para sync real-time a apps web

### Notificaciones por rol y canal

| Evento | Destinatario | Canales (en orden de prioridad) |
|--------|-------------|----------------------------------|
| Nueva oferta de carga | Carrier | Web Push → FCM → WhatsApp → Email |
| Carga asignada | Driver | Web Push → FCM → WhatsApp → SMS |
| Driver en ruta | Shipper | Web Push → Email |
| Driver llegó al pickup | Shipper | Web Push → WhatsApp → Email |
| Entrega confirmada | Shipper + Carrier | Web Push → Email |
| Incidencia reportada | Admin + involucrados | Web Push → Email → WhatsApp |
| Disputa abierta | Admin + involucrados | Email + Web Push |
| Pago procesado | Carrier | Email + WhatsApp |
| Certificado ESG emitido | Shipper + Carrier + Stakeholders con scope | Email + Web Push |
| Reporte ESG periódico listo | Sustainability Stakeholder | Email con link |
| Scope de consent revocado | Sustainability Stakeholder | Email |

Web Push requiere Service Worker activo y permiso del usuario. La degradación a otros canales debe ser automática si el push falla o no hay permiso.

### Pricing dinámico (introducción breve; ADR dedicado futuro)

Factores:
- Distancia Haversine + factor de ruta real (Routes API)
- Tipo y peso de carga (tarifa base + premium por refrigerado, frágil, peligroso)
- Tipo de vehículo
- Time of day (surge en peak; descuento off-peak si se quiere incentivar empty-leg)
- Demanda/oferta actual en el origen (scarcity surge)
- Rating del carrier (carriers top tienen menos descuento en negociación)
- Distancia adicional si el viaje completa un empty-leg conocido → descuento ESG

Arquitectura: `packages/pricing-engine` como librería pura, determinística, con tests exhaustivos. Un cambio de fórmula genera un commit trazable.

## Consecuencias

### Positivas

- **Modelo mental claro**: cada rol sabe exactamente qué hace. Reduce carga cognitiva y errores de UX.
- **Respeta la cadena de mando real** del sector transporte: el carrier decide, el driver ejecuta.
- **Soporta operadores unipersonales** sin friction adicional — el mismo User asume dos roles.
- **Auditable para TRL 10**: cada transición de trip es un evento en Pub/Sub + snapshot en BD. Auditor puede reconstruir cualquier viaje histórico.
- **Escalable**: matching engine es stateless, consume de Pub/Sub, escala horizontal.
- **Resiliente**: si la oferta a un carrier expira, el engine automáticamente pasa al siguiente. No hay bloqueo humano.

### Negativas

- **Complejidad de UX**: cuatro interfaces distintas multiplican el trabajo de diseño. Mitigado con sistema de diseño compartido (Tailwind + shadcn/ui + tokens).
- **Carrier unipersonal requiere "skin change"**: la misma persona ve interfaz de carrier y de driver según contexto del viaje. Mitigado con toggle claro "Modo Carrier | Modo Conductor".
- **XState tiene curva de aprendizaje**: el equipo debe entender máquinas de estados. Justificado por el beneficio de tener el lifecycle como código verificable vs. lógica imperativa dispersa.
- **Latencia de matching**: un carrier que tarda 3 min en aceptar suma 3 min al tiempo total del matching. Mitigado con offering paralelo controlado (ofertar a top 2 simultáneamente) o ventanas cortas en horario peak.

## Implementación inicial

### Packages nuevos

- `packages/trip-state-machine` — XState machines para el trip lifecycle.
- `packages/matching-algorithm` — algoritmo de scoring y selección de candidatos.
- `packages/pricing-engine` — cálculo determinístico de precio.
- `packages/notification-fan-out` — orquestador que determina canal según evento + destinatario + fallbacks.

### Apps nuevas

- `apps/matching-engine` — Cloud Run service que consume `cargo-requested-events` y produce `offer-sent-events`.
- `apps/notification-service` — Cloud Run service que consume `notification-events` y fan-out a Web Push + FCM + WhatsApp + Email + SMS.

### Schemas Zod en `packages/shared-schemas`

```ts
// Boceto inicial — se materializará en código
Shipper, Carrier, Driver, User, Role
Vehicle (capacity, type, plates, Teltonika imei)
CargoRequest (origin, destination, cargo type, weight, volume, deadline, requirements)
Trip (shipper, carrier, driver, vehicle, cargo, state, timestamps)
TripEvent (trip_id, from_state, to_state, actor, timestamp, metadata)
MatchingOffer (cargo_request_id, carrier_id, sent_at, expires_at, status)
```

## Validación

Este modelo se considera correctamente implementado cuando:

- [ ] Los 4 roles tienen UI diferenciada en `apps/web`.
- [ ] Un User puede tener múltiples roles (caso carrier unipersonal cubierto).
- [ ] El matching engine ofrece cargas a carriers, nunca a drivers directamente.
- [ ] El carrier puede asignar driver y la notificación llega al driver elegido.
- [ ] El trip lifecycle es una máquina XState con transiciones verificables.
- [ ] Todos los cambios de estado emiten evento a Pub/Sub + persisten snapshot.
- [ ] Escenario E2E: shipper crea → matching ofrece a carrier → carrier acepta → asigna driver → driver ejecuta → shipper confirma → ambos califican.

## Referencias

- [ADR-001 — Stack](./001-stack-selection.md)
- [ADR-005 — Telemetría IoT](./005-telemetry-iot.md)
- [ADR-006 — WhatsApp](./006-whatsapp-primary-channel.md)
- [ADR-007 — Gestión documental Chile](./007-chile-document-management.md)
- [ADR-008 — PWA multi-rol](./008-pwa-multirole.md)
- XState: https://stately.ai/docs/xstate
- Patrón Uber-like Dispatch (overview público): https://eng.uber.com/matching/

# Eco-route loop closure — 2026-05-10 (sesión 2)

**Owner**: dev@boosterchile.com
**Sprint**: 1 sesión maratón continuación (6 PRs)
**Origen**: continuación del feedback PO "Booster a través de IA debe sugerir la mejor ruta o comportamiento en ruta que permita reducir la huella de carbono"
**Handoff anterior**: `2026-05-10-feedback-feature-end-to-end.md`

---

## TL;DR

Cierra el **loop completo** de la visión PO. Antes de esta sesión, la AI calculaba la huella ANTES de aceptar (Phase 1), generaba coaching POST-entrega (Phase 3), y tenía voice-first UX (Phase 4) y tracking público (Phase 5) en parcial. Esta sesión:

1. **Voice-first DRIVER UX cerrado**: K1-K7 (intents) + nuevo **K8** (onboarding Modo Conductor pantalla dedicada)
2. **Voice command framework cerrado**: último intent (`aceptar_oferta`, PR-K7) wired al control real
3. **Push notif al shipper** en incidentes (PR-K6c)
4. **ETA tracking público** con Routes API on-demand + cache (PR-L2c)
5. **Eco-route polyline preview** visualizado en mapa pre-accept (PR-H4)
6. **Driver ve la ruta eco-eficiente DURANTE el viaje** (PR-H5) — cierra el loop carrier→driver

**No hay blockers operacionales restantes** del backlog identificado. Meta approval `tracking_link_v1` sigue como único external pendiente.

---

## PRs delivered en esta sesión

| PR | Título | Phase | Tests |
|---|---|---|---|
| #138 | feat(api): push notif al shipper cuando se reporta incidente | Phase 4 PR-K6c | +8 api |
| #140 | feat(web): aceptar oferta por voz — cierra voice command framework | Phase 4 PR-K7 | +9 web |
| #141 | feat(web): onboarding Modo Conductor — cierra ciclo voice-first | Phase 4 PR-K8 | +23 web (13 service + 10 route) |
| #144 | feat(api): ETA tracking público vía Routes API on-demand | Phase 5 PR-L2c | +17 api |
| #146 | feat(eco-preview): mapa de la ruta sugerida en el preview ambiental | Phase 1 PR-H4 | +13 web (7 polyline + 4 component + 2 api) |
| #149 | feat(assignments): driver ve la ruta eco-eficiente durante el viaje | Phase 1 PR-H5 | +16 (9 api + 7 web) |

Total tests añadidos: **+86 tests** entre api y web.

---

## Cambios estructurales por phase

### Phase 4 — Voice-first driver UX → cerrado end-to-end

**Estado pre-sesión**: K1-K6b implementados, K6c-K7-K8 pendientes.

**Cambios**:
- **PR-K6c** (`apps/api/src/services/notify-incident-shipper.ts`): cuando el driver reporta incidente vía voz/visual, se dispara un push notif al shipper con `tag: incident-${assignmentId}` para dedupe. Fire-and-forget desde `reportarIncidente` — el INSERT del trip event ya está commiteado.
- **PR-K7** (`apps/web/src/components/offers/VoiceAcceptOfferControl.tsx`): wire del último intent del voice command framework. Solo se renderiza con offerCount=1 (offers >1 son ambiguas para "aceptar"). Doble confirmación con timer 4s anti-falsos-positivos.
- **PR-K8** (`apps/web/src/routes/conductor-modo.tsx`): nueva ruta `/app/conductor/modo` con 4 cards: autoplay coaching toggle, permisos mic+GPS, referencia de los 4 comandos de voz, explainer del flujo. Cierra el "descubrible solo por accidente" problem.

**Decisiones**:
- Modo Conductor NO bloquea features: si el driver no visita esta página, los prompts de permiso del browser siguen funcionando ad-hoc. La página es onboarding + troubleshooting + transparencia.
- `driver-mode-permissions.ts` defensivo contra Safari ≤16 (`TypeError` en `permissions.query({ name: 'microphone' })` → devuelve `'unknown'`).
- Tras `getUserMedia` éxito, **stop() de los tracks inmediatamente** — no mantenemos mic abierto.

### Phase 5 — Tracking público → ETA preciso

**Estado pre-sesión**: L1-L2b shippeados (centroide regional, error ±20-30%). PR-L2c estaba en backlog opcional.

**Cambios**:
- **PR-L2c** (`apps/api/src/services/compute-route-eta.ts`): reemplaza `haversine(currentPos → regionCentroid) × 1.3 / avgSpeed` con `roadDistKm_routes_api / avgSpeedKmh`. La distancia real al destino exacto. Mantiene `avgSpeedKmh` medido (no la duration genérica de Routes API).

**Cache**:
- Key: `(tripId, currentLat.toFixed(2), currentLng.toFixed(2))`. 0.01° ≈ 1.1km en Chile.
- TTL 5min como safety net.
- In-memory Map (single-process Cloud Run). Si escalamos, swap a Redis con la misma interface `RouteEtaCacheStore`.

**Fallback transparente**: sin `GOOGLE_ROUTES_API_KEY`, o 4xx/5xx, o destAddress vacío → devolvemos ETA de PR-L2b (centroide). `eta_minutes: number | null` no cambia de shape — backward compat 100%.

### Phase 1 — Eco-route → visualizado end-to-end

**Estado pre-sesión**: eco-preview devolvía números (kg CO₂e, distance_km, etc.) pero descartaba el `polylineEncoded` de Routes API.

**Cambios**:
- **PR-H4** (`apps/web/src/components/offers/EcoRouteMapPreview.tsx`): nuevo componente que renderiza la polyline sobre Google Maps con markers O (origen) / D (destino). Decoder puro `polyline.ts` (Google's Encoded Polyline Algorithm Format, zero deps, ~70 líneas). Lazy `useMapsLibrary('maps')` para race-safe acceso al namespace.
- **PR-H5** (`apps/web/src/components/scoring/AssignmentEcoRouteCard.tsx`): el driver también ve el mapa DURANTE el viaje. Card collapsed-by-default, expand-on-tap lazy fetch (no carga Google Maps SDK hasta que el driver lo pida). staleTime 30min.

**Endpoint nuevo `GET /assignments/:id/eco-route`** dedicado, no reusa `/offers/:id/eco-preview` porque:
- Post-accept la semántica "preview pre-decisión" ya no aplica
- El caller es el driver, ownership check por `empresaId`
- Response payload liviano: solo polyline + distance + duration

---

## Tests coverage delta

| Package | Pre-sesión | Post-sesión | Delta |
|---|---|---|---|
| api | 600 | **634** | +34 |
| web | 765 | **818** | +53 |
| **Total** | 1365 | **1452** | **+87** |

Lint clean, typecheck clean, coverage gates 80% pasan en CI.

---

## Estado del backlog

### ✅ Completado en esta sesión

- PR-K6c: push notif al shipper en incidentes
- PR-K7: aceptar oferta por voz
- PR-K8: onboarding driver-mode (nuevo, no estaba en el backlog explícito)
- PR-L2c: ETA Routes API on-demand
- PR-H4: eco-route polyline preview (nuevo, no estaba en el backlog explícito)
- PR-H5: driver eco-route view (nuevo, no estaba en el backlog explícito)

### ⏳ Externos restantes (no requieren código)

- **Meta approval `tracking_link_v1`** (~24-48h pendiente, status `pending`). Cuando approved, los consignees con `consigneeWhatsappE164` empiezan a recibir el link automáticamente al asignar oferta.

### Backlog restante del handoff anterior

- **PR-L5**: chat público driver↔consignee (extiende chat infra para que el destinatario chatee con el conductor sin auth, vía el token público). **No es trivial**: requiere migración (el `chatMessages` actual tiene FK notNull a empresas + users; el consignee no es ni una ni la otra). Diseño preliminar: tabla separada `public_tracking_messages` con direction enum.
- **Refinements UX**:
  - Form `/app/cargas/nueva`: validación inline, Maps autocomplete para origin/destino. Substantial refactor de un archivo de 1500+ líneas.

### Posibles próximos pasos (no en backlog explícito)

- **Persistir polyline al accept** (PR-H5b): hoy se re-fetcha cada visita; persistirla en `assignments.eco_route_polyline_encoded` ahorra Routes API calls y sirve para offline / re-emisión de certificados.
- **Coaching IA visualizado**: mostrar en el mapa post-trip dónde ocurrieron los harsh-braking / over-speeding events (Phase 2 telemetry + behavior score). Cierra el loop "AI explica behavior issues geográficamente".
- **Eco-route polyline en certificate PDF**: el certificado actual muestra emisiones pero no la ruta. Anti-greenwashing: el shipper puede verificar la ruta sobre la que se calculó.

---

## Decisiones documentadas

### Voice-first driver UX se considera CERRADO

Tras PR-K8, el conductor tiene:
- 4 comandos de voz operativos (aceptar oferta, confirmar entrega, marcar incidente, cancelar) con doble confirmación + timer 4s
- Auto-play coaching gated por vehículo parado (Phase 3 + PR-K1 stopped-detector)
- Onboarding pantalla dedicada (PR-K8) con permisos + comandos + explainer
- VoiceCommandButton reusable (PR-K2) y framework parser puro (PR-K3)

El **siguiente trabajo voice-related** ya no es expansión del framework, sino features:
- Confirmar pickup vía voz (recogida — actualmente solo entrega)
- Repetir último coaching ("repítemelo")
- Anuncios de eventos de telemetría críticos vía TTS ("Detectamos frenada brusca")

### Routes API costs guardrails están vigentes

PR-L2c y PR-H5 agregan llamadas a Routes API on-demand. Las alert policies de cost guardrails (sesión anterior PR #110) siguen vigentes:
- Routes API daily budget
- Gemini API daily budget
- Cloud Monitoring alerts → email a `dev@boosterchile.com`

PR-L2c específicamente tiene cache (5min + grid 0.01°) para evitar hammering. PR-H5 confía en TanStack staleTime 30min en cliente + lazy expand-on-tap (no fetch hasta que el driver lo pida).

### `useMapsLibrary` es el patrón canónico para google.maps

`@vis.gl/react-google-maps` carga el SDK async. Acceder a `google.maps` global antes de que `APIProvider` resuelva tira ReferenceError. `useMapsLibrary('maps')` devuelve `null` mientras carga y la lib correctamente tipada cuando ready — race-safe y typed.

Patrón establecido en `EcoRouteMapPreview` (PR-H4). Si se necesita otro mapa con polylines / circles / etc., copiar este patrón.

---

## Refs

- Handoff anterior: `2026-05-10-feedback-feature-end-to-end.md`
- Playbook 002 — Canal coaching voz, no WhatsApp
- ADR-028 — Dual data source (Teltonika vs Maps API)
- CLAUDE.md — Contrato de trabajo

---

## Tasks externos pendientes para el PO

Ninguno bloqueante. El sistema es funcional end-to-end en staging.

1. (Opcional) Verificar manualmente cada PR en staging:
   - PR-K7: en `/app/ofertas` con 1 oferta, decir "aceptar oferta" → confirming → "aceptar" → success
   - PR-K8: visitar `/app/conductor/modo`, verificar permisos UI con browser settings
   - PR-L2c: abrir tracking público con trip activo, comparar precision de ETA vs PR-L2b
   - PR-H4: oferta carrier, click "Ver impacto ambiental", verificar mapa con polyline
   - PR-H5: post-accept en `/app/asignaciones/:id`, expandir card eco-ruta

2. (External, no-code) Polling Meta approval para `tracking_link_v1`:
   ```bash
   curl -s -u "$(gcloud secrets versions access latest --secret=twilio-account-sid):$(gcloud secrets versions access latest --secret=twilio-auth-token)" \
     "https://content.twilio.com/v1/Content/HXac1ef21ed9423258a2c38dad02f31e41/ApprovalRequests"
   ```

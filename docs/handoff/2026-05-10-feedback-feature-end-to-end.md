# Feedback feature end-to-end — 2026-05-10

**Owner**: dev@boosterchile.com
**Sprint**: 1 sesión maratón (~25+ PRs mergeados)
**Origen**: feedback PO "Booster a través de IA debe sugerir la mejor ruta o comportamiento en ruta que permita reducir la huella de carbono"

---

## TL;DR

Se cerró end-to-end el feedback original del Product Owner — **5 phases completas**:

1. **Phase 1**: Eco-route preview (Routes API + FUEL_CONSUMPTION pre-aceptación de oferta)
2. **Phase 2**: Driver scoring (eventos Codec8 Green Driving del Teltonika → score 0-100)
3. **Phase 3**: Coaching IA + delivery por voz (Gemini API + fallback plantilla, voice player en PWA)
4. **Phase 4**: Voice-first driver UX (vehicle-stopped guard, voice command framework, marcar incidente)
5. **Phase 5**: Uber-like consignee tracking (link público + página `/tracking/$token` + WhatsApp template)

Adicionalmente:
- **Cost guardrails** (Routes API + Gemini API) en Cloud Monitoring
- **Eval suite Gemini** con 12 casos golden
- **Pivote crítico de canal**: coaching IA → voz (no WhatsApp) tras feedback PO sobre seguridad al volante (Ley 18.290 art. 199 letra C)

**Solo blocker externo restante**: Meta approval del template `tracking_link_v1` (~24-48h, status `pending`).

---

## Phases delivered

### Phase 1 — Eco-route preview

| PR | Descripción |
|---|---|
| ~ (commits previos) | Routes API integration en `apps/api/src/services/routes-api.ts` |
| ~ | Endpoint `GET /offers/:id/eco-preview` lazy-load |
| ~ | Web `EcoPreviewBlock` en `OfferCard` |

### Phase 2 — Driver scoring

| PR | Descripción |
|---|---|
| ~ | `packages/codec8-parser` extractor Green Driving (IO 253) + Over-Speeding (IO 255) |
| ~ | `apps/telemetry-processor` persiste eventos en `eventos_conduccion_verde` |
| ~ | `packages/driver-scoring` cálculo puro score = 100 − Σ penalty (24 tests) |
| ~ | `apps/api` persiste behaviorScore + breakdown en metricas_viaje |
| ~ | Web `BehaviorScoreCard` con drill-down expansible |

### Phase 3 — Coaching IA + voz

| PR | Descripción |
|---|---|
| ~ J1 | `packages/coaching-generator` con `genFn` injectable (22 tests) |
| ~ J2 | `apps/api/src/services/gemini-client.ts` REST wrapper (no SDK) + persiste en metricas_viaje |
| #112 | **CERRADO sin merge** — WhatsApp delivery (canal incorrecto, ver playbook 002) |
| #114 | `apps/web/src/services/coaching-voice.ts` + `CoachingVoicePlayer.tsx` (Web Speech API) |
| #113 | Eval suite Gemini (12 golden cases × 9 propiedades cualitativas) |

### Phase 4 — Voice-first driver UX

| PR | Descripción |
|---|---|
| #116 | `stopped-detector.ts` con histeresis 3/8 km/h + HOLD_MS=4000ms para auto-play seguro |
| #117 | `voice-commands.ts` framework: parseCommand puro + recognizer factory push-to-talk |
| #118 | `useVoiceCommand` hook + `VoiceCommandButton` reusable (push-to-talk 80×80px) |
| #119 | `DeliveryConfirmCard` con voice + visual + doble confirmación anti-falsos-positivos |
| #129 | Endpoint `POST /assignments/:id/incidents` + service backend |
| #130 | `IncidentReportCard` UI con voz + 5 botones grandes hands-free |

### Phase 5 — Uber-like consignee tracking

| PR | Descripción |
|---|---|
| #120 | Migration 0013 `tracking_token_publico` UUID v4 + endpoint `GET /public/tracking/:token` (sin auth, defensa por opacidad) |
| #121 | Progress signals (avg_speed_kmh_last_15min + last_position_age_seconds) |
| #122 | Página `/tracking/$token` mobile-first con 5 cards (status / ruta / vehículo / posición + Maps link / progress) |
| #123 | Dispatcher WhatsApp `tracking_link_v1` al shipper post-accept oferta + Twilio template creado y submitted a Meta |
| #125 | Migration 0014 `consignee_phone` opt-in + recipient resolution chain (consignee → shipper → skip) |
| #126 | Form UI consignee opcional en `/app/cargas/nueva` |
| #128 | ETA real al centroide regional (haversine × 1.3 / avg_speed × 60), 16 regiones de Chile mapeadas |
| #132 | Fix detección 404 en ErrorState (encontrado en verificación UI manual con Playwright) |

### Operacional / quality

| PR | Descripción |
|---|---|
| #110 | Cost guardrails Routes API + Gemini API (3 alert policies en Cloud Monitoring) |
| #128 hotfix | `vitest.config.ts testTimeout: 15s` para fix flake recurrente bajo coverage en CI |

---

## Twilio templates approval status (manual external)

| Template | SID | Categoría Meta | Status |
|---|---|---|---|
| `offer_new_v1` | `HXa30e82ea818a72d08bb12a4214610a86` | Marketing | ✅ Approved (legacy) |
| `chat_unread_v1` | _pending creation_ | (futuro) | ⏳ |
| `tracking_link_v1` | `HXac1ef21ed9423258a2c38dad02f31e41` | Utility | ⏳ Submitted Meta 2026-05-10, status `pending` |

Para verificar status:
```bash
curl -s -u "$(gcloud secrets versions access latest --secret=twilio-account-sid):$(gcloud secrets versions access latest --secret=twilio-auth-token)" \
  "https://content.twilio.com/v1/Content/HXac1ef21ed9423258a2c38dad02f31e41/ApprovalRequests"
```

Cuando `whatsapp.status == "approved"`, el SID ya está cargado en `content-sid-tracking` (Secret Manager, version 2). El api Cloud Run ya tiene el env var montado. Solo falta que Meta apruebe.

---

## Decisiones documentadas

### Playbook 002 — Canal coaching: voz, no WhatsApp

`playbooks/002-canal-coaching-voz-no-whatsapp.md`

PR #112 (WhatsApp coaching delivery) se cerró sin merge tras feedback PO:

> "quien utilizara el Coaching AI es principalmente el conductor, quien no puede estar utilizando whatsapp mientras conduce, por lo tanto la comunicación debe ser por audio y voz mientras conduce con un uso muy limitado de botones en la pantalla de Booster."

WhatsApp queda reservado para: shipper↔transportista (info de carga, `offer_new_v1`), conductor↔destinatario (tracking link `tracking_link_v1`).

Coaching IA → voz vía Web Speech API en PWA con UI mínima (botón único play/replay), auto-play opt-in al detectar vehículo parado.

---

## Tests coverage

Estado al final del sprint:

| Package | Tests | Notas |
|---|---|---|
| api | 494 | +67 en este sprint |
| web | 728 | +144 en este sprint |
| coaching-generator | 34 | eval suite 12 casos |
| notification-fan-out | 9 | nuevo en este sprint |
| driver-scoring | 24 | nuevo en este sprint |
| codec8-parser | 61 | +14 (Green Driving) |
| **Total** | **>1500** | gates 80%/75%/80%/80% pasan |

---

## TF state post-sprint

`terraform apply -var-file=terraform.tfvars.local` en booster-ai-494222:
- 3 alert policies nuevos (cost guardrails)
- 2 secrets nuevos (`content-sid-coaching` placeholder, `content-sid-tracking` con SID real)
- env vars montados en api Cloud Run: `GEMINI_API_KEY`, `GOOGLE_ROUTES_API_KEY`, `CONTENT_SID_TRACKING`
- Force redeploy de api Cloud Run para que tome los secret values nuevos

---

## Pendientes / próximos pasos

### Externos (no requieren código)

- ⏳ **Meta approval `tracking_link_v1`** (~24-48h). Cuando approved, los consignees con `consigneeWhatsappE164` empiezan a recibir el link automáticamente al asignar oferta.
- ⏳ **Test E2E con trip real**: crear un trip de prueba (vía shipper user) y asignárselo al carrier para verificar visualmente las cards del lado conductor (DeliveryConfirmCard, IncidentReportCard, BehaviorScoreCard, voice player).

### Backlog opcional

- **PR-K7**: aceptar oferta por voz (`aceptar_oferta` intent — último sin caller real).
- **PR-K6c**: push notif al shipper cuando se reporta incidente (vía VAPID web push existente).
- **PR-L5**: chat público driver↔consignee (extiende chat infra para que el destinatario chatee con el conductor sin auth, vía el token público).
- **PR-L2c**: ETA con Routes API on-demand (vs centroide regional actual; mejora precisión ±20-30%→±5%).

### Refinements UX

- **Form `/app/cargas/nueva`**: usabilidad mobile (validación inline, Maps autocomplete para origin/destino) — observado en verificación pero no bloqueante.
- **Onboarding driver-mode**: pantalla dedicada para opt-in autoplay coaching + comandos de voz + permisos GPS/mic.

---

## Bugs encontrados durante el sprint

### #132 — ErrorState 404 detection

Encontrado en verificación UI manual con Playwright. La página `/tracking/$token` con token inválido mostraba el mensaje genérico en vez del específico "Link de seguimiento no válido".

**Causa**: `ApiError` constructor recibe `errMessage = payload.error` ("not_found") como 4to arg → `error.message = "not_found"` no contiene "404".

**Fix**: `error instanceof ApiError && error.status === 404` (PR #132).

**Lesson learned**: tests passaban porque pasaban solo 3 args al ApiError constructor (default fallback message contenía "404"). El flow real pasa 4 args con el error code del response. Tests deberían replicar el shape exacto del flow real.

---

## Refs

- ADR-028 — Dual data source (Teltonika vs Maps API) — base de Phase 2-3
- Playbook 002 — Canal coaching voz, no WhatsApp
- CLAUDE.md — Contrato de trabajo (cero deuda, evidence over assumption, tests en cada PR)
- Sesión anterior: `2026-05-09-iac-hardening-sprint.md` (cerró 74 alerts Trivy IaC)

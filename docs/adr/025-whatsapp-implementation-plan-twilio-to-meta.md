# ADR-025 — Plan de implementación WhatsApp: transición Twilio → Meta + arquitectura NLU Gemini

**Status**: Accepted
**Date**: 2026-05-05
**Decider**: Felipe Vicencio (Product Owner)
**Related**:
- [ADR-006 WhatsApp como canal primario](./006-whatsapp-primary-channel.md) — vigente, este ADR complementa con plan de implementación
- [docs/market-research/004-decisiones-bloqueantes-resueltas.md §D4 §D6](../market-research/004-decisiones-bloqueantes-resueltas.md)

---

## Contexto

[ADR-006](./006-whatsapp-primary-channel.md) decidió **Meta WhatsApp Business Cloud API directo** (sin Twilio/360dialog/WATI) como canal primario, con **Gemini 2.5 Flash** como NLU. La auditoría F8 del 2026-05-05 confirmó que la implementación actual viola ambas decisiones:

- `apps/whatsapp-bot` usa **Twilio** (no Meta) como BSP.
- `packages/ai-provider` es placeholder — no hay NLU operativo.
- Solo el flow shipper `create_order` está implementado (FSM XState determinístico, no NLU).
- **Cero implementación carrier-side** (accept/reject offer, upload POD, confirm delivery, report incident).

El Product Owner aprobó el 2026-05-05 mantener la decisión Meta + Gemini, pero con dos matices operacionales:
1. Mantener Twilio operativo durante la habilitación de Meta (transición gradual, no hard cutover).
2. Confirmar formalmente que Meta es la "mejor solución empresarial" — no solo más barata.

Este ADR documenta el plan de transición + ratifica criterios empresariales + detalla la arquitectura NLU.

## Decisión

### 1. Plan de transición Twilio → Meta (no hard cutover)

```
Estado actual              Estado intermedio                  Estado final
(Sprint actual)            (Sprint X+1 a X+3)                 (Sprint X+4)
─────────────────          ──────────────────                 ─────────────

shipper                    shipper                            shipper
  create_order               create_order                       create_order
  via Twilio        ────►    via Twilio (no migrar todavía)    via Meta (migrado)
                                                                 │
carrier                    carrier                              carrier
  N/A             ────►      accept/reject_offer                 accept/reject_offer
                             upload_pod                           upload_pod
                             confirm_delivery                     confirm_delivery
                             report_incident                      report_incident
                             ──────────────                       ──────────────
                             via Meta (NUEVO)                     via Meta
```

**Política**:
- F8 (carrier transactional flow) se construye **100% sobre Meta desde día 1**. No reusar el path Twilio actual ni para parte del flow.
- shipper `create_order` se mantiene en Twilio durante el sprint que arranca F8 — evita romper el único flow productivo existente.
- Una vez F8 estabilizado y Meta Business Manager + WhatsApp Business Account verificados (proceso 5-15 días Meta), se migra el flow shipper a Meta en sprint dedicado.
- El hard switch del shipper flow va detrás de un feature flag (`WHATSAPP_BSP_PROVIDER=meta|twilio`) que permite rollback instantáneo si Meta falla.

### 2. Confirmación de Meta como mejor solución empresarial (no solo más barata)

| Criterio empresarial | Meta directo | Twilio | Ganador |
|---|---|---|---|
| Costo a escala (>10k conv/mes) | Tarifa Meta base | +$0.005/msg + 20-40% markup | **Meta** (25-40% ahorro) |
| Latencia | Directa | +1 hop | **Meta** |
| Auditabilidad TRL 10 / ISO 27001 | Webhooks Meta directos en GCP audit log | Depende exports Twilio (vendor) | **Meta** |
| Control sobre features bleeding-edge | Primero en Meta | Catch-up | **Meta** |
| Reducción dependencias terceros | Solo Meta (ya en stack) | Meta + Twilio | **Meta** (CLAUDE.md §Principio "minimizar deps") |
| SLA enterprise | Meta SLA directo (oficial) | Twilio SLA (capa adicional) | Empate (Twilio tiene reputación de uptime) |
| Soporte humano dedicado | Meta partner program (gated por volumen) | Twilio Premium support | **Twilio** (ventaja inicial) |
| Setup complexity inicial | Alto (Meta Business Manager, verificación, Display Name approval) | Bajo (signup minutos) | Twilio |
| Migración futura forzada | N/A (es la raíz) | Sí (todos migran a Meta a escala) | **Meta** |
| Conformance con ADR-006 | ✅ Original | 🔴 Viola decisión arquitectónica | **Meta** |

**Veredicto empresarial**: Meta gana en 8 de 10 criterios. Las 2 desventajas (setup + soporte humano inicial) son **one-time costs**, mientras que las ventajas son **recurring**. Para un greenfield con horizonte 5+ años, Meta es objetivamente mejor.

### 3. Arquitectura NLU con Gemini 2.5 Flash (Vertex AI)

`packages/ai-provider` implementa wrapper sobre Vertex AI con interface estable:

```typescript
// packages/ai-provider/src/interface.ts
export interface NluProvider {
  classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult>;
  extractEntities<T>(input: ExtractEntitiesInput<T>): Promise<T>;
  generateText(input: GenerateTextInput): Promise<string>;
}

// packages/ai-provider/src/adapters/
//   gemini.ts    - GeminiAdapter (PRIMARIO via Vertex AI)
//   mock.ts      - MockAdapter (tests)
//   claude.ts    - ClaudeAdapter (futuro, si quality cases edge lo justifican)
```

**Razones para Gemini sobre Claude**:

1. **Alineación stack GCP** (ADR-001): Vertex AI es nativo. Claude requiere Anthropic SDK separado + auth distinta.
2. **Costo 2.5x menor**: Gemini 2.5 Flash $0.30/1M input + $2.50/1M output vs Claude Haiku 4.5 $1.00/$5.00. A 10M input + 2M output/mes → ~$8 Gemini vs ~$20 Claude.
3. **Context window 5x mayor**: 1.048.576 vs 200.000 tokens — relevante para conversaciones largas con contexto histórico.
4. **Throughput comparable**: ambos ~300-400 tok/s.
5. **Spanish quality**: ambos comparables a nivel general; sin benchmarks específicos NLU español que difieran significativamente.

Gemini es elección por defecto. Claude queda como adapter de respaldo si en producción se identifican casos donde Gemini falla sistemáticamente (ej. detección de incidentes con jerga regional muy variada).

### 4. Set completo de intents (8 total — 6 originales del ADR-006 + 5 nuevos transaccionales del carrier)

| Intent | Origen | Quien lo emite | Acción downstream |
|---|---|---|---|
| `create_order` | ADR-006 | Shipper | Crear `cargo_request` borrador, confirmar antes de publicar |
| `query_status` | ADR-006 | Shipper o Carrier | Devolver estado del trip más reciente del usuario |
| `cancel_order` | ADR-006 | Shipper | Cancelar `cargo_request` si aún no asignado |
| `ask_info` | ADR-006 | Cualquiera | Respuesta canned con info común (precios, cómo funciona, etc.) |
| `chitchat` | ADR-006 | Cualquiera | Respuesta breve + redirección a flow productivo |
| `human_handoff` | ADR-006 | Cualquiera | Notificar admin Slack + responder al usuario "te conectamos con un humano" |
| **`accept_offer`** | **NUEVO** | Carrier | Trigger transición trip-state-machine: pending → assigned. Extrae `offerId` del contexto del mensaje o template button |
| **`reject_offer`** | **NUEVO** | Carrier | Trigger trip-state-machine: pending → rejected. Razón opcional |
| **`upload_pod`** | **NUEVO** | Carrier | Acompañado de imagen WhatsApp. Bot descarga, valida (size/format/EXIF), sube GCS, emite trip_event `whatsapp_pod_received`, transición trip in_transit → pod_uploaded |
| **`confirm_delivery`** | **NUEVO** | Carrier | Trigger trip-state-machine: pod_uploaded → delivered_confirmed. Esto a su vez dispara F1 (cálculo carbono + certificado) y F7 (DTE + Carta Porte) |
| **`report_incident`** | **NUEVO** | Carrier | Trigger trip-state-machine: branch a `incident_open`. Notifica admin |

### 5. Política de fallback a PWA

WhatsApp NO cubre 100% de la operación. Bot escala a PWA web cuando:

- NLU classifier devuelve confianza <0.75 → bot pregunta "¿Te refieres a X o Y?" (clarification turn). Si segundo intento falla → "Por favor revisa la app web para esta acción: {deep_link}".
- Operación requiere UI rica: firma electrónica del POD legalmente vinculante, edición de campos largos, mapa interactivo, comparación de N ofertas.
- Operación financiera crítica (aceptar oferta de monto > umbral, sugerido CLP 500.000): doble confirmación con reply "SI {orderId}" o link a PWA.
- Conversación lleva >20 turnos sin resolver — fallback a humano (`human_handoff`) o PWA.

### 6. Templates Meta requeridos (gestión versionada)

`packages/whatsapp-client/src/templates.ts` mantiene catálogo versionado:

```typescript
export const TEMPLATES = {
  carrier_offer_v1: { ... },          // outbound oferta nueva → carrier
  shipper_assignment_v1: { ... },     // outbound asignación confirmada → shipper
  trip_status_update_v1: { ... },     // outbound update genérico → shipper
  pod_received_confirmation_v1: { ... }, // outbound confirmación POD recibida → shipper + carrier
  delivery_confirmation_v1: { ... },  // outbound entrega confirmada → shipper
  incident_report_v1: { ... },        // outbound notificación incidente → admin
  certificate_ready_v1: { ... },      // outbound certificado emitido → shipper (sustainability stakeholder)
  reminder_v1: { ... }                // outbound recordatorio genérico
};
```

Templates nuevos requieren aprobación Meta (24-72h). Versionado strict: cambio de wording = `_v2`, nunca edit del `_v1` desplegado.

### 7. Compliance con auditoría TRL 10

- Toda interacción WhatsApp se loguea en BigQuery vía OpenTelemetry (correlationId trip-scoped).
- Audio/imagen recibidos se archivan en GCS con retention 6 años (consistente con doc legal ADR-007).
- Webhooks de Meta firmados con HMAC SHA-256 — verificación obligatoria, never trust un payload sin signature válida.
- Conversaciones contienen datos personales (nombres, RUT mencionados) → Pino redaction strict en logs externos.

## Consecuencias

### Positivas

- F8 desbloqueada con plan claro y arquitectura defensible.
- ADR-006 honrado sin breaking change al flow productivo actual.
- Gemini wrapper en `packages/ai-provider` desbloquea reuso para otros casos NLU futuros (ej. clasificar mensajes inbound del shipper en `create_order`).
- Adapter pattern permite swap a Claude/otros si Gemini falla sistemáticamente.

### Negativas / costos

- Setup Meta Business Manager + WhatsApp Business Account verification + Display Name approval: 5-15 días, requiere documentación corporativa (RUT empresa, dueño verificado, sitio web operativo).
- Costos NLU: estimado ~USD 8-30/mes en Q3 2026 (volumen bajo); escala con uso.
- Mantenimiento de templates (cada nueva variante requiere aprobación Meta).
- Doble bot operando en transición (Twilio shipper + Meta carrier) — 1 sprint adicional de complejidad.

### Acciones derivadas

1. Felipe inicia setup Meta Business Manager + WhatsApp Business Account (proceso paralelo, no bloquea desarrollo).
2. Agente implementa `packages/ai-provider` con GeminiAdapter + MockAdapter + tests.
3. Agente implementa lado Meta de `packages/whatsapp-client` (signature, templates, media upload/download) — si Meta WAB no listo, usa webhook simulator local.
4. `/spec` F8 cita este ADR como fuente de truth de la arquitectura.
5. Migrar shipper flow Twilio → Meta en sprint dedicado post-F8.
6. Cuando shipper flow migrado: marcar `apps/whatsapp-bot/src/routes/webhook.ts` Twilio como deprecated, mantener N sprints como fallback feature-flagged, eventualmente eliminar.

## Validación

- [ ] Meta Business Manager + WAB + Display Name aprobados.
- [ ] `packages/ai-provider` operativo con Gemini + tests.
- [ ] `packages/whatsapp-client` Meta side completo + signature verification + templates v1 aprobados.
- [ ] F8 (carrier transactional flow) en producción operativo.
- [ ] Migración shipper flow Twilio → Meta completada.
- [ ] Telemetría WhatsApp en BigQuery + redaction Pino activa.

## Histórico

- 2026-05-05: Plan de transición + ratificación Meta + Gemini + intents transaccionales nuevos para carrier.

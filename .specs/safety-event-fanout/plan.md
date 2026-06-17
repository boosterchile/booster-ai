# Safety Event Fan-out — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Dominio crítico (safety) → TDD es ley (`booster-skills:tdd-dominio-critico`).

**Goal:** Cuando un Teltonika reporta crash/unplug/jamming, el dueño del transportista recibe push (+ WhatsApp si el template está aprobado), deduplicado y auditable.

**Architecture:** `telemetry-processor` publica un `SafetyEvent` al topic Pub/Sub `safety-p0` → push subscription entrega a `POST /internal/safety-events` en `apps/api` (OIDC del SA) → routing `vehicleId → empresa transportista → dueños` → dedupe Redis → fan-out push + WhatsApp.

**Tech Stack:** TypeScript, Hono, Drizzle, Zod, `@google-cloud/pubsub`, `google-auth-library` (OIDC), ioredis, web-push (VAPID), Twilio Content API, Terraform.

**Convención de commits:** Conventional Commits con scope (`feat(safety): ...`). Commit por task (al final de cada uno).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `packages/shared-schemas/src/domain/safety-event.ts` (crear) | Zod `safetyEventSchema` + tipo `SafetyEvent`. Contrato producer↔consumer. |
| `apps/telemetry-processor/src/config.ts` (modificar) | Env `SAFETY_EVENTS_TOPIC`. |
| `apps/telemetry-processor/src/publish-safety-events.ts` (crear) | `publishSafetyEvent()` — wrapper Pub/Sub fire-and-forget. |
| `apps/telemetry-processor/src/panic-events.ts` (modificar) | Tras `logPanicEvents`, publicar unplug/jamming. |
| `apps/telemetry-processor/src/persist-crash-trace.ts` (modificar) | Tras persistir, publicar `crash`. |
| `apps/api/src/config.ts` (modificar) | Env `CONTENT_SID_SAFETY_ALERT` (opt), `SAFETY_PUSH_CALLER_SA`. |
| `apps/api/src/services/route-safety-recipients.ts` (crear) | `vehicleId → recipients[]` (dueños activos + tracking_code del viaje activo). |
| `apps/api/src/services/dispatch-safety-notification.ts` (crear) | dedupe Redis + fan-out push + WhatsApp. |
| `apps/api/src/services/safety-event-labels.ts` (crear) | Labels es de eventType (puro, compartible con test). |
| `apps/api/src/routes/internal-safety-events.ts` (crear) | `POST /internal/safety-events`: OIDC + Zod envelope + dispatch. |
| `apps/api/src/server.ts` (modificar) | Montar la ruta interna. |
| `infrastructure/messaging.tf` (modificar) | `telemetry-events-safety-p0-notification-sub` → push a `apps/api` con OIDC. |

---

## Task 1: SafetyEvent schema (shared-schemas)

**Files:**
- Create: `packages/shared-schemas/src/domain/safety-event.ts`
- Modify: `packages/shared-schemas/src/index.ts`
- Test: `packages/shared-schemas/src/domain/safety-event.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { safetyEventSchema } from './safety-event.js';

describe('safetyEventSchema', () => {
  it('parsea un evento válido', () => {
    const parsed = safetyEventSchema.parse({
      eventType: 'crash',
      imei: '863238075489155',
      vehicleId: '6487dac2-600e-4655-a20e-2ea77a6b1017',
      occurredAt: '2026-06-15T14:32:00.000Z',
      rawValue: 2,
    });
    expect(parsed.eventType).toBe('crash');
  });

  it('rechaza eventType desconocido', () => {
    expect(() => safetyEventSchema.parse({ eventType: 'foo', imei: '1', occurredAt: '2026-06-15T14:32:00.000Z' })).toThrow();
  });

  it('imei es obligatorio; vehicleId es opcional', () => {
    const parsed = safetyEventSchema.parse({ eventType: 'unplug', imei: '863238075489155', occurredAt: '2026-06-15T14:32:00.000Z' });
    expect(parsed.vehicleId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL** (`Cannot find module './safety-event.js'`)

```
pnpm --filter @booster-ai/shared-schemas exec vitest run src/domain/safety-event.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/shared-schemas/src/domain/safety-event.ts
import { z } from 'zod';

/** Evento de seguridad física emitido por telemetry-processor al topic safety-p0. */
export const safetyEventSchema = z.object({
  eventType: z.enum(['crash', 'unplug', 'jamming']),
  /** IMEI del device que emitió. Siempre presente (clave de routing). */
  imei: z.string().min(1),
  /** UUID del vehículo si el processor lo resolvió; el consumer hace fallback por IMEI si falta. */
  vehicleId: z.string().uuid().optional(),
  /** ISO-8601 UTC del evento. */
  occurredAt: z.string().datetime(),
  /** Valor crudo del IO (ej. jamming: 1 warning, 2 crítico). */
  rawValue: z.number().int().optional(),
});

export type SafetyEvent = z.infer<typeof safetyEventSchema>;
```

- [ ] **Step 4: Export desde el barrel** — añadir a `packages/shared-schemas/src/index.ts`:

```ts
export { safetyEventSchema, type SafetyEvent } from './domain/safety-event.js';
```

- [ ] **Step 5: Run test — expect PASS**

```
pnpm --filter @booster-ai/shared-schemas exec vitest run src/domain/safety-event.test.ts
```

- [ ] **Step 6: Commit**

```
git add packages/shared-schemas/src/domain/safety-event.ts packages/shared-schemas/src/domain/safety-event.test.ts packages/shared-schemas/src/index.ts
git commit -m "feat(safety): schema SafetyEvent en shared-schemas"
```

---

## Task 2: Config del topic en telemetry-processor

**Files:**
- Modify: `apps/telemetry-processor/src/config.ts`

- [ ] **Step 1: Añadir la env al schema Zod** (junto a las otras `PUBSUB_*`):

```ts
/** Topic Pub/Sub de eventos de seguridad (safety-p0). Vacío = no publica (dev/test). */
SAFETY_EVENTS_TOPIC: z.string().default(''),
```

- [ ] **Step 2: Typecheck**

```
pnpm --filter @booster-ai/telemetry-processor typecheck
```

Expected: 0 errores.

- [ ] **Step 3: Commit**

```
git add apps/telemetry-processor/src/config.ts
git commit -m "feat(safety): env SAFETY_EVENTS_TOPIC en telemetry-processor"
```

---

## Task 3: Publisher Pub/Sub (telemetry-processor)

**Files:**
- Create: `apps/telemetry-processor/src/publish-safety-events.ts`
- Test: `apps/telemetry-processor/src/publish-safety-events.test.ts`

- [ ] **Step 1: Write the failing test** (publisher inyectable, fire-and-forget):

```ts
import type { SafetyEvent } from '@booster-ai/shared-schemas';
import { describe, expect, it, vi } from 'vitest';
import { publishSafetyEvent } from './publish-safety-events.js';

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
}
const ev: SafetyEvent = { eventType: 'unplug', imei: '863238075489155', occurredAt: '2026-06-15T14:32:00.000Z' };

describe('publishSafetyEvent', () => {
  it('publica con data JSON + attribute imei', async () => {
    const publishMessage = vi.fn().mockResolvedValue('msg-1');
    const topic = vi.fn().mockReturnValue({ publishMessage });
    await publishSafetyEvent({ topicName: 'safety-p0', event: ev, logger: fakeLogger(), pubsub: { topic } as never });
    expect(topic).toHaveBeenCalledWith('safety-p0');
    const arg = publishMessage.mock.calls[0][0];
    expect(JSON.parse(arg.data.toString())).toMatchObject({ eventType: 'unplug', imei: '863238075489155' });
    expect(arg.attributes).toEqual({ imei: '863238075489155', event_type: 'unplug' });
  });

  it('no lanza si Pub/Sub falla (fire-and-forget)', async () => {
    const publishMessage = vi.fn().mockRejectedValue(new Error('pubsub down'));
    const topic = vi.fn().mockReturnValue({ publishMessage });
    const logger = fakeLogger();
    await expect(publishSafetyEvent({ topicName: 'safety-p0', event: ev, logger, pubsub: { topic } as never })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('no publica si topicName está vacío', async () => {
    const topic = vi.fn();
    await publishSafetyEvent({ topicName: '', event: ev, logger: fakeLogger(), pubsub: { topic } as never });
    expect(topic).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```
pnpm --filter @booster-ai/telemetry-processor exec vitest run src/publish-safety-events.test.ts
```

- [ ] **Step 3: Implement** (patrón de `apps/api/src/services/chat-pubsub.ts`):

```ts
// apps/telemetry-processor/src/publish-safety-events.ts
import type { Logger } from '@booster-ai/logger';
import type { SafetyEvent } from '@booster-ai/shared-schemas';
import { PubSub } from '@google-cloud/pubsub';

let cached: PubSub | null = null;
function defaultClient(): PubSub {
  if (!cached) cached = new PubSub();
  return cached;
}

/** Publica un SafetyEvent al topic. Fire-and-forget: nunca lanza ni bloquea el ack del record. */
export async function publishSafetyEvent(opts: {
  topicName: string;
  event: SafetyEvent;
  logger: Logger;
  pubsub?: Pick<PubSub, 'topic'>;
}): Promise<void> {
  const { topicName, event, logger } = opts;
  if (!topicName) return; // dev/test sin topic configurado
  const pubsub = opts.pubsub ?? defaultClient();
  try {
    await pubsub.topic(topicName).publishMessage({
      data: Buffer.from(JSON.stringify(event)),
      attributes: { imei: event.imei, event_type: event.eventType },
    });
  } catch (err) {
    logger.error({ err, imei: event.imei, eventType: event.eventType }, 'publishSafetyEvent falló (evento ya logueado para on-call)');
  }
}
```

- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

```
git add apps/telemetry-processor/src/publish-safety-events.ts apps/telemetry-processor/src/publish-safety-events.test.ts
git commit -m "feat(safety): publisher Pub/Sub de SafetyEvent (fire-and-forget)"
```

---

## Task 4: Producer unplug/jamming en panic-events

**Files:**
- Modify: `apps/telemetry-processor/src/panic-events.ts` (la función que orquesta detección, hoy `logPanicEvents`)
- Modify: `apps/telemetry-processor/src/main.ts:97` (pasar topic + publisher al call)
- Test: extender `apps/telemetry-processor/src/panic-events.test.ts` (o crear si no existe)

- [ ] **Step 1: Write failing test** — al detectar unplug, se publica un SafetyEvent `unplug` con el imei del record:

```ts
it('publishPanicEvents publica un SafetyEvent por cada evento detectado', async () => {
  const published: unknown[] = [];
  const msg = makeRecordMessage({ imei: '863238075489155', io: [{ id: 252, value: 1 }] }); // helper existente o inline
  await publishPanicEvents({
    msg, messageId: 'm1', topicName: 'safety-p0', logger: fakeLogger(),
    publish: async ({ event }) => { published.push(event); },
  });
  expect(published).toEqual([
    expect.objectContaining({ eventType: 'unplug', imei: '863238075489155' }),
  ]);
});
```

> Nota: reusar `detectPanicEvents(msg)` (ya existe). Mapear `eventName 'Unplug'→'unplug'`, `'GnssJamming'→'jamming'`.

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — añadir junto a `logPanicEvents` (no reemplazarla):

```ts
import type { SafetyEvent } from '@booster-ai/shared-schemas';

const EVENT_NAME_TO_TYPE: Record<'Unplug' | 'GnssJamming', SafetyEvent['eventType']> = {
  Unplug: 'unplug',
  GnssJamming: 'jamming',
};

/** Publica un SafetyEvent por cada panic detectado. `publish` inyectable para tests. */
export async function publishPanicEvents(opts: {
  msg: RecordMessage;
  messageId: string;
  topicName: string;
  logger: Logger;
  publish: (a: { topicName: string; event: SafetyEvent; logger: Logger }) => Promise<void>;
}): Promise<void> {
  const events = detectPanicEvents(opts.msg);
  for (const e of events) {
    const event: SafetyEvent = {
      eventType: EVENT_NAME_TO_TYPE[e.eventName],
      imei: opts.msg.record.imei, // confirmar el path real del imei en RecordMessage
      occurredAt: new Date().toISOString(), // o el timestamp del record si está disponible
      rawValue: e.rawValue,
    };
    await opts.publish({ topicName: opts.topicName, event, logger: opts.logger });
  }
}
```

> ⚠️ Verificar el path del `imei` y del timestamp en `RecordMessage` (ver `persist.ts`); ajustar si difiere. `new Date().toISOString()` está prohibido en workflows pero acá es código de runtime normal — OK.

- [ ] **Step 4: Wire en `main.ts`** (junto a la línea 97 `logPanicEvents(...)`):

```ts
logPanicEvents({ logger, msg: parsed.data, messageId: message.id });
void publishPanicEvents({
  msg: parsed.data, messageId: message.id, topicName: config.SAFETY_EVENTS_TOPIC, logger,
  publish: (a) => publishSafetyEvent(a),
});
```

- [ ] **Step 5: Run unit + typecheck — expect PASS**
- [ ] **Step 6: Commit**

```
git add apps/telemetry-processor/src/panic-events.ts apps/telemetry-processor/src/panic-events.test.ts apps/telemetry-processor/src/main.ts
git commit -m "feat(safety): publicar unplug/jamming al topic safety-p0"
```

---

## Task 5: Producer crash

**Files:**
- Modify: `apps/telemetry-processor/src/persist-crash-trace.ts` (tras persistir el crash trace OK)
- Test: extender el test de persist-crash-trace

- [ ] **Step 1: Write failing test** — tras `persistCrashTrace`, se publica un SafetyEvent `crash` con el imei del trace. (Inyectar el `publish` como dependencia, igual que Task 4.)
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement** — al final del happy-path de `persistCrashTrace`, construir `{ eventType: 'crash', imei, vehicleId?, occurredAt }` y `await publishSafetyEvent(...)` (fire-and-forget; el crash ya está en GCS+BQ). Pasar `topicName` y `publish` desde el wiring en `main.ts` (CONSUMER 2).
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit** `feat(safety): publicar crash al topic safety-p0`

---

## Task 6: Config en apps/api

**Files:**
- Modify: `apps/api/src/config.ts`

- [ ] **Step 1: Añadir al schema** (zona de templates Twilio + SAs internos):

```ts
/** Content SID Twilio del template safety_alert_v1. Vacío → WhatsApp se skipea (solo push). */
CONTENT_SID_SAFETY_ALERT: z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().regex(/^HX[a-fA-F0-9]+$/, 'Debe empezar con HX').optional(),
),
/** Email del SA que firma el OIDC de la push subscription de safety-events. */
SAFETY_PUSH_CALLER_SA: z
  .string()
  .regex(/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/, 'SA email inválido')
  .optional(),
```

- [ ] **Step 2: Typecheck** → `pnpm --filter @booster-ai/api typecheck`
- [ ] **Step 3: Commit** `feat(safety): env CONTENT_SID_SAFETY_ALERT + SAFETY_PUSH_CALLER_SA`

---

## Task 7: Labels de evento (puro)

**Files:**
- Create: `apps/api/src/services/safety-event-labels.ts`
- Test: `apps/api/src/services/safety-event-labels.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { safetyEventLabel } from './safety-event-labels.js';

describe('safetyEventLabel', () => {
  it('mapea cada tipo a su label es', () => {
    expect(safetyEventLabel('crash')).toBe('Posible colisión');
    expect(safetyEventLabel('unplug')).toBe('Desconexión de energía (manipulación)');
    expect(safetyEventLabel('jamming')).toBe('Interferencia de señal GPS');
  });
});
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**

```ts
// apps/api/src/services/safety-event-labels.ts
import type { SafetyEvent } from '@booster-ai/shared-schemas';

const LABELS: Record<SafetyEvent['eventType'], string> = {
  crash: 'Posible colisión',
  unplug: 'Desconexión de energía (manipulación)',
  jamming: 'Interferencia de señal GPS',
};

export function safetyEventLabel(t: SafetyEvent['eventType']): string {
  return LABELS[t];
}
```

- [ ] **Step 4: Run — PASS** · **Step 5: Commit** `feat(safety): labels es de eventos de seguridad`

---

## Task 8: Routing — vehicleId → destinatarios

**Files:**
- Create: `apps/api/src/services/route-safety-recipients.ts`
- Test: `apps/api/src/services/route-safety-recipients.test.ts`

**Contrato:**

```ts
export interface SafetyRecipient { userId: string; phoneE164: string | null; }
export interface SafetyRouting { empresaId: string; vehicleLabel: string; trackingCode: string | null; recipients: SafetyRecipient[]; }
export async function routeSafetyRecipients(opts: { db: Db; imei: string; vehicleId?: string }): Promise<SafetyRouting | null>;
```

**Lógica:**
1. Resolver el vehículo: por `vehicleId` si viene, si no por `vehicles.teltonikaImei === imei` (NO el espejo). Si no existe → `return null`.
2. `empresaId = vehicle.empresaId`. `vehicleLabel` = patente/alias del vehículo (campo existente, ej. `vehicles.patente`).
3. `trackingCode`: buscar asignación activa del vehículo (estado en-curso) → su `trips.trackingCode`. Si no hay → `null` (camión parado).
4. `recipients`: `memberships` WHERE `empresaId`, `role='dueno'`, `status='activa'` JOIN `users` → `{ userId, phoneE164: users.telefono }`.

- [ ] **Step 1: Failing test** (mock `db` con builder encadenable; cubrir: con vehicleId; por imei; vehículo inexistente→null; con viaje activo→trackingCode; sin viaje→null; múltiples dueños). Ejemplo del caso núcleo:

```ts
it('resuelve dueños por empresa del vehículo (fallback sin viaje)', async () => {
  const db = makeDbStub({
    vehicle: { id: 'v1', empresaId: 'e1', patente: 'RJXK-42', teltonikaImei: '863238075489155' },
    activeAssignment: null,
    duenos: [{ userId: 'u1', telefono: '+56911111111' }],
  });
  const r = await routeSafetyRecipients({ db, imei: '863238075489155' });
  expect(r).toEqual({ empresaId: 'e1', vehicleLabel: 'RJXK-42', trackingCode: null, recipients: [{ userId: 'u1', phoneE164: '+56911111111' }] });
});
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** con Drizzle (`eq`, `and`). Patrón de la query de dueños: copiar de `apps/api/src/services/notify-offer.ts:72-81` (`memberships` innerJoin `users`, `role='dueno'`, `status='activa'`). Confirmar el nombre real de la columna teléfono en `users` (ej. `telefono`) y de patente en `vehicles`.
- [ ] **Step 4: Run — PASS** · **Step 5: Commit** `feat(safety): routing vehicleId→dueños del transportista`

---

## Task 9: Dispatch — dedupe + fan-out

**Files:**
- Create: `apps/api/src/services/dispatch-safety-notification.ts`
- Test: `apps/api/src/services/dispatch-safety-notification.test.ts`

**Contrato:**

```ts
export type DispatchOutcome = 'notified' | 'deduped' | 'no_recipient';
export async function dispatchSafetyNotification(opts: {
  db: Db; redis: Redis; logger: Logger; event: SafetyEvent; routing: SafetyRouting;
  contentSidSafety?: string;
  sendPush: typeof sendPushToUser;
  sendWhatsapp: (p: { to: string; contentSid: string; contentVariables: Record<string,string> }) => Promise<void>;
}): Promise<DispatchOutcome>;
```

**Lógica:**
1. **Dedupe**: `key = safety:dedupe:${event.imei}:${event.eventType}`. `redis.set(key, '1', 'EX', 600, 'NX')`. Si devuelve `null` (ya existe) → `return 'deduped'`.
2. Si `routing.recipients.length === 0` → `return 'no_recipient'`.
3. Construir mensaje: `label = safetyEventLabel(event.eventType)`, `hora = formato local de occurredAt`, `viaje = routing.trackingCode ?? 'Sin viaje activo'`.
4. **Push** a cada `userId` (best-effort): `sendPush({ db, logger, userId, payload: { title: '🚨 Alerta de seguridad', body: \`${routing.vehicleLabel}: ${label}\`, tag: \`safety-${event.imei}-${event.eventType}\`, data: { url: \`/app/flota\` } } })`. Cada falla → log + sigue.
5. **WhatsApp** (si `contentSidSafety` y `phoneE164`): `sendWhatsapp({ to: phoneE164, contentSid: contentSidSafety, contentVariables: { '1': routing.vehicleLabel, '2': label, '3': hora, '4': viaje } })`. Best-effort.
6. `return 'notified'`.

- [ ] **Step 1: Failing test** — casos:
  - segundo evento dentro de ventana → `'deduped'`, no llama sendPush/sendWhatsapp;
  - `recipients` vacío → `'no_recipient'`;
  - con CONTENT_SID → push + whatsapp llamados con las variables correctas;
  - sin CONTENT_SID → push llamado, whatsapp NO;
  - push falla pero whatsapp ok → `'notified'` (no throw).

Mock `redis.set` devolviendo `'OK'` la 1ª vez y `null` la 2ª.

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement** según el contrato. Usar `sendPushToUser` (firma real: `{ db, logger, userId, payload }`). `payload` shape: `{ title, body, tag, data: { url } }` (ver `web-push.ts:51`).
- [ ] **Step 4: Run — PASS** · **Step 5: Commit** `feat(safety): dispatch con dedupe + push + WhatsApp`

---

## Task 10: Endpoint interno con OIDC

**Files:**
- Create: `apps/api/src/routes/internal-safety-events.ts`
- Modify: `apps/api/src/server.ts` (montar la ruta)
- Test: `apps/api/src/routes/internal-safety-events.test.ts`

**Contrato:** `POST /internal/safety-events`. Body = envelope de Pub/Sub push:
```json
{ "message": { "data": "<base64 del SafetyEvent JSON>", "attributes": {...}, "messageId": "..." }, "subscription": "..." }
```
Auth: header `Authorization: Bearer <OIDC>`; `verifyIdToken` (audience = la URL del endpoint o config), `payload.email === SAFETY_PUSH_CALLER_SA`. Patrón: `apps/api/src/middleware/auth.ts` (OAuth2Client inyectable para test).

- [ ] **Step 1: Failing test** (Hono app + OAuth2Client stub):
  - OIDC válido + envelope con SafetyEvent → 200, `dispatchSafetyNotification` llamado;
  - sin/again OIDC inválido → 403, dispatch NO llamado;
  - `data` no decodifica a SafetyEvent válido → 400;
  - dispatch lanza → 500 (para que Pub/Sub reintente → DLQ).

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement**:

```ts
// pseudo-estructura — auth con OAuth2Client.verifyIdToken, luego:
const envelope = pubsubEnvelopeSchema.parse(await c.req.json());
const raw = JSON.parse(Buffer.from(envelope.message.data, 'base64').toString('utf8'));
const event = safetyEventSchema.parse(raw); // 400 si falla
const routing = await routeSafetyRecipients({ db, imei: event.imei, vehicleId: event.vehicleId });
if (!routing) { logger.warn(...); return c.json({ outcome: 'unknown_vehicle' }, 200); } // ack: no es transitorio
const outcome = await dispatchSafetyNotification({ ...deps, event, routing, contentSidSafety: config.CONTENT_SID_SAFETY_ALERT });
// span OTel + métrica safety_notifications_total{event_type, outcome}
return c.json({ outcome }, 200);
```
Definir `pubsubEnvelopeSchema` (Zod) inline: `{ message: { data: z.string(), attributes: z.record(z.string()).optional(), messageId: z.string() }, subscription: z.string() }`.

- [ ] **Step 4: Montar en `server.ts`** — junto a las otras rutas internas, SIN `firebaseAuthMiddleware` (usa su propia OIDC):

```ts
app.route('/internal/safety-events', createInternalSafetyEventsRoutes({ db: opts.db, redis, logger, config }));
```

> El gate de CI `is-demo-wire-completeness` exige que rutas con `firebaseAuthMiddleware` tengan también los middlewares demo. Esta ruta NO usa `firebaseAuthMiddleware` → no la afecta. Verificar que el check no la marque (su parser busca `firebaseAuthMiddleware` en el `app.use`).

- [ ] **Step 5: Run unit + typecheck — PASS**
- [ ] **Step 6: Commit** `feat(safety): endpoint interno /internal/safety-events con OIDC`

---

## Task 11: Infra — push subscription

**Files:**
- Modify: `infrastructure/messaging.tf` (recurso `telemetry_events_safety_p0_notification`)

- [ ] **Step 1:** Cambiar la subscription de pull a **push** hacia `apps/api`:

```hcl
push_config {
  push_endpoint = "${<url del cloud run api>}/internal/safety-events"
  oidc_token {
    service_account_email = google_service_account.safety_push_invoker.email # SA dedicado o reusar uno existente
  }
}
```
Mantener `dead_letter_policy` + `retry_policy` ya presentes. Crear el SA `safety_push_invoker` (o reusar uno con permiso de invocar el api) y exponer su email como `SAFETY_PUSH_CALLER_SA` en la env del Cloud Run api (`compute.tf`).

- [ ] **Step 2:** `terraform fmt` + `terraform validate`.

```
cd infrastructure && terraform fmt messaging.tf && terraform validate
```

- [ ] **Step 3:** `terraform plan` (NO apply) — revisar que solo cambie la subscription + el SA. **Apply gateado** (revisar plan con el PO; ver lección de [[prod-drift]] — plan completo, no -target).
- [ ] **Step 4: Commit** `feat(safety): push subscription safety-p0 → apps/api (OIDC)`

---

## Task 12: Integración + evidencia

- [ ] **Step 1:** Integration test `apps/api/test/integration/safety-events.integration.test.ts`: POST envelope real (con OIDC stub) → verifica que con un vehículo+dueño+push-sub seedeado, se intenta el push y la métrica se emite; evento duplicado → segundo POST `'deduped'`.
- [ ] **Step 2:** `pnpm --filter @booster-ai/api test` + `pnpm --filter @booster-ai/telemetry-processor test` + `pnpm --filter @booster-ai/shared-schemas test` — todo verde, coverage ≥80/75.
- [ ] **Step 3:** `pnpm ci` (lint + typecheck + test + build).
- [ ] **Step 4:** PR con sección `## Evidencia`: output tests + coverage, `curl` del endpoint con OIDC (401 sin token, 200 con), `terraform plan` de la subscription, checklist ADR-compliance.

---

## Notas de integración / dependencias

- **WhatsApp**: hasta que Meta apruebe `safety_alert_v1`, `CONTENT_SID_SAFETY_ALERT` queda vacío → solo push. El código no rompe (Task 9 step skip).
- **Onboarding push**: los dueños de los 10 carriers deben tener la PWA + push aceptado, o el push devuelve `sent:0`. Acción operativa al instalar.
- **No tocar el subsistema demo** acá; el `notification-service` skeleton se retira en el cleanup aparte (esta feature lo deja sin uso, lo cual es correcto).
- **Verificaciones pendientes durante implementación** (confirmar contra el schema/código real, no asumir): path exacto de `imei`/timestamp en `RecordMessage`; nombre de columna teléfono en `users` y patente en `vehicles`; estados que cuentan como "asignación activa".

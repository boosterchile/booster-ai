# @booster-ai/trip-state-machine

State machines canónicas (XState v5) para los workflows de **viaje** y **asignación**.

Son la **fuente de verdad** de qué transiciones son legales sobre `tripStatusEnum` y `assignmentStatusEnum` (`apps/api/src/db/schema.ts`). Reemplazan el patrón actual de "asumir que el caller manda algo coherente" — sin SM canónica, cualquier service puede romper invariantes (ej. saltar de `borrador` a `entregado`, o resucitar un viaje cancelado).

## Instalación en un workspace dependent

```jsonc
// apps/<x>/package.json
"dependencies": {
  "@booster-ai/trip-state-machine": "workspace:*"
}
```

## API

### Validación de transiciones

```ts
import {
  assertTripTransition,
  canTripTransition,
  getNextTripStatus,
  InvalidTransitionError,
} from '@booster-ai/trip-state-machine';

// Patrón estándar pre-UPDATE en services:
assertTripTransition(trip.status, { type: 'DELIVERY_CONFIRMED' });
//   throws InvalidTransitionError si trip.status no acepta DELIVERY_CONFIRMED

// Versión sin throw, para flujos opcionales:
if (canTripTransition(trip.status, { type: 'CANCEL' })) {
  await db.update(trips).set({ status: 'cancelado' });
}

// Computar el próximo status:
const next = getNextTripStatus('emparejando', { type: 'OFFERS_SENT' });
//   → 'ofertas_enviadas'
```

### UI gating (lista de eventos válidos)

```ts
import { getValidEventsForTripStatus } from '@booster-ai/trip-state-machine';

const allowed = getValidEventsForTripStatus(trip.status);
//   ['START_MATCHING', 'CANCEL']  // si trip.status === 'borrador'

// En React:
{allowed.includes('CANCEL') && <CancelButton />}
```

### Detección de terminales

```ts
import { isTerminalTripStatus } from '@booster-ai/trip-state-machine';

if (isTerminalTripStatus(trip.status)) {
  // No se puede crear nuevo chat sobre un trip terminado
  return forbidden('Trip is closed');
}
```

## Estados y eventos

### Trip (`tripStatusEnum`)

```
                ┌──────────┐
                │ borrador │
                └────┬─────┘
                START_MATCHING
                     ▼
           ┌──────────────────┐
      ┌──→ │ esperando_match  │ ←──── RETRY ──── ┌──────────┐
      │    └────────┬─────────┘                  │ expirado │
      │       START_MATCHING                     └─────▲────┘
      │             ▼                                  │
      │     ┌──────────────┐                           │
      └──── │ emparejando  │                           │
   NO_MATCH └──────┬───────┘                           │
                OFFERS_SENT                            │
                   ▼                                   │
           ┌────────────────────┐                      │
           │ ofertas_enviadas   │ ── ALL_OFFERS_EXPIRED┘
           └─────────┬──────────┘
                OFFER_ACCEPTED
                     ▼
               ┌──────────┐
               │ asignado │
               └────┬─────┘
               PICKUP_CONFIRMED
                    ▼
              ┌────────────┐
              │ en_proceso │
              └─────┬──────┘
               DELIVERY_CONFIRMED
                    ▼
              ┌────────────┐    (terminal)
              │ entregado  │
              └────────────┘

  Cancel desde cualquier estado activo:
      borrador / esperando_match / emparejando / ofertas_enviadas /
      asignado / en_proceso  ── CANCEL ──→  cancelado (terminal)
```

### Assignment (`assignmentStatusEnum`)

```
   ┌──────────┐
   │ asignado │ ── CANCEL ──→  cancelado (terminal)
   └────┬─────┘
    PICKUP_CONFIRMED
        ▼
   ┌──────────┐
   │ recogido │ ── CANCEL ──→  cancelado
   └────┬─────┘
    DELIVERY_CONFIRMED
        ▼
   ┌────────────┐
   │ entregado  │  (terminal)
   └────────────┘
```

## Plan de migración de services existentes

Hoy hay 6 sites en `apps/api/src/` que hacen `db.update(...).set({ status: 'X' })` directo sin validación:

| Service / Route | Transición |
|-----------------|------------|
| `services/matching.ts:99` | `→ emparejando` |
| `services/matching.ts:216` | `→ ofertas_enviadas` |
| `services/matching.ts:284` | `→ expirado` |
| `services/offer-actions.ts:132` | offer `→ reemplazada` (no trip) |
| `services/offer-actions.ts:145` | trip `→ asignado` |
| `services/confirmar-entrega-viaje.ts:153` | trip `→ entregado` |
| `routes/trip-requests-v2.ts:545` | trip `→ cancelado` |

PR follow-up para migrar uno a uno:

```ts
// Antes:
await db.update(trips).set({ status: 'entregado' }).where(eq(trips.id, tripId));

// Después:
const trip = await db.query.trips.findFirst({ where: eq(trips.id, tripId) });
if (!trip) throw new NotFoundError();
assertTripTransition(trip.status, { type: 'DELIVERY_CONFIRMED' });
await db.update(trips).set({ status: 'entregado' }).where(eq(trips.id, tripId));
```

Cada migración debe ir en commit independiente con su test E2E.

## Referencias

- Drizzle enums: `apps/api/src/db/schema.ts:126-157`
- ADR-004 — Uber-like model (define el flujo conceptual)
- HANDOFF.md §5 — bloqueante "trip-state-machine XState canónica"
- XState v5 docs — https://stately.ai/docs

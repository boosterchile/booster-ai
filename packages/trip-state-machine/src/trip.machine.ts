/**
 * State machine canónica del workflow de un viaje (`trip_request`).
 *
 * Estados matchean `tripStatusEnum` en `apps/api/src/db/schema.ts:126-136`.
 *
 * Diagrama:
 *
 * ```
 *                ┌──────────┐
 *                │ borrador │
 *                └────┬─────┘
 *                START_MATCHING
 *                     ▼
 *           ┌──────────────────┐
 *      ┌──→ │ esperando_match  │ ←──── RETRY ──── ┌──────────┐
 *      │    └────────┬─────────┘                  │ expirado │
 *      │       START_MATCHING                     └─────▲────┘
 *      │             ▼                                  │
 *      │     ┌──────────────┐                           │
 *      └──── │ emparejando  │                           │
 *   NO_MATCH └──────┬───────┘                           │
 *                OFFERS_SENT                            │
 *                   ▼                                   │
 *           ┌────────────────────┐                      │
 *           │ ofertas_enviadas   │ ── ALL_OFFERS_EXPIRED┘
 *           └─────────┬──────────┘
 *                OFFER_ACCEPTED
 *                     ▼
 *               ┌──────────┐
 *               │ asignado │
 *               └────┬─────┘
 *               PICKUP_CONFIRMED
 *                    ▼
 *              ┌────────────┐
 *              │ en_proceso │
 *              └─────┬──────┘
 *               DELIVERY_CONFIRMED
 *                    ▼
 *              ┌────────────┐    (terminal)
 *              │ entregado  │
 *              └────────────┘
 *
 *  Cancel from cualquier estado activo:
 *      borrador / esperando_match / emparejando / ofertas_enviadas /
 *      asignado / en_proceso  ── CANCEL ──→  cancelado (terminal)
 * ```
 */

import { createMachine } from 'xstate';

export type TripStatus =
  | 'borrador'
  | 'esperando_match'
  | 'emparejando'
  | 'ofertas_enviadas'
  | 'asignado'
  | 'en_proceso'
  | 'entregado'
  | 'cancelado'
  | 'expirado';

export type TripEvent =
  | { type: 'START_MATCHING' }
  | { type: 'OFFERS_SENT' }
  | { type: 'NO_MATCH' }
  | { type: 'NO_CANDIDATES' }
  | { type: 'OFFER_ACCEPTED' }
  | { type: 'ALL_OFFERS_EXPIRED' }
  | { type: 'PICKUP_CONFIRMED' }
  | { type: 'DELIVERY_CONFIRMED' }
  | { type: 'CANCEL' }
  | { type: 'RETRY' };

export interface TripContext {
  tripId: string;
}

export const tripMachine = createMachine({
  id: 'trip',
  initial: 'borrador',
  types: {} as {
    context: TripContext;
    events: TripEvent;
  },
  context: { tripId: '' },
  states: {
    borrador: {
      on: {
        START_MATCHING: 'esperando_match',
        CANCEL: 'cancelado',
      },
    },
    esperando_match: {
      on: {
        START_MATCHING: 'emparejando',
        CANCEL: 'cancelado',
      },
    },
    emparejando: {
      on: {
        OFFERS_SENT: 'ofertas_enviadas',
        NO_MATCH: 'esperando_match',
        // matching encontró 0 candidatos viables (no hay carriers en zona +
        // mismo cargo type + capacidad). Distinto a NO_MATCH (retry) y
        // ALL_OFFERS_EXPIRED (vencieron las ya enviadas). Reflejado por el
        // service apps/api/src/services/matching.ts:finalizeNoCandidates.
        NO_CANDIDATES: 'expirado',
        CANCEL: 'cancelado',
      },
    },
    ofertas_enviadas: {
      on: {
        OFFER_ACCEPTED: 'asignado',
        ALL_OFFERS_EXPIRED: 'expirado',
        CANCEL: 'cancelado',
      },
    },
    asignado: {
      on: {
        PICKUP_CONFIRMED: 'en_proceso',
        CANCEL: 'cancelado',
      },
    },
    en_proceso: {
      on: {
        DELIVERY_CONFIRMED: 'entregado',
        CANCEL: 'cancelado',
      },
    },
    entregado: {
      type: 'final',
    },
    cancelado: {
      type: 'final',
    },
    expirado: {
      on: {
        RETRY: 'esperando_match',
      },
    },
  },
});

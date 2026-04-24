import { z } from 'zod';
import { tripStateSchema } from '../domain/trip.js';
import { tripIdSchema, userIdSchema } from '../primitives/ids.js';

/**
 * Evento publicado cada vez que un Trip cambia de estado.
 * Topic: trip-events.
 */
export const tripStateChangedEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.literal('trip.state_changed'),
  trip_id: tripIdSchema,
  from_state: tripStateSchema.nullable(),
  to_state: tripStateSchema,
  actor_user_id: userIdSchema.nullable(),
  timestamp: z.string().datetime(),
  metadata: z.record(z.unknown()).default({}),
});

export type TripStateChangedEvent = z.infer<typeof tripStateChangedEventSchema>;

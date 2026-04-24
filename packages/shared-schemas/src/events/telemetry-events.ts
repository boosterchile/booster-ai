import type { z } from 'zod';
import { telemetryEventSchema } from '../domain/telemetry.js';

/**
 * Payload del topic `telemetry-events`.
 * Un solo evento por mensaje Pub/Sub (no batching a nivel de topic — el batching
 * lo hace el gateway antes de publicar).
 */
export const telemetryPublishedMessageSchema = telemetryEventSchema;
export type TelemetryPublishedMessage = z.infer<typeof telemetryPublishedMessageSchema>;

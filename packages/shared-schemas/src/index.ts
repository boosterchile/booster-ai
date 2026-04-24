/**
 * @booster-ai/shared-schemas
 *
 * Zod schemas compartidos entre backend y frontend.
 * Una sola fuente de verdad para la forma de los datos en todo el sistema.
 */

// Primitivos (usados por múltiples dominios)
export * from './primitives/ids.js';
export * from './primitives/chile.js';
export * from './primitives/geo.js';

// Dominio
export * from './domain/user.js';
export * from './domain/carrier.js';
export * from './domain/driver.js';
export * from './domain/vehicle.js';
export * from './domain/cargo-request.js';
export * from './domain/trip.js';
export * from './domain/telemetry.js';
export * from './domain/stakeholder.js';

// Events (Pub/Sub payloads)
export * from './events/trip-events.js';
export * from './events/telemetry-events.js';

// Thin slice (Fase 6) — WhatsApp intake flow
export * from './common.js';
export * from './trip-request.js';
export * from './whatsapp.js';

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

// Dominio — multi-tenant + ops (slice B pre-launch)
export * from './domain/stakeholder.js';
export * from './domain/empresa.js';
export * from './domain/plan.js';
export * from './domain/membership.js';
export * from './domain/zone.js';
export * from './domain/offer.js';
export * from './domain/assignment.js';
export * from './domain/trip-event.js';
export * from './domain/trip-metrics.js';
export * from './domain/document.js';

// Dominio — entidades del MVP shared (algunas precedentes a multi-tenant,
// se irán armonizando en commits siguientes para apuntar a empresa_id)
export * from './domain/user.js';
export * from './domain/transportista.js';
export * from './domain/driver.js';
export * from './domain/vehicle.js';
export * from './domain/cargo-request.js';
export * from './domain/trip.js';
export * from './domain/telemetry.js';

// Events (Pub/Sub payloads)
export * from './events/trip-events.js';
export * from './events/telemetry-events.js';

// Thin slice (Fase 6) — WhatsApp intake flow
export * from './common.js';
export * from './trip-request.js';
export * from './whatsapp.js';

// Onboarding (Slice B.4)
export * from './onboarding.js';

// Trip request creation (Slice B.5)
export * from './trip-request-create.js';

// Profile update (Slice B.8)
export * from './profile.js';

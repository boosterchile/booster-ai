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
export * from './primitives/dates.js';

// Dominio — multi-tenant + ops (slice B pre-launch)
export * from './domain/stakeholder.js';
export * from './domain/organizacion-stakeholder.js';
export * from './domain/empresa.js';
export * from './domain/plan.js';
export * from './domain/membership.js';
export * from './domain/zone.js';
export * from './domain/zona-stakeholder.js';
export * from './domain/offer.js';
export * from './domain/assignment.js';
export * from './domain/trip-event.js';
export * from './domain/trip-metrics.js';

// Dominio — entidades del MVP shared (algunas precedentes a multi-tenant,
// se irán armonizando en commits siguientes para apuntar a empresa_id)
export * from './domain/user.js';
export * from './domain/transportista.js';
export * from './domain/driver.js';
export * from './domain/vehicle.js';
export * from './domain/cargo-request.js';

// Events (Pub/Sub payloads)
export * from './events/telemetry-record.js';

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

// Auth universal RUT + clave numérica (ADR-035 — Wave 4)
export * from './auth.js';

// AVL IDs catálogo (Wave 2 — Track B1 + B2)
export * from './avl-ids/index.js';

// Site Settings — configuración runtime editable de marca y copy (ADR-039)
export * from './site-settings.js';

// Aggregations — privacy invariants compartidos backend/frontend (D11/ADR-041)
export * from './aggregations/k-anonymity.js';

// SEC-001 Sprint 2a H1.1 — cuentas demo DB-driven registry (ADR-053)
export * from './domain/cuentas-demo.js';

// SEC-001 Sprint 2b H1.2 — solicitudes de registro signup gate (ADR-052)
export * from './domain/signup-request.js';

// Safety events — Pub/Sub payload para topic safety-p0 (feat/safety-event-fanout)
export * from './domain/safety-event.js';

// Repositorio documental de transporte — recepción/archivo de DTE de terceros
// (ADR-070, frente F4). Booster NO emite DTE (ADR-069), solo recibe/archiva.
export * from './domain/transport-document.js';

// Eco-routing realtime — sugerencias de ruta eco-óptima emitidas en tiempo real
// por el eco-routing-service; persistidas para trazabilidad del ciclo de vida.
export * from './domain/route-suggestion.js';

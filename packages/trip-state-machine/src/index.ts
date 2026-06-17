/**
 * @booster-ai/trip-state-machine
 *
 * Lifecycle del viaje como tabla de transiciones pura (ADR-061; antes
 * stub — el finding 🔴 de ADR-004 en el inventario adr-vs-prod). Los
 * services de apps/api orquestan (tx, FOR UPDATE, CAS) y delegan acá la
 * legalidad de cada transición.
 */
export const PACKAGE_NAME = '@booster-ai/trip-state-machine' as const;

export * from './estados.js';
export * from './transiciones.js';

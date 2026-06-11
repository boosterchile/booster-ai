import { ESTADOS_VIAJE } from '@booster-ai/trip-state-machine';
import { describe, expect, it } from 'vitest';
import { tripStatusEnum } from '../../src/db/schema.js';

/**
 * Spec arch-trip-state-machine-refactor SC-6: el package es espejo
 * deliberado del enum DDL (zero-dep, no puede importar Drizzle). Este
 * test es la barrera anti-drift que la auditoría 2026-06-09 pidió para
 * los espejos manuales: cambiar un lado sin el otro rompe acá.
 */
describe('paridad trip-state-machine ↔ enum DDL estado_viaje', () => {
  it('ESTADOS_VIAJE ≡ tripStatusEnum.enumValues (mismo orden)', () => {
    expect([...ESTADOS_VIAJE]).toEqual(tripStatusEnum.enumValues);
  });
});

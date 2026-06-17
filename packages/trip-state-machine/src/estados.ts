/**
 * Estados del lifecycle de viaje — ESPEJO del enum DDL `estado_viaje`
 * (apps/api/src/db/schema.ts, pgEnum tripStatusEnum). El package es
 * zero-dep a propósito (no importa Drizzle): la paridad la garantiza el
 * test `trip-state-machine-parity.test.ts` en apps/api, que rompe si
 * cualquiera de los dos lados cambia sin el otro (spec §SC-6).
 *
 * Vocabulario canónico: español, como el DDL (regla de naming bilingüe
 * del CLAUDE.md). El vocabulario aspiracional de ADR-004 (17 estados en
 * inglés) fue eliminado por tener cero consumidores — ver ADR-061.
 */
export const ESTADOS_VIAJE = [
  'borrador',
  'esperando_match',
  'emparejando',
  'ofertas_enviadas',
  'asignado',
  'en_proceso',
  'entregado',
  'cancelado',
  'expirado',
] as const;

export type EstadoViaje = (typeof ESTADOS_VIAJE)[number];

const ESTADOS_SET: ReadonlySet<string> = new Set(ESTADOS_VIAJE);

/** Type guard para strings de boundary (rows de BD tipadas como string). */
export function esEstadoViaje(valor: string): valor is EstadoViaje {
  return ESTADOS_SET.has(valor);
}

/**
 * Estados terminales: sin transiciones de salida. Un viaje acá quedó
 * cerrado para siempre (la "resurrección" de un terminal fue exactamente
 * el bug de la auditoría 2026-06-09 / PR #436).
 */
export const ESTADOS_TERMINALES = [
  'entregado',
  'cancelado',
  'expirado',
] as const satisfies readonly EstadoViaje[];

export function esTerminal(estado: EstadoViaje): boolean {
  return (ESTADOS_TERMINALES as readonly EstadoViaje[]).includes(estado);
}

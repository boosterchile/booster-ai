import { describe, expect, it } from 'vitest';
import { ESTADOS_VIAJE, type EstadoViaje, esEstadoViaje, esTerminal } from './estados.js';
// Vía index a propósito: cubre el barrel y fija la API pública del package.
import { PACKAGE_NAME } from './index.js';
import {
  TRANSICIONES,
  TransicionViajeInvalidaError,
  assertTransicion,
  esAceptableOferta,
  esCancelablePorShipper,
  esConfirmableEntrega,
  puedeTransicionar,
} from './transiciones.js';

/**
 * La FSM real del lifecycle (spec §7) — fixture EXPLÍCITO e independiente
 * de la tabla de producción: si alguien edita TRANSICIONES, este test
 * rompe y obliga a justificar la transición nueva/eliminada en review.
 */
const VALIDAS: ReadonlyArray<readonly [EstadoViaje, EstadoViaje]> = [
  ['borrador', 'esperando_match'],
  ['borrador', 'cancelado'],
  ['esperando_match', 'emparejando'],
  ['esperando_match', 'cancelado'],
  ['emparejando', 'ofertas_enviadas'],
  ['emparejando', 'expirado'],
  ['emparejando', 'cancelado'],
  ['ofertas_enviadas', 'asignado'],
  ['ofertas_enviadas', 'cancelado'],
  ['ofertas_enviadas', 'expirado'],
  ['asignado', 'en_proceso'],
  ['asignado', 'entregado'],
  ['en_proceso', 'entregado'],
];

describe('TRANSICIONES — tabla exhaustiva (T1)', () => {
  it.each(VALIDAS)('%s → %s es válida', (desde, hacia) => {
    expect(puedeTransicionar(desde, hacia)).toBe(true);
  });

  it('TODA combinación fuera del fixture es inválida (producto cartesiano 9×9)', () => {
    const validasSet = new Set(VALIDAS.map(([a, b]) => `${a}→${b}`));
    for (const desde of ESTADOS_VIAJE) {
      for (const hacia of ESTADOS_VIAJE) {
        const esperado = validasSet.has(`${desde}→${hacia}`);
        expect(puedeTransicionar(desde, hacia), `${desde}→${hacia}`).toBe(esperado);
      }
    }
  });

  it('la tabla cubre exactamente los 9 estados como origen', () => {
    expect(Object.keys(TRANSICIONES).sort()).toEqual([...ESTADOS_VIAJE].sort());
  });
});

describe('assertTransicion (T2)', () => {
  it('transición válida no lanza', () => {
    expect(() => assertTransicion('esperando_match', 'emparejando')).not.toThrow();
  });

  it('inválida lanza TransicionViajeInvalidaError con desde/hacia/permitidas', () => {
    try {
      assertTransicion('cancelado', 'asignado');
      expect.unreachable('debió lanzar');
    } catch (err) {
      expect(err).toBeInstanceOf(TransicionViajeInvalidaError);
      const e = err as TransicionViajeInvalidaError;
      expect(e.desde).toBe('cancelado');
      expect(e.hacia).toBe('asignado');
      expect(e.permitidas).toEqual([]);
      expect(e.message).toContain('terminal');
    }
  });

  it('el caso de la auditoría (resurrección): cancelado → asignado lanza', () => {
    expect(() => assertTransicion('cancelado', 'asignado')).toThrow(TransicionViajeInvalidaError);
  });

  it('inválida desde estado NO terminal lista las permitidas en el mensaje', () => {
    try {
      assertTransicion('borrador', 'entregado');
      expect.unreachable('debió lanzar');
    } catch (err) {
      const e = err as TransicionViajeInvalidaError;
      expect(e.permitidas).toEqual(['esperando_match', 'cancelado']);
      expect(e.message).toContain('esperando_match, cancelado');
    }
  });

  it('el barrel del package expone la API (PACKAGE_NAME conservado para el smoke test)', () => {
    expect(PACKAGE_NAME).toBe('@booster-ai/trip-state-machine');
  });
});

describe('terminales (T3)', () => {
  it.each(['entregado', 'cancelado', 'expirado'] as const)('%s es terminal sin salidas', (e) => {
    expect(esTerminal(e)).toBe(true);
    expect(TRANSICIONES[e]).toEqual([]);
  });

  it.each([
    'borrador',
    'esperando_match',
    'emparejando',
    'ofertas_enviadas',
    'asignado',
    'en_proceso',
  ] as const)('%s NO es terminal', (e) => {
    expect(esTerminal(e)).toBe(false);
    expect(TRANSICIONES[e].length).toBeGreaterThan(0);
  });
});

describe('guards semánticos ≡ sets históricos de los services (T4)', () => {
  it('cancelable por shipper: exactamente los 4 estados pre-asignación (ex CANCELLABLE_STATUSES)', () => {
    const cancelables = ESTADOS_VIAJE.filter(esCancelablePorShipper);
    expect(cancelables).toEqual(['borrador', 'esperando_match', 'emparejando', 'ofertas_enviadas']);
  });

  it('aceptable para oferta: SOLO ofertas_enviadas (guard de #436)', () => {
    expect(ESTADOS_VIAJE.filter(esAceptableOferta)).toEqual(['ofertas_enviadas']);
  });

  it('confirmable entrega: asignado + en_proceso (ex STATUS_CONFIRMABLE)', () => {
    expect(ESTADOS_VIAJE.filter(esConfirmableEntrega)).toEqual(['asignado', 'en_proceso']);
  });
});

describe('esEstadoViaje (T5)', () => {
  it('acepta los 9 del enum y rechaza el resto', () => {
    for (const e of ESTADOS_VIAJE) {
      expect(esEstadoViaje(e)).toBe(true);
    }
    expect(esEstadoViaje('requested')).toBe(false); // vocabulario ADR-004 muerto
    expect(esEstadoViaje('')).toBe(false);
    expect(esEstadoViaje('ENTREGADO')).toBe(false);
  });
});

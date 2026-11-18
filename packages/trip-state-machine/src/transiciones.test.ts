import { describe, expect, it } from 'vitest';
import { ESTADOS_VIAJE, type EstadoViaje, esEstadoViaje, esTerminal } from './estados.js';
// Vía index a propósito: cubre el barrel y fija la API pública del package.
import { PACKAGE_NAME } from './index.js';
import {
  ESTADOS_PRE_MATCH,
  TRANSICIONES,
  TransicionViajeInvalidaError,
  aceptaDatosLibres,
  aceptaSolicitudCambio,
  assertTransicion,
  esAceptableOferta,
  esAnulablePorGenerador,
  esCancelablePostMatch,
  esConfirmableEntrega,
  esConfirmableRecogida,
  esEditablePreMatch,
  esPreMatch,
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
  // editar-anular-cargas: volver a ofertar tras una edición material antes
  // del match. Única transición hacia atrás; no sale de ningún terminal.
  ['ofertas_enviadas', 'esperando_match'],
  ['asignado', 'en_proceso'],
  ['asignado', 'entregado'],
  // editar-anular-cargas: cancelación después del match (no desde en_proceso, §12-P2).
  ['asignado', 'cancelado'],
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
  it('anulable por el generador: exactamente los 4 estados pre-match (ex CANCELLABLE_STATUSES)', () => {
    expect(ESTADOS_VIAJE.filter(esAnulablePorGenerador)).toEqual([
      'borrador',
      'esperando_match',
      'emparejando',
      'ofertas_enviadas',
    ]);
  });

  // editar-anular-cargas §4: guards derivados de la tabla.
  it('pre-match: los mismos 4 estados, y ESTADOS_PRE_MATCH coincide', () => {
    expect(ESTADOS_VIAJE.filter(esPreMatch)).toEqual([...ESTADOS_PRE_MATCH]);
    expect([...ESTADOS_PRE_MATCH]).toEqual([
      'borrador',
      'esperando_match',
      'emparejando',
      'ofertas_enviadas',
    ]);
  });

  it('cancelable después del match: solo asignado (en_proceso no, §12-P2)', () => {
    expect(ESTADOS_VIAJE.filter(esCancelablePostMatch)).toEqual(['asignado']);
  });

  it('editable antes del match: sin emparejando (el matching está en curso)', () => {
    expect(ESTADOS_VIAJE.filter(esEditablePreMatch)).toEqual([
      'borrador',
      'esperando_match',
      'ofertas_enviadas',
    ]);
  });

  it('datos libres: todo estado no terminal', () => {
    expect(ESTADOS_VIAJE.filter(aceptaDatosLibres)).toEqual([
      'borrador',
      'esperando_match',
      'emparejando',
      'ofertas_enviadas',
      'asignado',
      'en_proceso',
    ]);
  });

  it('solicitud de cambio: solo asignado', () => {
    expect(ESTADOS_VIAJE.filter(aceptaSolicitudCambio)).toEqual(['asignado']);
  });

  it('aceptable para oferta: SOLO ofertas_enviadas (guard de #436)', () => {
    expect(ESTADOS_VIAJE.filter(esAceptableOferta)).toEqual(['ofertas_enviadas']);
  });

  it('confirmable entrega: asignado + en_proceso (ex STATUS_CONFIRMABLE)', () => {
    expect(ESTADOS_VIAJE.filter(esConfirmableEntrega)).toEqual(['asignado', 'en_proceso']);
  });

  // Guard consultable (NO lanza) para que la UI decida si ofrecer la recogida.
  // El service sigue validando con assertTransicion; los 3 casos son los del
  // plan medicion-huella-segmento Task 5.
  describe('esConfirmableRecogida', () => {
    it('asignado → true (la recogida abre la ventana pickedUpAt→deliveredAt)', () => {
      expect(esConfirmableRecogida('asignado')).toBe(true);
    });

    it('en_proceso → false (ya recogido; no se ofrece de nuevo)', () => {
      expect(esConfirmableRecogida('en_proceso')).toBe(false);
    });

    it('entregado → false (terminal; nada que recoger)', () => {
      expect(esConfirmableRecogida('entregado')).toBe(false);
    });

    it('derivado de la tabla: exactamente los estados que transicionan a en_proceso', () => {
      expect(ESTADOS_VIAJE.filter(esConfirmableRecogida)).toEqual(['asignado']);
    });
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

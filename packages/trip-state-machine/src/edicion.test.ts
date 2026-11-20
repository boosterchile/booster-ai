import { describe, expect, it } from 'vitest';
import {
  CAMPOS_COMERCIALES,
  CAMPOS_CON_ACEPTACION,
  CAMPOS_LIBRES,
  type CargaEditable,
  ESTADOS_SOLICITUD_CAMBIO,
  TRANSICIONES_SOLICITUD,
  clasificarEdicion,
  puedeTransicionarSolicitud,
} from './edicion.js';
import { ESTADOS_VIAJE } from './estados.js';

/**
 * editar-anular-cargas §4–5: qué campo se edita en qué estado. Es la única
 * fuente de esa regla; la usan la API y la web.
 */
const ORIGEN = { address_raw: 'Av. Apoquindo 5550', region_code: 'XIII' };
const DESTINATARIO = { name: 'Bodega', phone_e164: null, email: null };
const BASE: CargaEditable = {
  origin: ORIGEN,
  destination: { address_raw: 'Av. Brasil 2345', region_code: 'V' },
  cargo_type: 'carga_seca',
  weight_kg: 8000,
  volume_m3: null,
  description: null,
  pickup_window: { start_at: '2026-11-20T12:00:00.000Z', end_at: '2026-11-20T16:00:00.000Z' },
  proposed_price_clp: 250_000,
  modalidad_carga: 'spot',
  consignee: DESTINATARIO,
  notes: null,
  reference: null,
};

describe('listas de campos', () => {
  it('libres, con aceptación y comerciales son las de la spec', () => {
    expect([...CAMPOS_LIBRES]).toEqual(['consignee', 'notes', 'reference']);
    expect([...CAMPOS_CON_ACEPTACION]).toEqual([
      'origin',
      'destination',
      'cargo_type',
      'weight_kg',
      'volume_m3',
      'description',
      'pickup_window',
      'proposed_price_clp',
      'modalidad_carga',
    ]);
    expect([...CAMPOS_COMERCIALES]).toEqual(['proposed_price_clp', 'modalidad_carga']);
  });

  it('libres y con aceptación cubren todos los campos de la carga, sin repetir', () => {
    const todos = [...CAMPOS_LIBRES, ...CAMPOS_CON_ACEPTACION].sort();
    expect(todos).toEqual(Object.keys(BASE).sort());
  });

  it('los comerciales son un subconjunto de los que requieren aceptación', () => {
    for (const c of CAMPOS_COMERCIALES) {
      expect(CAMPOS_CON_ACEPTACION).toContain(c);
    }
  });
});

describe('clasificarEdicion', () => {
  it('sin cambios: directo y listas vacías', () => {
    expect(
      clasificarEdicion('asignado', BASE, {
        ...BASE,
        origin: { ...ORIGEN },
        consignee: { ...DESTINATARIO },
      }),
    ).toEqual({
      libres: [],
      materiales: [],
      comerciales: [],
      permitido: 'directo',
    });
  });

  it('antes del match, un cambio material vuelve a ofertar', () => {
    const r = clasificarEdicion('ofertas_enviadas', BASE, { ...BASE, weight_kg: 9000 });
    expect(r).toEqual({
      libres: [],
      materiales: ['weight_kg'],
      comerciales: [],
      permitido: 'rematch',
    });
  });

  it('antes del match, solo datos libres: directo', () => {
    const r = clasificarEdicion('esperando_match', BASE, { ...BASE, notes: 'Andén 4' });
    expect(r.permitido).toBe('directo');
    expect(r.libres).toEqual(['notes']);
  });

  it('después del match, un cambio material requiere aceptación', () => {
    const r = clasificarEdicion('asignado', BASE, {
      ...BASE,
      origin: { ...ORIGEN, address_raw: 'Otra 123' },
      proposed_price_clp: 300_000,
    });
    expect(r).toEqual({
      libres: [],
      materiales: ['origin', 'proposed_price_clp'],
      comerciales: ['proposed_price_clp'],
      permitido: 'requiere_aceptacion',
    });
  });

  it('después del match, datos libres: directo', () => {
    const r = clasificarEdicion('asignado', BASE, {
      ...BASE,
      consignee: { ...DESTINATARIO, phone_e164: '+56911111111' },
      reference: 'PO-123',
    });
    expect(r.permitido).toBe('directo');
    expect(r.libres).toEqual(['consignee', 'reference']);
  });

  it('libres y materiales juntos después del match: requiere aceptación por los materiales', () => {
    const r = clasificarEdicion('asignado', BASE, {
      ...BASE,
      notes: 'Andén 4',
      modalidad_carga: 'programada',
    });
    expect(r.permitido).toBe('requiere_aceptacion');
    expect(r.libres).toEqual(['notes']);
    expect(r.comerciales).toEqual(['modalidad_carga']);
  });

  it('en proceso, lo material está prohibido y lo libre se edita', () => {
    expect(clasificarEdicion('en_proceso', BASE, { ...BASE, weight_kg: 1 }).permitido).toBe(
      'prohibido',
    );
    expect(clasificarEdicion('en_proceso', BASE, { ...BASE, notes: 'x' }).permitido).toBe(
      'directo',
    );
  });

  it('mientras el matching corre (emparejando), lo material está prohibido', () => {
    expect(clasificarEdicion('emparejando', BASE, { ...BASE, weight_kg: 1 }).permitido).toBe(
      'prohibido',
    );
  });

  it.each(['entregado', 'cancelado', 'expirado'] as const)(
    '%s: cualquier cambio está prohibido',
    (estado) => {
      expect(clasificarEdicion(estado, BASE, { ...BASE, notes: 'x' }).permitido).toBe('prohibido');
    },
  );

  it('compara por valor, no por referencia ni por orden de claves', () => {
    const reordenado: CargaEditable = {
      ...BASE,
      origin: { region_code: 'XIII', address_raw: 'Av. Apoquindo 5550' },
    };
    expect(clasificarEdicion('asignado', BASE, reordenado).materiales).toEqual([]);
  });

  it('cubre los 9 estados sin lanzar', () => {
    for (const e of ESTADOS_VIAJE) {
      expect(() => clasificarEdicion(e, BASE, { ...BASE, weight_kg: 1 })).not.toThrow();
    }
  });
});

describe('TRANSICIONES_SOLICITUD', () => {
  it('pendiente sale a los 4 cierres; los cierres son terminales', () => {
    expect([...ESTADOS_SOLICITUD_CAMBIO]).toEqual([
      'pendiente',
      'aceptada',
      'rechazada',
      'retirada',
      'invalidada',
    ]);
    expect(TRANSICIONES_SOLICITUD.pendiente).toEqual([
      'aceptada',
      'rechazada',
      'retirada',
      'invalidada',
    ]);
    for (const e of ESTADOS_SOLICITUD_CAMBIO.filter((x) => x !== 'pendiente')) {
      expect(TRANSICIONES_SOLICITUD[e]).toEqual([]);
    }
  });

  it('no vence sola: no hay estado expirada (§12-P7)', () => {
    expect(ESTADOS_SOLICITUD_CAMBIO).not.toContain('expirada');
  });

  it('puedeTransicionarSolicitud sigue la tabla', () => {
    expect(puedeTransicionarSolicitud('pendiente', 'aceptada')).toBe(true);
    expect(puedeTransicionarSolicitud('aceptada', 'rechazada')).toBe(false);
    expect(puedeTransicionarSolicitud('retirada', 'pendiente')).toBe(false);
  });
});

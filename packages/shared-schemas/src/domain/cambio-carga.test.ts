import { describe, expect, it } from 'vitest';
import {
  cambioPropuestoSchema,
  cambioRespondidoPayloadSchema,
  cambioSolicitadoPayloadSchema,
  cambiosGuardadosSchema,
  cargaEditadaPayloadSchema,
  datosLibresInputSchema,
} from './cambio-carga.js';

/** editar-anular-cargas §6.2: datos libres que el generador edita sin aceptación. */
describe('datosLibresInputSchema', () => {
  it('acepta notas y referencia, y las deja sin espacios', () => {
    expect(datosLibresInputSchema.parse({ notes: '  Andén 4  ', reference: ' PO-1 ' })).toEqual({
      notes: 'Andén 4',
      reference: 'PO-1',
    });
  });

  it('null borra el campo; vacío también', () => {
    expect(datosLibresInputSchema.parse({ notes: null, reference: '   ' })).toEqual({
      notes: null,
      reference: null,
    });
  });

  it('destinatario: teléfono E.164 y correo en minúsculas', () => {
    expect(
      datosLibresInputSchema.parse({
        consignee: { name: 'Bodega', phone_e164: '+56911111111', email: 'Recepcion@Cliente.CL' },
      }),
    ).toEqual({
      consignee: { name: 'Bodega', phone_e164: '+56911111111', email: 'recepcion@cliente.cl' },
    });
  });

  it('exige al menos un campo', () => {
    const r = datosLibresInputSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rechaza claves desconocidas (no se cuela un campo material)', () => {
    expect(datosLibresInputSchema.safeParse({ notes: 'x', weight_kg: 1 }).success).toBe(false);
  });

  it('respeta los topes: notas 1000 y referencia 100', () => {
    expect(datosLibresInputSchema.safeParse({ notes: 'x'.repeat(1001) }).success).toBe(false);
    expect(datosLibresInputSchema.safeParse({ reference: 'x'.repeat(101) }).success).toBe(false);
    expect(datosLibresInputSchema.safeParse({ notes: 'x'.repeat(1000) }).success).toBe(true);
  });
});

describe('cargaEditadaPayloadSchema', () => {
  it('modo libre lleva solo los nombres de los campos, sin valores', () => {
    const p = { modo: 'libre', campos: ['consignee', 'notes'] };
    expect(cargaEditadaPayloadSchema.parse(p)).toEqual(p);
  });

  it('rechaza un campo que no es libre en modo libre', () => {
    expect(
      cargaEditadaPayloadSchema.safeParse({ modo: 'libre', campos: ['weight_kg'] }).success,
    ).toBe(false);
  });
});

describe('cambioPropuestoSchema (editar-anular-cargas §5, PR7 sin campos comerciales)', () => {
  const futuro = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  it('acepta un cambio de peso y uno de ventana', () => {
    expect(cambioPropuestoSchema.parse({ weight_kg: 2000 })).toEqual({ weight_kg: 2000 });
    const ventana = { start_at: futuro(2), end_at: futuro(4) };
    expect(cambioPropuestoSchema.parse({ pickup_window: ventana })).toEqual({
      pickup_window: ventana,
    });
  });

  it('exige al menos un campo', () => {
    expect(cambioPropuestoSchema.safeParse({}).success).toBe(false);
  });

  it('rechaza datos libres y campos comerciales por esta vía', () => {
    expect(cambioPropuestoSchema.safeParse({ notes: 'x' }).success).toBe(false);
    expect(cambioPropuestoSchema.safeParse({ proposed_price_clp: 1 }).success).toBe(false);
    expect(cambioPropuestoSchema.safeParse({ modalidad_carga: 'spot' }).success).toBe(false);
  });

  it('la ventana nueva debe empezar en el futuro', () => {
    const r = cambioPropuestoSchema.safeParse({
      pickup_window: { start_at: futuro(-1), end_at: futuro(2) },
    });
    expect(r.success).toBe(false);
  });

  it('volumen y descripción se pueden borrar con null', () => {
    expect(cambioPropuestoSchema.parse({ volume_m3: null, description: null })).toEqual({
      volume_m3: null,
      description: null,
    });
  });
});

describe('cambiosGuardadosSchema', () => {
  it('lee una ventana ya pasada sin rechazarla (lectura, no propuesta)', () => {
    const pasado = '2026-01-01T10:00:00.000Z';
    expect(
      cambiosGuardadosSchema.parse({
        pickup_window: { start_at: pasado, end_at: pasado },
        origin: {
          address_raw: 'Av. Uno 123',
          region_code: null,
          comuna_code: null,
          latitude: null,
          longitude: null,
        },
      }),
    ).toMatchObject({ pickup_window: { start_at: pasado } });
  });
});

describe('payloads de solicitudes de cambio', () => {
  const id = '6f1c2a7e-4b2d-4c55-9a7b-1d2e3f4a5b6c';
  it('cambio_solicitado lleva la solicitud y los campos', () => {
    expect(
      cambioSolicitadoPayloadSchema.parse({ solicitud_id: id, campos: ['weight_kg'] }),
    ).toEqual({ solicitud_id: id, campos: ['weight_kg'] });
    expect(cambioSolicitadoPayloadSchema.safeParse({ solicitud_id: id, campos: [] }).success).toBe(
      false,
    );
  });

  it('cambio_respondido: invalidado exige motivo; el resto no lo lleva', () => {
    expect(
      cambioRespondidoPayloadSchema.safeParse({ solicitud_id: id, resultado: 'invalidado' })
        .success,
    ).toBe(false);
    expect(
      cambioRespondidoPayloadSchema.parse({
        solicitud_id: id,
        resultado: 'invalidado',
        motivo_invalidacion: 'viaje_cancelado',
      }),
    ).toMatchObject({ motivo_invalidacion: 'viaje_cancelado' });
    expect(
      cambioRespondidoPayloadSchema.parse({ solicitud_id: id, resultado: 'rechazado' }),
    ).toEqual({ solicitud_id: id, resultado: 'rechazado' });
  });

  it('carga_editada en modo cambio_aceptado lleva antes y después', () => {
    const p = cargaEditadaPayloadSchema.parse({
      modo: 'cambio_aceptado',
      solicitud_id: id,
      campos: ['weight_kg'],
      antes: { weight_kg: 1000 },
      despues: { weight_kg: 2000 },
    });
    expect(p.modo).toBe('cambio_aceptado');
  });
});

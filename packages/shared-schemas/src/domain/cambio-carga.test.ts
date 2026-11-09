import { describe, expect, it } from 'vitest';
import { cargaEditadaPayloadSchema, datosLibresInputSchema } from './cambio-carga.js';

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

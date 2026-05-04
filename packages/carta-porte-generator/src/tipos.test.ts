import { describe, expect, it } from 'vitest';
import { cartaPorteInputSchema } from './tipos.js';

const VALID = {
  folio: 'cp-1',
  emittedAt: '2026-05-04T00:00:00.000Z',
  porteador: {
    nombre: 'ACME',
    rut: '76543210-3',
    direccion: 'Av. 1',
    comuna: 'XX',
    region: 'XIII',
  },
  cargador: {
    nombre: 'Cargador',
    rut: '11111111-1',
    direccion: 'Av. 2',
    comuna: 'YY',
    region: 'II',
  },
  consignatario: {
    nombre: 'Consignatario',
    rut: '11111111-1',
    direccion: 'Av. 3',
    comuna: 'ZZ',
    region: 'XIII',
  },
  origen: { direccion: 'Av. 2', comuna: 'YY', region: 'II' },
  destino: { direccion: 'Av. 3', comuna: 'ZZ', region: 'XIII' },
  carga: {
    naturaleza: 'Materiales',
    cantidad: 1,
    unidad: 'caja',
    pesoKg: 10,
    embalaje: 'caja',
  },
  vehiculo: { patente: 'AB1234', tipo: 'camión' },
  conductor: {
    nombre: 'Juan',
    rut: '11111111-1',
    licenciaNumero: 'A-1',
    licenciaClase: 'A4',
  },
};

describe('cartaPorteInputSchema', () => {
  it('acepta input válido completo', () => {
    expect(() => cartaPorteInputSchema.parse(VALID)).not.toThrow();
  });

  it('rechaza RUT inválido en porteador', () => {
    expect(() =>
      cartaPorteInputSchema.parse({
        ...VALID,
        porteador: { ...VALID.porteador, rut: '12345678-X' },
      }),
    ).toThrow(/RUT/i);
  });

  it('rechaza folio vacío', () => {
    expect(() => cartaPorteInputSchema.parse({ ...VALID, folio: '' })).toThrow();
  });

  it('rechaza fecha no-ISO', () => {
    expect(() =>
      cartaPorteInputSchema.parse({ ...VALID, emittedAt: '2026-05-04 10:00' }),
    ).toThrow();
  });

  it('rechaza peso 0 o negativo', () => {
    expect(() =>
      cartaPorteInputSchema.parse({
        ...VALID,
        carga: { ...VALID.carga, pesoKg: 0 },
      }),
    ).toThrow();
  });

  it('acepta sin precioFleteClp ni verifyUrl', () => {
    const { ...withoutOptional } = VALID;
    expect(() => cartaPorteInputSchema.parse(withoutOptional)).not.toThrow();
  });

  it('rechaza precioFleteClp negativo', () => {
    expect(() => cartaPorteInputSchema.parse({ ...VALID, precioFleteClp: -100 })).toThrow();
  });

  it('rechaza patente fuera de rango', () => {
    expect(() =>
      cartaPorteInputSchema.parse({
        ...VALID,
        vehiculo: { ...VALID.vehiculo, patente: 'AB' },
      }),
    ).toThrow();
  });
});

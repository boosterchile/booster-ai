import { describe, expect, it } from 'vitest';
import { crearViajePropioBodySchema } from './viaje-propio.js';

describe('crearViajePropioBodySchema', () => {
  const base = {
    origen: { address_raw: 'Av. Apoquindo 3000, Las Condes', region_code: '13' },
    destino: { address_raw: 'Puerto San Antonio', region_code: '05' },
    cargo_type: 'agricola' as const,
    pickup_date_raw: '2026-11-20',
  };

  it('acepta cliente externo con RUT válido normalizado', () => {
    const parsed = crearViajePropioBodySchema.parse({
      ...base,
      cliente: { tipo: 'externo', nombre: 'Cliente SPA', rut: '11.111.111-1' },
    });
    expect(parsed.cliente).toEqual({
      tipo: 'externo',
      nombre: 'Cliente SPA',
      rut: '11111111-1',
    });
  });

  it('rechaza RUT inválido en cliente externo', () => {
    expect(() =>
      crearViajePropioBodySchema.parse({
        ...base,
        cliente: { tipo: 'externo', nombre: 'X', rut: '11.111.111-9' },
      }),
    ).toThrow();
  });

  it('acepta cliente generador con UUID', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const parsed = crearViajePropioBodySchema.parse({
      ...base,
      cliente: { tipo: 'generador', empresa_id: id },
    });
    expect(parsed.cliente).toEqual({ tipo: 'generador', empresa_id: id });
  });
});

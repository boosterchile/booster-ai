import { describe, expect, it } from 'vitest';
import {
  type LicenseClass,
  createDriverBodySchema,
  driverSchema,
  driverStatusSchema,
  licenseClassSchema,
  updateDriverBodySchema,
} from '../../src/domain/driver.js';

describe('licenseClassSchema', () => {
  it('acepta las 10 clases chilenas (DS 170)', () => {
    const all: LicenseClass[] = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E', 'F'];
    for (const c of all) {
      expect(licenseClassSchema.parse(c)).toBe(c);
    }
  });

  it('rechaza clases inventadas / mayúsculas raras', () => {
    expect(() => licenseClassSchema.parse('a1')).toThrow();
    expect(() => licenseClassSchema.parse('G')).toThrow();
    expect(() => licenseClassSchema.parse('A6')).toThrow();
    expect(() => licenseClassSchema.parse('')).toThrow();
  });
});

describe('driverStatusSchema', () => {
  it('acepta los 4 estados operativos', () => {
    for (const s of ['activo', 'suspendido', 'en_viaje', 'fuera_servicio'] as const) {
      expect(driverStatusSchema.parse(s)).toBe(s);
    }
  });

  it('rechaza estados fuera del enum', () => {
    expect(() => driverStatusSchema.parse('inactivo')).toThrow();
    expect(() => driverStatusSchema.parse('eliminado')).toThrow();
  });
});

describe('driverSchema', () => {
  const validRow = {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: '00000000-0000-0000-0000-000000000002',
    empresa_id: '00000000-0000-0000-0000-000000000003',
    license_class: 'A5',
    license_number: 'LIC-12345',
    license_expiry: '2027-12-31',
    is_extranjero: false,
    status: 'activo',
    created_at: '2026-05-10T22:00:00.000Z',
    updated_at: '2026-05-10T22:00:00.000Z',
    deleted_at: null,
  };

  it('acepta un row válido', () => {
    expect(driverSchema.parse(validRow)).toBeTruthy();
  });

  it('license_expiry debe ser ISO YYYY-MM-DD, no datetime', () => {
    expect(() =>
      driverSchema.parse({ ...validRow, license_expiry: '2027-12-31T00:00:00.000Z' }),
    ).toThrow();
    expect(() => driverSchema.parse({ ...validRow, license_expiry: '12/31/2027' })).toThrow();
  });

  it('is_extranjero default false cuando se omite', () => {
    const { is_extranjero, ...withoutFlag } = validRow;
    void is_extranjero;
    const parsed = driverSchema.parse(withoutFlag);
    expect(parsed.is_extranjero).toBe(false);
  });

  it('deleted_at puede ser string ISO o null', () => {
    expect(driverSchema.parse({ ...validRow, deleted_at: null })).toBeTruthy();
    expect(
      driverSchema.parse({ ...validRow, deleted_at: '2026-05-11T10:00:00.000Z' }),
    ).toBeTruthy();
    expect(() => driverSchema.parse({ ...validRow, deleted_at: 'no-es-fecha' })).toThrow();
  });

  it('license_number max 50 chars', () => {
    expect(() => driverSchema.parse({ ...validRow, license_number: 'X'.repeat(51) })).toThrow();
  });
});

describe('createDriverBodySchema', () => {
  it('requiere RUT, full_name, license_class, license_number, license_expiry', () => {
    expect(() => createDriverBodySchema.parse({})).toThrow();
    expect(() =>
      createDriverBodySchema.parse({
        rut: '11.111.111-1',
        full_name: 'Juan Pérez',
      }),
    ).toThrow();
  });

  it('acepta body mínimo válido', () => {
    const parsed = createDriverBodySchema.parse({
      rut: '11.111.111-1',
      full_name: 'Juan Pérez',
      license_class: 'A5',
      license_number: 'LIC-12345',
      license_expiry: '2027-12-31',
    });
    expect(parsed.is_extranjero).toBe(false); // default
    expect(parsed.email).toBeUndefined();
  });

  it('email opcional debe ser válido si se provee', () => {
    expect(() =>
      createDriverBodySchema.parse({
        rut: '11.111.111-1',
        full_name: 'Juan',
        license_class: 'B',
        license_number: 'X',
        license_expiry: '2027-12-31',
        email: 'no-es-email',
      }),
    ).toThrow();
  });
});

describe('updateDriverBodySchema', () => {
  it('todos los campos son opcionales (partial update)', () => {
    expect(updateDriverBodySchema.parse({})).toEqual({});
    expect(updateDriverBodySchema.parse({ status: 'suspendido' })).toEqual({
      status: 'suspendido',
    });
  });

  it('rechaza cambios a status fuera del enum', () => {
    expect(() => updateDriverBodySchema.parse({ status: 'borrado' })).toThrow();
  });

  it('license_expiry debe seguir formato YYYY-MM-DD si se incluye', () => {
    expect(() => updateDriverBodySchema.parse({ license_expiry: '2027/12/31' })).toThrow();
    expect(updateDriverBodySchema.parse({ license_expiry: '2028-06-30' })).toEqual({
      license_expiry: '2028-06-30',
    });
  });
});

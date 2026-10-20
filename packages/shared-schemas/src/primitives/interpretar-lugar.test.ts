import { describe, expect, it } from 'vitest';
import { interpretarComponentes, regionDesdeNombre } from './interpretar-lugar.js';

describe('regionDesdeNombre', () => {
  it('reconoce los nombres en español y en inglés', () => {
    expect(regionDesdeNombre('Región Metropolitana de Santiago')).toBe('XIII');
    expect(regionDesdeNombre('Santiago Metropolitan Region')).toBe('XIII');
    expect(regionDesdeNombre("Región del Libertador General Bernardo O'Higgins")).toBe('VI');
    expect(regionDesdeNombre('Región de Ñuble')).toBe('XVI');
    expect(regionDesdeNombre('Región del Biobío')).toBe('VIII');
    expect(regionDesdeNombre('Región de Los Ríos')).toBe('XIV');
    expect(regionDesdeNombre('Región de Los Lagos')).toBe('X');
    expect(regionDesdeNombre('Región de Aysén del General Carlos Ibáñez del Campo')).toBe('XI');
    expect(regionDesdeNombre('Región de Arica y Parinacota')).toBe('XV');
  });

  it('no adivina una región con un nombre suelto', () => {
    expect(regionDesdeNombre('Compañía')).toBeNull();
  });
});

describe('interpretarComponentes', () => {
  it('completa región y comuna desde una dirección de Santiago', () => {
    const lugar = interpretarComponentes(
      [
        { longName: '4425', shortName: '4425', types: ['street_number'] },
        { longName: 'Compañía', shortName: 'Compañía', types: ['route'] },
        { longName: 'Santiago', shortName: 'Santiago', types: ['locality', 'political'] },
        {
          longName: 'Santiago',
          shortName: 'Santiago',
          types: ['administrative_area_level_3', 'political'],
        },
        {
          longName: 'Región Metropolitana de Santiago',
          shortName: 'RM',
          types: ['administrative_area_level_1', 'political'],
        },
      ],
      'Compañía 4425, Santiago, Chile',
    );
    expect(lugar.direccion).toBe('Compañía 4425, Santiago');
    expect(lugar.region).toBe('XIII');
    expect(lugar.comunaCode).toBe('13101');
  });

  it('acepta el alias La Calera y arma la calle si no hay formatted', () => {
    const lugar = interpretarComponentes(
      [
        { longName: '100', shortName: '100', types: ['street_number'] },
        { longName: 'Avenida José Joaquín Pérez', shortName: 'Av. J. J. Pérez', types: ['route'] },
        {
          longName: 'La Calera',
          shortName: 'La Calera',
          types: ['locality', 'political'],
        },
        {
          longName: 'Región de Valparaíso',
          shortName: 'Valparaíso',
          types: ['administrative_area_level_1', 'political'],
        },
      ],
      '',
    );
    expect(lugar.region).toBe('V');
    expect(lugar.comunaCode).toBe('05502');
    expect(lugar.direccion).toBe('Avenida José Joaquín Pérez 100');
  });
});

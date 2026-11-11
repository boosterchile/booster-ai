import { describe, expect, it } from 'vitest';
import { type UnidadDeFlota, capacidadDeConfiguracion, cargaCabeEnCarrocerias } from './index.js';

/**
 * Capacidad de una configuración para una ruta con cargas de distinto tipo
 * (plan de ruta-parada-servicio, decisión D3): la suma de las unidades que
 * cargan, sin filtrar por carrocería. La carrocería se mira por servicio.
 */
function unidad(parcial: Partial<UnidadDeFlota> & Pick<UnidadDeFlota, 'id'>): UnidadDeFlota {
  return {
    unitCategory: 'motriz',
    unitType: 'camion_rigido',
    bodyType: 'plano',
    capacityKg: 10_000,
    capacityM3: 40,
    ...parcial,
  };
}

describe('capacidadDeConfiguracion', () => {
  it('motriz sola: la de la motriz', () => {
    expect(capacidadDeConfiguracion(unidad({ id: 'm' }), null)).toEqual({
      capacidadKg: 10_000,
      capacidadM3: 40,
      carrocerias: ['plano'],
    });
  });

  it('tracto con semirremolque: solo el semirremolque', () => {
    const tracto = unidad({ id: 't', unitType: 'tracto_camion', bodyType: null, capacityKg: 0 });
    const semi = unidad({
      id: 's',
      unitCategory: 'arrastre',
      unitType: 'semirremolque',
      bodyType: 'refrigerado',
      capacityKg: 28_000,
      capacityM3: 90,
    });
    expect(capacidadDeConfiguracion(tracto, semi)).toEqual({
      capacidadKg: 28_000,
      capacidadM3: 90,
      carrocerias: ['refrigerado'],
    });
  });

  it('tracto solo no carga', () => {
    const tracto = unidad({ id: 't', unitType: 'tracto_camion', capacityKg: 5_000 });
    expect(capacidadDeConfiguracion(tracto, null)).toEqual({
      capacidadKg: 0,
      capacidadM3: null,
      carrocerias: [],
    });
  });

  it('rígido con remolque: la suma de los dos, aunque las carrocerías difieran', () => {
    const rigido = unidad({ id: 'r', bodyType: 'cortina', capacityKg: 12_000, capacityM3: 50 });
    const remolque = unidad({
      id: 'x',
      unitCategory: 'arrastre',
      unitType: 'remolque',
      bodyType: 'tolva',
      capacityKg: 14_000,
      capacityM3: 30,
    });
    expect(capacidadDeConfiguracion(rigido, remolque)).toEqual({
      capacidadKg: 26_000,
      capacidadM3: 80,
      carrocerias: ['cortina', 'tolva'],
    });
  });

  it('si una unidad que carga no declara volumen, el volumen queda sin declarar', () => {
    const rigido = unidad({ id: 'r', capacityM3: null });
    const remolque = unidad({ id: 'x', unitCategory: 'arrastre', unitType: 'remolque' });
    expect(capacidadDeConfiguracion(rigido, remolque).capacidadM3).toBeNull();
  });

  it('la motriz tiene que ser motriz y el arrastre, arrastre', () => {
    const remolque = unidad({ id: 'x', unitCategory: 'arrastre', unitType: 'remolque' });
    expect(() => capacidadDeConfiguracion(remolque, null)).toThrow(/no es motriz/);
    expect(() => capacidadDeConfiguracion(unidad({ id: 'r' }), unidad({ id: 'r2' }))).toThrow(
      /no es de arrastre/,
    );
  });

  it('un arrastre que no compone con la motriz no se acepta', () => {
    const rigido = unidad({ id: 'r' });
    const semi = unidad({ id: 's', unitCategory: 'arrastre', unitType: 'semirremolque' });
    expect(() => capacidadDeConfiguracion(rigido, semi)).toThrow(/no compone/);
  });
});

describe('cargaCabeEnCarrocerias', () => {
  it('cabe si alguna unidad que carga le sirve', () => {
    expect(cargaCabeEnCarrocerias('refrigerada', ['plano', 'refrigerado'])).toBe(true);
    expect(cargaCabeEnCarrocerias('refrigerada', ['plano', 'tolva'])).toBe(false);
  });

  it('sin unidades que carguen no cabe nada', () => {
    expect(cargaCabeEnCarrocerias('carga_seca', [])).toBe(false);
  });

  it('una unidad sin carrocería declarada sigue la regla de matching (§3.5)', () => {
    expect(cargaCabeEnCarrocerias('carga_seca', [null])).toBe(true);
    expect(cargaCabeEnCarrocerias('refrigerada', [null])).toBe(false);
  });
});

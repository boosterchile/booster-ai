import {
  type BodyType,
  type CargoType,
  bodyTypeSchema,
  cargoTypeSchema,
  esConfiguracionCompatible,
  unitTypeSchema,
} from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import {
  CARROCERIAS as CARROCERIAS_DEL_PAQUETE,
  COMPATIBILIDAD_CARGA_CARROCERIA,
  TIPOS_DE_CARGA,
  TIPOS_DE_UNIDAD,
  type UnidadDeFlota,
  carroceriaCompatible,
  componeConArrastre,
  configuracionesElegibles,
  empresaEsCandidata,
} from '../src/elegibilidad/index.js';

/**
 * Copia de la tabla aprobada por el PO el 2026-11-11
 * (.specs/matching-desde-la-carga/plan.md §1.1). Por cada tipo de carga, las
 * carrocerías en «sí»; todo lo demás es «no». Está escrita aparte de la del
 * código a propósito: cambiar un par exige cambiarlo en los dos lados.
 */
const APROBADA: Record<CargoType, readonly BodyType[]> = {
  carga_seca: ['plano', 'cortina', 'furgon_cerrado', 'refrigerado'],
  perecible: ['furgon_cerrado', 'refrigerado'],
  refrigerada: ['refrigerado'],
  congelada: ['refrigerado'],
  fragil: ['cortina', 'furgon_cerrado', 'refrigerado'],
  peligrosa: ['plano', 'cortina', 'furgon_cerrado', 'cisterna'],
  liquida: ['cisterna'],
  construccion: ['plano', 'cortina', 'furgon_cerrado', 'tolva', 'cama_baja'],
  agricola: ['plano', 'cortina', 'furgon_cerrado', 'refrigerado', 'tolva'],
  ganado: ['jaula'],
  otra: ['plano', 'cortina', 'furgon_cerrado'],
};

const CARGAS = cargoTypeSchema.options;
const CARROCERIAS = bodyTypeSchema.options;
const PARES = CARGAS.flatMap((carga) =>
  CARROCERIAS.map((carroceria) => ({
    carga,
    carroceria,
    esperado: APROBADA[carga].includes(carroceria),
  })),
);

describe('espejo del dominio canónico (shared-schemas)', () => {
  it('los tipos de carga, las carrocerías y los tipos de unidad son los mismos', () => {
    expect([...TIPOS_DE_CARGA]).toEqual(cargoTypeSchema.options);
    expect([...CARROCERIAS_DEL_PAQUETE]).toEqual(bodyTypeSchema.options);
    expect([...TIPOS_DE_UNIDAD]).toEqual(unitTypeSchema.options);
  });

  it('qué arrastre lleva cada motriz coincide con ADR-073, par por par', () => {
    for (const motriz of unitTypeSchema.options) {
      for (const arrastre of unitTypeSchema.options) {
        expect(componeConArrastre(motriz, arrastre), `${motriz} + ${arrastre}`).toBe(
          esConfiguracionCompatible(motriz, arrastre),
        );
      }
    }
    expect(componeConArrastre(null, 'remolque')).toBe(false);
  });
});

describe('tabla de compatibilidad carga × carrocería', () => {
  it('cubre los 110 pares', () => {
    expect(PARES).toHaveLength(110);
    expect(Object.keys(COMPATIBILIDAD_CARGA_CARROCERIA).sort()).toEqual([...CARGAS].sort());
    for (const carga of CARGAS) {
      expect(Object.keys(COMPATIBILIDAD_CARGA_CARROCERIA[carga]).sort()).toEqual(
        [...CARROCERIAS].sort(),
      );
    }
  });

  it('tiene 30 pares en «sí» y 80 en «no»', () => {
    const si = PARES.filter((p) => carroceriaCompatible(p.carga, p.carroceria)).length;
    expect(si).toBe(30);
    expect(PARES.length - si).toBe(80);
  });

  it.each(PARES)('$carga × $carroceria → $esperado', ({ carga, carroceria, esperado }) => {
    expect(carroceriaCompatible(carga, carroceria)).toBe(esperado);
    expect(COMPATIBILIDAD_CARGA_CARROCERIA[carga][carroceria]).toBe(esperado);
  });
});

describe('vehículo sin carrocería declarada (spec §3.5)', () => {
  it.each(CARGAS.map((carga) => ({ carga, esperado: carga === 'carga_seca' || carga === 'otra' })))(
    '$carga → $esperado',
    ({ carga, esperado }) => {
      expect(carroceriaCompatible(carga, null)).toBe(esperado);
    },
  );
});

function unidad(cambios: Partial<UnidadDeFlota> & Pick<UnidadDeFlota, 'id'>): UnidadDeFlota {
  return {
    unitCategory: 'motriz',
    unitType: 'camion_rigido',
    bodyType: 'furgon_cerrado',
    capacityKg: 5_000,
    capacityM3: null,
    ...cambios,
  };
}

const semi = (cambios: Partial<UnidadDeFlota> & Pick<UnidadDeFlota, 'id'>) =>
  unidad({ unitCategory: 'arrastre', unitType: 'semirremolque', ...cambios });
const remolque = (cambios: Partial<UnidadDeFlota> & Pick<UnidadDeFlota, 'id'>) =>
  unidad({ unitCategory: 'arrastre', unitType: 'remolque', ...cambios });
const tracto = (id: string) =>
  unidad({ id, unitType: 'tracto_camion', bodyType: null, capacityKg: 0 });

const SECA = { cargoType: 'carga_seca', weightKg: 4_000, volumeM3: null } as const;

describe('configuracionesElegibles', () => {
  it('una motriz sola sirve con su carrocería y su capacidad', () => {
    expect(configuracionesElegibles(SECA, [unidad({ id: 'm1' })])).toEqual([
      { motrizId: 'm1', arrastreId: null, capacidadUtilKg: 5_000, capacidadUtilM3: null },
    ]);
  });

  it('el peso justo en el límite alcanza; un kilo más, no', () => {
    const flota = [unidad({ id: 'm1', capacityKg: 4_000 })];
    expect(configuracionesElegibles(SECA, flota)).toHaveLength(1);
    expect(configuracionesElegibles({ ...SECA, weightKg: 4_001 }, flota)).toEqual([]);
  });

  it('una carga sin peso declarado no descarta por peso', () => {
    expect(
      configuracionesElegibles({ ...SECA, weightKg: null }, [unidad({ id: 'm1', capacityKg: 1 })]),
    ).toHaveLength(1);
  });

  it('una carrocería que no sirve descarta aunque sobre capacidad', () => {
    const carga = { cargoType: 'refrigerada', weightKg: 100, volumeM3: null } as const;
    expect(configuracionesElegibles(carga, [unidad({ id: 'm1', bodyType: 'tolva' })])).toEqual([]);
  });

  it('una motriz sin carrocería declarada sirve para carga seca y no para agrícola', () => {
    const flota = [unidad({ id: 'm1', bodyType: null })];
    expect(configuracionesElegibles(SECA, flota)).toHaveLength(1);
    expect(configuracionesElegibles({ ...SECA, cargoType: 'agricola' }, flota)).toEqual([]);
  });

  it('una motriz sin tipo de unidad (fila antigua) carga sola y no lleva arrastre', () => {
    const flota = [unidad({ id: 'm1', unitType: null }), remolque({ id: 'r1' })];
    expect(configuracionesElegibles(SECA, flota)).toEqual([
      { motrizId: 'm1', arrastreId: null, capacidadUtilKg: 5_000, capacidadUtilM3: null },
    ]);
  });

  it('el volumen se compara solo cuando los dos lados lo declaran', () => {
    const carga = { ...SECA, volumeM3: 30 };
    expect(configuracionesElegibles(carga, [unidad({ id: 'm1', capacityM3: null })])).toHaveLength(
      1,
    );
    expect(configuracionesElegibles(carga, [unidad({ id: 'm1', capacityM3: 30 })])).toHaveLength(1);
    expect(configuracionesElegibles(carga, [unidad({ id: 'm1', capacityM3: 29 })])).toEqual([]);
    expect(configuracionesElegibles(SECA, [unidad({ id: 'm1', capacityM3: 1 })])).toHaveLength(1);
  });

  it('un tracto solo no carga nada', () => {
    expect(configuracionesElegibles({ ...SECA, weightKg: 0 }, [tracto('t1')])).toEqual([]);
  });

  it('tracto con semirremolque: cuentan la carrocería y la capacidad del semirremolque', () => {
    const flota = [tracto('t1'), semi({ id: 's1', capacityKg: 28_000, capacityM3: 90 })];
    expect(configuracionesElegibles({ ...SECA, weightKg: 20_000 }, flota)).toEqual([
      { motrizId: 't1', arrastreId: 's1', capacidadUtilKg: 28_000, capacidadUtilM3: 90 },
    ]);
    const frio = { cargoType: 'refrigerada', weightKg: 100, volumeM3: null } as const;
    expect(configuracionesElegibles(frio, flota)).toEqual([]);
    expect(
      configuracionesElegibles(frio, [tracto('t1'), semi({ id: 's1', bodyType: 'refrigerado' })]),
    ).toHaveLength(1);
  });

  it('un tracto no compone con un remolque, ni un rígido con un semirremolque', () => {
    expect(configuracionesElegibles(SECA, [tracto('t1'), remolque({ id: 'r1' })])).toEqual([]);
    expect(
      configuracionesElegibles({ ...SECA, weightKg: 9_000 }, [
        unidad({ id: 'm1' }),
        semi({ id: 's1', capacityKg: 28_000 }),
      ]),
    ).toEqual([]);
  });

  it('camioneta y furgón no llevan arrastre', () => {
    const flota = [
      unidad({ id: 'c1', unitType: 'camioneta', capacityKg: 800 }),
      unidad({ id: 'f1', unitType: 'furgon', capacityKg: 1_500 }),
      remolque({ id: 'r1', capacityKg: 5_000 }),
    ];
    expect(configuracionesElegibles({ ...SECA, weightKg: 1_000 }, flota)).toEqual([
      { motrizId: 'f1', arrastreId: null, capacidadUtilKg: 1_500, capacidadUtilM3: null },
    ]);
  });

  it('rígido con remolque de la misma carrocería: suman capacidad y volumen', () => {
    const flota = [
      unidad({ id: 'm1', capacityKg: 8_000, capacityM3: 40 }),
      remolque({ id: 'r1', capacityKg: 10_000, capacityM3: 50 }),
    ];
    expect(configuracionesElegibles({ ...SECA, weightKg: 15_000 }, flota)).toEqual([
      { motrizId: 'm1', arrastreId: 'r1', capacidadUtilKg: 18_000, capacidadUtilM3: 90 },
    ]);
  });

  it('rígido con remolque: si una unidad no declara volumen, el de la configuración no se conoce', () => {
    const flota = [
      unidad({ id: 'm1', capacityKg: 8_000, capacityM3: 40 }),
      remolque({ id: 'r1', capacityKg: 10_000, capacityM3: null }),
    ];
    expect(configuracionesElegibles({ ...SECA, weightKg: 15_000, volumeM3: 500 }, flota)).toEqual([
      { motrizId: 'm1', arrastreId: 'r1', capacidadUtilKg: 18_000, capacidadUtilM3: null },
    ]);
  });

  it('rígido con remolque de distinta carrocería: cuenta solo la unidad que sirve', () => {
    const flota = [
      unidad({ id: 'm1', bodyType: 'tolva', capacityKg: 8_000 }),
      remolque({ id: 'r1', bodyType: 'refrigerado', capacityKg: 10_000, capacityM3: 50 }),
    ];
    const frio = { cargoType: 'refrigerada', weightKg: 10_000, volumeM3: null } as const;
    expect(configuracionesElegibles(frio, flota)).toEqual([
      { motrizId: 'm1', arrastreId: 'r1', capacidadUtilKg: 10_000, capacidadUtilM3: 50 },
    ]);
    expect(configuracionesElegibles({ ...frio, weightKg: 10_001 }, flota)).toEqual([]);
    // Solo sirve la motriz: el remolque no agrega capacidad para esta carga.
    const granos = { cargoType: 'construccion', weightKg: 8_000, volumeM3: null } as const;
    expect(configuracionesElegibles(granos, flota)).toEqual([
      { motrizId: 'm1', arrastreId: null, capacidadUtilKg: 8_000, capacidadUtilM3: null },
      { motrizId: 'm1', arrastreId: 'r1', capacidadUtilKg: 8_000, capacidadUtilM3: null },
    ]);
  });

  it('rígido con remolque: si ninguna carrocería sirve, no hay configuración', () => {
    const flota = [
      unidad({ id: 'm1', bodyType: 'tolva' }),
      remolque({ id: 'r1', bodyType: 'tolva' }),
    ];
    expect(
      configuracionesElegibles({ cargoType: 'ganado', weightKg: 1, volumeM3: null }, flota),
    ).toEqual([]);
  });

  it('ordena de menor a mayor capacidad, y por identificador ante empate', () => {
    const flota = [
      unidad({ id: 'm3', capacityKg: 9_000 }),
      unidad({ id: 'm2', capacityKg: 5_000 }),
      unidad({ id: 'm1', capacityKg: 5_000 }),
      remolque({ id: 'r1', capacityKg: 1_000 }),
    ];
    expect(
      configuracionesElegibles(SECA, flota).map((c) => [
        c.motrizId,
        c.arrastreId,
        c.capacidadUtilKg,
      ]),
    ).toEqual([
      ['m1', null, 5_000],
      ['m2', null, 5_000],
      ['m1', 'r1', 6_000],
      ['m2', 'r1', 6_000],
      ['m3', null, 9_000],
      ['m3', 'r1', 10_000],
    ]);
  });

  it('una flota vacía o solo de arrastre no tiene configuraciones', () => {
    expect(configuracionesElegibles(SECA, [])).toEqual([]);
    expect(configuracionesElegibles(SECA, [semi({ id: 's1' }), remolque({ id: 'r1' })])).toEqual(
      [],
    );
  });
});

describe('empresaEsCandidata', () => {
  it('lo es si tiene al menos una configuración elegible', () => {
    expect(empresaEsCandidata(SECA, [unidad({ id: 'm1' })])).toBe(true);
    expect(empresaEsCandidata(SECA, [unidad({ id: 'm1', capacityKg: 100 })])).toBe(false);
    expect(empresaEsCandidata(SECA, [])).toBe(false);
  });

  it('la flota de producción al 2026-11-10 (16 motrices sin carrocería) recibe carga seca y no agrícola', () => {
    const flota = Array.from({ length: 16 }, (_, i) =>
      unidad({ id: `v${i}`, bodyType: null, capacityKg: 10_000 }),
    );
    expect(empresaEsCandidata(SECA, flota)).toBe(true);
    expect(empresaEsCandidata({ ...SECA, cargoType: 'otra' }, flota)).toBe(true);
    expect(empresaEsCandidata({ ...SECA, cargoType: 'agricola' }, flota)).toBe(false);
  });
});

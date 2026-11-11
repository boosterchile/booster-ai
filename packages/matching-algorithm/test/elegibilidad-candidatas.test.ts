import { describe, expect, it } from 'vitest';
import {
  type CandidataPorFlota,
  type RequisitosDeCarga,
  type UnidadDeFlota,
  candidatasPorCarga,
  compararCandidatas,
} from '../src/elegibilidad/index.js';

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

const SECA: RequisitosDeCarga = { cargoType: 'carga_seca', weightKg: 4_000, volumeM3: null };

describe('candidatasPorCarga', () => {
  it('una candidata por empresa con flota apta, con la configuración más chica', () => {
    const flotas = new Map([
      ['e1', [unidad({ id: 'grande', capacityKg: 20_000 }), unidad({ id: 'chico' })]],
      ['e2', [unidad({ id: 'tolva', bodyType: 'tolva' })]],
      ['e3', [unidad({ id: 'justo', capacityKg: 4_000 })]],
      ['e4', []],
    ]);
    expect(candidatasPorCarga(SECA, flotas)).toEqual([
      { empresaId: 'e1', vehicleId: 'chico', vehicleCapacityKg: 5_000, volumenInsuficiente: false },
      { empresaId: 'e3', vehicleId: 'justo', vehicleCapacityKg: 4_000, volumenInsuficiente: false },
    ]);
  });

  it('con arrastre, el vehículo sugerido es la motriz y la capacidad la de la configuración', () => {
    const flotas = new Map([
      [
        'e1',
        [
          unidad({ id: 'tracto', unitType: 'tracto_camion', bodyType: null, capacityKg: 0 }),
          unidad({
            id: 'semi',
            unitCategory: 'arrastre',
            unitType: 'semirremolque',
            capacityKg: 28_000,
          }),
        ],
      ],
    ]);
    expect(candidatasPorCarga({ ...SECA, weightKg: 20_000 }, flotas)).toEqual([
      {
        empresaId: 'e1',
        vehicleId: 'tracto',
        vehicleCapacityKg: 28_000,
        volumenInsuficiente: false,
      },
    ]);
  });

  it('sin empresas no hay candidatas', () => {
    expect(candidatasPorCarga(SECA, new Map())).toEqual([]);
  });
});

describe('compararCandidatas', () => {
  const c = (empresaId: string, vehicleId: string): CandidataPorFlota => ({
    empresaId,
    vehicleId,
    vehicleCapacityKg: 1,
  });

  it('coinciden cuando son las mismas empresas con el mismo vehículo, en cualquier orden', () => {
    expect(
      compararCandidatas([c('e1', 'v1'), c('e2', 'v2')], [c('e2', 'v2'), c('e1', 'v1')]),
    ).toEqual({
      coinciden: true,
      soloVigente: [],
      soloPorCarga: [],
      vehiculoDistinto: [],
      volumenInsuficiente: [],
    });
  });

  it('dos listas vacías coinciden', () => {
    expect(compararCandidatas([], []).coinciden).toBe(true);
  });

  it('lista las candidatas por carga con aviso de volumen, sin contarlas como diferencia', () => {
    const conAviso = { ...c('e1', 'v1'), volumenInsuficiente: true };
    const sinAviso = { ...c('e2', 'v2'), volumenInsuficiente: false };
    expect(compararCandidatas([c('e1', 'v1'), c('e2', 'v2')], [sinAviso, conAviso])).toEqual({
      coinciden: true,
      soloVigente: [],
      soloPorCarga: [],
      vehiculoDistinto: [],
      volumenInsuficiente: ['e1'],
    });
  });

  it('separa las empresas que solo aparecen en un lado y las que cambian de vehículo', () => {
    expect(
      compararCandidatas(
        [c('e3', 'v3'), c('e1', 'v1'), c('e2', 'v2')],
        [c('e2', 'otro'), c('e4', 'v4'), c('e1', 'v1')],
      ),
    ).toEqual({
      coinciden: false,
      soloVigente: ['e3'],
      soloPorCarga: ['e4'],
      vehiculoDistinto: ['e2'],
      volumenInsuficiente: [],
    });
  });
});

/**
 * Criterio 2 de la spec: la flota y las cargas de producción al 2026-11-10,
 * leídas en solo lectura. Las empresas van numeradas; no hay identificadores
 * reales. Ningún vehículo declara carrocería ni hay unidades de arrastre.
 */
describe('regresión con la flota y las cargas de producción (2026-11-10)', () => {
  // [capacidad kg, capacidad m3]; solo vehículos activos.
  const FLOTA: Record<string, readonly (readonly [number, number | null])[]> = {
    e1: [
      [20_000, null],
      [20_000, null],
    ],
    e2: [
      [4_500, null],
      [4_500, null],
      [4_500, null],
      [4_500, null],
      [10_000, 500],
      [10_000, 500],
      [14_000, 50],
      [14_000, 50],
      [14_000, 50],
      [20_000, null],
      [20_000, null],
      [28_000, 50],
    ],
    e3: [[5_000, 50]],
    e4: [[1_600, 7]],
  };
  const flotas = new Map(
    Object.entries(FLOTA).map(([empresa, vehiculos]) => [
      empresa,
      vehiculos.map(([capacityKg, capacityM3], i) =>
        unidad({ id: `${empresa}-${i}`, bodyType: null, capacityKg, capacityM3 }),
      ),
    ]),
  );

  /** El matching vigente: empresa con algún vehículo activo de capacidad ≥ peso. */
  const vigente = (pesoKg: number) =>
    [...flotas]
      .filter(([, unidades]) => unidades.some((u) => u.capacityKg >= pesoKg))
      .map(([empresa]) => empresa);
  const porCarga = (carga: RequisitosDeCarga) =>
    candidatasPorCarga(carga, flotas).map((x) => x.empresaId);

  // [peso kg, volumen m3] de los 16 viajes de carga seca (13 combinaciones).
  const SECAS: readonly (readonly [number, number | null])[] = [
    [1, null],
    [50, 1],
    [1_000, null],
    [1_500, null],
    [1_500, 6],
    [2_000, 8],
    [5_000, null],
    [8_000, 40],
    [10_000, null],
    [15_000, null],
    [20_000, null],
  ];

  it.each(SECAS)(
    'carga seca de %i kg y %s m³: mismas empresas que el matching vigente',
    (kg, m3) => {
      expect(porCarga({ cargoType: 'carga_seca', weightKg: kg, volumeM3: m3 })).toEqual(
        vigente(kg),
      );
    },
  );

  it('carga seca de 22.000 kg y 100 m³: misma empresa que el vigente, con aviso de volumen', () => {
    // El único vehículo que alcanza el peso (28.000 kg) declara 50 m³. El
    // volumen declarado no descarta (spec §11-5): la empresa sigue siendo
    // candidata y el caso queda marcado.
    const carga = { cargoType: 'carga_seca', weightKg: 22_000, volumeM3: 100 } as const;
    expect(porCarga(carga)).toEqual(vigente(22_000));
    expect(candidatasPorCarga(carga, flotas)).toMatchObject([
      { empresaId: 'e2', volumenInsuficiente: true },
    ]);
  });

  it('ninguna otra carga seca de producción lleva aviso de volumen', () => {
    for (const [kg, m3] of SECAS) {
      const candidatas = candidatasPorCarga(
        { cargoType: 'carga_seca', weightKg: kg, volumeM3: m3 },
        flotas,
      );
      expect(
        candidatas.filter((c) => c.volumenInsuficiente),
        `${kg} kg`,
      ).toEqual([]);
    }
  });

  it('carga agrícola de 10.000 kg: ninguna empresa, porque nadie declara carrocería (spec §9)', () => {
    expect(vigente(10_000)).toEqual(['e1', 'e2']);
    expect(porCarga({ cargoType: 'agricola', weightKg: 10_000, volumeM3: null })).toEqual([]);
  });
});

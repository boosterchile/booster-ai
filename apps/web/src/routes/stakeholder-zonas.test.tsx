import { describe, expect, it } from 'vitest';
import { filterZonasByRegion, sortZonasDestacadasPrimero } from './stakeholder-zonas.js';

const ZONAS = [
  {
    id: 'a',
    nombre: 'A',
    region: 'V',
    region_iso: 'CL-VS',
    tipo: 'puerto',
    demo_viajes_30d: 1,
    demo_co2e_kg: 1,
    demo_horario_pico: 'x',
  },
  {
    id: 'b',
    nombre: 'B',
    region: 'V',
    region_iso: 'CL-VS',
    tipo: 'puerto',
    demo_viajes_30d: 1,
    demo_co2e_kg: 1,
    demo_horario_pico: 'x',
  },
  {
    id: 'c',
    nombre: 'C',
    region: 'XIII',
    region_iso: 'CL-RM',
    tipo: 'mercado_abastos',
    demo_viajes_30d: 1,
    demo_co2e_kg: 1,
    demo_horario_pico: 'x',
  },
  {
    id: 'd',
    nombre: 'D',
    region: 'I',
    region_iso: 'CL-TA',
    tipo: 'zona_franca',
    demo_viajes_30d: 1,
    demo_co2e_kg: 1,
    demo_horario_pico: 'x',
  },
] as Parameters<typeof filterZonasByRegion>[0];

describe('filterZonasByRegion (ADR-034)', () => {
  it('region_ambito null → devuelve todas (ámbito nacional)', () => {
    expect(filterZonasByRegion(ZONAS, null)).toHaveLength(4);
  });

  it('region_ambito undefined → devuelve todas', () => {
    expect(filterZonasByRegion(ZONAS, undefined)).toHaveLength(4);
  });

  it('region_ambito CL-VS → solo Valparaíso', () => {
    const result = filterZonasByRegion(ZONAS, 'CL-VS');
    expect(result).toHaveLength(2);
    expect(result.every((z) => z.region_iso === 'CL-VS')).toBe(true);
  });

  it('region_ambito CL-RM → solo Metropolitana', () => {
    const result = filterZonasByRegion(ZONAS, 'CL-RM');
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('c');
  });

  it('region_ambito sin matches → array vacío', () => {
    const result = filterZonasByRegion(ZONAS, 'CL-XX');
    expect(result).toHaveLength(0);
  });
});

describe('sortZonasDestacadasPrimero', () => {
  const ZONAS_MIXED = [
    {
      id: 'a',
      nombre: 'A',
      region: 'V',
      region_iso: 'CL-VS',
      tipo: 'puerto',
      demo_viajes_30d: 1,
      demo_co2e_kg: 1,
      demo_horario_pico: 'x',
    },
    {
      id: 'destacada',
      nombre: 'Destacada',
      region: 'IV',
      region_iso: 'CL-CO',
      tipo: 'puerto',
      demo_viajes_30d: 1,
      demo_co2e_kg: 1,
      demo_horario_pico: 'x',
      destacado: true,
    },
    {
      id: 'b',
      nombre: 'B',
      region: 'V',
      region_iso: 'CL-VS',
      tipo: 'puerto',
      demo_viajes_30d: 1,
      demo_co2e_kg: 1,
      demo_horario_pico: 'x',
    },
  ] as Parameters<typeof sortZonasDestacadasPrimero>[0];

  it('mueve destacadas al inicio sin perturbar el orden relativo del resto', () => {
    const result = sortZonasDestacadasPrimero(ZONAS_MIXED);
    expect(result.map((z) => z.id)).toEqual(['destacada', 'a', 'b']);
  });

  it('no destacadas → preserva orden original', () => {
    const sinDestacadas = ZONAS_MIXED.filter((z) => !z.destacado);
    const result = sortZonasDestacadasPrimero(sinDestacadas);
    expect(result.map((z) => z.id)).toEqual(['a', 'b']);
  });

  it('array vacío → array vacío', () => {
    expect(sortZonasDestacadasPrimero([])).toEqual([]);
  });

  it('no muta el input', () => {
    const original = [...ZONAS_MIXED];
    sortZonasDestacadasPrimero(ZONAS_MIXED);
    expect(ZONAS_MIXED).toEqual(original);
  });
});

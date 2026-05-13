import { describe, expect, it } from 'vitest';
import { filterZonasByRegion } from './stakeholder-zonas.js';

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

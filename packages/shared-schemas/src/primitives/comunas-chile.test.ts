import { describe, expect, it } from 'vitest';
import { regionCodeSchema } from './chile.js';
import {
  COMUNAS_CHILE,
  comunaPorCodigo,
  comunaPorNombre,
  comunasDeRegion,
} from './comunas-chile.js';

describe('catálogo de comunas', () => {
  it('cubre las 346 comunas, con código CUT de 5 dígitos y región canónica', () => {
    expect(COMUNAS_CHILE).toHaveLength(346);
    const codigos = new Set<string>();
    for (const comuna of COMUNAS_CHILE) {
      expect(comuna.code).toMatch(/^\d{5}$/);
      expect(comuna.code.length).toBeLessThanOrEqual(10);
      expect(regionCodeSchema.safeParse(comuna.region).success).toBe(true);
      expect(comuna.name.trim().length).toBeGreaterThan(0);
      codigos.add(comuna.code);
    }
    expect(codigos.size).toBe(346);
  });

  it('filtra por región y resuelve nombres con tilde o alias', () => {
    expect(comunasDeRegion('XIII').length).toBe(52);
    expect(comunaPorCodigo('13114')?.name).toBe('Las Condes');
    expect(comunaPorCodigo('08101')?.name).toBe('Concepción');
    expect(comunaPorNombre('Concepción', 'VIII')?.code).toBe('08101');
    expect(comunaPorNombre('Las Condes')?.region).toBe('XIII');
    expect(comunaPorNombre('La Calera', 'V')?.code).toBe('05502');
    expect(comunaPorNombre('no-existe')).toBeUndefined();
  });
});

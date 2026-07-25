import { describe, expect, it } from 'vitest';
// RED: `decidirModoBackfill` aún no existe. Es la INVERSIÓN DE LA CARGA del
// entrypoint del backfill (F0-0 paso 1): el default seguro es dry-run; escribir
// exige confirmación explícita + conteo que coincide. "El camino fácil = el seguro."
import { decidirModoBackfill } from './admin-backfill-distancia.js';

describe('decidirModoBackfill — el default seguro es dry-run', () => {
  it('body ausente/vacío → dry-run (NUNCA escribe por default)', () => {
    expect(decidirModoBackfill(undefined, 5).modo).toBe('dry-run');
    expect(decidirModoBackfill({}, 5).modo).toBe('dry-run');
    expect(decidirModoBackfill(null, 5).modo).toBe('dry-run');
  });

  it('body basura / confirmación mal escrita → dry-run (no un near-miss que escribe)', () => {
    expect(decidirModoBackfill({ dryRun: false }, 5).modo).toBe('dry-run');
    expect(decidirModoBackfill({ confirmar: 'escribir', trips_esperados: 5 }, 5).modo).toBe(
      'dry-run',
    );
    expect(decidirModoBackfill({ confirmar: 'ESCRIBIR' }, 5).modo).toBe('dry-run'); // falta el conteo
    expect(decidirModoBackfill({ confirmar: true, trips_esperados: 5 }, 5).modo).toBe('dry-run');
  });

  it('confirmación completa + conteo COINCIDE → escritura', () => {
    const d = decidirModoBackfill({ confirmar: 'ESCRIBIR', trips_esperados: 5 }, 5);
    expect(d.modo).toBe('escritura');
  });

  it('confirmación completa pero conteo NO coincide → RECHAZADO (algo cambió entre dry-run y ejecución)', () => {
    const d = decidirModoBackfill({ confirmar: 'ESCRIBIR', trips_esperados: 5 }, 7);
    expect(d.modo).toBe('rechazado');
    if (d.modo === 'rechazado') {
      expect(d.razon).toBe('conteo_no_coincide');
      expect(d.tripsEsperados).toBe(5);
      expect(d.tripsReales).toBe(7);
    }
  });

  it('trips_esperados=0 con 0 reales → escritura (0 es un conteo válido, no un default)', () => {
    expect(decidirModoBackfill({ confirmar: 'ESCRIBIR', trips_esperados: 0 }, 0).modo).toBe(
      'escritura',
    );
  });
});

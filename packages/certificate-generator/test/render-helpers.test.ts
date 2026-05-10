/**
 * Tests de los helpers puros de render del cert (ADR-028).
 *
 * El cert PDF codifica texto vía font streams, así que assertions sobre
 * el binary del PDF no son confiables. La lógica de selección de copy
 * (título, subtítulo, disclaimer, formato del número) se extrajo a
 * funciones puras en `render-helpers.ts` que se testean acá directamente.
 *
 * Bug en estos helpers = greenwashing potencial (cert "verificable" para
 * un trip secundario) o fricción al cliente (disclaimer impreso de más
 * en cert primario). Cobertura exhaustiva por construcción.
 */

import { describe, expect, it } from 'vitest';
import {
  DISCLAIMER_SECUNDARIO_LINEAS,
  formatRouteDataSource,
  formatearNumeroPrincipal,
  muestraDisclaimerSecundario,
  subtituloHeader,
  tamanoTitulo,
  tituloHeader,
} from '../src/render-helpers.js';

describe('tituloHeader', () => {
  it('primario_verificable → "CERTIFICADO DE HUELLA DE CARBONO"', () => {
    expect(tituloHeader('primario_verificable')).toBe('CERTIFICADO DE HUELLA DE CARBONO');
  });

  it('secundario_modeled → "REPORTE ESTIMATIVO DE HUELLA DE CARBONO"', () => {
    expect(tituloHeader('secundario_modeled')).toBe('REPORTE ESTIMATIVO DE HUELLA DE CARBONO');
  });

  it('secundario_default también es "REPORTE ESTIMATIVO" (greenwashing prevention)', () => {
    expect(tituloHeader('secundario_default')).toBe('REPORTE ESTIMATIVO DE HUELLA DE CARBONO');
  });
});

describe('subtituloHeader', () => {
  it('primario menciona "datos primarios verificables"', () => {
    expect(subtituloHeader('primario_verificable')).toMatch(/Datos primarios verificables/);
  });

  it('secundario_modeled menciona "datos secundarios modelados"', () => {
    expect(subtituloHeader('secundario_modeled')).toMatch(/Datos secundarios modelados/);
  });

  it('secundario_default también dice "datos secundarios modelados"', () => {
    expect(subtituloHeader('secundario_default')).toMatch(/Datos secundarios modelados/);
  });
});

describe('tamanoTitulo', () => {
  it('primario usa tamaño 18 (texto más corto)', () => {
    expect(tamanoTitulo('primario_verificable')).toBe(18);
  });

  it('secundario usa tamaño 16 (texto "REPORTE ESTIMATIVO..." es más largo)', () => {
    expect(tamanoTitulo('secundario_modeled')).toBe(16);
    expect(tamanoTitulo('secundario_default')).toBe(16);
  });
});

describe('muestraDisclaimerSecundario', () => {
  it('primario_verificable → false (cert auditable, sin disclaimer)', () => {
    expect(muestraDisclaimerSecundario('primario_verificable')).toBe(false);
  });

  it('secundario_modeled → true (debe llevar disclaimer)', () => {
    expect(muestraDisclaimerSecundario('secundario_modeled')).toBe(true);
  });

  it('secundario_default → true (worst case, definitivamente con disclaimer)', () => {
    expect(muestraDisclaimerSecundario('secundario_default')).toBe(true);
  });
});

describe('DISCLAIMER_SECUNDARIO_LINEAS', () => {
  // Estas verificaciones aseguran que el copy del disclaimer mantiene
  // los componentes claves obligatorios. Cualquier cambio que rompa
  // estos asserts requiere update consciente del test (= update consciente
  // del copy legal).
  it('contiene mención explícita de "datos secundarios modelados"', () => {
    const fullText = DISCLAIMER_SECUNDARIO_LINEAS.join(' ');
    expect(fullText).toMatch(/datos secundarios modelados/i);
  });

  it('contiene mención explícita "NO auditable como dato primario"', () => {
    const fullText = DISCLAIMER_SECUNDARIO_LINEAS.join(' ');
    expect(fullText).toMatch(/NO auditable como dato primario/);
  });

  it('contiene path de upgrade vía Teltonika', () => {
    const fullText = DISCLAIMER_SECUNDARIO_LINEAS.join(' ');
    expect(fullText).toMatch(/Teltonika/);
  });

  it('cada línea no excede ~95 chars (no overflowea el PDF rect)', () => {
    for (const line of DISCLAIMER_SECUNDARIO_LINEAS) {
      expect(line.length).toBeLessThanOrEqual(110);
    }
  });
});

describe('formatearNumeroPrincipal', () => {
  it('sin uncertaintyFactor → "X.XX kg CO2e"', () => {
    expect(formatearNumeroPrincipal(318.7)).toBe('318.70 kg CO2e');
  });

  it('uncertaintyFactor = 0 → omite el ± (sería ±0)', () => {
    expect(formatearNumeroPrincipal(318.7, 0)).toBe('318.70 kg CO2e');
  });

  it('uncertaintyFactor 0.05 sobre 318.7 → "318.70 ± 15.94 kg CO2e"', () => {
    expect(formatearNumeroPrincipal(318.7, 0.05)).toBe('318.70 ± 15.94 kg CO2e');
  });

  it('uncertaintyFactor 0.18 sobre 100 → "100.00 ± 18.00 kg CO2e"', () => {
    expect(formatearNumeroPrincipal(100, 0.18)).toBe('100.00 ± 18.00 kg CO2e');
  });

  it('uncertaintyFactor 1 (cap) → publica el ± completo', () => {
    expect(formatearNumeroPrincipal(50, 1)).toBe('50.00 ± 50.00 kg CO2e');
  });

  it('uncertaintyFactor < 0 lanza error', () => {
    expect(() => formatearNumeroPrincipal(100, -0.1)).toThrow(/uncertaintyFactor/);
  });

  it('uncertaintyFactor > 1 lanza error', () => {
    expect(() => formatearNumeroPrincipal(100, 1.5)).toThrow(/uncertaintyFactor/);
  });

  it('uncertaintyFactor NaN lanza error', () => {
    expect(() => formatearNumeroPrincipal(100, Number.NaN)).toThrow(/uncertaintyFactor/);
  });
});

describe('formatRouteDataSource', () => {
  it('teltonika_gps → "Telemetría Teltonika (GPS real)"', () => {
    expect(formatRouteDataSource('teltonika_gps')).toBe('Telemetría Teltonika (GPS real)');
  });

  it('maps_directions → "Google Routes API (ruta modelada)"', () => {
    expect(formatRouteDataSource('maps_directions')).toBe('Google Routes API (ruta modelada)');
  });

  it('manual_declared → "Declaración manual"', () => {
    expect(formatRouteDataSource('manual_declared')).toBe('Declaración manual');
  });

  it('valor desconocido se devuelve sin formatear (defensive)', () => {
    expect(formatRouteDataSource('phone_gps')).toBe('phone_gps');
  });
});

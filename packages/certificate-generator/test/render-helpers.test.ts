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
  FRASE_ISO,
  TITULO_CERT,
  formatRouteDataSource,
  formatearNumeroPrincipal,
  subtituloMetodologia,
  textoDisclaimer,
} from '../src/render-helpers.js';

describe('copy v2 (HC-004, copy de Felipe)', () => {
  it('título único y frase ISO exacta', () => {
    expect(TITULO_CERT).toBe('Certificado de huella de carbono');
    expect(FRASE_ISO).toBe('Estos resultados han sido establecidos de acuerdo con ISO 14083:2023.');
  });
  it('subtítulo con la versión de la emisión, sin v3.0 fijo', () => {
    expect(subtituloMetodologia('v3.1')).toBe(
      'GLEC Framework v3.1 · ISO 14083:2023 · Well-to-Wheel (combustión + upstream)',
    );
  });
  it('disclaimer exacto con fuente y versión de la emisión; nunca SEC Chile', () => {
    const t = textoDisclaimer('GLEC v2.0 (2019), Tabla 32', 'v3.0');
    expect(t).toBe(
      'Cálculo basado en datos secundarios modelados (Google Routes API + factores GLEC v2.0 (2019), Tabla 32 + GLEC Framework v3.0). NO auditable como dato primario bajo SBTi, CDP o CSRD assurance. Para certificado verificable con datos primarios (telemetría Teltonika), contactar a Booster.',
    );
    expect(t).not.toContain('SEC Chile');
  });
});

describe('formatearNumeroPrincipal', () => {
  it('sin uncertaintyFactor → valor es-CL y «kg CO₂e»', () => {
    expect(formatearNumeroPrincipal(318.7)).toEqual({ valor: '318,70', detalle: 'kg CO\u2082e' });
  });

  it('uncertaintyFactor = 0 → omite el ± (sería ±0)', () => {
    expect(formatearNumeroPrincipal(318.7, 0).detalle).toBe('kg CO\u2082e');
  });

  it('uncertaintyFactor 0.05 sobre 318.7 → «± 15,94 kg»', () => {
    expect(formatearNumeroPrincipal(318.7, 0.05).detalle).toBe('kg CO\u2082e (± 15,94 kg)');
  });

  it('uncertaintyFactor 0.18 sobre 100 → miles es-CL', () => {
    expect(formatearNumeroPrincipal(1234.5, 0.18)).toEqual({
      valor: '1.234,50',
      detalle: 'kg CO\u2082e (± 222,21 kg)',
    });
  });

  it('uncertaintyFactor 1 (cap) → publica el ± completo', () => {
    expect(formatearNumeroPrincipal(50, 1).detalle).toBe('kg CO\u2082e (± 50,00 kg)');
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

describe('presentacionNivel (HC-004): badge, sello y disclaimer salen de la misma función', () => {
  it('99,6 % no se redondea a 100 (piso)', async () => {
    const { presentacionNivel } = await import('../src/render-helpers.js');
    expect(
      presentacionNivel({ certificationLevel: 'primario_verificable', coveragePct: 99.6 }).badge,
    ).toBe('\u2713 Dato primario medido · 99% telemetría');
  });
  it('cobertura ausente → 0 % y nivel ausente → estimado', async () => {
    const { presentacionNivel } = await import('../src/render-helpers.js');
    const p = presentacionNivel({});
    expect(p.estimado).toBe(true);
    expect(p.badge).toBe('Estimado · datos secundarios modelados · 0% telemetría');
  });
});

describe('presentacionNivel (ADR-091): el sello depende de quién midió la distancia', () => {
  const BADGE_MEDIDO = 'Distancia medida con Teltonika · consumo modelado · 92% telemetría';
  type Caso = [
    string,
    Parameters<typeof import('../src/render-helpers.js').presentacionNivel>[0],
    string,
  ];
  const casos: Caso[] = [
    [
      'primario con Teltonika',
      {
        certificationLevel: 'primario_verificable',
        routeDataSource: 'teltonika_gps',
        coveragePct: 98,
      },
      'primario',
    ],
    [
      'primario sin fuente guardada',
      { certificationLevel: 'primario_verificable', coveragePct: 98 },
      'primario',
    ],
    [
      'Teltonika sin CAN, cobertura 92 %',
      {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'teltonika_gps',
        coveragePct: 92.9,
      },
      'medido_teltonika',
    ],
    [
      'Teltonika justo en 80 %',
      {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'teltonika_gps',
        coveragePct: 80,
      },
      'medido_teltonika',
    ],
    [
      'Teltonika bajo 80 %',
      {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'teltonika_gps',
        coveragePct: 79.99,
      },
      'estimado',
    ],
    [
      'Teltonika sin cobertura guardada',
      { certificationLevel: 'secundario_modeled', routeDataSource: 'teltonika_gps' },
      'estimado',
    ],
    [
      'Google Maps',
      {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'maps_directions',
        coveragePct: 0,
      },
      'estimado',
    ],
    [
      'GPS del móvil',
      { certificationLevel: 'secundario_modeled', routeDataSource: 'movil_gps', coveragePct: 99 },
      'estimado',
    ],
    [
      'distancia declarada',
      {
        certificationLevel: 'secundario_modeled',
        routeDataSource: 'manual_declared',
        coveragePct: 99,
      },
      'estimado',
    ],
    [
      'secundario sin fuente guardada',
      { certificationLevel: 'secundario_modeled', coveragePct: 99 },
      'estimado',
    ],
    [
      'secundario por defecto con Teltonika',
      {
        certificationLevel: 'secundario_default',
        routeDataSource: 'teltonika_gps',
        coveragePct: 99,
      },
      'estimado',
    ],
    [
      'sin nivel guardado, con Teltonika',
      { routeDataSource: 'teltonika_gps', coveragePct: 99 },
      'estimado',
    ],
    ['sin ningún dato', {}, 'estimado'],
  ];

  it.each(casos)('%s', async (_nombre, entrada, esperada) => {
    const { presentacionNivel } = await import('../src/render-helpers.js');
    const p = presentacionNivel(entrada);
    expect(p.presentacion).toBe(esperada);
    expect(p.estimado).toBe(esperada === 'estimado');
  });

  it('el badge de Teltonika dice qué se midió y qué no, con % piso', async () => {
    const { presentacionNivel } = await import('../src/render-helpers.js');
    const p = presentacionNivel({
      certificationLevel: 'secundario_modeled',
      routeDataSource: 'teltonika_gps',
      coveragePct: 92.9,
    });
    expect(p.badge).toBe(BADGE_MEDIDO);
  });

  it('la nota de método no menciona Google Routes ni promete dato primario', async () => {
    const { textoNotaMetodo } = await import('../src/render-helpers.js');
    const nota = textoNotaMetodo('GLEC v2.0 (2019), Tabla 32', 'v3.0');
    expect(nota).toBe(
      'La distancia fue medida por el dispositivo Teltonika instalado en el vehículo. El consumo de combustible se modeló con factores GLEC v2.0 (2019), Tabla 32 y GLEC Framework v3.0; no proviene de una medición del vehículo.',
    );
    expect(nota.toLowerCase()).not.toContain('google');
    expect(nota.toLowerCase()).not.toContain('verificable');
    expect(nota.toLowerCase()).not.toContain('primario');
  });
});

describe('textoNotaMetodo en una carga consolidada (ADR-089 + ADR-091)', () => {
  it('lo medido es la distancia de la ruta', async () => {
    const { textoNotaMetodo } = await import('../src/render-helpers.js');
    expect(textoNotaMetodo('F', 'v3.0', true)).toBe(
      'La distancia de la ruta fue medida por el dispositivo Teltonika instalado en el vehículo. El consumo de combustible se modeló con factores F y GLEC Framework v3.0; no proviene de una medición del vehículo.',
    );
  });
});

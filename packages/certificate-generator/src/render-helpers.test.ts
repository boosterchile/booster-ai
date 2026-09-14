// RED: `declaracionDistancia` aún no existe. Es el invariante de honestidad del
// paso 1 (F0-0 §7 / spec `distancia-real-hibrida`): con cobertura < 100% el cert
// NO puede declarar "distancia medida" a secas — debe declarar la mezcla
// "medido X%, estimado (100−X)%", con X = coverage_pct. Sin esto se reintroduce
// el sesgo direccional a la baja que motivó todo el fix.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  TAMANO_LINEA_METODO,
  declaracionDistancia,
  formatRouteDataSource,
  lineaMetodoCert,
} from './render-helpers.js';

describe('declaracionDistancia — invariante de honestidad de la distancia', () => {
  it('cobertura 100% → declara medida; NO menciona estimado', () => {
    const d = declaracionDistancia(100);
    expect(d).toMatch(/medid/i);
    expect(d).not.toMatch(/estimad/i);
  });

  it('cobertura 60% → declara la mezcla "medido 60%, estimado 40%"', () => {
    const d = declaracionDistancia(60);
    expect(d).toContain('60%');
    expect(d).toContain('40%');
    expect(d).toMatch(/medid/i);
    expect(d).toMatch(/estimad/i);
  });

  it('INVARIANTE: con cobertura < 100% NUNCA declara "medida" a secas — siempre incluye el estimado', () => {
    for (const cov of [1, 30, 60, 80, 99]) {
      const d = declaracionDistancia(cov);
      // debe declarar la porción estimada (100 − X) explícitamente
      expect(d, `cobertura ${cov}%`).toMatch(/estimad/i);
      expect(d, `cobertura ${cov}%`).toContain(`${100 - cov}%`);
      // y no puede ser una declaración de "medida" sin cualificar
      expect(d.toLowerCase(), `cobertura ${cov}%`).not.toBe('medida');
    }
  });

  it('X = coverage_pct: la fracción medida declarada es exactamente la cobertura', () => {
    expect(declaracionDistancia(72)).toContain('72%');
    expect(declaracionDistancia(72)).toContain('28%');
  });

  it('cobertura 0% o sin telemetría → declara estimada (no medida)', () => {
    for (const cov of [0, undefined]) {
      const d = declaracionDistancia(cov);
      expect(d, `cobertura ${cov}`).toMatch(/estimad/i);
      expect(d.toLowerCase(), `cobertura ${cov}`).not.toMatch(/medid/i);
    }
  });
});

/**
 * ADR-077 §4 — vocabulario cerrado del certificado por fuente de posición:
 * «medida» aplica solo a la distancia; «verificable» está prohibido en todo lo
 * que no sea `primario_verificable`, y el móvil nunca lo es.
 */
describe('formatRouteDataSource — fuente de la ruta en el certificado (ADR-077 §4)', () => {
  it('movil_gps declara la distancia medida por el GPS del móvil del conductor', () => {
    const texto = formatRouteDataSource('movil_gps');
    expect(texto).toMatch(/GPS del móvil del conductor/);
    expect(texto).toMatch(/medida/i);
    // El literal del enum jamás llega al cliente (hoy el default lo filtra tal cual).
    expect(texto).not.toBe('movil_gps');
  });

  it('vocabulario cerrado: ninguna fuente secundaria dice "verificable"', () => {
    for (const fuente of ['movil_gps', 'maps_directions', 'manual_declared']) {
      expect(formatRouteDataSource(fuente), fuente).not.toMatch(/verificable/i);
    }
  });

  it('las tres fuentes de ADR-028 conservan un texto propio (no el literal)', () => {
    for (const fuente of ['teltonika_gps', 'maps_directions', 'manual_declared']) {
      expect(formatRouteDataSource(fuente), fuente).not.toBe(fuente);
    }
  });
});

/**
 * ADR-077 §4/§5 — la línea de método del PDF sale de la MISMA función pura que
 * usa la app (`lineaMetodoCertificacion`, carbon-calculator); el helper solo
 * adapta `DatosMetricasCertificado` (campos opcionales en certs legacy).
 */
describe('lineaMetodoCert — línea de método en el PDF (ADR-077 §4)', () => {
  it('movil_gps → «GPS del móvil del conductor», nunca «verificable»', () => {
    const linea = lineaMetodoCert({
      precisionMethod: 'modelado',
      routeDataSource: 'movil_gps',
      coveragePct: 100,
    });
    expect(linea).toMatch(/GPS del móvil del conductor/);
    expect(linea).not.toMatch(/verificable/i);
  });

  it('cert legacy sin fuente de ruta → null (no se inventa método)', () => {
    expect(lineaMetodoCert({ precisionMethod: 'modelado' })).toBeNull();
    expect(
      lineaMetodoCert({ precisionMethod: 'modelado', routeDataSource: 'maps_directions' }),
    ).toBeNull();
  });

  it('primario → CAN bus + ruta GPS del vehículo', () => {
    expect(
      lineaMetodoCert({
        precisionMethod: 'exacto_canbus',
        routeDataSource: 'teltonika_gps',
        coveragePct: 99,
      }),
    ).toMatch(/^Combustible medido por CAN bus del vehículo/);
  });

  it('LAYOUT — la línea más larga cabe en el ancho útil de A4 al tamaño que usa el renderer', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const A4_WIDTH_PT = 595.28;
    const MARGEN_PT = 40;
    const casos = [
      { precisionMethod: 'exacto_canbus', routeDataSource: 'teltonika_gps', coveragePct: 100 },
      { precisionMethod: 'modelado', routeDataSource: 'teltonika_gps', coveragePct: 100 },
      { precisionMethod: 'modelado', routeDataSource: 'movil_gps', coveragePct: 100 },
      { precisionMethod: 'modelado', routeDataSource: 'maps_directions', coveragePct: 0 },
      { precisionMethod: 'por_defecto', routeDataSource: 'maps_directions', coveragePct: 0 },
      { precisionMethod: 'por_defecto', routeDataSource: 'manual_declared', coveragePct: 0 },
    ] as const;
    for (const c of casos) {
      const linea = lineaMetodoCert(c);
      expect(linea, JSON.stringify(c)).not.toBeNull();
      const ancho = font.widthOfTextAtSize(linea ?? '', TAMANO_LINEA_METODO);
      expect(ancho, `${linea} → ${ancho.toFixed(1)} pt`).toBeLessThanOrEqual(
        A4_WIDTH_PT - 2 * MARGEN_PT,
      );
    }
  });
});

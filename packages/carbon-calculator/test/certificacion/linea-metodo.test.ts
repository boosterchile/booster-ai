import { describe, expect, it } from 'vitest';
import { lineaMetodoCertificacion } from '../../src/certificacion/linea-metodo.js';
import type { MetodoPrecision, RouteDataSource } from '../../src/tipos.js';

/**
 * ADR-077 §4 — línea de método del certificado/reporte y de la UI. Derivada
 * SIEMPRE de `metodo_precision × fuente_dato_ruta × coverage_pct` (nunca texto
 * libre ni flag del cliente), con vocabulario cerrado:
 *   - «medida» aplica solo a la DISTANCIA; las emisiones secundarias son
 *     «modeladas» o «estimadas».
 *   - «verificable», «certificado» y «medición de emisiones» están prohibidas
 *     fuera de `primario_verificable`.
 * La misma función alimenta el PDF (ambas plantillas) y la app: no existe un
 * segundo vocabulario.
 */
const METODOS: readonly MetodoPrecision[] = ['exacto_canbus', 'modelado', 'por_defecto'];
const FUENTES: readonly RouteDataSource[] = [
  'teltonika_gps',
  'maps_directions',
  'manual_declared',
  'movil_gps',
];
const COBERTURAS = [0, 50, 79.9, 80, 94.9, 95, 100];
const esPrimario = (m: MetodoPrecision, f: RouteDataSource, c: number) =>
  m === 'exacto_canbus' && f === 'teltonika_gps' && c >= 95;

describe('lineaMetodoCertificacion — tabla ADR-077 §4', () => {
  it('primario_verificable → combustible medido por CAN bus + ruta GPS del vehículo con cobertura', () => {
    expect(
      lineaMetodoCertificacion({
        precisionMethod: 'exacto_canbus',
        routeDataSource: 'teltonika_gps',
        coveragePct: 98.2,
      }),
    ).toBe('Combustible medido por CAN bus del vehículo · Ruta GPS del vehículo (cobertura 98 %)');
  });

  it('secundario + teltonika_gps → distancia medida por GPS del vehículo, consumo modelado', () => {
    expect(
      lineaMetodoCertificacion({
        precisionMethod: 'modelado',
        routeDataSource: 'teltonika_gps',
        coveragePct: 91.6,
      }),
    ).toBe(
      'Distancia medida por GPS del vehículo (cobertura 91 %) · Consumo modelado según GLEC v3.0',
    );
  });

  it('secundario + movil_gps → distancia medida por GPS del móvil del conductor, consumo modelado', () => {
    expect(
      lineaMetodoCertificacion({
        precisionMethod: 'modelado',
        routeDataSource: 'movil_gps',
        coveragePct: 100,
      }),
    ).toBe(
      'Distancia medida por GPS del móvil del conductor (cobertura 100 %) · Consumo modelado según GLEC v3.0',
    );
  });

  it('secundario + maps_directions → distancia estimada por ruta, consumo modelado', () => {
    expect(
      lineaMetodoCertificacion({
        precisionMethod: 'modelado',
        routeDataSource: 'maps_directions',
        coveragePct: 0,
      }),
    ).toBe('Distancia estimada por ruta (Google Routes) · Consumo modelado según GLEC v3.0');
  });

  it('secundario_default (por_defecto) → consumo estimado con factores por defecto', () => {
    expect(
      lineaMetodoCertificacion({
        precisionMethod: 'por_defecto',
        routeDataSource: 'maps_directions',
        coveragePct: 0,
      }),
    ).toBe(
      'Distancia estimada por ruta (Google Routes) · Consumo estimado con factores por defecto según GLEC v3.0',
    );
  });

  it('manual_declared → distancia declarada por el cliente (siempre secundario_default)', () => {
    expect(
      lineaMetodoCertificacion({
        precisionMethod: 'modelado',
        routeDataSource: 'manual_declared',
        coveragePct: 0,
      }),
    ).toBe('Distancia declarada por el cliente · Consumo modelado según GLEC v3.0');
  });

  it('la cobertura se trunca hacia abajo (nunca sobre-declara lo medido)', () => {
    const linea = lineaMetodoCertificacion({
      precisionMethod: 'modelado',
      routeDataSource: 'teltonika_gps',
      coveragePct: 79.99,
    });
    expect(linea).toContain('(cobertura 79 %)');
  });

  it('coveragePct fuera de [0, 100] lanza (misma validación que la matriz)', () => {
    expect(() =>
      lineaMetodoCertificacion({
        precisionMethod: 'modelado',
        routeDataSource: 'teltonika_gps',
        coveragePct: 101,
      }),
    ).toThrow(/coveragePct/);
  });
});

describe('lineaMetodoCertificacion — vocabulario cerrado (ADR-077 §4)', () => {
  it('fuera de primario_verificable NUNCA dice «verificable», «certificado» ni «medición de emisiones»', () => {
    for (const m of METODOS) {
      for (const f of FUENTES) {
        for (const c of COBERTURAS) {
          if (esPrimario(m, f, c)) {
            continue;
          }
          const linea = lineaMetodoCertificacion({
            precisionMethod: m,
            routeDataSource: f,
            coveragePct: c,
          });
          const ctx = `${m} + ${f} + ${c}%`;
          expect(linea, ctx).not.toMatch(/verificable/i);
          expect(linea, ctx).not.toMatch(/certificado/i);
          expect(linea, ctx).not.toMatch(/medición de emisiones/i);
        }
      }
    }
  });

  it('«medida» solo aparece con fuente GPS (teltonika_gps | movil_gps) y se refiere a la distancia', () => {
    for (const m of METODOS) {
      for (const f of FUENTES) {
        for (const c of COBERTURAS) {
          if (esPrimario(m, f, c)) {
            continue;
          }
          const linea = lineaMetodoCertificacion({
            precisionMethod: m,
            routeDataSource: f,
            coveragePct: c,
          });
          const ctx = `${m} + ${f} + ${c}%`;
          if (f === 'teltonika_gps' || f === 'movil_gps') {
            expect(linea, ctx).toMatch(/^Distancia medida por GPS/);
          } else {
            expect(linea, ctx).not.toMatch(/medida/i);
          }
          expect(linea, ctx).not.toMatch(/emisiones medidas|huella medida/i);
        }
      }
    }
  });

  it('movil_gps nunca produce la línea primaria aunque el método sea exacto_canbus y la cobertura 100 %', () => {
    const linea = lineaMetodoCertificacion({
      precisionMethod: 'exacto_canbus',
      routeDataSource: 'movil_gps',
      coveragePct: 100,
    });
    expect(linea).toMatch(/GPS del móvil del conductor/);
    expect(linea).not.toMatch(/verificable/i);
    expect(linea).not.toMatch(/Ruta GPS del vehículo/);
  });

  it('las cuatro fuentes producen líneas distintas (la auditoría distingue de dónde salió cada km)', () => {
    const lineas = FUENTES.map((f) =>
      lineaMetodoCertificacion({
        precisionMethod: 'modelado',
        routeDataSource: f,
        coveragePct: 85,
      }),
    );
    expect(new Set(lineas).size).toBe(FUENTES.length);
  });
});

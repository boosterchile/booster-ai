import { describe, expect, it } from 'vitest';
import {
  THRESHOLD_PRIMARIO_PCT,
  derivarNivelCertificacion,
} from '../../src/certificacion/derivar-nivel.js';
import type { MetodoPrecision, RouteDataSource } from '../../src/tipos.js';

/**
 * Tests de la matriz de derivación de nivel de certificación (ADR-028 §2).
 *
 * La matriz es la única fuente de verdad para el cliente sobre qué
 * certificado recibe. Bug aquí = greenwashing posible o downgrade
 * incorrecto al cliente legítimo. Cobertura exhaustiva por construcción.
 */

describe('derivarNivelCertificacion — matriz ADR-028 §2', () => {
  // Helper para construir cases legibles
  const caso = (
    precisionMethod: MetodoPrecision,
    routeDataSource: RouteDataSource,
    coveragePct: number,
  ) => ({ precisionMethod, routeDataSource, coveragePct });

  describe('primario_verificable: requiere los 3 alineados', () => {
    it('exacto_canbus + teltonika_gps + cobertura ≥ 95% → primario', () => {
      expect(derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', 100))).toBe(
        'primario_verificable',
      );
      expect(derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', 95))).toBe(
        'primario_verificable',
      );
      expect(derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', 98.7))).toBe(
        'primario_verificable',
      );
    });

    it('exacto_canbus + teltonika_gps + cobertura 80-94% → secundario_modeled', () => {
      expect(derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', 94.9))).toBe(
        'secundario_modeled',
      );
      expect(derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', 80))).toBe(
        'secundario_modeled',
      );
    });

    it('exacto_canbus + teltonika_gps + cobertura < 80% → secundario_modeled', () => {
      expect(derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', 79))).toBe(
        'secundario_modeled',
      );
      expect(derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', 50))).toBe(
        'secundario_modeled',
      );
    });
  });

  describe('modelado: nunca alcanza primario, siempre cae a secundario_modeled', () => {
    it('modelado + teltonika_gps (cualquier cobertura) → secundario_modeled', () => {
      expect(derivarNivelCertificacion(caso('modelado', 'teltonika_gps', 100))).toBe(
        'secundario_modeled',
      );
      expect(derivarNivelCertificacion(caso('modelado', 'teltonika_gps', 80))).toBe(
        'secundario_modeled',
      );
      expect(derivarNivelCertificacion(caso('modelado', 'teltonika_gps', 30))).toBe(
        'secundario_modeled',
      );
    });

    it('modelado + maps_directions → secundario_modeled', () => {
      expect(derivarNivelCertificacion(caso('modelado', 'maps_directions', 0))).toBe(
        'secundario_modeled',
      );
    });
  });

  describe('por_defecto: depende de la fuente de ruta', () => {
    it('por_defecto + maps_directions → secundario_modeled (Maps SI calibra)', () => {
      expect(derivarNivelCertificacion(caso('por_defecto', 'maps_directions', 0))).toBe(
        'secundario_modeled',
      );
    });

    it('por_defecto + teltonika_gps → secundario_modeled', () => {
      expect(derivarNivelCertificacion(caso('por_defecto', 'teltonika_gps', 90))).toBe(
        'secundario_modeled',
      );
    });
  });

  describe('manual_declared: siempre worst case (secundario_default)', () => {
    it('manual_declared con cualquier precisionMethod → secundario_default', () => {
      expect(derivarNivelCertificacion(caso('exacto_canbus', 'manual_declared', 100))).toBe(
        'secundario_default',
      );
      expect(derivarNivelCertificacion(caso('modelado', 'manual_declared', 90))).toBe(
        'secundario_default',
      );
      expect(derivarNivelCertificacion(caso('por_defecto', 'manual_declared', 0))).toBe(
        'secundario_default',
      );
    });
  });

  describe('boundaries del threshold primario (95%)', () => {
    it(`exactamente ${THRESHOLD_PRIMARIO_PCT}% → primario_verificable`, () => {
      expect(
        derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', THRESHOLD_PRIMARIO_PCT)),
      ).toBe('primario_verificable');
    });

    it(`${THRESHOLD_PRIMARIO_PCT - 0.1}% → secundario_modeled`, () => {
      expect(
        derivarNivelCertificacion(
          caso('exacto_canbus', 'teltonika_gps', THRESHOLD_PRIMARIO_PCT - 0.1),
        ),
      ).toBe('secundario_modeled');
    });
  });

  describe('validación defensiva de inputs', () => {
    it('coveragePct < 0 lanza error', () => {
      expect(() => derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', -1))).toThrow(
        /coveragePct/,
      );
    });

    it('coveragePct > 100 lanza error', () => {
      expect(() => derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', 101))).toThrow(
        /coveragePct/,
      );
    });

    it('coveragePct NaN lanza error', () => {
      expect(() =>
        derivarNivelCertificacion(caso('exacto_canbus', 'teltonika_gps', Number.NaN)),
      ).toThrow(/coveragePct/);
    });
  });
});

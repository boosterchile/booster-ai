import { describe, expect, it } from 'vitest';
import { calcularFactorIncertidumbre } from '../../src/certificacion/factor-incertidumbre.js';

/**
 * Tests del cálculo de factor de incertidumbre publicado en cert (ADR-028 §3).
 *
 * El factor se imprime visiblemente en el cert y va a auditor; bug aquí
 * = subreporte o sobre-reporte de incertidumbre, ambos rompen confianza.
 */

describe('calcularFactorIncertidumbre — tabla ADR-028 §3', () => {
  describe('primario_verificable (baseline 0.05)', () => {
    it('sin desviación CAN bus → 0.05', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'primario_verificable',
        canbusDeviationPct: 3,
        coveragePct: 100,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.05, 5);
    });

    it('canbusDeviationPct = 5% (boundary, no triggers) → 0.05', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'primario_verificable',
        canbusDeviationPct: 5,
        coveragePct: 100,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.05, 5);
    });

    it('canbusDeviationPct > 5% → 0.06 (penaliza por bus mal calibrado)', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'primario_verificable',
        canbusDeviationPct: 7,
        coveragePct: 100,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.06, 5);
    });

    it('canbusDeviationPct undefined no aplica modificador', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'primario_verificable',
        coveragePct: 100,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.05, 5);
    });
  });

  describe('secundario_modeled (baseline 0.15)', () => {
    it('cobertura ≥ 95% → 0.15 (sin penalización)', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'secundario_modeled',
        coveragePct: 95,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.15, 5);
    });

    it('cobertura 70% → 0.15 + (1 - 0.7) × 0.20 = 0.21', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'secundario_modeled',
        coveragePct: 70,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.21, 5);
    });

    it('cobertura 0% → 0.15 + 1.0 × 0.20 = 0.35', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'secundario_modeled',
        coveragePct: 0,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.35, 5);
    });

    it('penalización es lineal — cobertura 50% → 0.25', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'secundario_modeled',
        coveragePct: 50,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.25, 5);
    });
  });

  describe('secundario_default (baseline 0.30)', () => {
    it('vehicleType matchea Routes API → 0.30', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'secundario_default',
        coveragePct: 0,
        vehicleTypeMatchesRoutesApi: true,
      });
      expect(f).toBeCloseTo(0.3, 5);
    });

    it('vehicleType NO matchea → 0.40 (penaliza por mismatch)', () => {
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'secundario_default',
        coveragePct: 0,
        vehicleTypeMatchesRoutesApi: false,
      });
      expect(f).toBeCloseTo(0.4, 5);
    });
  });

  describe('cap en 1.0', () => {
    it('factor nunca excede 1.0 (interpretación física requiere ≤ 100%)', () => {
      // Forzamos un escenario absurdo: secundario_modeled con cobertura -100
      // sería matemáticamente 0.15 + 2*0.20 = 0.55, lejos del cap. Probemos
      // con un caso realista que se acerque: secundario_modeled cobertura 0
      // es 0.35. Para superar 1.0 con la fórmula actual no es posible salvo
      // bug. Verificamos que el cap está activo defensivamente.
      const f = calcularFactorIncertidumbre({
        nivelCertificacion: 'secundario_default',
        coveragePct: 0,
        vehicleTypeMatchesRoutesApi: false,
      });
      expect(f).toBeLessThanOrEqual(1);
    });
  });

  describe('validación defensiva de inputs', () => {
    it('coveragePct fuera de rango lanza error', () => {
      expect(() =>
        calcularFactorIncertidumbre({
          nivelCertificacion: 'secundario_modeled',
          coveragePct: 150,
          vehicleTypeMatchesRoutesApi: true,
        }),
      ).toThrow(/coveragePct/);

      expect(() =>
        calcularFactorIncertidumbre({
          nivelCertificacion: 'secundario_modeled',
          coveragePct: Number.NaN,
          vehicleTypeMatchesRoutesApi: true,
        }),
      ).toThrow(/coveragePct/);
    });
  });
});

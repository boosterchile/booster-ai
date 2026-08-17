import { describe, expect, it } from 'vitest';
import { resolverOptInHuella } from './resolver-opt-in-huella.js';

/**
 * Los 7 casos fijados en `.specs/medicion-huella-segmento/plan.md` (Task 3).
 * Regla: el override del viaje gana; si es null, OR de las empresas
 * participantes (generador y transportista). Empresa ausente / flag null
 * cuenta como false. El consignee no participa (no es empresa consultable).
 */
describe('resolverOptInHuella', () => {
  it('override true del viaje gana aunque ninguna empresa tenga huella activa', () => {
    expect(
      resolverOptInHuella({
        tripOverride: true,
        generadorCarbonEnabled: false,
        transportistaCarbonEnabled: false,
      }),
    ).toBe(true);
  });

  it('override false del viaje gana aunque ambas empresas tengan huella activa', () => {
    expect(
      resolverOptInHuella({
        tripOverride: false,
        generadorCarbonEnabled: true,
        transportistaCarbonEnabled: true,
      }),
    ).toBe(false);
  });

  it('sin override, basta que el generador tenga huella activa (OR)', () => {
    expect(
      resolverOptInHuella({
        tripOverride: null,
        generadorCarbonEnabled: true,
        transportistaCarbonEnabled: false,
      }),
    ).toBe(true);
  });

  it('sin override, basta que el transportista tenga huella activa (OR)', () => {
    expect(
      resolverOptInHuella({
        tripOverride: null,
        generadorCarbonEnabled: false,
        transportistaCarbonEnabled: true,
      }),
    ).toBe(true);
  });

  it('sin override y ambas empresas en false, la huella queda inactiva', () => {
    expect(
      resolverOptInHuella({
        tripOverride: null,
        generadorCarbonEnabled: false,
        transportistaCarbonEnabled: false,
      }),
    ).toBe(false);
  });

  it('generador ausente (null) cuenta como false; el transportista activa la huella por OR', () => {
    expect(
      resolverOptInHuella({
        tripOverride: null,
        generadorCarbonEnabled: null,
        transportistaCarbonEnabled: true,
      }),
    ).toBe(true);
  });

  it('todo null (sin override, sin empresas consultables) resuelve a false, nunca a null', () => {
    expect(
      resolverOptInHuella({
        tripOverride: null,
        generadorCarbonEnabled: null,
        transportistaCarbonEnabled: null,
      }),
    ).toBe(false);
  });
});

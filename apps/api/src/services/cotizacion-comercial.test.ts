import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import {
  desgloseParaGenerador,
  modalidadPermitida,
  tasaParaPublicacion,
} from './cotizacion-comercial.js';

const C = CONFIGURACION_COMERCIAL_INICIAL;

describe('tasaParaPublicacion (ADR-079 §2)', () => {
  it('spot y programada toman su tasa; una publicación nueva no es retorno', () => {
    expect(tasaParaPublicacion(C, 'spot')).toBe(20);
    expect(tasaParaPublicacion(C, 'programada')).toBe(10);
  });
});

describe('modalidadPermitida', () => {
  it('spot siempre; programada solo con contrato programado habilitado', () => {
    expect(modalidadPermitida('spot', null)).toBe(true);
    expect(modalidadPermitida('programada', null)).toBe(false);
    expect(modalidadPermitida('programada', new Date())).toBe(true);
  });
});

describe('desgloseParaGenerador (ADR-079 §1 y §5)', () => {
  it('viaje de $700.000 spot con IVA de la configuración', () => {
    expect(
      desgloseParaGenerador({ precioTransportistaClp: 700_000, comisionPct: 20, ivaPct: 19 }),
    ).toEqual({
      precio_transportista_clp: 700_000,
      comision_pct: 20,
      comision_clp: 140_000,
      iva_comision_clp: 26_600,
      precio_generador_clp: 840_000,
      total_factura_generador_clp: 166_600,
    });
  });

  it('acepta la tasa congelada como texto numeric de Postgres', () => {
    expect(
      desgloseParaGenerador({ precioTransportistaClp: 100_000, comisionPct: '10.00', ivaPct: 19 })
        .comision_clp,
    ).toBe(10_000);
  });
});

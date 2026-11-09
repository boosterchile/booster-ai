import { CONFIGURACION_COMERCIAL_INICIAL } from '@booster-ai/shared-schemas';
import { describe, expect, it } from 'vitest';
import {
  type ComercialViaje,
  desglosePropuesto,
  recalculoComercial,
} from '../../src/services/cambio-carga-comercial.js';

/** Versión congelada al publicar: spot 15 %, programada 8 %, IVA 19 %. */
const CONGELADA = {
  ...CONFIGURACION_COMERCIAL_INICIAL,
  comisiones: { ...CONFIGURACION_COMERCIAL_INICIAL.comisiones, spot_pct: 15, programada_pct: 8 },
};

const V3: ComercialViaje = {
  proposedPriceClp: 800_000,
  modalidadCarga: 'spot',
  comisionPctAplicada: '15.00',
  configCongelada: CONGELADA,
  contratoProgramadoActivadoEn: new Date('2026-01-01T00:00:00Z'),
};

const V2: ComercialViaje = {
  ...V3,
  comisionPctAplicada: null,
  configCongelada: null,
};

describe('recalculoComercial (editar-anular-cargas §7)', () => {
  it('precio nuevo: viaje y asignación quedan con el mismo precio; la tasa no cambia', () => {
    const r = recalculoComercial(V3, { proposed_price_clp: 900_000 }, 800_000);
    expect(r).toEqual({
      ok: true,
      viaje: {},
      asignacion: { agreedPriceClp: 900_000 },
      bloque: {
        precio_acordado_antes: 800_000,
        precio_acordado_despues: 900_000,
        comision_pct_antes: '15.00',
        comision_pct_despues: '15.00',
      },
    });
  });

  it('modalidad nueva: la tasa sale de la versión congelada, con dos decimales', () => {
    const r = recalculoComercial(V3, { modalidad_carga: 'programada' }, 800_000);
    expect(r).toMatchObject({
      ok: true,
      viaje: { comisionPctAplicada: '8.00' },
      asignacion: {},
      bloque: { comision_pct_antes: '15.00', comision_pct_despues: '8.00' },
    });
  });

  it('un viaje sin tasa congelada (v2) no gana tasa: solo cambia la modalidad', () => {
    const r = recalculoComercial(V2, { modalidad_carga: 'programada' }, 800_000);
    expect(r).toMatchObject({
      ok: true,
      viaje: {},
      bloque: { comision_pct_antes: null, comision_pct_despues: null },
    });
  });

  it('programada sin contrato programado habilitado → contrato_programado_no_habilitado', () => {
    const r = recalculoComercial(
      { ...V3, contratoProgramadoActivadoEn: null },
      { modalidad_carga: 'programada' },
      800_000,
    );
    expect(r).toEqual({ ok: false, code: 'contrato_programado_no_habilitado' });
  });

  it('volver a spot no exige contrato', () => {
    const r = recalculoComercial(
      {
        ...V3,
        modalidadCarga: 'programada',
        comisionPctAplicada: '8.00',
        contratoProgramadoActivadoEn: null,
      },
      { modalidad_carga: 'spot' },
      800_000,
    );
    expect(r).toMatchObject({ ok: true, viaje: { comisionPctAplicada: '15.00' } });
  });
});

describe('desglosePropuesto (ADR-079 §5, solo para el generador)', () => {
  it('con tasa congelada: precio, comisión e IVA de la modalidad propuesta', () => {
    const d = desglosePropuesto(V3, {
      proposed_price_clp: 1_000_000,
      modalidad_carga: 'programada',
    });
    expect(d).toMatchObject({
      precio_transportista_clp: 1_000_000,
      comision_pct: 8,
      comision_clp: 80_000,
    });
  });

  it('sin cambio comercial o sin tasa congelada no hay desglose', () => {
    expect(desglosePropuesto(V3, { weight_kg: 2000 })).toBeNull();
    expect(desglosePropuesto(V2, { proposed_price_clp: 1_000_000 })).toBeNull();
  });
});

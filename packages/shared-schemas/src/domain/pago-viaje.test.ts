import { describe, expect, it } from 'vitest';
import {
  abrirDisputaSchema,
  modoFlujoSchema,
  registrarEventoAdminSchema,
  tipoEventoPagoSchema,
} from './pago-viaje.js';

describe('pago-viaje (ADR-080)', () => {
  it('enums alineados con SQL', () => {
    expect(modoFlujoSchema.options).toEqual(['conector', 'mandato_cobro']);
    expect(tipoEventoPagoSchema.options).toContain('recepcion_conforme');
    expect(tipoEventoPagoSchema.options).toHaveLength(7);
  });

  it('cobro, liberación y anticipo exigen monto; la resolución de disputa no lleva', () => {
    const base = { evidencia_ref: 'abono-123', ocurrido_en: '2026-10-30T12:00:00-03:00' };
    expect(
      registrarEventoAdminSchema.safeParse({ ...base, tipo: 'cobro_registrado', monto_clp: 1 })
        .success,
    ).toBe(true);
    expect(
      registrarEventoAdminSchema.safeParse({ ...base, tipo: 'liberacion_booster' }).success,
    ).toBe(false);
    expect(
      registrarEventoAdminSchema.safeParse({ ...base, tipo: 'disputa_resuelta' }).success,
    ).toBe(true);
    expect(
      registrarEventoAdminSchema.safeParse({ ...base, tipo: 'disputa_resuelta', monto_clp: 5 })
        .success,
    ).toBe(false);
  });

  it('evidencia y fecha son obligatorias y válidas', () => {
    expect(
      registrarEventoAdminSchema.safeParse({
        tipo: 'cobro_registrado',
        monto_clp: 1,
        evidencia_ref: '  ',
        ocurrido_en: '2026-10-30T12:00:00Z',
      }).success,
    ).toBe(false);
    expect(
      registrarEventoAdminSchema.safeParse({
        tipo: 'cobro_registrado',
        monto_clp: 1,
        evidencia_ref: 'x',
        ocurrido_en: 'ayer',
      }).success,
    ).toBe(false);
    expect(
      registrarEventoAdminSchema.safeParse({
        tipo: 'cobro_registrado',
        monto_clp: -5,
        evidencia_ref: 'x',
        ocurrido_en: '2026-10-30T12:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('la disputa exige un motivo de al menos 10 caracteres', () => {
    expect(abrirDisputaSchema.safeParse({ motivo: 'corto' }).success).toBe(false);
    expect(
      abrirDisputaSchema.safeParse({ motivo: 'La carga llegó dañada en 3 pallets' }).success,
    ).toBe(true);
  });
});

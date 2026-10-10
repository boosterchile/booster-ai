import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { leerConfiguracionPublicada } from '../../src/services/configuracion-comercial.js';
import { liquidarTrip } from '../../src/services/liquidar-trip.js';
import {
  calcularFloatActual,
  conciliarMandatoCobro,
  leerPagoViaje,
  registrarEventoPago,
  registrarRecepcionConforme,
} from '../../src/services/mandato-cobro/eventos-pago.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ADR-080 contra Postgres real:
 *   - migración 0061: eventos append-only (trigger), una recepción conforme
 *     por asignación, evidencia obligatoria;
 *   - Verificación 1: flag apagado → liquidación `conector` y cero eventos;
 *   - Verificación 2: flag encendido → recepción conforme con documento,
 *     vencimientos con los plazos de la versión liquidada, float exacto;
 *   - Verificación 3: anticipo solo con adelanto desembolsado de la asignación;
 *   - Verificación 4: liberación sobre el tope → `tope_float_excedido`.
 *
 * El float y la conciliación son globales: la base de integración es
 * compartida, así que los asserts usan diferencias antes/después.
 */
const noop = (): void => undefined;
const logger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  fatal: noop,
  child: () => logger,
} as never as Logger;

const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

const DIA = 86_400_000;

describe('integration: mandato de cobro (ADR-080)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  /** Viaje v3 entregado con documento archivado; devuelve ids y la liquidación. */
  async function viajeEntregado(opts: { mandato: boolean; conDocumento?: boolean }) {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const plan =
      (
        await db
          .insert(schema.plans)
          .values({ slug: 'gratis', name: 'P', description: 'f', monthlyPriceClp: 0, features: {} })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan');
    const user = uno(
      await db
        .insert(schema.users)
        .values({ firebaseUid: `fb-mc-${s}`, email: `mc-${s}@test.invalid`, fullName: 'MC' })
        .returning(),
      'user',
    );
    const empresa = async (generador: boolean) =>
      uno(
        await db
          .insert(schema.empresas)
          .values({
            legalName: `${generador ? 'Gen' : 'Tra'} MC ${s}`,
            rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
            contactEmail: `${generador ? 'g' : 't'}-mc-${s}@test.invalid`,
            contactPhone: '+56911111111',
            addressStreet: 'C 1',
            addressCity: 'Santiago',
            addressRegion: 'RM',
            isGeneradorCarga: generador,
            isTransportista: !generador,
            planId: plan.id,
          })
          .returning(),
        'empresa',
      );
    const generador = await empresa(true);
    const transportista = await empresa(false);
    const vehiculo = uno(
      await db
        .insert(schema.vehicles)
        .values({
          empresaId: transportista.id,
          plate: `MC${s.slice(0, 4).toUpperCase()}`,
          vehicleType: 'camion_mediano',
          capacityKg: 5000,
        })
        .returning(),
      'vehículo',
    );
    const vigente = await leerConfiguracionPublicada(db);
    const viaje = uno(
      await db
        .insert(schema.trips)
        .values({
          trackingCode: randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
          generadorCargaEmpresaId: generador.id,
          createdByUserId: user.id,
          originAddressRaw: 'Origen',
          destinationAddressRaw: 'Destino',
          cargoType: 'carga_seca',
          pickupDateRaw: '2026-10-08',
          proposedPriceClp: 1_000_000,
          status: 'entregado',
          comisionPctAplicada: '20.00',
          configuracionComercialId: vigente.id,
        })
        .returning(),
      'viaje',
    );
    const oferta = uno(
      await db
        .insert(schema.offers)
        .values({
          tripId: viaje.id,
          empresaId: transportista.id,
          score: 900,
          proposedPriceClp: 1_000_000,
          expiresAt: new Date(Date.now() + 3_600_000),
        })
        .returning(),
      'oferta',
    );
    const asignacion = uno(
      await db
        .insert(schema.assignments)
        .values({
          tripId: viaje.id,
          offerId: oferta.id,
          empresaId: transportista.id,
          vehicleId: vehiculo.id,
          driverUserId: user.id,
          agreedPriceClp: 1_000_000,
          status: 'entregado',
          acceptedAt: new Date(Date.now() - 7_200_000),
          deliveredAt: new Date(),
        })
        .returning(),
      'asignación',
    );
    const documento =
      opts.conDocumento === false
        ? null
        : uno(
            await db
              .insert(schema.transportDocuments)
              .values({
                viajeId: viaje.id,
                filePath: `gs://test/${s}.pdf`,
                fileMime: 'application/pdf',
                docType: '52',
                source: 'pdf_upload',
                uploadedBy: user.id,
              })
              .returning(),
            'documento',
          );
    const asegurarLiquidacion = () =>
      liquidarTrip({
        db,
        logger,
        assignmentId: asignacion.id,
        pricingV2Activated: false,
        pricingV3Activated: true,
        mandatoCobroActivated: opts.mandato,
      });
    return {
      generador,
      transportista,
      viaje,
      asignacion,
      user,
      documento,
      vigente,
      asegurarLiquidacion,
    };
  }

  const deps = (topeFloatClp = 0) => ({ db: handle.db, logger, topeFloatClp });

  test('Verificación 1: flag apagado → liquidación conector y sin eventos', async () => {
    const v = await viajeEntregado({ mandato: false });
    await v.asegurarLiquidacion();
    const liq = uno(
      await handle.db
        .select()
        .from(schema.liquidaciones)
        .where(eq(schema.liquidaciones.asignacionId, v.asignacion.id)),
      'liquidación',
    );
    expect(liq.modoFlujo).toBe('conector');
    const r = await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: v.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    expect(r).toEqual({ ok: false, code: 'no_es_mandato' });
    const eventos = await handle.db
      .select()
      .from(schema.eventosPagoViaje)
      .where(eq(schema.eventosPagoViaje.asignacionId, v.asignacion.id));
    expect(eventos).toEqual([]);
  });

  test('migración 0061: eventos append-only, una recepción por asignación, evidencia no vacía', async () => {
    const v = await viajeEntregado({ mandato: true });
    const r = await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: v.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    expect(r.ok).toBe(true);
    const ev = uno(
      await handle.db
        .select()
        .from(schema.eventosPagoViaje)
        .where(eq(schema.eventosPagoViaje.asignacionId, v.asignacion.id)),
      'evento',
    );
    await expect(
      handle.pool.query('UPDATE eventos_pago_viaje SET detalle = $1 WHERE id = $2', ['x', ev.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      handle.pool.query('DELETE FROM eventos_pago_viaje WHERE id = $1', [ev.id]),
    ).rejects.toThrow(/append-only/);
    await expect(
      handle.pool.query(
        `INSERT INTO eventos_pago_viaje (asignacion_id, tipo, evidencia_tipo, evidencia_ref, ocurrido_en, registrado_por)
         VALUES ($1, 'recepcion_conforme', 'confirmacion_generador', 'otro', now(), 'x')`,
        [v.asignacion.id],
      ),
    ).rejects.toThrow(/uq_eventos_pago_viaje_recepcion|duplicate/);
    await expect(
      handle.pool.query(
        `INSERT INTO eventos_pago_viaje (asignacion_id, tipo, evidencia_tipo, evidencia_ref, ocurrido_en, registrado_por)
         VALUES ($1, 'disputa_abierta', 'objecion_generador', '  ', now(), 'x')`,
        [v.asignacion.id],
      ),
    ).rejects.toThrow(/chk_eventos_pago_viaje_evidencia/);
  });

  test('Verificación 2: recepción conforme con documento, vencimientos de la versión liquidada', async () => {
    const v = await viajeEntregado({ mandato: true });
    const r = await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: v.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    if (!r.ok) {
      throw new Error(`recepción rechazada: ${r.code}`);
    }
    const plazos = v.vigente.config.financiamiento;
    const recepcion = new Date(r.pago.recepcion_conforme_en ?? '');
    expect(r.pago.modo_flujo).toBe('mandato_cobro');
    expect(r.pago.cobro.estado).toBe('pendiente');
    expect(r.pago.liberacion.estado).toBe('pendiente');
    expect(new Date(r.pago.cobro.vence_en ?? '').getTime()).toBe(
      recepcion.getTime() + plazos.plazo_pago_generador_dias * DIA,
    );
    expect(new Date(r.pago.liberacion.vence_en ?? '').getTime()).toBe(
      recepcion.getTime() + plazos.plazo_liberacion_transportista_dias * DIA,
    );
    // Precio 1.000.000, comisión 20 % = 200.000 + IVA.
    const iva = Math.round(200_000 * (v.vigente.config.impuestos.iva_pct / 100));
    expect(r.pago.montos_esperados).toEqual({
      cobro_clp: 1_200_000 + iva,
      liberacion_clp: 1_000_000,
    });
    const evento = uno(
      await handle.db
        .select()
        .from(schema.eventosPagoViaje)
        .where(eq(schema.eventosPagoViaje.asignacionId, v.asignacion.id)),
      'evento',
    );
    expect(evento).toMatchObject({
      tipo: 'recepcion_conforme',
      evidenciaTipo: 'confirmacion_generador',
      evidenciaRef: v.documento?.id,
    });

    // Idempotente: confirmar dos veces no duplica ni falla.
    const otra = await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: v.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    expect(otra.ok).toBe(true);
  });

  test('sin documento archivado no hay recepción conforme', async () => {
    const v = await viajeEntregado({ mandato: true, conDocumento: false });
    const r = await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: v.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    expect(r).toEqual({ ok: false, code: 'sin_documento' });
  });

  test('otro generador no puede confirmar un viaje ajeno', async () => {
    const v = await viajeEntregado({ mandato: true });
    const ajeno = await viajeEntregado({ mandato: true });
    const r = await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: ajeno.generador.id,
      registradoPor: 'x@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    expect(r).toEqual({ ok: false, code: 'viaje_no_encontrado' });
  });

  test('Verificación 4: tope del float; cobro baja el float; liberación post-cobro sin tope', async () => {
    const v = await viajeEntregado({ mandato: true });
    await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: v.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    const pago = await leerPagoViaje(handle.db, v.asignacion.id);
    if (!pago) {
      throw new Error('pago no encontrado');
    }
    const ahora = new Date();
    const liberar = (tope: number) =>
      registrarEventoPago(deps(tope), {
        asignacionId: v.asignacion.id,
        tipo: 'liberacion_booster',
        montoClp: 1_000_000,
        evidenciaRef: `trf-${randomUUID()}`,
        ocurridoEn: ahora,
        registradoPor: 'admin@test.invalid',
      });

    // Tope 0 (default): Booster no adelanta caja propia.
    const rechazada = await liberar(0);
    expect(rechazada).toMatchObject({ ok: false, code: 'tope_float_excedido' });

    const floatAntes = await calcularFloatActual(handle.db);
    const ok = await liberar(Number.MAX_SAFE_INTEGER);
    expect(ok.ok).toBe(true);
    expect(await calcularFloatActual(handle.db)).toBe(floatAntes + 1_000_000);

    const cobro = await registrarEventoPago(deps(), {
      asignacionId: v.asignacion.id,
      tipo: 'cobro_registrado',
      montoClp: pago.montos_esperados.cobro_clp,
      evidenciaRef: `abono-${randomUUID()}`,
      ocurridoEn: new Date(ahora.getTime() + 1000),
      registradoPor: 'admin@test.invalid',
    });
    expect(cobro.ok).toBe(true);
    expect(await calcularFloatActual(handle.db)).toBe(floatAntes);

    // Monto distinto del esperado → rechazo explícito.
    const v2 = await viajeEntregado({ mandato: true });
    await registrarRecepcionConforme(deps(), {
      tripId: v2.viaje.id,
      generadorEmpresaId: v2.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v2.asegurarLiquidacion,
    });
    const mal = await registrarEventoPago(deps(), {
      asignacionId: v2.asignacion.id,
      tipo: 'cobro_registrado',
      montoClp: 1,
      evidenciaRef: 'abono-x',
      ocurridoEn: new Date(),
      registradoPor: 'admin@test.invalid',
    });
    expect(mal).toEqual({ ok: false, code: 'monto_invalido' });
  });

  test('Verificación 3: anticipo solo con adelanto desembolsado de la misma asignación', async () => {
    const v = await viajeEntregado({ mandato: true });
    await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: v.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    const anticipo = (ref: string, monto: number) =>
      registrarEventoPago(deps(), {
        asignacionId: v.asignacion.id,
        tipo: 'anticipo_operador',
        montoClp: monto,
        evidenciaRef: ref,
        ocurridoEn: new Date(),
        registradoPor: 'admin@test.invalid',
      });
    expect(await anticipo(randomUUID(), 900_000)).toEqual({ ok: false, code: 'adelanto_invalido' });

    const adelanto = uno(
      await handle.db
        .insert(schema.adelantosCarrier)
        .values({
          asignacionId: v.asignacion.id,
          empresaCarrierId: v.transportista.id,
          empresaShipperId: v.generador.id,
          montoNetoClp: 1_000_000,
          plazoDiasShipper: 30,
          tarifaPct: '1.50',
          tarifaClp: 15_000,
          montoAdelantadoClp: 900_000,
          partnerSlug: 'operador-prueba',
          status: 'aprobado',
          factoringMethodologyVersion: 'factoring-v1.0-cl-2026.06',
        })
        .returning(),
      'adelanto',
    );
    expect(await anticipo(adelanto.id, 900_000)).toEqual({ ok: false, code: 'adelanto_invalido' });

    await handle.db
      .update(schema.adelantosCarrier)
      .set({ status: 'desembolsado', desembolsadoEn: new Date() })
      .where(eq(schema.adelantosCarrier.id, adelanto.id));
    expect(await anticipo(adelanto.id, 1)).toEqual({ ok: false, code: 'monto_invalido' });
    const ok = await anticipo(adelanto.id, 900_000);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.pago.liberacion.estado).toBe('anticipado_por_operador');
    }
  });

  test('conciliación: registra mora sobre cobros vencidos y es idempotente', async () => {
    const v = await viajeEntregado({ mandato: true });
    await registrarRecepcionConforme(deps(), {
      tripId: v.viaje.id,
      generadorEmpresaId: v.generador.id,
      registradoPor: 'g@test.invalid',
      asegurarLiquidacion: v.asegurarLiquidacion,
    });
    const plazo = v.vigente.config.financiamiento.plazo_pago_generador_dias;
    const despues = new Date(Date.now() + (plazo + 1) * DIA);
    const r1 = await conciliarMandatoCobro({ ...deps(), ahora: () => despues });
    expect(r1.morasRegistradas).toBeGreaterThanOrEqual(1);
    const pago = await leerPagoViaje(handle.db, v.asignacion.id);
    expect(pago?.cobro.estado).toBe('mora');
    const r2 = await conciliarMandatoCobro({ ...deps(), ahora: () => despues });
    const pago2 = await leerPagoViaje(handle.db, v.asignacion.id);
    expect(pago2?.cobro.estado).toBe('mora');
    expect(r2.morasRegistradas).toBeLessThan(r1.morasRegistradas + 1);
  });
});

import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { cobrarSuscripcionesUf } from '../../src/services/cobrar-suscripciones-uf.js';
import { leerConfiguracionPublicada } from '../../src/services/configuracion-comercial.js';
import { noopMembershipPaymentGateway } from '../../src/services/membership-payment-gateway.js';
import { type ProveedorUf, obtenerValorUf } from '../../src/services/valor-uf.js';
import { type TestDbHandle, createTestDb } from '../helpers/test-db.js';

/**
 * ADR-079 §4 y Verificación 5 contra Postgres real: la factura de
 * suscripción captura `monto_uf` y `uf_valor_clp`, y
 * `subtotal_clp = round(monto_uf × uf_valor_clp)`; el IVA se suma encima
 * (decisión del PO del 2026-10-08). El periodo es uno lejano para no chocar
 * con facturas de otros tests en la misma base.
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

const UF = 39_485.65;
const PERIODO = '2099-01';

const uno = <T>(rows: T[], que: string): T => {
  const r = rows[0];
  if (!r) {
    throw new Error(`fixture: ${que} no creado`);
  }
  return r;
};

describe('integration: suscripciones en UF (ADR-079 §4)', () => {
  let handle: TestDbHandle;
  beforeAll(() => {
    handle = createTestDb();
  });
  afterAll(async () => {
    await handle.pool.end();
  });

  async function plan() {
    const { db } = handle;
    return (
      (
        await db
          .insert(schema.plans)
          .values({
            slug: 'gratis',
            name: 'Gratis',
            description: 'f',
            monthlyPriceClp: 0,
            features: {},
          })
          .onConflictDoNothing({ target: schema.plans.slug })
          .returning({ id: schema.plans.id })
      )[0] ?? uno(await db.select({ id: schema.plans.id }).from(schema.plans).limit(1), 'plan')
    );
  }

  async function empresa(opts: {
    generador?: boolean;
    transportista?: boolean;
    gestionFlota?: boolean;
    prueba?: boolean;
    camiones?: Array<{ estado?: 'activo' | 'retirado'; categoria?: 'motriz' | 'arrastre' }>;
  }) {
    const { db } = handle;
    const s = randomUUID().slice(0, 8);
    const e = uno(
      await db
        .insert(schema.empresas)
        .values({
          legalName: `Sus ${s}`,
          rut: `${Math.floor(10000000 + Math.random() * 89999999)}-K`,
          contactEmail: `sus-${s}@test.invalid`,
          contactPhone: '+56911111111',
          addressStreet: 'C 1',
          addressCity: 'Santiago',
          addressRegion: 'RM',
          isGeneradorCarga: opts.generador ?? false,
          isTransportista: opts.transportista ?? false,
          isTestUser: opts.prueba ?? false,
          status: 'activa',
          gestionFlotaActivadaEn: opts.gestionFlota ? new Date() : null,
          planId: (await plan()).id,
        })
        .returning(),
      'empresa',
    );
    for (const [i, c] of (opts.camiones ?? []).entries()) {
      await db.insert(schema.vehicles).values({
        empresaId: e.id,
        plate: `S${s.slice(0, 4).toUpperCase()}${i}`,
        vehicleType: 'camion_mediano',
        capacityKg: 5000,
        vehicleStatus: c.estado ?? 'activo',
        unitCategory: c.categoria ?? 'motriz',
      });
    }
    return e;
  }

  test('factura por rol, umbral y gestión de flota; idempotente al repetir', async () => {
    const { db } = handle;
    const generador = await empresa({ generador: true });
    // 3 motrices activos (+1 arrastre y 1 retirado que no cuentan) → paga 2.
    const transportista = await empresa({
      transportista: true,
      camiones: [{}, {}, {}, { categoria: 'arrastre' }, { estado: 'retirado' }],
    });
    const flota = await empresa({ transportista: true, gestionFlota: true, camiones: [{}, {}] });
    const chico = await empresa({ transportista: true, camiones: [{}] });
    const prueba = await empresa({ generador: true, prueba: true });
    const ids = [generador.id, transportista.id, flota.id, chico.id, prueba.id];

    const config = await leerConfiguracionPublicada(db);
    const iva = config.config.impuestos.iva_pct / 100;
    const correr = () =>
      cobrarSuscripcionesUf({
        db,
        logger,
        gateway: noopMembershipPaymentGateway(logger),
        obtenerUf: async (fecha) => ({ fecha, valorClp: UF, fuente: 'cmf', desdeCache: false }),
        leerConfiguracion: () => leerConfiguracionPublicada(db),
        periodoMes: PERIODO,
      });

    const r = await correr();
    expect(r.ufValorClp).toBe(UF);

    const facturas = await db
      .select()
      .from(schema.facturasBoosterClp)
      .where(
        and(
          inArray(schema.facturasBoosterClp.empresaDestinoId, ids),
          eq(schema.facturasBoosterClp.periodoMes, PERIODO),
        ),
      );
    const de = (id: string) => facturas.find((f) => f.empresaDestinoId === id);
    const s = config.config.servicios;
    const esperado = (montoUf: number) => {
      const subtotal = Math.round(montoUf * UF);
      const ivaClp = Math.round(subtotal * iva);
      return {
        montoUf: montoUf.toFixed(4),
        ufValorClp: UF.toFixed(2),
        subtotalClp: subtotal,
        ivaClp,
        totalClp: subtotal + ivaClp,
        tipo: 'membership_mensual',
        cobroEstado: 'pending_payment_provider',
      };
    };

    expect(de(generador.id)).toMatchObject(esperado(s.suscripcion_generador_uf_empresa_mes));
    const cobrados = 3 - s.camiones_sin_cobro_por_transportista;
    expect(de(transportista.id)).toMatchObject(
      esperado(cobrados * s.suscripcion_transportista_uf_camion_mes),
    );
    expect(de(flota.id)).toMatchObject(
      esperado(
        (2 - s.camiones_sin_cobro_por_transportista) *
          s.suscripcion_transportista_gestion_flota_uf_camion_mes,
      ),
    );
    // Bajo el umbral y empresa de prueba: sin factura.
    expect(de(chico.id)).toBeUndefined();
    expect(de(prueba.id)).toBeUndefined();

    // Verificación 5: el CLP neto sale exactamente de monto_uf × uf_valor_clp.
    for (const f of facturas) {
      expect(f.subtotalClp).toBe(Math.round(Number(f.montoUf) * Number(f.ufValorClp)));
    }

    // Repetir el tick no duplica facturas.
    await correr();
    const despues = await db
      .select({ id: schema.facturasBoosterClp.id })
      .from(schema.facturasBoosterClp)
      .where(
        and(
          inArray(schema.facturasBoosterClp.empresaDestinoId, ids),
          eq(schema.facturasBoosterClp.periodoMes, PERIODO),
        ),
      );
    expect(despues).toHaveLength(facturas.length);
  });

  test('obtenerValorUf guarda el valor con su fuente y luego lo sirve de la base', async () => {
    const { db } = handle;
    // Fecha única por corrida para no leer una fila de una corrida anterior.
    const anio = 2100 + Math.floor(Math.random() * 800);
    const fecha = `${anio}-03-15`;
    const llamadas: string[] = [];
    const cmf: ProveedorUf = {
      fuente: 'cmf',
      obtener: async () => {
        llamadas.push('cmf');
        throw new Error('caída');
      },
    };
    const sii: ProveedorUf = {
      fuente: 'sii',
      obtener: async () => {
        llamadas.push('sii');
        return UF;
      },
    };

    const primera = await obtenerValorUf({ db, logger, fecha, proveedores: [cmf, sii] });
    expect(primera).toEqual({ fecha, valorClp: UF, fuente: 'sii', desdeCache: false });
    const fila = uno(
      await db.select().from(schema.valoresUf).where(eq(schema.valoresUf.fecha, fecha)),
      'valor UF',
    );
    expect(fila).toMatchObject({ valorClp: UF.toFixed(2), fuente: 'sii' });

    const segunda = await obtenerValorUf({ db, logger, fecha, proveedores: [cmf, sii] });
    expect(segunda).toEqual({ fecha, valorClp: UF, fuente: 'sii', desdeCache: true });
    expect(llamadas).toEqual(['cmf', 'sii']);
  });
});

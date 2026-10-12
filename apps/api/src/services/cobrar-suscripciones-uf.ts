import type { Logger } from '@booster-ai/logger';
import { calcularCobroSuscripcionUf, periodoMesDesde } from '@booster-ai/pricing-engine';
import { and, count, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { pgErrorCode } from '../db/pg-error.js';
import { empresas, facturasBoosterClp, vehicles } from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import {
  type CobrarMembershipsCounts,
  type FacturaPeriodoRow,
  ejecutarIntentoYActualizar,
  reintentarFacturaExistente,
} from './cobrar-memberships-mensual.js';
import type { VersionConfiguracionComercial } from './configuracion-comercial.js';
import type { MembershipPaymentGateway } from './membership-payment-gateway.js';
import { type ValorUfDelDia, fechaChile } from './valor-uf.js';

/**
 * ADR-079 §4 — cobro mensual de suscripciones en UF (modelo v3). Reemplaza
 * al cobro de membresías v2 cuando `PRICING_V3_ACTIVATED` está encendido.
 *
 * Por empresa activa (sin demo ni usuarios de prueba):
 *   - generador → `suscripcion_generador_uf_empresa_mes`;
 *   - transportista → por camión motriz activo sobre
 *     `camiones_sin_cobro_por_transportista`, con la tarifa de gestión de
 *     flota si el admin la activó (`empresas.gestion_flota_activada_en`).
 * Una sola factura por empresa y mes (la aritmética es pura, en
 * `calcularCobroSuscripcionUf`). Precios en UF netos + IVA de la
 * configuración publicada; la factura captura `monto_uf` y `uf_valor_clp`
 * del día de emisión.
 *
 * Reutiliza la fila `tipo = 'membership_mensual'` y su UNIQUE parcial por
 * empresa y mes: si en el mes de la activación de v3 ya existía una factura
 * v2, cuenta como la del periodo y solo se reintenta su cobro.
 *
 * ⚠️ El rail de pago sigue stubeado (`noopMembershipPaymentGateway`): la
 * factura queda en `pending_payment_provider` hasta que exista el provider.
 */

export interface CobrarSuscripcionesUfInput {
  db: Db;
  logger: Logger;
  gateway: MembershipPaymentGateway;
  /** Valor UF de la fecha (YYYY-MM-DD) en Chile. Lanza si no hay fuente. */
  obtenerUf: (fecha: string) => Promise<ValorUfDelDia>;
  /** Configuración comercial publicada (precios y IVA). */
  leerConfiguracion: () => Promise<VersionConfiguracionComercial>;
  hoyMs?: number;
  periodoMes?: string;
  limite?: number;
}

export interface CobrarSuscripcionesUfCounts extends CobrarMembershipsCounts {
  /** Empresas evaluadas que no pagan este mes (bajo el umbral, sin rol). */
  exentas: number;
}

export interface CobrarSuscripcionesUfResult extends CobrarSuscripcionesUfCounts {
  status: 'ok';
  fechaUf: string;
  ufValorClp: number;
  ufFuente: ValorUfDelDia['fuente'];
  configuracionVersion: number;
}

const LIMITE_DEFAULT = 1000;

interface EmpresaFacturable {
  empresaId: string;
  esGeneradorCarga: boolean;
  esTransportista: boolean;
  gestionFlotaActivadaEn: Date | null;
  camionesActivos: number;
}

export async function cobrarSuscripcionesUf(
  input: CobrarSuscripcionesUfInput,
): Promise<CobrarSuscripcionesUfResult> {
  const { db, logger, gateway, hoyMs = Date.now(), limite = LIMITE_DEFAULT } = input;
  const periodoMes = input.periodoMes ?? periodoMesDesde(new Date(hoyMs));
  const fechaUf = fechaChile(hoyMs);

  // Sin configuración o sin valor UF no se factura nada: el error sube y el
  // job responde 503 para que Cloud Scheduler reintente.
  const configuracion = await input.leerConfiguracion();
  const uf = await input.obtenerUf(fechaUf);
  const { servicios, impuestos } = configuracion.config;

  const counts: CobrarSuscripcionesUfCounts = {
    periodoMes,
    evaluadas: 0,
    facturasCreadas: 0,
    reintentos: 0,
    pendingProvider: 0,
    cobradas: 0,
    morosas: 0,
    yaFacturadas: 0,
    exentas: 0,
  };

  // rls-allowlist: cron platform-wide de facturación de suscripciones.
  const filas = await db
    .select({
      empresaId: empresas.id,
      esGeneradorCarga: empresas.isGeneradorCarga,
      esTransportista: empresas.isTransportista,
      gestionFlotaActivadaEn: empresas.gestionFlotaActivadaEn,
      camionesActivos: count(vehicles.id),
    })
    .from(empresas)
    .leftJoin(
      vehicles,
      and(
        eq(vehicles.empresaId, empresas.id),
        eq(vehicles.vehicleStatus, 'activo'),
        eq(vehicles.unitCategory, 'motriz'),
      ),
    )
    .where(
      and(
        eq(empresas.status, 'activa'),
        eq(empresas.isDemo, false),
        eq(empresas.isTestUser, false),
      ),
    )
    .groupBy(empresas.id)
    .limit(limite);

  for (const empresa of filas as EmpresaFacturable[]) {
    counts.evaluadas += 1;

    // rls-allowlist: cron platform-wide, factura del periodo por empresa (idempotencia).
    const existentes = (await db
      .select({
        id: facturasBoosterClp.id,
        totalClp: facturasBoosterClp.totalClp,
        cobroEstado: facturasBoosterClp.cobroEstado,
        cobroIntentos: facturasBoosterClp.cobroIntentos,
        cobroProximoIntentoEn: facturasBoosterClp.cobroProximoIntentoEn,
      })
      .from(facturasBoosterClp)
      .where(
        and(
          eq(facturasBoosterClp.empresaDestinoId, empresa.empresaId),
          eq(facturasBoosterClp.tipo, 'membership_mensual'),
          eq(facturasBoosterClp.periodoMes, periodoMes),
        ),
      )
      .limit(1)) as FacturaPeriodoRow[];
    const existente = existentes[0];
    if (existente) {
      await reintentarFacturaExistente({
        db,
        logger,
        gateway,
        empresaId: empresa.empresaId,
        periodoMes,
        factura: existente,
        hoyMs,
        counts,
      });
      continue;
    }

    const cobro = calcularCobroSuscripcionUf({
      esGeneradorCarga: empresa.esGeneradorCarga,
      esTransportista: empresa.esTransportista,
      camionesActivos: Number(empresa.camionesActivos),
      gestionFlota: empresa.gestionFlotaActivadaEn !== null,
      precios: {
        transportistaUfCamionMes: servicios.suscripcion_transportista_uf_camion_mes,
        transportistaGestionFlotaUfCamionMes:
          servicios.suscripcion_transportista_gestion_flota_uf_camion_mes,
        generadorUfEmpresaMes: servicios.suscripcion_generador_uf_empresa_mes,
        camionesSinCobro: servicios.camiones_sin_cobro_por_transportista,
      },
      ufValorClp: uf.valorClp,
      ivaRate: impuestos.iva_pct / 100,
      hoyMs,
    });
    if (cobro.status === 'exenta') {
      counts.exentas += 1;
      continue;
    }

    let facturaId: string;
    try {
      // rls-allowlist: cron platform-wide, INSERT de la factura del periodo.
      const insertadas = await db
        .insert(facturasBoosterClp)
        .values({
          empresaDestinoId: empresa.empresaId,
          tipo: 'membership_mensual',
          periodoMes,
          subtotalClp: cobro.subtotalClp,
          ivaClp: cobro.ivaClp,
          totalClp: cobro.totalClp,
          montoUf: cobro.montoUf.toFixed(4),
          ufValorClp: cobro.ufValorClp.toFixed(2),
          status: 'pendiente',
          cobroEstado: 'pendiente_cobro',
          cobroIntentos: 0,
          venceEn: cobro.venceEn,
        })
        .returning({ id: facturasBoosterClp.id });
      const id = insertadas[0]?.id;
      if (!id) {
        throw new Error('cobrarSuscripcionesUf: INSERT factura no devolvió id');
      }
      facturaId = id;
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        counts.yaFacturadas += 1;
        logger.info(
          { empresaId: empresa.empresaId, periodoMes },
          'cobrarSuscripcionesUf: factura del periodo ya existe (idempotente)',
        );
        continue;
      }
      throw err;
    }

    counts.facturasCreadas += 1;
    for (const linea of cobro.lineas) {
      getBusinessCounter('pricing.suscripcion_facturada').add(1, { concepto: linea.concepto });
    }
    await ejecutarIntentoYActualizar({
      db,
      logger,
      gateway,
      empresaId: empresa.empresaId,
      periodoMes,
      facturaId,
      totalClp: cobro.totalClp,
      intentosPrevios: 0,
      hoyMs,
      counts,
    });
  }

  logger.info(
    {
      event: 'suscripciones_uf.cron.tick',
      ...counts,
      fechaUf,
      ufValorClp: uf.valorClp,
      ufFuente: uf.fuente,
      configuracionVersion: configuracion.version,
    },
    'cobrarSuscripcionesUf: tick completado',
  );

  return {
    status: 'ok',
    ...counts,
    fechaUf,
    ufValorClp: uf.valorClp,
    ufFuente: uf.fuente,
    configuracionVersion: configuracion.version,
  };
}

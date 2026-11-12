import {
  ArtefactoYaSubidoError,
  emitirCertificado,
  generarPdfBase,
  rutaPdfCertificado,
} from '@booster-ai/certificate-generator';
import type { Logger } from '@booster-ai/logger';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tripEvents, tripMetrics, trips, users } from '../db/schema.js';
import {
  VersionVigenteCambioError,
  crearVersionEnTx,
  obtenerVigente,
  siguienteVersion,
} from './certificados-versionados.js';
import {
  type DatosEmisionCertificado,
  type EmitirCertificadoConfig,
  armarDatosEmision,
} from './emitir-certificado-viaje.js';

/**
 * Reemisión de un certificado emitido (`.specs/reemision-certificado/` §3).
 *
 * Corrige cómo se presenta un cálculo, no el cálculo: las emisiones impresas
 * no cambian. En este orden:
 *
 *   1. comprueba que la corrección corresponde al dato guardado y que el dato
 *      nuevo cuadra con el resto de la fila;
 *   2. genera el PDF con el dato corregido, en memoria;
 *   3. lo firma y lo sube a la ruta de su versión, sin tocar la anterior ni
 *      pisar un objeto que ya exista;
 *   4. en una transacción: corrige el dato con guarda sobre el valor
 *      anterior, registra la versión nueva (la anterior queda `reemplazado`)
 *      y deja el evento del viaje.
 *
 * Si 2 o 3 fallan, la base no cambia. Si la base cambió entre la lectura y
 * la transacción, la transacción se deshace y el PDF subido queda huérfano
 * en el bucket (spec §9); nunca una versión sin PDF.
 */

/**
 * Lista cerrada de motivos (spec §3.4). Vive en el generador, que imprime el
 * texto de cada uno; `ck_certificados_viaje_motivo` la repite en la base.
 */
export { MOTIVOS_REEMISION, type MotivoReemision } from '@booster-ai/certificate-generator';

/**
 * El factor de emisión guardado (y por lo tanto impreso) no es el que se usó
 * para calcular las emisiones (hallazgo del 2026-11-11, #926).
 */
export interface CorreccionFactor {
  readonly motivo: 'factor_impreso_no_corresponde';
  readonly factorAnterior: number;
  readonly factorNuevo: number;
}

export type CodigoNoReemitido =
  | 'config_missing'
  | 'trip_not_found'
  | 'trip_not_delivered'
  | 'certificate_not_issued'
  | 'sin_version_vigente'
  | 'vigente_inconsistente'
  | 'correccion_no_corresponde'
  | 'correccion_no_explica_cifra'
  | 'datos_insuficientes'
  | 'solicitante_no_existe'
  | 'no_shipper'
  | 'ruta_sin_huella';

export type ResultadoReemision =
  | {
      readonly ok: true;
      readonly version: number;
      readonly certificadoId: string;
      readonly sha256Anterior: string;
      readonly sha256Nuevo: string;
      readonly pdfUri: string;
    }
  | { readonly ok: false; readonly code: CodigoNoReemitido; readonly detalle?: string };

/** La base cambió mientras se generaba el PDF: no se registró nada. */
export class ReemisionConcurrenteError extends Error {}

/** `metricas_viaje.factor_emision_usado` es numeric(8,5). */
const ESCALA_FACTOR = 100_000;
const comoFactor = (n: number) => Math.round(n * ESCALA_FACTOR) / ESCALA_FACTOR;
const textoFactor = (n: number) => comoFactor(n).toFixed(5);

/**
 * ¿El factor explica la cifra impresa? Los litros se guardan con 2 decimales
 * y las emisiones con 3: la diferencia tolerada es la que deja ese redondeo.
 */
function explicaLaCifra(litros: number, emisionesKg: number, factor: number): boolean {
  const tolerancia = 0.005 * factor + 0.0005;
  return Math.abs(litros * factor - emisionesKg) <= tolerancia;
}

const numOrNull = (v: string | null): number | null => {
  if (v === null) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Lo que la reemisión va a hacer, ya comprobado; aún sin firmar ni escribir. */
export interface PlanReemision {
  readonly trip: typeof trips.$inferSelect;
  readonly metrics: typeof tripMetrics.$inferSelect;
  readonly vigente: NonNullable<Awaited<ReturnType<typeof obtenerVigente>>>;
  readonly versionNueva: number;
  readonly factorNuevoTexto: string;
  readonly litros: number;
  readonly emisiones: number;
  /** Datos del PDF con el factor corregido y la línea de reemplazo. */
  readonly datos: DatosEmisionCertificado;
}

type Preparacion =
  | { readonly ok: true; readonly plan: PlanReemision }
  | Extract<ResultadoReemision, { ok: false }>;

interface ParametrosReemision {
  readonly db: Db;
  readonly logger: Logger;
  readonly tripId: string;
  readonly correccion: CorreccionFactor;
  readonly solicitadoPorUserId: string | null;
}

const noReemitidoCon =
  (logger: Logger, tripId: string) =>
  (code: CodigoNoReemitido, detalle?: string): Extract<ResultadoReemision, { ok: false }> => {
    logger.warn({ tripId, code, detalle }, 'reemisión de certificado no realizada');
    return { ok: false, code, ...(detalle ? { detalle } : {}) };
  };

/**
 * Pasos (1) y armado de (2): todas las comprobaciones y los datos del PDF.
 * Solo lee. La usan la reemisión y la corrida en seco, para que las dos
 * comprueben exactamente lo mismo.
 */
export async function prepararReemision(opts: ParametrosReemision): Promise<Preparacion> {
  const { db, logger, tripId, correccion, solicitadoPorUserId } = opts;
  const noReemitido = noReemitidoCon(logger, tripId);

  // rls-allowlist: reemisión de plataforma scoped por tripId (job manual del PO)
  const [trip] = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  if (!trip) {
    return noReemitido('trip_not_found');
  }
  if (trip.status !== 'entregado') {
    return noReemitido('trip_not_delivered');
  }
  // rls-allowlist: métricas del viaje ya leído por tripId
  const [metrics] = await db
    .select()
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  if (!metrics?.certificateIssuedAt || !metrics.certificateSha256) {
    return noReemitido('certificate_not_issued');
  }

  const vigente = await obtenerVigente(db, tripId);
  if (!vigente) {
    return noReemitido('sin_version_vigente');
  }
  if (vigente.id !== metrics.certificadoVigenteId || vigente.sha256 !== metrics.certificateSha256) {
    return noReemitido(
      'vigente_inconsistente',
      'la versión vigente no es la que espejan las métricas del viaje',
    );
  }

  // (1) La corrección corresponde al dato guardado y lo explica.
  const factorGuardado = numOrNull(metrics.emissionFactorUsed);
  if (
    factorGuardado === null ||
    comoFactor(factorGuardado) !== comoFactor(correccion.factorAnterior)
  ) {
    return noReemitido(
      'correccion_no_corresponde',
      `el factor guardado es ${metrics.emissionFactorUsed ?? 'nulo'}, no ${textoFactor(correccion.factorAnterior)}`,
    );
  }
  if (comoFactor(correccion.factorNuevo) === comoFactor(correccion.factorAnterior)) {
    return noReemitido('correccion_no_corresponde', 'el factor nuevo es igual al anterior');
  }
  const litros =
    numOrNull(metrics.fuelConsumedLActual) ?? numOrNull(metrics.fuelConsumedLEstimated);
  const emisiones =
    numOrNull(metrics.carbonEmissionsKgco2eActual) ??
    numOrNull(metrics.carbonEmissionsKgco2eEstimated);
  if (litros === null || emisiones === null) {
    return noReemitido('datos_insuficientes', 'faltan litros o emisiones para comprobar el factor');
  }
  if (!explicaLaCifra(litros, emisiones, correccion.factorNuevo)) {
    return noReemitido(
      'correccion_no_explica_cifra',
      `${litros} L × ${textoFactor(correccion.factorNuevo)} no da ${emisiones} kg CO₂e`,
    );
  }

  // (2) y (3) Generar, firmar y subir con el dato corregido, sin tocar la base.
  const factorNuevoTexto = textoFactor(correccion.factorNuevo);
  const armado = await armarDatosEmision({
    db,
    logger,
    trip,
    metrics: { ...metrics, emissionFactorUsed: factorNuevoTexto },
  });
  if (!armado.ok) {
    return noReemitido(armado.reason);
  }
  // El número sale de la mayor versión registrada, no de la vigente: después
  // de una reversa la vigente es la 1 pero la 2 ya tiene su PDF en el bucket.
  const versionNueva = await siguienteVersion(db, tripId);

  // El solicitante queda en el evento (FK a usuarios): si no existe, la
  // transacción fallaría después de firmar y subir. Se comprueba antes.
  if (solicitadoPorUserId !== null) {
    const [solicitante] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, solicitadoPorUserId))
      .limit(1);
    if (!solicitante) {
      return noReemitido(
        'solicitante_no_existe',
        `no hay un usuario con id ${solicitadoPorUserId}`,
      );
    }
  }

  return {
    ok: true,
    plan: {
      trip,
      metrics,
      vigente,
      versionNueva,
      factorNuevoTexto,
      litros,
      emisiones,
      // El certificado dice a qué versión reemplaza, de cuándo y por qué
      // (spec §8-2). Reemplaza a la vigente, que tras una reversa puede no
      // ser la de número anterior.
      datos: {
        ...armado.datos,
        viaje: {
          ...armado.datos.viaje,
          version: {
            numero: versionNueva,
            reemplazaA: vigente.version,
            reemplazaEmitidoEn: vigente.emitidoEn,
            motivo: correccion.motivo,
          },
        },
      },
    },
  };
}

export async function reemitirCertificado(
  opts: ParametrosReemision & { readonly config: Partial<EmitirCertificadoConfig> },
): Promise<ResultadoReemision> {
  const { db, logger, tripId, correccion, solicitadoPorUserId, config } = opts;
  if (!config.kmsKeyId || !config.certificatesBucket || !config.verifyBaseUrl) {
    return noReemitidoCon(logger, tripId)('config_missing');
  }
  const preparada = await prepararReemision(opts);
  if (!preparada.ok) {
    return preparada;
  }
  const { metrics, vigente, versionNueva, factorNuevoTexto, datos } = preparada.plan;

  // (2) y (3) Generar, firmar y subir con el dato corregido, sin tocar la base.
  let result: Awaited<ReturnType<typeof emitirCertificado>>;
  try {
    result = await emitirCertificado({
      ...datos,
      infra: { kmsKeyId: config.kmsKeyId, certificatesBucket: config.certificatesBucket },
      verifyBaseUrl: config.verifyBaseUrl,
      version: versionNueva,
    });
  } catch (err) {
    if (err instanceof ArtefactoYaSubidoError) {
      // Otra reemisión subió esa versión primero; la subida no la pisa.
      logger.error(
        { tripId, versionNueva, ruta: err.ruta },
        'reemisión no realizada: el PDF de esa versión ya estaba en el bucket',
      );
      throw new ReemisionConcurrenteError(err.message);
    }
    throw err;
  }

  // (4) Corregir, versionar y dejar el evento, todo o nada.
  try {
    const creada = await db.transaction(async (tx) => {
      // rls-allowlist: métricas del viaje ya leído por tripId; guarda sobre el factor anterior
      const corregidas = await tx
        .update(tripMetrics)
        .set({ emissionFactorUsed: factorNuevoTexto })
        .where(
          and(
            eq(tripMetrics.tripId, tripId),
            eq(tripMetrics.emissionFactorUsed, textoFactor(correccion.factorAnterior)),
            eq(tripMetrics.certificateSha256, vigente.sha256),
          ),
        )
        .returning({ tripId: tripMetrics.tripId });
      if (corregidas.length !== 1) {
        throw new ReemisionConcurrenteError(
          `las métricas del viaje ${tripId} cambiaron mientras se generaba el PDF`,
        );
      }
      const nueva = await crearVersionEnTx(
        tx,
        {
          tripId,
          sha256: result.pdfSha256,
          pdfUrl: result.pdfGcsUri,
          kmsVersion: result.kmsKeyVersion,
          emitidoEn: result.issuedAt,
          fuenteDistancia: metrics.fuenteDistancia,
          motivoFallback: metrics.motivoFallback,
          decisionVersion: metrics.decisionVersion,
        },
        correccion.motivo,
        vigente.id,
      );
      if (nueva.version !== versionNueva) {
        throw new ReemisionConcurrenteError(
          `la versión registrada (${nueva.version}) no es la del PDF subido (${versionNueva})`,
        );
      }
      await tx.insert(tripEvents).values({
        tripId,
        eventType: 'certificado_reemitido',
        source: 'sistema',
        recordedByUserId: solicitadoPorUserId,
        payload: {
          motivo: correccion.motivo,
          version_anterior: vigente.version,
          version_nueva: nueva.version,
          sha256_anterior: vigente.sha256,
          sha256_nuevo: result.pdfSha256,
          pdf_uri: result.pdfGcsUri,
          correccion: {
            factor_emision_usado: {
              anterior: comoFactor(correccion.factorAnterior),
              nuevo: comoFactor(correccion.factorNuevo),
            },
          },
        },
      });
      return nueva;
    });

    logger.info(
      {
        tripId,
        motivo: correccion.motivo,
        versionAnterior: vigente.version,
        versionNueva: creada.version,
        pdfSha256: result.pdfSha256,
      },
      'certificado reemitido',
    );
    return {
      ok: true,
      version: creada.version,
      certificadoId: creada.id,
      sha256Anterior: vigente.sha256,
      sha256Nuevo: result.pdfSha256,
      pdfUri: result.pdfGcsUri,
    };
  } catch (err) {
    const concurrente =
      err instanceof ReemisionConcurrenteError || err instanceof VersionVigenteCambioError;
    if (concurrente) {
      logger.error(
        { tripId, pdfHuerfano: result.pdfGcsUri },
        'reemisión deshecha: la base cambió; el PDF subido queda huérfano en el bucket',
      );
      throw err instanceof ReemisionConcurrenteError
        ? err
        : new ReemisionConcurrenteError(err.message);
    }
    throw err;
  }
}

/** Lo que informa la corrida en seco: la reemisión que haría, sin firmar ni escribir. */
export type ResultadoSimulacion =
  | {
      readonly ok: true;
      readonly tripId: string;
      readonly versionVigente: number;
      readonly versionNueva: number;
      readonly sha256Vigente: string;
      readonly rutaPdf: string;
      readonly factorAnterior: number;
      readonly factorNuevo: number;
      readonly litros: number;
      readonly emisionesKg: number;
      /** Tamaño del PDF generado en memoria, sin firma: la plantilla lo aceptó. */
      readonly pdfBytes: number;
    }
  | Extract<ResultadoReemision, { ok: false }>;

/**
 * Corrida en seco (spec §3.5): las mismas comprobaciones que la reemisión y
 * el PDF generado en memoria, sin firmar, sin subir y sin escribir en la base.
 */
export async function simularReemision(
  opts: ParametrosReemision & { readonly verifyBaseUrl: string },
): Promise<ResultadoSimulacion> {
  const preparada = await prepararReemision(opts);
  if (!preparada.ok) {
    return preparada;
  }
  const { trip, vigente, versionNueva, litros, emisiones, datos } = preparada.plan;
  const pdf = await generarPdfBase({
    viaje: datos.viaje,
    metricas: datos.metricas,
    empresaShipper: datos.empresaShipper,
    ...(datos.transportista ? { transportista: datos.transportista } : {}),
    verifyUrl: `${opts.verifyBaseUrl.replace(/\/$/, '')}/certificates/${trip.trackingCode}/verify`,
  });
  return {
    ok: true,
    tripId: trip.id,
    versionVigente: vigente.version,
    versionNueva,
    sha256Vigente: vigente.sha256,
    rutaPdf: rutaPdfCertificado({
      empresaId: datos.empresaShipper.id,
      trackingCode: trip.trackingCode,
      version: versionNueva,
    }),
    factorAnterior: comoFactor(opts.correccion.factorAnterior),
    factorNuevo: comoFactor(opts.correccion.factorNuevo),
    litros,
    emisionesKg: emisiones,
    pdfBytes: pdf.length,
  };
}

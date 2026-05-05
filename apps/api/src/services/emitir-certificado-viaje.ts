/**
 * Emisión de certificados de huella de carbono firmados con KMS + PAdES.
 *
 * Disparo: fire-and-forget post-commit cuando un viaje pasa a 'entregado'
 * (ya sea por confirmación del shipper o del carrier — ver
 * `confirmar-entrega-viaje.ts`).
 *
 * Idempotente: si el certificado ya fue emitido (certificateIssuedAt
 * notNull), retorna {skipped:true, reason:'already_issued'} sin volver a
 * firmar. Esto es importante porque:
 *   - Si shipper Y carrier marcan entregado en la misma ventana, ambos
 *     disparan el wire y el segundo encuentra el cert ya emitido.
 *   - Si reintentamos manualmente desde un job de backfill, no
 *     duplicamos.
 *
 * Precondiciones que validamos antes de emitir:
 *   1. trip existe y status='entregado'.
 *   2. tripMetrics existe con métricas calculadas (carbon_emissions_*
 *      no null). Sin métricas no hay datos para el certificado.
 *   3. certificateIssuedAt = null (no emitido todavía).
 *   4. Config (kmsKeyId + bucket) presente. Si falta, skip con warn.
 *
 * Errores:
 *   - Cualquier fallo en KMS, GCS o la generación del PDF se loggea pero
 *     NO throwea — es fire-and-forget. El cert quedará pendiente y un
 *     job de backfill (P2.f) lo retoma después.
 */

import { emitirCertificado } from '@booster-ai/certificate-generator';
import type { Logger } from '@booster-ai/logger';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, empresas, tripEvents, tripMetrics, trips, vehicles } from '../db/schema.js';

export interface EmitirCertificadoConfig {
  /** Resource ID de la KMS key (sin :versions). */
  kmsKeyId: string;
  /** Nombre del bucket GCS donde subir el PDF + sidecar. */
  certificatesBucket: string;
  /**
   * Base URL del api público para construir el verifyUrl que va dentro
   * del PDF y del sidecar. Sin trailing slash. Ej:
   * 'https://api.boosterchile.com'.
   */
  verifyBaseUrl: string;
}

export type EmitirResult =
  | {
      skipped: true;
      reason:
        | 'config_missing'
        | 'trip_not_found'
        | 'trip_not_delivered'
        | 'metrics_missing'
        | 'already_issued'
        | 'no_shipper';
    }
  | {
      skipped: false;
      pdfGcsUri: string;
      sigGcsUri: string;
      pdfSha256: string;
      kmsKeyVersion: string;
      issuedAt: Date;
      pdfBytes: number;
    };

export async function emitirCertificadoViaje(opts: {
  db: Db;
  logger: Logger;
  tripId: string;
  config: Partial<EmitirCertificadoConfig>;
}): Promise<EmitirResult> {
  const { db, logger, tripId, config } = opts;

  // (1) Config — sin esto no podemos firmar. En dev con env vars vacías
  // skipeamos con warn; en prod Terraform las inyecta siempre.
  if (!config.kmsKeyId || !config.certificatesBucket || !config.verifyBaseUrl) {
    logger.warn(
      { tripId, hasKey: !!config.kmsKeyId, hasBucket: !!config.certificatesBucket },
      'emitirCertificadoViaje skipped: config incompleto (KMS_KEY_ID o CERTIFICATES_BUCKET ausentes)',
    );
    return { skipped: true, reason: 'config_missing' };
  }

  // (2) Cargar trip + métricas + assignment + vehicle + empresas en una
  // sola tx read-only. El UPDATE final va en una tx separada para
  // mantener el read-side rápido y permitir retry idempotente.
  const tripRows = await db.select().from(trips).where(eq(trips.id, tripId)).limit(1);
  const trip = tripRows[0];
  if (!trip) {
    return { skipped: true, reason: 'trip_not_found' };
  }
  if (trip.status !== 'entregado') {
    return { skipped: true, reason: 'trip_not_delivered' };
  }

  const metricsRows = await db
    .select()
    .from(tripMetrics)
    .where(eq(tripMetrics.tripId, tripId))
    .limit(1);
  const metrics = metricsRows[0];
  if (!metrics) {
    return { skipped: true, reason: 'metrics_missing' };
  }
  if (metrics.certificateIssuedAt) {
    // Ya emitido. Idempotente: retornamos como skipped pero loggeamos
    // info (no warn) porque es esperado en escenarios de double-trigger.
    logger.info(
      { tripId, issuedAt: metrics.certificateIssuedAt },
      'emitirCertificadoViaje skipped: certificado ya emitido (idempotente)',
    );
    return { skipped: true, reason: 'already_issued' };
  }

  // generadorCargaEmpresaId es nullable en el schema — los trips de
  // WhatsApp anonymous (pre-binding) lo tienen null. El cert necesita la
  // identidad del shipper para incluirlo en el PDF y firmar, así que
  // skippeamos defensivamente. En el lifecycle actual esto no debería
  // ocurrir post-entrega (el binding ya está hecho), pero el guard cuesta
  // poco y deja el invariante explícito.
  if (!trip.generadorCargaEmpresaId) {
    logger.warn(
      { tripId },
      'emitirCertificadoViaje skipped: trip sin shipper (anonymous WhatsApp pre-binding)',
    );
    return { skipped: true, reason: 'no_shipper' };
  }

  // Empresa shipper (siempre existe — el trip lo creó).
  const shipperRows = await db
    .select({
      id: empresas.id,
      legalName: empresas.legalName,
      rut: empresas.rut,
    })
    .from(empresas)
    .where(eq(empresas.id, trip.generadorCargaEmpresaId))
    .limit(1);
  const shipper = shipperRows[0];
  if (!shipper) {
    // No debería pasar — FK garantiza referencia. Si pasa, log error y
    // skip (el cert no se puede emitir sin identidad del shipper).
    logger.error(
      { tripId, generadorCargaEmpresaId: trip.generadorCargaEmpresaId },
      'emitirCertificadoViaje: empresa shipper no encontrada (FK rota?)',
    );
    return { skipped: true, reason: 'trip_not_found' };
  }

  // Assignment + transportista + vehicle (opcionales — el cert puede
  // emitirse sin transportista en escenarios de prueba, pero
  // normalmente está presente cuando trip='entregado').
  const assignmentRows = await db
    .select({
      empresaId: assignments.empresaId,
      vehicleId: assignments.vehicleId,
    })
    .from(assignments)
    .where(eq(assignments.tripId, tripId))
    .limit(1);
  const assignment = assignmentRows[0];

  let transportistaLegalName: string | null = null;
  let transportistaRut: string | null = null;
  let vehiclePlate: string | null = null;

  if (assignment) {
    const carrierRows = await db
      .select({
        legalName: empresas.legalName,
        rut: empresas.rut,
      })
      .from(empresas)
      .where(eq(empresas.id, assignment.empresaId))
      .limit(1);
    const carrier = carrierRows[0];
    if (carrier) {
      transportistaLegalName = carrier.legalName;
      transportistaRut = carrier.rut;
    }
    if (assignment.vehicleId) {
      const vehRows = await db
        .select({ plate: vehicles.plate })
        .from(vehicles)
        .where(eq(vehicles.id, assignment.vehicleId))
        .limit(1);
      vehiclePlate = vehRows[0]?.plate ?? null;
    }
  }

  // (3) Llamar al package — la única función con I/O hacia KMS + GCS.
  const result = await emitirCertificado({
    viaje: {
      trackingCode: trip.trackingCode,
      origenDireccion: trip.originAddressRaw,
      origenRegionCode: trip.originRegionCode,
      destinoDireccion: trip.destinationAddressRaw,
      destinoRegionCode: trip.destinationRegionCode,
      cargoTipo: trip.cargoType,
      cargoPesoKg: trip.cargoWeightKg,
      pickupAt: trip.pickupWindowStart,
      // deliveredAt vive en assignments, no en trips. Si no hay
      // assignment, dejamos null (el PDF lo omite).
      deliveredAt: null,
    },
    metricas: {
      distanciaKmEstimated: numOrNull(metrics.distanceKmEstimated),
      distanciaKmActual: numOrNull(metrics.distanceKmActual),
      kgco2eWtwEstimated: numOrNull(metrics.carbonEmissionsKgco2eEstimated),
      kgco2eWtwActual: numOrNull(metrics.carbonEmissionsKgco2eActual),
      // TTW/WTT no están en el schema actual (el calculator los devuelve
      // pero no se persistieron por separado). Para v1 dejamos null —
      // el PDF muestra solo WTW. Próxima migración: agregar columns
      // emisiones_kgco2e_ttw + _wtt.
      kgco2eTtw: null,
      kgco2eWtt: null,
      combustibleConsumido:
        numOrNull(metrics.fuelConsumedLActual) ?? numOrNull(metrics.fuelConsumedLEstimated),
      combustibleUnidad: 'L', // hoy solo soportamos diésel/gasolina
      intensidadGco2ePorTonKm: null, // futuro: persistir desde calculator.intensidadGco2ePorTonKm
      precisionMethod:
        (metrics.precisionMethod as 'exacto_canbus' | 'modelado' | 'por_defecto' | null) ??
        'por_defecto',
      glecVersion: metrics.glecVersion ?? 'v3.0',
      emissionFactorUsado: numOrNull(metrics.emissionFactorUsed) ?? 0,
      fuenteFactores: 'SEC Chile 2024 + GLEC v3.0',
      calculatedAt: metrics.calculatedAt ?? new Date(),
    },
    empresaShipper: {
      id: shipper.id,
      legalName: shipper.legalName,
      rut: shipper.rut,
    },
    ...(transportistaLegalName
      ? {
          transportista: {
            legalName: transportistaLegalName,
            rut: transportistaRut,
            vehiclePlate,
          },
        }
      : {}),
    infra: {
      kmsKeyId: config.kmsKeyId,
      certificatesBucket: config.certificatesBucket,
    },
    verifyBaseUrl: config.verifyBaseUrl,
  });

  // (4) Persistir resultado + emitir tripEvent. En una tx para que ambos
  // queden o ninguno (si crashea entre el UPDATE y el INSERT, el próximo
  // re-disparo encuentra certificateIssuedAt=null y reintenta).
  await db.transaction(async (tx) => {
    await tx
      .update(tripMetrics)
      .set({
        certificatePdfUrl: result.pdfGcsUri,
        certificateSha256: result.pdfSha256,
        certificateKmsKeyVersion: result.kmsKeyVersion,
        certificateIssuedAt: result.issuedAt,
        updatedAt: sql`now()`,
      })
      .where(eq(tripMetrics.tripId, tripId));

    await tx.insert(tripEvents).values({
      tripId,
      eventType: 'certificado_emitido',
      source: 'sistema',
      payload: {
        pdf_gcs_uri: result.pdfGcsUri,
        sig_gcs_uri: result.sigGcsUri,
        pdf_sha256: result.pdfSha256,
        kms_key_version: result.kmsKeyVersion,
        pdf_bytes: result.pdfBytes,
        issued_at: result.issuedAt.toISOString(),
      },
    });
  });

  logger.info(
    {
      tripId,
      pdfSha256: result.pdfSha256,
      kmsKeyVersion: result.kmsKeyVersion,
      pdfBytes: result.pdfBytes,
    },
    'certificado de carbono emitido',
  );

  return {
    skipped: false,
    pdfGcsUri: result.pdfGcsUri,
    sigGcsUri: result.sigGcsUri,
    pdfSha256: result.pdfSha256,
    kmsKeyVersion: result.kmsKeyVersion,
    issuedAt: result.issuedAt,
    pdfBytes: result.pdfBytes,
  };
}

/**
 * Drizzle devuelve numeric como string (porque pueden exceder Number.MAX_SAFE_INTEGER).
 * Para los campos que sabemos chicos (kg CO2e, distancia), convertimos a Number.
 */
function numOrNull(v: string | null): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

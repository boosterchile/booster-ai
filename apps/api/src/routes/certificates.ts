/**
 * Endpoints sobre certificados de huella de carbono ya emitidos.
 *
 *   - GET /                       (auth shipper) — lista paginada de los
 *                                  certificados emitidos a la empresa
 *                                  shipper activa.
 *   - GET /:tracking_code/verify  (PÚBLICO, SIN AUTH) — devuelve el
 *                                  contenido del sidecar .sig + datos
 *                                  para validación externa con OpenSSL.
 *                                  No requiere ser el dueño del trip;
 *                                  cualquier auditor que tenga el código
 *                                  de tracking puede validar la firma.
 *
 * El endpoint /verify es público a propósito — el modelo de confianza es
 * "publicar lo necesario para que un tercero pueda matemáticamente
 * verificar la firma sin involucrar a Booster". Esto es la garantía ESG
 * típica: el certificado es self-contained.
 *
 * El download del PDF (signed URL) vive en trip-requests-v2.ts porque
 * naturalmente pertenece al namespace shipper-owned.
 */

import { descargarSidecar } from '@booster-ai/certificate-generator';
import type { Logger } from '@booster-ai/logger';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Db } from '../db/client.js';
import { tripMetrics, trips } from '../db/schema.js';
import type { EmitirCertificadoConfig } from '../services/emitir-certificado-viaje.js';

export function createCertificatesRoutes(opts: {
  db: Db;
  logger: Logger;
  certConfig?: Partial<EmitirCertificadoConfig>;
}) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireShipperAuth(c: Context<any, any, any>) {
    const userContext = c.get('userContext');
    if (!userContext) {
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    if (!active.empresa.isGeneradorCarga) {
      return {
        ok: false as const,
        response: c.json({ error: 'not_a_shipper', code: 'not_a_shipper' }, 403),
      };
    }
    return { ok: true as const, userContext, activeMembership: active };
  }

  // ---------------------------------------------------------------------
  // GET / — listado de certificados emitidos a la empresa shipper activa.
  //
  // Filtros: por defecto solo certificados ya emitidos (issued_at notNull).
  // Orden: descendente por fecha de emisión (los más recientes primero).
  // Paginación simple via limit + offset (cap 100).
  //
  // Por qué no incluir aquí los datos del PDF (download URL): cada signed
  // URL tiene TTL 5 min. Si el listado tiene 100 entries, no tiene sentido
  // generar 100 URLs upfront — la mayoría expirarían sin uso. El frontend
  // pide la URL con GET /trip-requests-v2/:id/certificate/download cuando
  // el usuario realmente click "descargar".
  // ---------------------------------------------------------------------
  app.get('/', async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const empresaId = auth.activeMembership.empresa.id;

    const limitRaw = Number(c.req.query('limit') ?? '50');
    const offsetRaw = Number(c.req.query('offset') ?? '0');
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const rows = await opts.db
      .select({
        tripId: trips.id,
        trackingCode: trips.trackingCode,
        originAddress: trips.originAddressRaw,
        destinationAddress: trips.destinationAddressRaw,
        cargoType: trips.cargoType,
        kgco2eEstimated: tripMetrics.carbonEmissionsKgco2eEstimated,
        kgco2eActual: tripMetrics.carbonEmissionsKgco2eActual,
        distanceKmEstimated: tripMetrics.distanceKmEstimated,
        distanceKmActual: tripMetrics.distanceKmActual,
        precisionMethod: tripMetrics.precisionMethod,
        glecVersion: tripMetrics.glecVersion,
        certificateSha256: tripMetrics.certificateSha256,
        certificateKmsKeyVersion: tripMetrics.certificateKmsKeyVersion,
        certificateIssuedAt: tripMetrics.certificateIssuedAt,
      })
      .from(tripMetrics)
      .innerJoin(trips, eq(trips.id, tripMetrics.tripId))
      .where(
        and(
          eq(trips.generadorCargaEmpresaId, empresaId),
          isNotNull(tripMetrics.certificateIssuedAt),
        ),
      )
      .orderBy(desc(tripMetrics.certificateIssuedAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      certificates: rows.map((r) => ({
        trip_id: r.tripId,
        tracking_code: r.trackingCode,
        origin_address: r.originAddress,
        destination_address: r.destinationAddress,
        cargo_type: r.cargoType,
        // El "real" sobreescribe al "estimado" si existe — es lo que el
        // frontend muestra como kg CO2e canónico.
        kg_co2e: r.kgco2eActual ?? r.kgco2eEstimated,
        distance_km: r.distanceKmActual ?? r.distanceKmEstimated,
        precision_method: r.precisionMethod,
        glec_version: r.glecVersion,
        certificate_sha256: r.certificateSha256,
        certificate_kms_key_version: r.certificateKmsKeyVersion,
        certificate_issued_at: r.certificateIssuedAt,
      })),
      pagination: { limit, offset, returned: rows.length },
    });
  });

  // ---------------------------------------------------------------------
  // GET /:tracking_code/verify — endpoint PÚBLICO de validación.
  //
  // Sin auth — cualquier auditor con el código BOO-XXXXXX puede validar
  // la firma sin necesidad de credenciales. Devuelve el sidecar JSON
  // que generamos al firmar (incluye sha256 del PDF, firma raw en
  // base64, public key PEM, key version, signed time).
  //
  // El validador externo verifica con:
  //   openssl dgst -sha256 -verify pubkey.pem \
  //     -signature signature.bin certificado.pdf
  //
  // Se publica sin rate-limiting agresivo porque el cost por request es
  // bajo (1 GCS download de un JSON ~3KB) y el caso de uso es
  // legítimo (auditores ESG, reguladores, clientes finales).
  //
  // 404 si el tracking_code no existe o el cert todavía no fue emitido.
  // ---------------------------------------------------------------------
  app.get('/:tracking_code/verify', async (c) => {
    const trackingCode = c.req.param('tracking_code');

    if (!opts.certConfig?.certificatesBucket) {
      return c.json(
        { error: 'certificates_disabled', code: 'certificates_disabled' },
        503,
      );
    }

    // Lookup por tracking_code → trip + empresa_id (necesitamos el path
    // de GCS que está bajo certificates/{empresa_id}/{tracking}.pdf.sig).
    const tripRows = await opts.db
      .select({
        empresaId: trips.generadorCargaEmpresaId,
        certificateIssuedAt: tripMetrics.certificateIssuedAt,
      })
      .from(trips)
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
      .where(eq(trips.trackingCode, trackingCode))
      .limit(1);
    const trip = tripRows[0];
    if (!trip) {
      return c.json(
        { error: 'tracking_code_not_found', code: 'tracking_code_not_found' },
        404,
      );
    }
    if (!trip.certificateIssuedAt) {
      return c.json(
        {
          error: 'certificate_not_issued',
          code: 'certificate_not_issued',
        },
        404,
      );
    }
    if (!trip.empresaId) {
      // Edge: trip sin shipper (anonymous WhatsApp). No debería tener
      // cert (el servicio skipea), pero defensivo.
      return c.json(
        { error: 'certificate_not_issued', code: 'certificate_not_issued' },
        404,
      );
    }

    // Descargar sidecar JSON desde GCS.
    const sidecar = await descargarSidecar({
      bucket: opts.certConfig.certificatesBucket,
      empresaId: trip.empresaId,
      trackingCode,
    });
    if (!sidecar) {
      // Inconsistencia: DB dice emitido pero el archivo no está en GCS.
      // Loggeamos para que un humano investigue (¿bucket mal seteado?
      // ¿borrado manual?).
      opts.logger.error(
        { trackingCode, empresaId: trip.empresaId },
        '/certificates/:tracking/verify: sidecar no encontrado en GCS pese a issued_at notNull',
      );
      return c.json(
        { error: 'certificate_artifacts_missing', code: 'certificate_artifacts_missing' },
        500,
      );
    }

    return c.json({
      valid: true,
      tracking_code: sidecar.trackingCode,
      signed_at: sidecar.signedAt,
      algorithm: sidecar.algorithm,
      kms_key_id: sidecar.kmsKeyId,
      kms_key_version: sidecar.kmsKeyVersion,
      pdf_sha256: sidecar.pdfSha256,
      signature_b64: sidecar.signatureB64,
      cert_pem: sidecar.certPem,
      verify_url: sidecar.verifyUrl,
      // Hint para auditores manuales: cómo validar offline con OpenSSL.
      verification_hint:
        'openssl dgst -sha256 -verify <(echo "$cert_pem" | openssl x509 -pubkey -noout) -signature <(echo "$signature_b64" | base64 -d) certificate.pdf',
    });
  });

  return app;
}

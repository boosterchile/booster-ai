import { generarSignedUrlPdf } from '@booster-ai/certificate-generator';
import type { Logger } from '@booster-ai/logger';
import {
  MENSAJES,
  abrirDisputaSchema,
  cambioPropuestoSchema,
  datosLibresInputSchema,
  errorOpcion,
  puedeCancelarCarga,
  puedePublicarCarga,
  tripRequestCreateInputSchema,
  tripRequestEditInputSchema,
} from '@booster-ai/shared-schemas';
import {
  aceptaDatosLibres,
  aceptaSolicitudCambio,
  esAnulablePorGenerador,
  esCancelablePostMatch,
  esEditablePreMatch,
  esEstadoViaje,
} from '@booster-ai/trip-state-machine';
import { and, asc, desc, eq, isNull, not, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import { ctxDeUserContext, denegarEditarCarga, denegarPublicarCarga } from '../auth/capacidades.js';
import { config as appConfig } from '../config.js';
import type { Db } from '../db/client.js';
import {
  assignments,
  configuracionComercial,
  empresas as empresasTable,
  offers,
  tripEvents,
  tripMetrics,
  trips,
  users as usersTable,
  vehicles,
} from '../db/schema.js';
import { ROLES_COMERCIALES, exigirRol } from '../lib/exigir-rol.js';
import { issuesPublicos, zValidator } from '../lib/validation.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { desglosePropuesto, leerComercialViaje } from '../services/cambio-carga-comercial.js';
import { cambiaComercial } from '../services/cambio-carga-valores.js';
import { cancelarCarga } from '../services/cancelar-carga.js';
import type { LectorConfiguracionComercial } from '../services/configuracion-comercial.js';
import {
  type DocumentClosePolicy,
  confirmarEntregaViaje,
} from '../services/confirmar-entrega-viaje.js';
import { completarCoordenadasPropuesta } from '../services/coordenadas-propuesta.js';
import {
  type DesgloseGenerador,
  desgloseParaGenerador,
  modalidadPermitida,
  tasaParaPublicacion,
} from '../services/cotizacion-comercial.js';
import { editarCargaPreMatch } from '../services/editar-carga.js';
import { editarDatosLibres } from '../services/editar-datos-libres.js';
import type { EmitirCertificadoConfig } from '../services/emitir-certificado-viaje.js';
import { geocodificarOrigen } from '../services/geocodificar-origen.js';
import { computeLiveTracking } from '../services/get-public-tracking.js';
import { filasListaUnicas, serializarFilaLista } from '../services/inicio-viaje-lista.js';
import { lineaMetodoDesdeMetricas } from '../services/linea-metodo-metricas.js';
import { liquidarTrip } from '../services/liquidar-trip.js';
import {
  type PagoViajeVista,
  abrirDisputa,
  leerPagoDelGenerador,
  registrarRecepcionConforme,
} from '../services/mandato-cobro/eventos-pago.js';
import type { RankeadorMatching } from '../services/matching-ranking.js';
import { TripRequestNotFoundError, runMatching } from '../services/matching.js';
import { notifyCambioCarga } from '../services/notify-cambio-carga.js';
import type { NotifyOfferDeps } from '../services/notify-offer.js';
import {
  type NotifyTrackingLinkDeps,
  reenviarTrackingLinkADestinatario,
} from '../services/notify-tracking-link.js';
import type { LivePositionSource } from '../services/posicion-en-vivo.js';
import { resolverEnlaceMapa } from '../services/resolver-enlace-mapa.js';
import {
  type SolicitudVista,
  crearSolicitudCambio,
  listarSolicitudesCambio,
  retirarSolicitudCambio,
  solicitudPendienteDeViaje,
} from '../services/solicitud-cambio-carga.js';
import { valoresViajeDesdeInput } from '../services/valores-viaje.js';

/**
 * Endpoint canónico para que un generador de carga autenticado:
 *   - cree un viaje (POST /) y dispare matching automático
 *   - liste sus viajes (GET /)
 *   - vea el detalle de uno (GET /:id) con eventos, asignación y métricas
 *   - cancele uno pre-asignación (PATCH /:id/cancelar)
 *
 * URL `/trip-requests-v2` se mantiene por compat con el cliente web actual;
 * internamente la tabla es `viajes`.
 *
 * Multi-tenant: todos los reads y writes filtran por
 * `activeMembership.empresa.id` contra `generadorCargaEmpresaId`. Un shipper
 * jamás ve cargas de otra empresa.
 */
/** numeric(10,7) como string, el modo en que Drizzle persiste el tipo. */
function puntoNumerico(
  latitude: number | undefined,
  longitude: number | undefined,
): { latitude: string; longitude: string } | null {
  if (latitude === undefined || longitude === undefined) {
    return null;
  }
  return { latitude: latitude.toFixed(7), longitude: longitude.toFixed(7) };
}

function generateTrackingCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `BOO-${suffix}`;
}

// Cancelable pre-asignación: lo decide la tabla de transiciones del
// package (esAnulablePorGenerador — ADR-061). Una vez `asignado` o
// posterior, el shipper coordina con el transportista (fuera del scope).

/** ADR-079 §1 — cotización previa a publicar (query string). */
const cotizacionQuerySchema = z.object({
  precio_transportista_clp: z.coerce
    .number({ error: MENSAJES.numero })
    .int(MENSAJES.numero)
    .nonnegative(MENSAJES.numero),
  modalidad_carga: z.enum(['spot', 'programada'], { error: errorOpcion }).default('spot'),
});

const cancelBodySchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

/**
 * Métricas ESG del viaje para el detalle (ADR-077 §4): además de los campos
 * históricos, expone las tres dimensiones crudas y la línea de método derivada
 * (misma función que el PDF). Exportada para testearla sin montar la ruta.
 */
export function serializeTripMetrics(
  m: Pick<
    typeof tripMetrics.$inferSelect,
    | 'distanceKmEstimated'
    | 'distanceKmActual'
    | 'carbonEmissionsKgco2eEstimated'
    | 'carbonEmissionsKgco2eActual'
    | 'precisionMethod'
    | 'glecVersion'
    | 'routeDataSource'
    | 'coveragePct'
    | 'certificationLevel'
    | 'certificatePdfUrl'
    | 'certificateSha256'
    | 'certificateKmsKeyVersion'
    | 'certificateIssuedAt'
  >,
) {
  return {
    distance_km_estimated: m.distanceKmEstimated,
    distance_km_actual: m.distanceKmActual,
    carbon_emissions_kgco2e_estimated: m.carbonEmissionsKgco2eEstimated,
    carbon_emissions_kgco2e_actual: m.carbonEmissionsKgco2eActual,
    precision_method: m.precisionMethod,
    glec_version: m.glecVersion,
    route_data_source: m.routeDataSource,
    coverage_pct: m.coveragePct,
    certification_level: m.certificationLevel,
    linea_metodo: lineaMetodoDesdeMetricas(m),
    certificate_pdf_url: m.certificatePdfUrl,
    certificate_sha256: m.certificateSha256,
    certificate_kms_key_version: m.certificateKmsKeyVersion,
    certificate_issued_at: m.certificateIssuedAt,
  };
}

/** Pago para el generador: estados y vencimientos, sin las referencias bancarias de los eventos. */
function pagoParaGenerador(pago: PagoViajeVista): Omit<PagoViajeVista, 'eventos'> {
  const { eventos: _eventos, ...resto } = pago;
  return resto;
}

export function createTripRequestsV2Routes(opts: {
  db: Db;
  logger: Logger;
  notify?: NotifyOfferDeps;
  /** T10-21 — rankeador de matching (local, sombra o matching-engine). */
  ranking?: RankeadorMatching;
  /**
   * ADR-079 §3 — configuración comercial vigente (caché ≤ 60 s). Requerida
   * para congelar la tasa al publicar con PRICING_V3_ACTIVATED.
   */
  lectorComercial?: LectorConfiguracionComercial;
  /**
   * Config para emisión de certificados de carbono al confirmar
   * recepción. Si está parcial/ausente, el endpoint igual marca el trip
   * como entregado pero el certificado se queda pendiente (skip con
   * warn en el wire fire-and-forget). Útil para dev sin KMS.
   */
  certConfig?: Partial<EmitirCertificadoConfig>;
  /**
   * Política de cierre flexible documental (ADR-070, F4-4a). Si se provee y el
   * flag está ON, confirmar-recepcion exige ≥1 documento subido (según fecha
   * de corte). Ausente → sin precondición documental.
   */
  documentClosePolicy?: DocumentClosePolicy | undefined;
  /**
   * GCP project para Routes API (header X-Goog-User-Project, ADR-038). Si se
   * provee, al crear un viaje se geocodifica y persiste el origen (ancla del
   * geofence de recogida — plan medicion-huella-segmento, Task 4). Ausente
   * (dev sin GCP) → no se intenta; el viaje se crea igual con lat/lng NULL.
   */
  routesProjectId?: string | undefined;
  /** Inyectable en tests. En runtime es el fetch global. */
  fetchImpl?: typeof fetch;
  /**
   * editar-anular-cargas §12-P8 — deps para reenviar el link de tracking al
   * número nuevo del destinatario. Ausente → no se reenvía (dev sin Twilio).
   */
  notifyTrackingLink?: NotifyTrackingLinkDeps;
}) {
  const app = new Hono();

  function requireShipperAuth(c: Context, opts2?: { requireActive?: boolean }) {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/trip-requests-v2 without userContext');
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
    // status='activa' solo se exige para writes (POST, PATCH cancelar). Para
    // reads (GET listado, GET detalle) permitimos pendiente_verificacion: el
    // shipper puede ver su listado vacío sin chocar con un 403 confuso. Si
    // intenta crear una carga, el guard write-mode lo bloquea.
    if (opts2?.requireActive && active.empresa.status !== 'activa') {
      return {
        ok: false as const,
        response: c.json({ error: 'empresa_not_active', code: 'empresa_not_active' }, 403),
      };
    }
    return { ok: true as const, userContext, activeMembership: active };
  }

  // ---------------------------------------------------------------------
  // GET /cotizacion — ADR-079 §1: desglose que el generador ve ANTES de
  // publicar (precio del transportista + comisión + IVA = total), con la
  // configuración vigente. Solo generadores; nunca llega a transportistas.
  // ---------------------------------------------------------------------
  app.get('/cotizacion', async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    if (!appConfig.PRICING_V3_ACTIVATED || !opts.lectorComercial) {
      return c.json({ error: 'pricing_v3_disabled' }, 404);
    }
    const query = cotizacionQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'invalid_query', issues: issuesPublicos(query.error.issues) }, 400);
    }
    const contratoEn = auth.activeMembership.empresa.contratoProgramadoActivadoEn ?? null;
    if (!modalidadPermitida(query.data.modalidad_carga, contratoEn)) {
      return c.json({ error: 'contrato_programado_no_habilitado' }, 422);
    }
    const vigente = await opts.lectorComercial.obtener();
    return c.json({
      configuracion_version: vigente.version,
      programada_disponible: contratoEn !== null,
      desglose: {
        modalidad_carga: query.data.modalidad_carga,
        ...desgloseParaGenerador({
          precioTransportistaClp: query.data.precio_transportista_clp,
          comisionPct: tasaParaPublicacion(vigente.config, query.data.modalidad_carga),
          ivaPct: vigente.config.impuestos.iva_pct,
        }),
      },
    });
  });

  const resolverEnlaceBodySchema = z.object({
    texto: z.string().trim().min(1).max(500),
  });

  // ---------------------------------------------------------------------
  // POST /resolver-enlace — lat/lng de un link de Google Maps o coordenadas.
  // El browser no puede seguir maps.app.goo.gl (CORS). Solo hosts de Maps.
  // ---------------------------------------------------------------------
  app.post('/resolver-enlace', zValidator('json', resolverEnlaceBodySchema), async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    // CHEQUEOS_REEMPLAZADOS trip-requests: requireShipper no miraba el rol.
    const sinCarga = denegarPublicarCarga(c, auth.userContext);
    if (sinCarga) {
      return sinCarga;
    }
    const { texto } = c.req.valid('json');
    const resultado = await resolverEnlaceMapa({
      texto,
      fetchImpl: opts.fetchImpl ?? fetch,
      logger: opts.logger,
    });
    if (!resultado.ok) {
      return c.json({ error: 'enlace_sin_punto', motivo: resultado.motivo }, 422);
    }
    return c.json({
      latitude: resultado.punto.latitude,
      longitude: resultado.punto.longitude,
    });
  });

  // ---------------------------------------------------------------------
  // POST / — crear viaje + dispatch matching.
  // ---------------------------------------------------------------------
  app.post('/', zValidator('json', tripRequestCreateInputSchema), async (c) => {
    const auth = requireShipperAuth(c, { requireActive: true });
    if (!auth.ok) {
      return auth.response;
    }
    // CHEQUEOS_REEMPLAZADOS trip-requests: requireShipper no miraba el rol.
    const sinCarga = denegarPublicarCarga(c, auth.userContext);
    if (sinCarga) {
      return sinCarga;
    }

    const input = c.req.valid('json');

    // ADR-079 §2 — `programada` solo con contrato programado habilitado.
    const empresaGeneradora = auth.activeMembership.empresa;
    if (
      !modalidadPermitida(
        input.modalidad_carga,
        empresaGeneradora.contratoProgramadoActivadoEn ?? null,
      )
    ) {
      return c.json({ error: 'contrato_programado_no_habilitado' }, 422);
    }

    // ADR-079 §2 — con v3 activo, la tasa se congela al publicar: el total
    // que el generador ve ahora no cambia si la configuración cambia después.
    let congelado: { comisionPct: number; ivaPct: number; configuracionId: string } | null = null;
    if (appConfig.PRICING_V3_ACTIVATED) {
      if (!opts.lectorComercial) {
        opts.logger.error('PRICING_V3_ACTIVATED sin lector de configuración comercial');
        return c.json({ error: 'internal_server_error' }, 500);
      }
      const vigente = await opts.lectorComercial.obtener();
      congelado = {
        comisionPct: tasaParaPublicacion(vigente.config, input.modalidad_carga),
        ivaPct: vigente.config.impuestos.iva_pct,
        configuracionId: vigente.id,
      };
    }

    const origenPunto = puntoNumerico(input.origin.latitude, input.origin.longitude);

    const [trip] = await opts.db
      .insert(trips)
      .values({
        trackingCode: generateTrackingCode(),
        generadorCargaEmpresaId: auth.activeMembership.empresa.id,
        createdByUserId: auth.userContext.user.id,
        // editar-anular-cargas §6.1: el mismo mapeo que usa la edición (PUT).
        ...valoresViajeDesdeInput(input),
        ...(congelado
          ? {
              comisionPctAplicada: congelado.comisionPct.toFixed(2),
              configuracionComercialId: congelado.configuracionId,
            }
          : {}),
        status: 'esperando_match',
      })
      .returning();

    if (!trip) {
      opts.logger.error('insert trip returned no row');
      return c.json({ error: 'internal_server_error' }, 500);
    }

    opts.logger.info(
      {
        tripId: trip.id,
        trackingCode: trip.trackingCode,
        generadorCargaEmpresaId: trip.generadorCargaEmpresaId,
        cargoType: trip.cargoType,
        originRegion: trip.originRegionCode,
      },
      'trip created',
    );

    // Geocodificación del origen (Task 4): fuera de la transacción del INSERT,
    // awaited (acotada por el timeout de Routes API) para que el ancla del
    // geofence exista antes de que salgan las ofertas. El service degrada a
    // null y NUNCA lanza; el try/catch es defensa en profundidad — nada de lo
    // que pase acá puede convertir un viaje ya insertado en un 500.
    // El pin o la sugerencia ya traen el punto: no lo pisamos con Routes API.
    if (opts.routesProjectId && !origenPunto) {
      try {
        const origen = await geocodificarOrigen({
          db: opts.db,
          logger: opts.logger,
          tripId: trip.id,
          originAddress: input.origin.address_raw,
          destinationAddress: input.destination.address_raw,
          routesProjectId: opts.routesProjectId,
        });
        opts.logger.info(
          { tripId: trip.id, originGeocoded: origen !== null },
          'trip origin geocoding finished',
        );
      } catch (err) {
        opts.logger.error(
          { err, tripId: trip.id },
          'trip origin geocoding threw unexpectedly, trip stays without origin lat/lng',
        );
      }
    }

    let matchingResult: Awaited<ReturnType<typeof runMatching>> | null = null;
    try {
      matchingResult = await runMatching({
        db: opts.db,
        logger: opts.logger,
        tripId: trip.id,
        ...(opts.notify ? { notify: opts.notify } : {}),
        ...(opts.ranking ? { ranking: opts.ranking } : {}),
      });
    } catch (err) {
      if (err instanceof TripRequestNotFoundError) {
        opts.logger.warn({ err, tripId: trip.id }, 'matching: trip vanished');
      } else {
        opts.logger.error({ err, tripId: trip.id }, 'matching threw, leaving trip pending');
      }
    }

    return c.json(
      {
        trip_request: {
          id: trip.id,
          tracking_code: trip.trackingCode,
          status: matchingResult
            ? matchingResult.offersCreated > 0
              ? 'ofertas_enviadas'
              : 'expirado'
            : 'esperando_match',
        },
        matching: matchingResult
          ? {
              candidates_evaluated: matchingResult.candidatesEvaluated,
              offers_created: matchingResult.offersCreated,
              offer_ids: matchingResult.offers.map((o) => o.id),
            }
          : null,
        // ADR-079 §1/§5 — desglose solo para el generador (esta ruta es de
        // generador). Sin precio propuesto no hay monto que desglosar.
        ...(congelado
          ? {
              comercial:
                input.proposed_price_clp === null
                  ? null
                  : {
                      modalidad_carga: input.modalidad_carga,
                      ...desgloseParaGenerador({
                        precioTransportistaClp: input.proposed_price_clp,
                        comisionPct: congelado.comisionPct,
                        ivaPct: congelado.ivaPct,
                      }),
                    },
            }
          : {}),
      },
      201,
    );
  });

  // ---------------------------------------------------------------------
  // GET / — lista de viajes de la empresa shipper activa.
  // ---------------------------------------------------------------------
  app.get('/', async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    // LEFT JOIN tripMetrics para exponer certificate_issued_at en cada
    // item del listado — el frontend lo usa para mostrar el ícono
    // "descargar certificado" en la columna Historial sin tener que
    // hacer un GET /:id por fila.
    const rows = await opts.db
      .select({
        id: trips.id,
        tracking_code: trips.trackingCode,
        status: trips.status,
        origin_address_raw: trips.originAddressRaw,
        origin_region_code: trips.originRegionCode,
        destination_address_raw: trips.destinationAddressRaw,
        destination_region_code: trips.destinationRegionCode,
        cargo_type: trips.cargoType,
        cargo_weight_kg: trips.cargoWeightKg,
        cargo_volume_m3: trips.cargoVolumeM3,
        pickup_window_start: trips.pickupWindowStart,
        pickup_window_end: trips.pickupWindowEnd,
        proposed_price_clp: trips.proposedPriceClp,
        created_at: trips.createdAt,
        certificate_issued_at: tripMetrics.certificateIssuedAt,
        // Una sola consulta: la asignación es 1:1 con el viaje.
        // El generador ve las ofertas pendientes (Felipe, 2026-10-19 17:41 CLT).
        transportista_nombre: empresasTable.legalName,
        assignment_status: assignments.status,
        ofertas_pendientes: sql<number>`(
          select count(*)::int from ${offers}
          where ${offers.tripId} = ${trips.id} and ${offers.status} = 'pendiente'
        )`,
      })
      .from(trips)
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
      .leftJoin(assignments, eq(assignments.tripId, trips.id))
      .leftJoin(empresasTable, eq(empresasTable.id, assignments.empresaId))
      .where(
        and(
          eq(trips.generadorCargaEmpresaId, auth.activeMembership.empresa.id),
          // Las anuladas (cancelado sin asignación) salen del listado, también
          // las históricas (editar-anular-cargas §8.7, §12-P10).
          not(and(eq(trips.status, 'cancelado'), isNull(assignments.id)) ?? sql`false`),
        ),
      )
      .orderBy(desc(trips.createdAt));

    return c.json({
      trip_requests: filasListaUnicas(rows).map((row) => serializarFilaLista(row)),
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id — detalle (incluye eventos, asignación, métricas si existen).
  // ---------------------------------------------------------------------
  app.get('/:id', async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [trip] = await opts.db
      .select()
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.generadorCargaEmpresaId, empresaId)))
      .limit(1);

    if (!trip) {
      return c.json({ error: 'trip_not_found' }, 404);
    }

    // ADR-079 §1 — desglose congelado al publicar (solo trips publicados con
    // v3 activo). El IVA sale de la versión de configuración congelada.
    let comercial: (DesgloseGenerador & { modalidad_carga: string }) | null = null;
    if (
      trip.comisionPctAplicada &&
      trip.configuracionComercialId &&
      typeof trip.proposedPriceClp === 'number'
    ) {
      // rls-allowlist: configuración comercial global de plataforma (sin empresa_id); el trip ya se filtró por empresa.
      const [version] = await opts.db
        .select({ config: configuracionComercial.config })
        .from(configuracionComercial)
        .where(eq(configuracionComercial.id, trip.configuracionComercialId))
        .limit(1);
      if (version) {
        comercial = {
          modalidad_carga: trip.modalidadCarga,
          ...desgloseParaGenerador({
            precioTransportistaClp: trip.proposedPriceClp,
            comisionPct: trip.comisionPctAplicada,
            ivaPct: version.config.impuestos.iva_pct,
          }),
        };
      }
    }

    const events = await opts.db
      .select({
        id: tripEvents.id,
        event_type: tripEvents.eventType,
        source: tripEvents.source,
        payload: tripEvents.payload,
        recorded_at: tripEvents.recordedAt,
      })
      .from(tripEvents)
      .where(eq(tripEvents.tripId, id))
      .orderBy(asc(tripEvents.recordedAt));

    // §9: la edición avisa cuántas transportistas están evaluando la carga.
    const [pendientes] =
      trip.status === 'ofertas_enviadas'
        ? await opts.db
            .select({ n: sql<number>`count(*)::int` })
            .from(offers)
            .where(and(eq(offers.tripId, trip.id), eq(offers.status, 'pendiente')))
        : [{ n: 0 }];

    // Solo una carga asignada puede tener un cambio pendiente (§6.3).
    const cambioPendiente =
      trip.status === 'asignado' ? await solicitudPendienteDeViaje(opts.db, trip.id) : null;
    // ADR-079 §5: el generador ve el desglose de lo que propuso (precio o modalidad).
    const desgloseCambio =
      cambioPendiente &&
      (cambioPendiente.cambios.proposed_price_clp !== undefined ||
        cambioPendiente.cambios.modalidad_carga !== undefined)
        ? desglosePropuesto(await leerComercialViaje(opts.db, trip.id), cambioPendiente.cambios)
        : null;

    const [assignmentRow] = await opts.db
      .select({
        id: assignments.id,
        status: assignments.status,
        agreed_price_clp: assignments.agreedPriceClp,
        accepted_at: assignments.acceptedAt,
        picked_up_at: assignments.pickedUpAt,
        delivered_at: assignments.deliveredAt,
        cancelled_at: assignments.cancelledAt,
        cancelled_by_actor: assignments.cancelledByActor,
        cancellation_reason: assignments.cancellationReason,
        empresa_id: assignments.empresaId,
        empresa_legal_name: empresasTable.legalName,
        vehicle_id: assignments.vehicleId,
        vehicle_plate: vehicles.plate,
        vehicle_type: vehicles.vehicleType,
        driver_user_id: assignments.driverUserId,
        driver_name: usersTable.fullName,
        driver_phone: usersTable.phone,
        driver_whatsapp: usersTable.whatsappE164,
        // El token se acuña en el accept, sin mirar al destinatario. Si no
        // sale en este detalle, el generador no tiene enlace público cuando
        // el WhatsApp no tiene a quién escribir.
        public_tracking_token: assignments.publicTrackingToken,
      })
      .from(assignments)
      .leftJoin(empresasTable, eq(empresasTable.id, assignments.empresaId))
      .leftJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
      .leftJoin(usersTable, eq(usersTable.id, assignments.driverUserId))
      .where(eq(assignments.tripId, id))
      .limit(1);

    const [metricsRow] = await opts.db
      .select()
      .from(tripMetrics)
      .where(eq(tripMetrics.tripId, id))
      .limit(1);

    // Posición viva del viaje: misma lectura que el tracking público
    // (`computeLiveTracking`, spec tracking-live-unificado). Teltonika fresco
    // (<30 min) o, si no, GPS del móvil del conductor de ESTA asignación; solo
    // en `asignado | en_proceso` — terminado el viaje el vehículo puede estar
    // en otra carga. Sin posición fresca: ubicacion_actual/eta null.
    let ubicacionActual: {
      timestamp_device: string;
      latitude: number | null;
      longitude: number | null;
      speed_kmh: number | null;
      angle_deg: number | null;
    } | null = null;
    let positionSource: LivePositionSource | null = null;
    let etaMinutes: number | null = null;
    if (assignmentRow?.vehicle_id) {
      const live = await computeLiveTracking({
        db: opts.db,
        logger: opts.logger,
        assignmentId: assignmentRow.id,
        vehicleId: assignmentRow.vehicle_id,
        tripId: trip.id,
        tripStatus: trip.status,
        destinationAddress: trip.destinationAddressRaw,
        destRegionCode: trip.destinationRegionCode,
        routesProjectId: opts.routesProjectId,
        nowMs: Date.now(),
      });
      if (live.position) {
        ubicacionActual = {
          timestamp_device: live.position.timestamp,
          latitude: live.position.latitude,
          longitude: live.position.longitude,
          speed_kmh: live.position.speed_kmh,
          angle_deg: live.angleDeg,
        };
      }
      positionSource = live.positionSource;
      etaMinutes = live.etaMinutes;
    }

    // Anulada ≡ cancelado sin asignación (§8.8). Quién y cuándo salen del
    // último evento `cancelado`; las históricas pueden no tenerlo.
    let anulacion: { en: string; por_nombre: string | null; razon: string | null } | null = null;
    if (trip.status === 'cancelado' && !assignmentRow) {
      const [evento] = await opts.db
        .select({
          recordedAt: tripEvents.recordedAt,
          payload: tripEvents.payload,
          porNombre: usersTable.fullName,
        })
        .from(tripEvents)
        .leftJoin(usersTable, eq(usersTable.id, tripEvents.recordedByUserId))
        .where(and(eq(tripEvents.tripId, id), eq(tripEvents.eventType, 'cancelado')))
        .orderBy(desc(tripEvents.recordedAt))
        .limit(1);
      const razon = evento ? motivoDelPayload(evento.payload) : null;
      anulacion = {
        en: (evento?.recordedAt ?? trip.updatedAt).toISOString(),
        por_nombre: evento?.porNombre ?? null,
        razon,
      };
    }
    const cancelacion =
      assignmentRow?.status === 'cancelado' && assignmentRow.cancelled_at
        ? {
            en: assignmentRow.cancelled_at.toISOString(),
            razon: assignmentRow.cancellation_reason ?? null,
          }
        : null;

    let assignmentOut: Record<string, unknown> | null = null;
    if (assignmentRow) {
      const { driver_phone, driver_whatsapp, ...resto } = assignmentRow;
      // El teléfono del conductor solo mientras el viaje está activo (§12-P11).
      const telefono = driver_phone ?? driver_whatsapp ?? null;
      const viajeActivo = trip.status === 'asignado' || trip.status === 'en_proceso';
      assignmentOut = {
        ...resto,
        ...(viajeActivo && telefono ? { conductor_telefono_e164: telefono } : {}),
      };
    }

    return c.json({
      trip_request: {
        ...serializeTripDetail(trip, auth.userContext, cambioPendiente, desgloseCambio),
        comercial,
        anulacion,
        cancelacion,
        ofertas_pendientes: pendientes?.n ?? 0,
      },
      events,
      assignment: assignmentRow
        ? {
            ...assignmentOut,
            // Siempre presente (uuid o null). Un destinatario vacío no lo omite.
            public_tracking_token: assignmentRow.public_tracking_token ?? null,
            ubicacion_actual: ubicacionActual,
            position_source: positionSource,
            eta_minutes: etaMinutes,
          }
        : null,
      metrics: metricsRow ? serializeTripMetrics(metricsRow) : null,
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id/certificate/download — devuelve signed URL al PDF firmado.
  //
  // Auth: shipper owner del trip. Validamos que el cert ya haya sido
  // emitido (certificateIssuedAt notNull); si no, 404 con código
  // 'certificate_not_issued' para que el frontend muestre "pendiente"
  // en vez de un error confuso.
  //
  // Devolvemos una signed URL en lugar de proxiar el PDF para evitar:
  //   - Timeouts del Cloud Run (los PDFs pueden ser >100KB y la conexión
  //     tarda) — descarga directa desde GCS es más rápida y no consume
  //     CPU del api.
  //   - Memoria: streamear desde GCS via api significa cargar todo el
  //     PDF en memoria (Hono no tiene streaming nativo simple).
  //
  // TTL 5 min — suficiente para que el browser inicie la descarga, no
  // tan largo que la URL leakeada sea peligrosa.
  // ---------------------------------------------------------------------
  app.get('/:id/certificate/download', async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    if (!opts.certConfig?.certificatesBucket) {
      // Sin bucket no hay nada que firmar.
      return c.json({ error: 'certificates_disabled', code: 'certificates_disabled' }, 503);
    }

    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    // Validar ownership + que el cert exista.
    const rows = await opts.db
      .select({
        tripId: trips.id,
        trackingCode: trips.trackingCode,
        certificateIssuedAt: tripMetrics.certificateIssuedAt,
        certificatePdfUrl: tripMetrics.certificatePdfUrl,
      })
      .from(trips)
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, trips.id))
      .where(and(eq(trips.id, id), eq(trips.generadorCargaEmpresaId, empresaId)))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404);
    }
    if (!row.certificateIssuedAt || !row.certificatePdfUrl) {
      return c.json(
        {
          error: 'certificate_not_issued',
          code: 'certificate_not_issued',
          // Útil para el frontend mostrar "pendiente" vs "no aplica".
          message:
            'El certificado todavía no fue emitido. Si el viaje está entregado, espera unos segundos e inténtalo.',
        },
        404,
      );
    }

    const downloadUrl = await generarSignedUrlPdf({
      bucket: opts.certConfig.certificatesBucket,
      empresaId,
      trackingCode: row.trackingCode,
      ttlSeconds: 300,
    });

    return c.json({
      download_url: downloadUrl,
      expires_in_seconds: 300,
      tracking_code: row.trackingCode,
    });
  });

  // ---------------------------------------------------------------------
  // PATCH /:id/confirmar-recepcion — shipper marca la carga como recibida.
  //
  // Flujo canónico de confirmación de entrega: el generador de carga (el
  // que recibe físicamente la carga en destino) aprieta este endpoint
  // cuando llega. Dispara:
  //   1. trips.status = 'entregado'
  //   2. assignments.delivered_at = now()
  //   3. trip_event 'entrega_confirmada' (source='shipper').
  //   4. Fire-and-forget: emisión de certificado de huella de carbono.
  //
  // Idempotente: si el trip ya está entregado, devuelve 200 con el
  // delivered_at actual sin re-disparar nada.
  //
  // Para el flujo POD del transportista ver:
  //   PATCH /assignments/:id/confirmar-entrega (en routes/assignments.ts).
  // Primer click gana entre los dos.
  // ---------------------------------------------------------------------
  app.patch('/:id/confirmar-recepcion', async (c) => {
    const auth = requireShipperAuth(c, { requireActive: true });
    if (!auth.ok) {
      return auth.response;
    }
    // CHEQUEOS_REEMPLAZADOS trip-requests: confirmar recepción es escritura.
    const sinCarga = denegarPublicarCarga(c, auth.userContext);
    if (sinCarga) {
      return sinCarga;
    }
    const rolRecepcion = auth.activeMembership.membership.role;
    const id = c.req.param('id');

    const result = await confirmarEntregaViaje({
      db: opts.db,
      logger: opts.logger,
      tripId: id,
      source: 'shipper',
      actor: {
        empresaId: auth.activeMembership.empresa.id,
        userId: auth.userContext.user.id,
      },
      config: opts.certConfig ?? {},
      ...(opts.documentClosePolicy ? { documentClosePolicy: opts.documentClosePolicy } : {}),
    });

    if (!result.ok && result.code === 'cambio_pendiente') {
      getBusinessCounter('recogida_bloqueada_cambio_total').add(1, { via: 'entrega_generador' });
    }
    if (!result.ok) {
      const statusCode =
        result.code === 'trip_not_found'
          ? 404
          : result.code === 'forbidden_owner_mismatch'
            ? 403
            : 409;
      return c.json(
        {
          error: result.code,
          code: result.code,
          ...(result.code === 'invalid_status' && result.currentStatus
            ? { current_status: result.currentStatus }
            : {}),
          ...(result.code === 'cambio_pendiente' ? { solicitud_id: result.solicitudId } : {}),
        },
        statusCode,
      );
    }

    // ADR-080 §1: con mandato de cobro, la confirmación del generador con el
    // documento archivado es la recepción conforme (arranca cobro y
    // liberación). La entrega queda confirmada aunque la recepción no se
    // pueda registrar todavía (p. ej. sin documento): se informa el motivo.
    let mandato: Record<string, unknown> = {};
    if (appConfig.MANDATO_COBRO_ACTIVATED) {
      try {
        const recepcion = await registrarRecepcionConforme(
          {
            db: opts.db,
            logger: opts.logger,
            topeFloatClp: appConfig.MANDATO_COBRO_FLOAT_MAXIMO_CLP,
          },
          {
            tripId: id,
            generadorEmpresaId: auth.activeMembership.empresa.id,
            registradoPor: auth.userContext.user.id,
            asegurarLiquidacion: (asignacionId) =>
              liquidarTrip({
                db: opts.db,
                logger: opts.logger,
                assignmentId: asignacionId,
                pricingV2Activated: appConfig.PRICING_V2_ACTIVATED,
                pricingV3Activated: appConfig.PRICING_V3_ACTIVATED,
                mandatoCobroActivated: true,
              }),
          },
        );
        if (recepcion.ok) {
          // El despachador confirma la recepción, pero el pago solo lo ven
          // dueño y admin (igual que GET /:id/pago).
          mandato = (ROLES_COMERCIALES as readonly string[]).includes(rolRecepcion)
            ? { pago: pagoParaGenerador(recepcion.pago) }
            : {};
        } else if (recepcion.code !== 'no_es_mandato') {
          opts.logger.warn({ tripId: id, code: recepcion.code }, 'recepción conforme pendiente');
          mandato = { recepcion_conforme_pendiente: recepcion.code };
        }
      } catch (err) {
        // La entrega ya quedó confirmada (commit previo): no se revierte por
        // un fallo al registrar la recepción. Queda logueado y el generador
        // puede reintentar confirmando de nuevo (idempotente).
        opts.logger.error({ err, tripId: id }, 'no se pudo registrar la recepción conforme');
        mandato = { recepcion_conforme_pendiente: 'error_registro' };
      }
    }

    return c.json({
      ok: true,
      already_delivered: result.alreadyDelivered,
      delivered_at: result.deliveredAt.toISOString(),
      ...mandato,
    });
  });

  // ---------------------------------------------------------------------
  // ADR-080 — pago del viaje bajo mandato de cobro (solo el generador dueño).
  //   GET  /:id/pago     → estado de cobro y liberación con vencimientos.
  //   POST /:id/disputa  → objeta la recepción; congela la liberación.
  // Con MANDATO_COBRO_ACTIVATED apagado: 404 mandato_cobro_desactivado.
  // ---------------------------------------------------------------------
  app.get('/:id/pago', async (c) => {
    if (!appConfig.MANDATO_COBRO_ACTIVATED) {
      return c.json({ error: 'mandato_cobro_desactivado' }, 404);
    }
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const sinRol = exigirRol(c, auth.activeMembership.membership.role, ROLES_COMERCIALES);
    if (sinRol) {
      return sinRol;
    }
    const pago = await leerPagoDelGenerador(
      opts.db,
      c.req.param('id'),
      auth.activeMembership.empresa.id,
    );
    if (!pago) {
      return c.json({ error: 'pago_no_encontrado' }, 404);
    }
    return c.json({ pago: pagoParaGenerador(pago) });
  });

  app.post('/:id/disputa', zValidator('json', abrirDisputaSchema), async (c) => {
    if (!appConfig.MANDATO_COBRO_ACTIVATED) {
      return c.json({ error: 'mandato_cobro_desactivado' }, 404);
    }
    const auth = requireShipperAuth(c, { requireActive: true });
    if (!auth.ok) {
      return auth.response;
    }
    const sinRolDisputa = exigirRol(c, auth.activeMembership.membership.role, ROLES_COMERCIALES);
    if (sinRolDisputa) {
      return sinRolDisputa;
    }
    const r = await abrirDisputa(
      { db: opts.db, logger: opts.logger, topeFloatClp: appConfig.MANDATO_COBRO_FLOAT_MAXIMO_CLP },
      {
        tripId: c.req.param('id'),
        generadorEmpresaId: auth.activeMembership.empresa.id,
        userId: auth.userContext.user.id,
        motivo: c.req.valid('json').motivo,
      },
    );
    if (!r.ok) {
      return c.json({ error: r.code }, r.code === 'viaje_no_encontrado' ? 404 : 409);
    }
    return c.json({ pago: pagoParaGenerador(r.pago) }, 201);
  });

  // ---------------------------------------------------------------------
  // PATCH /:id/datos-libres — destinatario, notas y referencia
  // (editar-anular-cargas §6.2). Sin aceptación del transportista, en todo
  // estado no terminal. La lógica vive en services/editar-datos-libres.ts.
  // ---------------------------------------------------------------------
  app.patch('/:id/datos-libres', zValidator('json', datosLibresInputSchema), async (c) => {
    const auth = requireShipperAuth(c, { requireActive: true });
    if (!auth.ok) {
      return auth.response;
    }
    const sinPermiso = denegarPublicarCarga(c, auth.userContext);
    if (sinPermiso) {
      return sinPermiso;
    }
    const tripId = c.req.param('id');
    const resultado = await withBusinessSpan(
      { name: 'cargas.datos_libres', attributes: { 'booster.trip_id': tripId } },
      async (span) => {
        const r = await editarDatosLibres(
          { db: opts.db, logger: opts.logger },
          {
            tripId,
            empresaId: auth.activeMembership.empresa.id,
            userId: auth.userContext.user.id,
            input: c.req.valid('json'),
          },
        );
        setResultAttributes(span, { 'booster.outcome': r.ok ? 'editada' : r.code });
        getBusinessCounter('carga_editada_total').add(1, {
          modo: 'libre',
          outcome: r.ok ? 'editada' : r.code,
        });
        return r;
      },
    );
    if (!resultado.ok) {
      switch (resultado.code) {
        case 'trip_not_found':
          return c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404);
        case 'trip_not_editable':
          return c.json(
            {
              error: 'trip_not_editable',
              code: 'trip_not_editable',
              current_status: resultado.currentStatus,
            },
            409,
          );
        case 'sin_cambios':
          return c.json({ error: 'sin_cambios', code: 'sin_cambios' }, 422);
      }
    }

    // Post-commit, fire-and-forget: avisar a la transportista y al conductor,
    // y reenviar el link al número nuevo del destinatario (§12-P8).
    const { asignacion, telefonoDestinatarioNuevo } = resultado;
    if (asignacion) {
      try {
        await notifyCambioCarga(
          { db: opts.db, logger: opts.logger },
          { tripId, asignacion, evento: 'datos_libres' },
        );
      } catch (err) {
        opts.logger.error({ err, tripId }, 'fallo avisar datos libres editados (la edición quedó)');
      }
      if (telefonoDestinatarioNuevo && opts.notifyTrackingLink) {
        try {
          await reenviarTrackingLinkADestinatario(opts.notifyTrackingLink, {
            assignmentId: asignacion.id,
            telefono: telefonoDestinatarioNuevo,
          });
        } catch (err) {
          opts.logger.error(
            { err, tripId, assignmentId: asignacion.id },
            'fallo reenviar link de tracking al destinatario (la edición quedó)',
          );
        }
      }
    }
    return c.json({ trip_request: { id: tripId, campos: resultado.campos } });
  });

  // ---------------------------------------------------------------------
  // PUT /:id — edición total antes del match (editar-anular-cargas §6.1).
  // La lógica vive en services/editar-carga.ts; post-commit, igual que el
  // POST: geocodificar el origen y correr el matching.
  // ---------------------------------------------------------------------
  app.put('/:id', zValidator('json', tripRequestEditInputSchema), async (c) => {
    const auth = requireShipperAuth(c, { requireActive: true });
    if (!auth.ok) {
      return auth.response;
    }
    const sinPermiso = denegarEditarCarga(c, auth.userContext);
    if (sinPermiso) {
      return sinPermiso;
    }
    const tripId = c.req.param('id');
    const input = c.req.valid('json');
    const r = await withBusinessSpan(
      { name: 'cargas.editar_pre_match', attributes: { 'booster.trip_id': tripId } },
      async (span) => {
        const res = await editarCargaPreMatch(
          { db: opts.db, logger: opts.logger },
          {
            tripId,
            empresaId: auth.activeMembership.empresa.id,
            userId: auth.userContext.user.id,
            input,
            contratoProgramadoActivadoEn:
              auth.activeMembership.empresa.contratoProgramadoActivadoEn ?? null,
          },
        );
        const resultado = res.ok ? (res.cambio ? 'editada' : 'sin_cambios') : res.code;
        setResultAttributes(span, { 'booster.outcome': resultado });
        if (res.ok && res.cambio) {
          getBusinessCounter('carga_editada_total').add(1, { modo: 'pre_match' });
        }
        return res;
      },
    );
    if (!r.ok) {
      switch (r.code) {
        case 'trip_not_found':
          return c.json({ error: r.code, code: r.code }, 404);
        case 'trip_busy':
          return c.json({ error: r.code, code: r.code }, 409);
        case 'trip_not_editable':
          return c.json({ error: r.code, code: r.code, current_status: r.currentStatus }, 409);
        case 'contrato_programado_no_habilitado':
          return c.json({ error: r.code, code: r.code }, 422);
      }
    }

    if (r.geocodificarOrigen && opts.routesProjectId) {
      try {
        await geocodificarOrigen({
          db: opts.db,
          logger: opts.logger,
          tripId,
          originAddress: r.geocodificarOrigen.originAddress,
          destinationAddress: r.geocodificarOrigen.destinationAddress,
          routesProjectId: opts.routesProjectId,
        });
      } catch (err) {
        opts.logger.error({ err, tripId }, 'geocodificar origen tras editar la carga falló');
      }
    }

    let matching: Awaited<ReturnType<typeof runMatching>> | null = null;
    if (r.cambio && r.estado === 'esperando_match') {
      try {
        matching = await runMatching({
          db: opts.db,
          logger: opts.logger,
          tripId,
          ...(opts.notify ? { notify: opts.notify } : {}),
          ...(opts.ranking ? { ranking: opts.ranking } : {}),
        });
      } catch (err) {
        opts.logger.error({ err, tripId }, 'matching tras editar la carga falló; queda esperando');
      }
    }

    const [actualizada] = await opts.db
      .select()
      .from(trips)
      .where(
        and(
          eq(trips.id, tripId),
          eq(trips.generadorCargaEmpresaId, auth.activeMembership.empresa.id),
        ),
      )
      .limit(1);
    if (!actualizada) {
      return c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404);
    }
    return c.json({
      trip_request: serializeTripDetail(actualizada, auth.userContext),
      matching: matching
        ? {
            candidates_evaluated: matching.candidatesEvaluated,
            offers_created: matching.offersCreated,
            offer_ids: matching.offers.map((o) => o.id),
          }
        : null,
      invalidated_offers: r.ofertasInvalidadas,
    });
  });

  // ---------------------------------------------------------------------
  // Solicitudes de cambio (editar-anular-cargas §6.3–6.5): después del match,
  // todo cambio que no sea un dato libre lo acepta o rechaza el transportista.
  // ---------------------------------------------------------------------
  app.post(
    '/:id/solicitudes-cambio',
    zValidator('json', z.object({ cambios: cambioPropuestoSchema }).strict()),
    async (c) => {
      const auth = requireShipperAuth(c, { requireActive: true });
      if (!auth.ok) {
        return auth.response;
      }
      const sinPermiso = denegarEditarCarga(c, auth.userContext);
      if (sinPermiso) {
        return sinPermiso;
      }
      const tripId = c.req.param('id');
      const empresaId = auth.activeMembership.empresa.id;
      // §6.3: las coordenadas se resuelven ANTES de la tx, sin llamadas externas bajo lock.
      const cambios = await completarCoordenadasPropuesta(
        { db: opts.db, logger: opts.logger, routesProjectId: opts.routesProjectId },
        { tripId, empresaId, cambios: c.req.valid('json').cambios },
      );
      const r = await withBusinessSpan(
        { name: 'cargas.solicitud_cambio.crear', attributes: { 'booster.trip_id': tripId } },
        async (span) => {
          const res = await crearSolicitudCambio(
            { db: opts.db, logger: opts.logger },
            { tripId, empresaId, userId: auth.userContext.user.id, cambios },
          );
          const resultado = res.ok ? 'creada' : res.code;
          setResultAttributes(span, { 'booster.outcome': resultado });
          getBusinessCounter('solicitud_cambio_total').add(1, {
            resultado,
            comercial: res.ok ? cambiaComercial(res.campos) : false,
          });
          return res;
        },
      );
      if (!r.ok) {
        switch (r.code) {
          case 'trip_not_found':
            return c.json({ error: r.code, code: r.code }, 404);
          case 'trip_not_matched':
            return c.json({ error: r.code, code: r.code }, 409);
          case 'trip_not_editable':
            return c.json({ error: r.code, code: r.code, current_status: r.currentStatus }, 409);
          case 'cambio_pendiente_existente':
            return c.json({ error: r.code, code: r.code, solicitud_id: r.solicitudId }, 409);
          case 'sin_cambios':
          case 'contrato_programado_no_habilitado':
            return c.json({ error: r.code, code: r.code }, 422);
        }
      }
      try {
        await notifyCambioCarga(
          { db: opts.db, logger: opts.logger },
          { tripId, asignacion: r.asignacion, evento: 'cambio_solicitado' },
        );
      } catch (err) {
        opts.logger.error({ err, tripId }, 'avisar solicitud de cambio falló (quedó creada)');
      }
      // ADR-079 §5: el desglose solo lo ve el generador.
      return c.json(
        {
          solicitud: r.solicitud,
          ...(r.desglosePropuesto ? { desglose_propuesto: r.desglosePropuesto } : {}),
        },
        201,
      );
    },
  );

  app.post(
    '/:id/solicitudes-cambio/:sid/retirar',
    zValidator('param', z.object({ id: z.string().uuid(), sid: z.string().uuid() }), (r, c) =>
      r.success ? undefined : c.json({ error: 'not_found', code: 'not_found' }, 404),
    ),
    async (c) => {
      const auth = requireShipperAuth(c, { requireActive: true });
      if (!auth.ok) {
        return auth.response;
      }
      const sinPermiso = denegarEditarCarga(c, auth.userContext);
      if (sinPermiso) {
        return sinPermiso;
      }
      const { id: tripId, sid: solicitudId } = c.req.valid('param');
      const r = await withBusinessSpan(
        {
          name: 'cargas.solicitud_cambio.retirar',
          attributes: { 'booster.trip_id': tripId, 'booster.solicitud_id': solicitudId },
        },
        async (span) => {
          const res = await retirarSolicitudCambio(
            { db: opts.db, logger: opts.logger },
            {
              tripId,
              empresaId: auth.activeMembership.empresa.id,
              userId: auth.userContext.user.id,
              solicitudId,
            },
          );
          const resultado = res.ok ? 'retirada' : res.code;
          setResultAttributes(span, { 'booster.outcome': resultado });
          getBusinessCounter('solicitud_cambio_total').add(1, { resultado, comercial: false });
          return res;
        },
      );
      if (!r.ok) {
        return c.json({ error: r.code, code: r.code }, r.code === 'trip_not_found' ? 404 : 409);
      }
      try {
        await notifyCambioCarga(
          { db: opts.db, logger: opts.logger },
          { tripId, asignacion: r.asignacion, evento: 'cambio_retirado' },
        );
      } catch (err) {
        opts.logger.error({ err, tripId }, 'avisar solicitud retirada falló (quedó retirada)');
      }
      return c.json({ ok: true, solicitud_id: solicitudId });
    },
  );

  app.get('/:id/solicitudes-cambio', async (c) => {
    const auth = requireShipperAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const solicitudes = await listarSolicitudesCambio(
      { db: opts.db },
      { tripId: c.req.param('id'), empresaId: auth.activeMembership.empresa.id },
    );
    if (!solicitudes) {
      return c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404);
    }
    return c.json({ solicitudes });
  });

  // ---------------------------------------------------------------------
  // PATCH /:id/cancelar — anular antes del match o cancelar después
  // (editar-anular-cargas §6.6). La lógica vive en services/cancelar-carga.ts.
  // ---------------------------------------------------------------------
  app.patch('/:id/cancelar', zValidator('json', cancelBodySchema), async (c) => {
    const auth = requireShipperAuth(c, { requireActive: true });
    if (!auth.ok) {
      return auth.response;
    }
    // CHEQUEOS_REEMPLAZADOS trip-requests: requireShipper no miraba el rol.
    const sinCarga = denegarPublicarCarga(c, auth.userContext);
    if (sinCarga) {
      return sinCarga;
    }
    const tripId = c.req.param('id');
    const body = c.req.valid('json');
    const resultado = await withBusinessSpan(
      { name: 'cargas.cancelar', attributes: { 'booster.trip_id': tripId } },
      async (span) => {
        const r = await cancelarCarga(
          { db: opts.db, logger: opts.logger },
          {
            tripId,
            empresaId: auth.activeMembership.empresa.id,
            userId: auth.userContext.user.id,
            ...(body.reason ? { reason: body.reason } : {}),
          },
        );
        const outcome = r.ok ? r.tipo : r.code;
        setResultAttributes(span, { 'booster.outcome': outcome });
        getBusinessCounter('carga_cancelada_total').add(1, { tipo: outcome });
        return r;
      },
    );
    if (!resultado.ok) {
      switch (resultado.code) {
        case 'trip_not_found':
          return c.json({ error: 'trip_not_found', code: 'trip_not_found' }, 404);
        case 'trip_not_cancellable':
          return c.json(
            {
              error: 'trip_not_cancellable',
              code: 'trip_not_cancellable',
              current_status: resultado.currentStatus,
            },
            409,
          );
        case 'reason_required':
          return c.json({ error: 'reason_required', code: 'reason_required' }, 422);
      }
    }

    // Post-commit, fire-and-forget: la transportista y el conductor se enteran
    // de la cancelación con su motivo (§8).
    if (resultado.tipo === 'cancelacion') {
      try {
        await notifyCambioCarga(
          { db: opts.db, logger: opts.logger },
          {
            tripId,
            asignacion: resultado.asignacion,
            evento: 'cancelacion',
            motivo: resultado.motivo,
          },
        );
      } catch (err) {
        opts.logger.error(
          { err, tripId },
          'fallo avisar la cancelación (la carga quedó cancelada)',
        );
      }
    }
    return c.json({ trip_request: { id: tripId, status: 'cancelado', tipo: resultado.tipo } });
  });

  return app;
}

/** El motivo guardado en el payload de un evento `cancelado`, si lo hay. */
function motivoDelPayload(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'reason' in payload) {
    const r = payload.reason;
    return typeof r === 'string' && r.length > 0 ? r : null;
  }
  return null;
}

function serializeTripDetail(
  row: typeof trips.$inferSelect,
  userContext: unknown,
  cambioPendiente: SolicitudVista | null = null,
  desgloseCambio: DesgloseGenerador | null = null,
) {
  return {
    id: row.id,
    tracking_code: row.trackingCode,
    status: row.status,
    origin_address_raw: row.originAddressRaw,
    origin_region_code: row.originRegionCode,
    origin_comuna_code: row.originComunaCode,
    destination_address_raw: row.destinationAddressRaw,
    destination_region_code: row.destinationRegionCode,
    destination_comuna_code: row.destinationComunaCode,
    cargo_type: row.cargoType,
    cargo_weight_kg: row.cargoWeightKg,
    cargo_volume_m3: row.cargoVolumeM3,
    cargo_description: row.cargoDescription,
    pickup_window_start: row.pickupWindowStart,
    pickup_window_end: row.pickupWindowEnd,
    proposed_price_clp: row.proposedPriceClp,
    modalidad_carga: row.modalidadCarga,
    // editar-anular-cargas: datos libres (el generador los ve y los edita).
    consignee: {
      name: row.consigneeName,
      phone_e164: row.consigneeWhatsappE164,
      email: row.consigneeEmail,
    },
    notes: row.notes,
    reference: row.reference,
    // §6.8: el generador ve su propuesta completa mientras está pendiente.
    cambio_pendiente: cambioPendiente
      ? {
          id: cambioPendiente.id,
          cambios: cambioPendiente.cambios,
          valores_anteriores: cambioPendiente.valores_anteriores,
          creado_en: cambioPendiente.creado_en,
          ...(desgloseCambio ? { desglose_propuesto: desgloseCambio } : {}),
        }
      : null,
    acciones_permitidas: accionesPermitidas(row.status, userContext, cambioPendiente !== null),
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

/**
 * Qué puede hacer quien mira la carga, en su estado actual (spec
 * editar-anular-cargas §6-8). Combina los guards de la máquina de estados con
 * las mismas capacidades que exigen las rutas, para que la web no ofrezca una
 * acción que el API va a rechazar. Con una solicitud pendiente no se propone
 * otra: se retira la vigente.
 */
function accionesPermitidas(estado: string, userContext: unknown, hayCambioPendiente: boolean) {
  const ctx = ctxDeUserContext(userContext as Parameters<typeof ctxDeUserContext>[0]);
  const editar = ctx !== null && puedePublicarCarga(ctx);
  const cancelar = ctx !== null && puedeCancelarCarga(ctx);
  const valido = esEstadoViaje(estado);
  return {
    editar: editar && valido && esEditablePreMatch(estado),
    editar_datos_libres: editar && valido && aceptaDatosLibres(estado),
    solicitar_cambio: editar && valido && aceptaSolicitudCambio(estado) && !hayCambioPendiente,
    retirar_cambio: editar && hayCambioPendiente,
    anular: cancelar && valido && esAnulablePorGenerador(estado),
    cancelar: cancelar && valido && esCancelablePostMatch(estado),
  };
}

/**
 * Endpoints carrier-side sobre assignments:
 *
 *   - GET   /:id                       — detalle assignment + trip (P3.f bonus)
 *   - PATCH /:id/confirmar-entrega     — POD del transportista (fallback al
 *     flujo canónico del shipper PATCH /trip-requests-v2/:id/confirmar-recepcion).
 *
 * El servicio confirmarEntregaViaje() centraliza la lógica del POD;
 * este file es un wrapper thin para validar carrier-auth + exponer detalle.
 *
 * Auth: ambas rutas requieren membership transportista activa que sea dueña
 * del assignment (assignment.empresa_id === activeMembership.empresa.id).
 * El shipper tiene su propio surface en /trip-requests-v2/:tripId — desde
 * ahí ve el assignment como sub-objeto.
 */

import type { Logger } from '@booster-ai/logger';
import { zValidator } from '@hono/zod-validator';
import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import {
  assignments,
  empresas as empresasTable,
  telemetryPoints,
  tripMetrics,
  trips,
  users as usersTable,
  vehicles,
} from '../db/schema.js';
import { confirmarEntregaViaje } from '../services/confirmar-entrega-viaje.js';
import type { EmitirCertificadoConfig } from '../services/emitir-certificado-viaje.js';
import { INCIDENT_TYPES, reportarIncidente } from '../services/reportar-incidente.js';

export function createAssignmentsRoutes(opts: {
  db: Db;
  logger: Logger;
  certConfig?: Partial<EmitirCertificadoConfig>;
}) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireCarrierAuth(c: Context<any, any, any>) {
    const userContext = c.get('userContext');
    if (!userContext) {
      opts.logger.error({ path: c.req.path }, '/assignments without userContext');
      return { ok: false as const, response: c.json({ error: 'unauthorized' }, 401) };
    }
    const active = userContext.activeMembership;
    if (!active) {
      return {
        ok: false as const,
        response: c.json({ error: 'no_active_empresa', code: 'no_active_empresa' }, 403),
      };
    }
    if (!active.empresa.isTransportista) {
      return {
        ok: false as const,
        response: c.json({ error: 'not_a_carrier', code: 'not_a_carrier' }, 403),
      };
    }
    if (active.empresa.status !== 'activa') {
      return {
        ok: false as const,
        response: c.json({ error: 'empresa_not_active', code: 'empresa_not_active' }, 403),
      };
    }
    return { ok: true as const, userContext, activeMembership: active };
  }

  // ---------------------------------------------------------------------
  // GET /:id — detalle del assignment + trip para el carrier.
  //
  // El carrier entra a /app/asignaciones/:id después de aceptar una oferta
  // y necesita header con tracking_code, ruta origen→destino, status, y
  // datos del vehículo/driver asignado. El shipper tiene su propio surface
  // (/app/cargas/:id) que ya devuelve esto desde GET /trip-requests-v2/:id.
  //
  // Forma de respuesta espejo (parcial) de GET /trip-requests-v2/:id, pero:
  //   - origin/destination como objetos {address_raw, region_code} para
  //     que el frontend no tenga que aplanar dos shapes distintos.
  //   - assignment.ubicacion_actual incluida (último punto del vehículo)
  //     porque el carrier surface también muestra "tu vehículo está en X"
  //     como confirmación de que el GPS llega al backend.
  // ---------------------------------------------------------------------
  app.get('/:id', async (c) => {
    const auth = requireCarrierAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const assignmentId = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    // Una sola query: assignment + trip + carrier empresa + shipper empresa
    // (alias) + vehicle + driver.
    // No hacemos chequeo previo de ownership porque si el WHERE no matchea
    // devuelve [], y respondemos 404 como cualquier otro recurso ajeno.
    // Joineamos `empresas` 2 veces:
    //   - empresasTable (sin alias) := carrier de assignment.empresaId,
    //     usado para el title que ya estaba (assignment.empresa_legal_name).
    //   - empresaShipper (alias)    := generador de carga del trip,
    //     necesario para el title del ChatPanel del lado carrier (mostrar
    //     "Chat con [shipper]" en vez de la propia empresa carrier).
    const empresaShipper = alias(empresasTable, 'empresa_shipper');

    const [row] = await opts.db
      .select({
        // assignment
        assignmentId: assignments.id,
        assignmentStatus: assignments.status,
        agreedPriceClp: assignments.agreedPriceClp,
        acceptedAt: assignments.acceptedAt,
        pickedUpAt: assignments.pickedUpAt,
        deliveredAt: assignments.deliveredAt,
        cancelledAt: assignments.cancelledAt,
        empresaIdAssign: assignments.empresaId,
        empresaLegalName: empresasTable.legalName,
        vehicleId: assignments.vehicleId,
        vehiclePlate: vehicles.plate,
        vehicleType: vehicles.vehicleType,
        driverUserId: assignments.driverUserId,
        driverName: usersTable.fullName,
        // trip
        tripId: trips.id,
        trackingCode: trips.trackingCode,
        tripStatus: trips.status,
        originAddressRaw: trips.originAddressRaw,
        originRegionCode: trips.originRegionCode,
        destinationAddressRaw: trips.destinationAddressRaw,
        destinationRegionCode: trips.destinationRegionCode,
        cargoType: trips.cargoType,
        cargoWeightKg: trips.cargoWeightKg,
        cargoVolumeM3: trips.cargoVolumeM3,
        pickupWindowStart: trips.pickupWindowStart,
        pickupWindowEnd: trips.pickupWindowEnd,
        proposedPriceClp: trips.proposedPriceClp,
        shipperLegalName: empresaShipper.legalName,
      })
      .from(assignments)
      .innerJoin(trips, eq(trips.id, assignments.tripId))
      .leftJoin(empresasTable, eq(empresasTable.id, assignments.empresaId))
      .leftJoin(empresaShipper, eq(empresaShipper.id, trips.generadorCargaEmpresaId))
      .leftJoin(vehicles, eq(vehicles.id, assignments.vehicleId))
      .leftJoin(usersTable, eq(usersTable.id, assignments.driverUserId))
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    if (!row) {
      return c.json({ error: 'assignment_not_found', code: 'assignment_not_found' }, 404);
    }
    if (row.empresaIdAssign !== empresaId) {
      return c.json({ error: 'forbidden_owner_mismatch', code: 'forbidden_owner_mismatch' }, 403);
    }

    // Última ubicación del vehículo asignado (si tiene Teltonika emitiendo).
    let ubicacionActual: {
      timestamp_device: string;
      latitude: number | null;
      longitude: number | null;
      speed_kmh: number | null;
      angle_deg: number | null;
    } | null = null;
    if (row.vehicleId) {
      const [last] = await opts.db
        .select({
          timestampDevice: telemetryPoints.timestampDevice,
          latitude: telemetryPoints.latitude,
          longitude: telemetryPoints.longitude,
          speedKmh: telemetryPoints.speedKmh,
          angleDeg: telemetryPoints.angleDeg,
        })
        .from(telemetryPoints)
        .where(eq(telemetryPoints.vehicleId, row.vehicleId))
        .orderBy(desc(telemetryPoints.timestampDevice))
        .limit(1);
      if (last) {
        ubicacionActual = {
          timestamp_device: last.timestampDevice.toISOString(),
          latitude: last.latitude != null ? Number.parseFloat(last.latitude) : null,
          longitude: last.longitude != null ? Number.parseFloat(last.longitude) : null,
          speed_kmh: last.speedKmh,
          angle_deg: last.angleDeg,
        };
      }
    }

    return c.json({
      trip_request: {
        id: row.tripId,
        tracking_code: row.trackingCode,
        status: row.tripStatus,
        origin: {
          address_raw: row.originAddressRaw,
          region_code: row.originRegionCode,
        },
        destination: {
          address_raw: row.destinationAddressRaw,
          region_code: row.destinationRegionCode,
        },
        cargo_type: row.cargoType,
        cargo_weight_kg: row.cargoWeightKg,
        cargo_volume_m3: row.cargoVolumeM3,
        pickup_window_start: row.pickupWindowStart?.toISOString() ?? null,
        pickup_window_end: row.pickupWindowEnd?.toISOString() ?? null,
        proposed_price_clp: row.proposedPriceClp,
        shipper_legal_name: row.shipperLegalName,
      },
      assignment: {
        id: row.assignmentId,
        status: row.assignmentStatus,
        agreed_price_clp: row.agreedPriceClp,
        accepted_at: row.acceptedAt?.toISOString() ?? null,
        picked_up_at: row.pickedUpAt?.toISOString() ?? null,
        delivered_at: row.deliveredAt?.toISOString() ?? null,
        cancelled_at: row.cancelledAt?.toISOString() ?? null,
        empresa_legal_name: row.empresaLegalName,
        vehicle_plate: row.vehiclePlate,
        vehicle_type: row.vehicleType,
        driver_name: row.driverName,
        ubicacion_actual: ubicacionActual,
      },
    });
  });

  // ---------------------------------------------------------------------
  // PATCH /:id/confirmar-entrega — carrier marca la carga como entregada.
  //
  // Es el flujo POD (Proof of Delivery) del transportista. Sirve como
  // fallback cuando el shipper no responde a tiempo. Idempotente.
  //
  // El servicio interno valida que el assignment pertenezca al carrier
  // (assignment.empresa_id === activeMembership.empresa.id) y dispara
  // el mismo lifecycle que el endpoint shipper.
  // ---------------------------------------------------------------------
  app.patch('/:id/confirmar-entrega', async (c) => {
    const auth = requireCarrierAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const assignmentId = c.req.param('id');

    // Resolver tripId desde assignmentId. El servicio toma tripId como
    // identificador canónico — esto es el shim para que el carrier no
    // necesite saber el tripId directamente (su URL natural es por
    // assignment, no por trip).
    const rows = await opts.db
      .select({ tripId: assignments.tripId, empresaId: assignments.empresaId })
      .from(assignments)
      .where(eq(assignments.id, assignmentId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return c.json({ error: 'assignment_not_found', code: 'assignment_not_found' }, 404);
    }
    // Doble check de ownership (defensa en profundidad — el servicio
    // también valida).
    if (row.empresaId !== auth.activeMembership.empresa.id) {
      return c.json({ error: 'forbidden_owner_mismatch', code: 'forbidden_owner_mismatch' }, 403);
    }

    const result = await confirmarEntregaViaje({
      db: opts.db,
      logger: opts.logger,
      tripId: row.tripId,
      source: 'carrier',
      actor: {
        empresaId: auth.activeMembership.empresa.id,
        userId: auth.userContext.user.id,
      },
      config: opts.certConfig ?? {},
    });

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
        },
        statusCode,
      );
    }

    return c.json({
      ok: true,
      already_delivered: result.alreadyDelivered,
      delivered_at: result.deliveredAt.toISOString(),
    });
  });

  // ---------------------------------------------------------------------
  // POST /:id/incidents — Phase 4 PR-K6
  //
  // El conductor reporta un incidente operacional durante el viaje
  // (accidente, demora, falla mecánica, problema de carga, otro).
  //
  // Disparado vía:
  //   - Voice command "marcar incidente" / "tengo un problema" (PR-K3
  //     framework existente)
  //   - Botón visual fallback en el assignment-detail
  //
  // Persiste como tripEvent (audit-only), NO bloquea el lifecycle del
  // viaje. La cancelación es un flujo separado.
  //
  // Auth: carrier owner del assignment. 401/403 estándar.
  // ---------------------------------------------------------------------
  const incidentBodySchema = z.object({
    incident_type: z.enum(INCIDENT_TYPES),
    description: z.string().trim().max(1000).optional(),
  });

  app.post('/:id/incidents', zValidator('json', incidentBodySchema), async (c) => {
    const auth = requireCarrierAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const assignmentId = c.req.param('id');
    const body = c.req.valid('json');

    const result = await reportarIncidente({
      db: opts.db,
      logger: opts.logger,
      assignmentId,
      input: {
        incidentType: body.incident_type,
        ...(body.description ? { description: body.description } : {}),
        actor: {
          empresaId: auth.activeMembership.empresa.id,
          userId: auth.userContext.user.id,
        },
      },
    });

    if (!result.ok) {
      const statusCode = result.code === 'assignment_not_found' ? 404 : 403;
      return c.json({ error: result.code, code: result.code }, statusCode);
    }

    return c.json(
      {
        ok: true,
        trip_event_id: result.tripEventId,
        recorded_at: result.recordedAt.toISOString(),
      },
      201,
    );
  });

  // ---------------------------------------------------------------------
  // GET /:id/behavior-score — Phase 2 PR-I4
  //
  // Devuelve el behavior score persistido en metricas_viaje del trip
  // asociado al assignment. El score se calcula post-entrega
  // (calcular-score-conduccion-viaje.ts) consumiendo eventos de
  // eventos_conduccion_verde.
  //
  // Estados:
  //   - score persistido (numérico) → 200 con shape completo
  //   - score NULL (trip sin Teltonika o no entregado todavía) → 200
  //     con score: null + status: 'no_disponible' para que la UI
  //     muestre estado apropiado sin tirar 404
  //   - assignment no existe / no es del carrier → 404 / 403
  // ---------------------------------------------------------------------
  app.get('/:id/behavior-score', async (c) => {
    const auth = requireCarrierAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const assignmentId = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [row] = await opts.db
      .select({
        assignmentEmpresaId: assignments.empresaId,
        tripId: assignments.tripId,
        score: tripMetrics.behaviorScore,
        nivel: tripMetrics.behaviorScoreNivel,
        breakdown: tripMetrics.behaviorScoreBreakdown,
        calculatedAt: tripMetrics.calculatedAt,
      })
      .from(assignments)
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, assignments.tripId))
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    if (!row) {
      return c.json({ error: 'assignment_not_found', code: 'assignment_not_found' }, 404);
    }
    if (row.assignmentEmpresaId !== empresaId) {
      return c.json({ error: 'forbidden', code: 'assignment_forbidden' }, 403);
    }

    if (row.score === null || row.score === undefined) {
      return c.json({
        trip_id: row.tripId,
        score: null,
        nivel: null,
        breakdown: null,
        status: 'no_disponible',
        // Razón probable para la UI: cliente sin Teltonika activo, o
        // trip todavía no entregado. La UI muestra "Activa Teltonika
        // para ver behavior score" según el tier del transportista.
        reason: 'sin_eventos_o_sin_telemetria',
      });
    }

    return c.json({
      trip_id: row.tripId,
      score: Number(row.score),
      nivel: row.nivel,
      breakdown: row.breakdown,
      calculated_at: row.calculatedAt,
      status: 'disponible',
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id/coaching — Phase 3 PR-J2
  //
  // Devuelve el mensaje de coaching IA persistido en metricas_viaje
  // del trip. Generado post-entrega por generar-coaching-viaje.ts a
  // partir del behavior score breakdown (PR-I4) usando Gemini API o
  // fallback de plantilla determinística.
  // ---------------------------------------------------------------------
  app.get('/:id/coaching', async (c) => {
    const auth = requireCarrierAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const assignmentId = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [row] = await opts.db
      .select({
        assignmentEmpresaId: assignments.empresaId,
        tripId: assignments.tripId,
        mensaje: tripMetrics.coachingMensaje,
        foco: tripMetrics.coachingFoco,
        fuente: tripMetrics.coachingFuente,
        modelo: tripMetrics.coachingModelo,
        generadoEn: tripMetrics.coachingGeneradoEn,
      })
      .from(assignments)
      .leftJoin(tripMetrics, eq(tripMetrics.tripId, assignments.tripId))
      .where(eq(assignments.id, assignmentId))
      .limit(1);

    if (!row) {
      return c.json({ error: 'assignment_not_found', code: 'assignment_not_found' }, 404);
    }
    if (row.assignmentEmpresaId !== empresaId) {
      return c.json({ error: 'forbidden', code: 'assignment_forbidden' }, 403);
    }

    if (!row.mensaje) {
      return c.json({
        trip_id: row.tripId,
        message: null,
        focus: null,
        source: null,
        status: 'no_disponible',
        reason: 'sin_score_o_no_entregado',
      });
    }

    return c.json({
      trip_id: row.tripId,
      message: row.mensaje,
      focus: row.foco,
      source: row.fuente, // 'gemini' | 'plantilla'
      model: row.modelo,
      generated_at: row.generadoEn,
      status: 'disponible',
    });
  });

  return app;
}

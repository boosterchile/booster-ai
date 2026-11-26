import { randomUUID } from 'node:crypto';
import type { Logger } from '@booster-ai/logger';
import { type CrearViajePropioBody, crearViajePropioBodySchema } from '@booster-ai/shared-schemas';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  type AssignmentRow,
  type TripRow,
  assignments,
  empresas,
  tripEvents,
  trips,
} from '../db/schema.js';
import { crearRutaDeAsignacion } from './crear-ruta-de-asignacion.js';

export class ViajePropioValidacionError extends Error {
  constructor(public readonly issues: unknown) {
    super('viaje_propio_validacion');
    this.name = 'ViajePropioValidacionError';
  }
}

export class EmpresaNoTransportistaError extends Error {
  constructor(public readonly empresaId: string) {
    super(`empresa_no_transportista:${empresaId}`);
    this.name = 'EmpresaNoTransportistaError';
  }
}

export class GeneradorNoEncontradoError extends Error {
  constructor(public readonly empresaId: string) {
    super(`generador_no_encontrado:${empresaId}`);
    this.name = 'GeneradorNoEncontradoError';
  }
}

/** IDOR: no se puede vincular un generador sin relación comercial previa. */
export class GeneradorSinVinculoError extends Error {
  constructor(public readonly empresaId: string) {
    super(`generador_sin_vinculo:${empresaId}`);
    this.name = 'GeneradorSinVinculoError';
  }
}

/**
 * Vínculo comercial verificable transportista↔generador:
 * mismo tenant, o historial de al menos una asignación marketplace previa.
 */
async function tieneVinculoComercial(
  db: Db,
  transportistaId: string,
  generadorId: string,
): Promise<boolean> {
  if (transportistaId === generadorId) {
    return true;
  }
  const rows = await db
    .select({ id: assignments.id })
    .from(assignments)
    .innerJoin(trips, eq(trips.id, assignments.tripId))
    .where(
      and(
        eq(assignments.empresaId, transportistaId),
        eq(trips.generadorCargaEmpresaId, generadorId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

function generateTrackingCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `BOO-${suffix}`;
}

export type CrearViajePropioResult = {
  trip: TripRow;
  assignment: AssignmentRow;
  rutaId: string;
};

/**
 * BARH-24 — alta de viaje propio del transportista.
 * No llama matching; no crea ofertas; assignment inmediata + ruta planificada.
 * `agreedPriceClp = 0` documentado (precio_acordado_clp NOT NULL; liquidación
 * propia fuera de esta slice).
 */
export async function crearViajePropio(opts: {
  db: Db;
  logger: Logger;
  empresaTransportistaId: string;
  userId: string;
  input: unknown;
  /** Solo para tests: spy de que matching no se invoca. */
  runMatching?: (args: unknown) => unknown;
}): Promise<CrearViajePropioResult> {
  const parsed = crearViajePropioBodySchema.safeParse(opts.input);
  if (!parsed.success) {
    throw new ViajePropioValidacionError(parsed.error.flatten());
  }
  const body: CrearViajePropioBody = parsed.data;

  // Si el caller inyecta runMatching, no lo llamamos — invariante de producto.
  void opts.runMatching;

  const carrierRows = await opts.db
    .select({
      id: empresas.id,
      isTransportista: empresas.isTransportista,
      status: empresas.status,
    })
    .from(empresas)
    .where(eq(empresas.id, opts.empresaTransportistaId))
    .limit(1);
  const carrier = carrierRows[0];
  if (!carrier || !carrier.isTransportista || carrier.status !== 'activa') {
    throw new EmpresaNoTransportistaError(opts.empresaTransportistaId);
  }

  let generadorCargaEmpresaId: string | null = null;
  let clienteExternoNombre: string | null = null;
  let clienteExternoRut: string | null = null;
  let clienteExternoContacto: string | null = null;
  let clienteExternoCorreo: string | null = null;

  if (body.cliente.tipo === 'generador') {
    const genRows = await opts.db
      .select({
        id: empresas.id,
        isGeneradorCarga: empresas.isGeneradorCarga,
        status: empresas.status,
      })
      .from(empresas)
      .where(and(eq(empresas.id, body.cliente.empresa_id), eq(empresas.isGeneradorCarga, true)))
      .limit(1);
    const gen = genRows[0];
    if (!gen || gen.status !== 'activa') {
      throw new GeneradorNoEncontradoError(body.cliente.empresa_id);
    }
    // Security HIGH discussion_r4589080075: no setear tenancy del generador
    // sin vínculo comercial verificable (historial o mismo tenant).
    const vinculado = await tieneVinculoComercial(opts.db, opts.empresaTransportistaId, gen.id);
    if (!vinculado) {
      throw new GeneradorSinVinculoError(gen.id);
    }
    generadorCargaEmpresaId = gen.id;
  } else {
    clienteExternoNombre = body.cliente.nombre;
    clienteExternoRut = body.cliente.rut ?? null;
    clienteExternoContacto = body.cliente.contacto ?? null;
    clienteExternoCorreo = body.cliente.correo ?? null;
  }

  const now = new Date();
  const result = await opts.db.transaction(async (tx) => {
    const [trip] = await tx
      .insert(trips)
      .values({
        trackingCode: generateTrackingCode(),
        generadorCargaEmpresaId,
        createdByUserId: opts.userId,
        originAddressRaw: body.origen.address_raw,
        originRegionCode: body.origen.region_code,
        originComunaCode: body.origen.comuna_code ?? null,
        destinationAddressRaw: body.destino.address_raw,
        destinationRegionCode: body.destino.region_code,
        destinationComunaCode: body.destino.comuna_code ?? null,
        cargoType: body.cargo_type,
        cargoWeightKg: body.cargo_weight_kg ?? null,
        cargoVolumeM3: body.cargo_volume_m3 ?? null,
        pickupDateRaw: body.pickup_date_raw,
        proposedPriceClp: null,
        origenAlta: 'propio_transportista',
        clienteExternoNombre,
        clienteExternoRut,
        clienteExternoContacto,
        clienteExternoCorreo,
        status: 'asignado',
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!trip) {
      throw new Error('Insert viaje propio sin fila');
    }

    const [assignment] = await tx
      .insert(assignments)
      .values({
        tripId: trip.id,
        offerId: null,
        empresaId: opts.empresaTransportistaId,
        vehicleId: null,
        status: 'asignado',
        agreedPriceClp: 0,
        acceptedAt: now,
        publicTrackingToken: randomUUID(),
      })
      .returning();
    if (!assignment) {
      throw new Error('Insert assignment propio sin fila');
    }

    const { rutaId } = await crearRutaDeAsignacion(tx, {
      assignment,
      userId: opts.userId,
    });

    await tx.insert(tripEvents).values({
      tripId: trip.id,
      assignmentId: assignment.id,
      eventType: 'asignacion_creada',
      payload: {
        origen: 'propio_transportista',
        empresa_transportista_id: opts.empresaTransportistaId,
        cliente_tipo: body.cliente.tipo,
      },
      source: 'api',
      recordedByUserId: opts.userId,
    });

    return { trip, assignment, rutaId };
  });

  opts.logger.info(
    {
      tripId: result.trip.id,
      assignmentId: result.assignment.id,
      rutaId: result.rutaId,
      empresaId: opts.empresaTransportistaId,
      origen: 'propio_transportista',
    },
    'viaje propio creado',
  );

  return result;
}

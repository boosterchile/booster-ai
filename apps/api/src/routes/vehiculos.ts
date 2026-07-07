import type { Logger } from '@booster-ai/logger';
import {
  type BodyType,
  type FuelType,
  type UnitCategory,
  type UnitType,
  bodyTypeSchema,
  chileanPlateSchema,
  derivarUnidadDesdeTipoLegacy,
  unitCategorySchema,
  unitTypeSchema,
  validarCoherenciaUnidadVehiculo,
} from '@booster-ai/shared-schemas';
import { zValidator } from '@hono/zod-validator';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { posicionesMovilConductor, telemetryPoints, vehicles } from '../db/schema.js';

/**
 * Endpoints de vehículos. CRUD completo:
 *
 *   GET    /vehiculos          → lista de la empresa activa (todos los users)
 *   POST   /vehiculos          → crear (dueno/admin/despachador)
 *   GET    /vehiculos/:id      → detalle (todos los users)
 *   PATCH  /vehiculos/:id      → actualizar (dueno/admin/despachador)
 *   DELETE /vehiculos/:id      → soft delete = vehicleStatus 'retirado'
 *                                (dueno/admin)
 *
 * Reglas multi-tenant:
 *   - Todos los reads y writes filtran por activeMembership.empresa.id.
 *   - Patente única en el sistema (constraint DB). Si choca → 409.
 *   - teltonika_imei se asigna desde /admin/dispositivos-pendientes
 *     (asociar). Acá NO se permite setearlo directamente para no abrir un
 *     flujo paralelo al de open enrollment — devolvemos 400 si vienen.
 */

const vehicleTypes = [
  'camioneta',
  'furgon_pequeno',
  'furgon_mediano',
  'camion_pequeno',
  'camion_mediano',
  'camion_pesado',
  'semi_remolque',
  'refrigerado',
  'tanque',
] as const;

const fuelTypes = [
  'diesel',
  'gasolina',
  'gas_glp',
  'gas_gnc',
  'electrico',
  'hibrido_diesel',
  'hibrido_gasolina',
  'hidrogeno',
] as const;

const vehicleStatuses = ['activo', 'mantenimiento', 'retirado'] as const;

// Patente chilena. Acepta input con o sin separadores (·, -, ., espacios) y
// en cualquier capitalización; persiste en formato canónico de 6 chars
// `[A-Z]{4}\d{2}` (ej: BCDF12). Schema centralizado en
// @booster-ai/shared-schemas para que cliente y servidor compartan reglas.
//
// Reemplaza el schema laxo previo que aceptaba `....`, `XXX-99`, `1234`, etc.
// porque solo validaba caracteres + min(4), no la estructura chilena.
// W4a (migración 0048, ADR-073) — tipologías de flota. `vehicle_type`
// (arriba, enum legacy) sigue obligatorio: la columna SQL `tipo_vehiculo`
// no se toca y sigue NOT NULL. `unit_type` es el campo NUEVO. D4.2 lo exigía
// obligatorio en toda escritura nueva, pero el fix C1 (review W4a, decisión
// PO opción b, 2026-07-06) lo relajó a OPCIONAL a nivel de forma: el form
// web actual (apps/web/src/routes/vehiculos.tsx, vehicleFormToBody) todavía
// no lo manda (W4b lo agregará) — en vez de romper el form, el handler de
// `POST /` deriva `unit_type`/`unit_category`/`body_type` desde
// `vehicle_type` (`derivarUnidadDesdeTipoLegacy`, mismo mapping D4 del
// backfill de la migración 0048) cuando `unit_type` no viene explícito. Si
// SÍ viene, se valida como antes (la derivación no pisa input explícito) —
// ver `.specs/_followups/retiro-derivacion-unit-type-create.md` para el
// plan de retiro de este fallback cuando el form mande el campo.
// `unit_category`/`body_type` quedan igual de opcionales que antes (default
// 'motriz'/null cuando no hay derivación en juego). `capacity_kg` relajado a
// `.min(0)` (D1.2: un tracto no carga solo) — el piso >0 para el resto de
// tipos motrices y para arrastre se valida en runtime
// (`validarCoherenciaUnidadVehiculo`, espejo de `chk_vehiculos_tipo_categoria`
// + D4.5), no acá a nivel de forma.
const createBodySchema = z.object({
  plate: chileanPlateSchema,
  vehicle_type: z.enum(vehicleTypes),
  unit_category: unitCategorySchema.optional(),
  unit_type: unitTypeSchema.optional(),
  body_type: bodyTypeSchema.nullable().optional(),
  capacity_kg: z.number().int().min(0).max(100_000),
  capacity_m3: z.number().int().positive().max(500).nullable().optional(),
  year: z.number().int().min(1980).max(2100).nullable().optional(),
  brand: z.string().min(1).max(50).nullable().optional(),
  model: z.string().min(1).max(100).nullable().optional(),
  fuel_type: z.enum(fuelTypes).nullable().optional(),
  curb_weight_kg: z.number().int().positive().max(50_000).nullable().optional(),
  consumption_l_per_100km_baseline: z.number().positive().max(99.99).nullable().optional(),
});

const updateBodySchema = createBodySchema.partial().extend({
  vehicle_status: z.enum(vehicleStatuses).optional(),
});

/**
 * Campos que participan de la coherencia tipo↔categoría
 * (`validarCoherenciaUnidadVehiculo`, espejo de
 * `chk_vehiculos_tipo_categoria` + D4.5). Si un PATCH no toca ninguno de
 * estos, no hace falta re-validar (el estado previo ya era coherente).
 */
const UNIT_CONFIG_FIELDS = [
  'unit_category',
  'unit_type',
  'capacity_kg',
  'curb_weight_kg',
  'consumption_l_per_100km_baseline',
  'fuel_type',
] as const;

function touchesUnitConfig(body: z.infer<typeof updateBodySchema>): boolean {
  return UNIT_CONFIG_FIELDS.some((f) => body[f] !== undefined);
}

/**
 * 422 antes de BD (D4 condición 3): valida `validarCoherenciaUnidadVehiculo`
 * y devuelve la respuesta de error si hay ≥1 violación, o `null` si la
 * configuración es coherente.
 */
function validarOResponderIncoherencia(
  c: Context,
  input: {
    unitCategory: UnitCategory;
    unitType: UnitType;
    capacityKg: number;
    curbWeightKg: number | null;
    consumptionLPer100kmBaseline: number | null;
    fuelType: FuelType | null;
  },
) {
  const violations = validarCoherenciaUnidadVehiculo(input);
  if (violations.length === 0) {
    return null;
  }
  return c.json(
    {
      error: 'tipo_categoria_incoherente',
      code: violations[0]?.code ?? 'tipo_categoria_incoherente',
      violations,
    },
    422,
  );
}

export function createVehiculosRoutes(opts: { db: Db; logger: Logger }) {
  const app = new Hono();

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireAuth(c: Context<any, any, any>) {
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
    return { ok: true as const, userContext, activeMembership: active };
  }

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireWriteRole(c: Context<any, any, any>) {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth;
    }
    const role = auth.activeMembership.membership.role;
    if (role !== 'dueno' && role !== 'admin' && role !== 'despachador') {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'write_role_required' }, 403),
      };
    }
    return auth;
  }

  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireDeleteRole(c: Context<any, any, any>) {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth;
    }
    const role = auth.activeMembership.membership.role;
    if (role !== 'dueno' && role !== 'admin') {
      return {
        ok: false as const,
        response: c.json({ error: 'forbidden', code: 'admin_required' }, 403),
      };
    }
    return auth;
  }

  // ---------------------------------------------------------------------
  // GET / — lista de vehículos de la empresa activa.
  // ---------------------------------------------------------------------
  app.get('/', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }

    const rows = await opts.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        type: vehicles.vehicleType,
        unit_category: vehicles.unitCategory,
        unit_type: vehicles.unitType,
        body_type: vehicles.bodyType,
        capacity_kg: vehicles.capacityKg,
        capacity_m3: vehicles.capacityM3,
        year: vehicles.year,
        brand: vehicles.brand,
        model: vehicles.model,
        fuel_type: vehicles.fuelType,
        curb_weight_kg: vehicles.curbWeightKg,
        consumption_l_per_100km_baseline: vehicles.consumptionLPer100kmBaseline,
        teltonika_imei: vehicles.teltonikaImei,
        status: vehicles.vehicleStatus,
        created_at: vehicles.createdAt,
        updated_at: vehicles.updatedAt,
      })
      .from(vehicles)
      .where(eq(vehicles.empresaId, auth.activeMembership.empresa.id))
      .orderBy(asc(vehicles.plate));

    return c.json({ vehicles: rows });
  });

  // ---------------------------------------------------------------------
  // GET /flota — vehículos de la empresa con su última ubicación.
  //
  // Versión bulk de /:id/ubicacion: una sola query con LATERAL JOIN
  // (vía subselect DISTINCT ON) que retorna todos los vehículos de la
  // empresa activa + su último punto GPS (si existe). Pensado para la
  // vista de seguimiento de flota (/app/flota) que necesita renderizar
  // un mapa con N markers sin N+1 round trips.
  //
  // Vehículos sin Teltonika asociado o sin telemetría todavía aparecen
  // con `position: null`. La UI los muestra como "Sin posición aún".
  // ---------------------------------------------------------------------
  app.get('/flota', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const empresaId = auth.activeMembership.empresa.id;

    const vehicleRows = await opts.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        type: vehicles.vehicleType,
        teltonika_imei: vehicles.teltonikaImei,
        teltonika_imei_espejo: vehicles.teltonikaImeiEspejo,
        status: vehicles.vehicleStatus,
      })
      .from(vehicles)
      .where(eq(vehicles.empresaId, empresaId))
      .orderBy(asc(vehicles.plate));

    // D1/D2 — Particionamos los vehículos en tres grupos:
    //   - withOwnDevice: tienen teltonika_imei propio → lookup por
    //     vehicle_id (path histórico, eficiente con indice ya existente).
    //   - withMirrorImei: solo tienen espejo → lookup por imei. Su data
    //     pertenece al stream de otro vehículo físico (demo o redundancia).
    //   - withoutDevice: sin Teltonika → lookup en posiciones_movil_conductor
    //     por vehicle_id (D2 browser GPS).
    const withOwnDevice = vehicleRows.filter((v) => v.teltonika_imei != null);
    const withMirrorImei = vehicleRows.filter(
      (v) => v.teltonika_imei == null && v.teltonika_imei_espejo != null,
    );
    const withoutDevice = vehicleRows.filter(
      (v) => v.teltonika_imei == null && v.teltonika_imei_espejo == null,
    );

    type LastPoint = {
      timestamp_device: Date;
      latitude: string | null;
      longitude: string | null;
      speed_kmh: number | null;
      angle_deg: number | null;
    };

    const ownVehicleIds = withOwnDevice.map((v) => v.id);
    const ownLastPoints =
      ownVehicleIds.length === 0
        ? []
        : await opts.db
            .selectDistinctOn([telemetryPoints.vehicleId], {
              vehicle_id: telemetryPoints.vehicleId,
              timestamp_device: telemetryPoints.timestampDevice,
              latitude: telemetryPoints.latitude,
              longitude: telemetryPoints.longitude,
              speed_kmh: telemetryPoints.speedKmh,
              angle_deg: telemetryPoints.angleDeg,
            })
            .from(telemetryPoints)
            .where(inArray(telemetryPoints.vehicleId, ownVehicleIds))
            .orderBy(telemetryPoints.vehicleId, desc(telemetryPoints.timestampDevice));
    const lastByVehicleId = new Map<string, LastPoint>();
    for (const p of ownLastPoints) {
      if (p.vehicle_id != null) {
        lastByVehicleId.set(p.vehicle_id, p);
      }
    }

    const mirrorImeis = [
      ...new Set(
        withMirrorImei.map((v) => v.teltonika_imei_espejo).filter((x): x is string => x != null),
      ),
    ];
    const mirrorLastPoints =
      mirrorImeis.length === 0
        ? []
        : await opts.db
            .selectDistinctOn([telemetryPoints.imei], {
              imei: telemetryPoints.imei,
              timestamp_device: telemetryPoints.timestampDevice,
              latitude: telemetryPoints.latitude,
              longitude: telemetryPoints.longitude,
              speed_kmh: telemetryPoints.speedKmh,
              angle_deg: telemetryPoints.angleDeg,
            })
            .from(telemetryPoints)
            .where(inArray(telemetryPoints.imei, mirrorImeis))
            .orderBy(telemetryPoints.imei, desc(telemetryPoints.timestampDevice));
    const lastByImei = new Map<string, LastPoint>();
    for (const p of mirrorLastPoints) {
      lastByImei.set(p.imei, p);
    }

    // D2 — Browser GPS lookup para vehículos sin Teltonika.
    const noDeviceVehicleIds = withoutDevice.map((v) => v.id);
    const browserLastPoints =
      noDeviceVehicleIds.length === 0
        ? []
        : await opts.db
            .selectDistinctOn([posicionesMovilConductor.vehicleId], {
              vehicle_id: posicionesMovilConductor.vehicleId,
              timestamp_device: posicionesMovilConductor.timestampDevice,
              latitude: posicionesMovilConductor.latitude,
              longitude: posicionesMovilConductor.longitude,
              speed_kmh: posicionesMovilConductor.speedKmh,
              heading_deg: posicionesMovilConductor.headingDeg,
            })
            .from(posicionesMovilConductor)
            .where(inArray(posicionesMovilConductor.vehicleId, noDeviceVehicleIds))
            .orderBy(
              posicionesMovilConductor.vehicleId,
              desc(posicionesMovilConductor.timestampDevice),
            );
    const browserByVehicleId = new Map<string, LastPoint>();
    for (const p of browserLastPoints) {
      browserByVehicleId.set(p.vehicle_id, {
        timestamp_device: p.timestamp_device,
        latitude: p.latitude,
        longitude: p.longitude,
        speed_kmh: p.speed_kmh != null ? Number.parseFloat(p.speed_kmh) : null,
        angle_deg: p.heading_deg,
      });
    }

    const fleet = vehicleRows.map((v) => {
      const point: LastPoint | undefined = v.teltonika_imei
        ? lastByVehicleId.get(v.id)
        : v.teltonika_imei_espejo
          ? lastByImei.get(v.teltonika_imei_espejo)
          : browserByVehicleId.get(v.id);
      const source: 'own' | 'mirror' | 'browser_gps' | null = v.teltonika_imei
        ? 'own'
        : v.teltonika_imei_espejo
          ? 'mirror'
          : point
            ? 'browser_gps'
            : null;
      return {
        id: v.id,
        plate: v.plate,
        type: v.type,
        teltonika_imei: v.teltonika_imei ?? v.teltonika_imei_espejo,
        teltonika_source: source,
        status: v.status,
        position: point
          ? {
              timestamp_device: point.timestamp_device,
              latitude: point.latitude != null ? Number.parseFloat(point.latitude) : null,
              longitude: point.longitude != null ? Number.parseFloat(point.longitude) : null,
              speed_kmh: point.speed_kmh,
              angle_deg: point.angle_deg,
            }
          : null,
      };
    });

    return c.json({ fleet });
  });

  // ---------------------------------------------------------------------
  // POST / — crear vehículo.
  // ---------------------------------------------------------------------
  app.post('/', zValidator('json', createBodySchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    // Fix C1 (review W4a, decisión PO opción b, 2026-07-06): si `unit_type`
    // no vino en el body (el form web actual todavía no lo manda), derivar
    // unit_category/unit_type/body_type desde vehicle_type con el mismo
    // mapping D4 del backfill de la migración 0048
    // (`derivarUnidadDesdeTipoLegacy`, packages/shared-schemas). Si
    // `unit_type` SÍ vino explícito, se respeta tal cual — la derivación
    // NUNCA pisa input explícito, ni siquiera parcialmente: solo completa
    // los campos hermanos (`unit_category`/`body_type`) que el cliente no
    // haya mandado él mismo.
    let unitCategory: UnitCategory;
    let unitType: UnitType;
    let bodyType: BodyType | null;
    let derivadoDeTipoLegacy = false;

    if (body.unit_type === undefined) {
      const derivado = derivarUnidadDesdeTipoLegacy(body.vehicle_type);
      unitType = derivado.unitType;
      unitCategory = body.unit_category ?? derivado.unitCategory;
      bodyType = body.body_type !== undefined ? (body.body_type ?? null) : derivado.bodyType;
      derivadoDeTipoLegacy = true;
    } else {
      unitType = body.unit_type;
      unitCategory = body.unit_category ?? 'motriz';
      bodyType = body.body_type ?? null;
    }

    // D4 condición 3 — CHECK tipo↔categoría (+ D4.5) validado en Zod/runtime
    // ANTES de llegar a BD. La CHECK `chk_vehiculos_tipo_categoria` de la
    // migración 0048 es la red de seguridad final, no la primera línea.
    const incoherencia = validarOResponderIncoherencia(c, {
      unitCategory,
      unitType,
      capacityKg: body.capacity_kg,
      curbWeightKg: body.curb_weight_kg ?? null,
      consumptionLPer100kmBaseline: body.consumption_l_per_100km_baseline ?? null,
      fuelType: body.fuel_type ?? null,
    });
    if (incoherencia) {
      return incoherencia;
    }

    try {
      const [created] = await opts.db
        .insert(vehicles)
        .values({
          empresaId,
          plate: body.plate,
          vehicleType: body.vehicle_type,
          unitCategory,
          unitType,
          bodyType,
          capacityKg: body.capacity_kg,
          capacityM3: body.capacity_m3 ?? null,
          year: body.year ?? null,
          brand: body.brand ?? null,
          model: body.model ?? null,
          fuelType: body.fuel_type ?? null,
          curbWeightKg: body.curb_weight_kg ?? null,
          consumptionLPer100kmBaseline:
            body.consumption_l_per_100km_baseline != null
              ? body.consumption_l_per_100km_baseline.toString()
              : null,
        })
        .returning();

      if (!created) {
        opts.logger.error({ empresaId, body }, 'insert vehiculo no devolvió row');
        return c.json({ error: 'insert_failed' }, 500);
      }
      opts.logger.info(
        { vehicleId: created.id, plate: created.plate, empresaId },
        'vehículo creado',
      );
      // Condición 1 del PO (fix C1): log estructurado cada vez que la
      // derivación dispara — el PO quiere contar cuántos creates la usan
      // para decidir el criterio de retiro (ver follow-up stub
      // .specs/_followups/retiro-derivacion-unit-type-create.md).
      if (derivadoDeTipoLegacy) {
        opts.logger.info(
          {
            vehicleType: body.vehicle_type,
            derivedUnitCategory: unitCategory,
            derivedUnitType: unitType,
            derivedBodyType: bodyType,
            empresaId,
            vehicleId: created.id,
          },
          'unit_type derivado desde vehicle_type en create (fix C1, ADR-073 §Caveat C1 runtime)',
        );
      }
      return c.json({ vehicle: serializeVehicle(created) }, 201);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        // unique_violation — patente o IMEI duplicado.
        return c.json({ error: 'plate_already_exists', code: 'plate_duplicate' }, 409);
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------
  // GET /:id — detalle.
  // ---------------------------------------------------------------------
  app.get('/:id', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');

    const [row] = await opts.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, auth.activeMembership.empresa.id)))
      .limit(1);

    if (!row) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }
    return c.json({ vehicle: serializeVehicle(row) });
  });

  // ---------------------------------------------------------------------
  // PATCH /:id — actualizar campos parciales.
  // ---------------------------------------------------------------------
  app.patch('/:id', zValidator('json', updateBodySchema), async (c) => {
    const auth = requireWriteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;

    // Verificar ownership antes del update. Trae también el estado actual
    // relevante para la coherencia tipo↔categoría (D4): un PATCH parcial
    // que solo toca, por ejemplo, `capacity_kg` necesita saber el
    // `unit_category`/`unit_type` YA persistidos para re-validar el estado
    // resultante (merge), no solo el fragmento que llegó en el body.
    const [existing] = await opts.db
      .select({
        id: vehicles.id,
        unitCategory: vehicles.unitCategory,
        unitType: vehicles.unitType,
        capacityKg: vehicles.capacityKg,
        curbWeightKg: vehicles.curbWeightKg,
        consumptionLPer100kmBaseline: vehicles.consumptionLPer100kmBaseline,
        fuelType: vehicles.fuelType,
      })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!existing) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.plate !== undefined) {
      updates.plate = body.plate;
    }
    if (body.vehicle_type !== undefined) {
      updates.vehicleType = body.vehicle_type;
    }
    if (body.unit_category !== undefined) {
      updates.unitCategory = body.unit_category;
    }
    if (body.unit_type !== undefined) {
      updates.unitType = body.unit_type;
    }
    if (body.body_type !== undefined) {
      updates.bodyType = body.body_type;
    }
    if (body.capacity_kg !== undefined) {
      updates.capacityKg = body.capacity_kg;
    }
    if (body.capacity_m3 !== undefined) {
      updates.capacityM3 = body.capacity_m3;
    }
    if (body.year !== undefined) {
      updates.year = body.year;
    }
    if (body.brand !== undefined) {
      updates.brand = body.brand;
    }
    if (body.model !== undefined) {
      updates.model = body.model;
    }
    if (body.fuel_type !== undefined) {
      updates.fuelType = body.fuel_type;
    }
    if (body.curb_weight_kg !== undefined) {
      updates.curbWeightKg = body.curb_weight_kg;
    }
    if (body.consumption_l_per_100km_baseline !== undefined) {
      updates.consumptionLPer100kmBaseline =
        body.consumption_l_per_100km_baseline != null
          ? body.consumption_l_per_100km_baseline.toString()
          : null;
    }
    if (body.vehicle_status !== undefined) {
      updates.vehicleStatus = body.vehicle_status;
    }

    // D4 condición 3 — re-validar coherencia SOLO si el PATCH toca algún
    // campo relevante (unit_category/unit_type/capacity_kg/curb_weight_kg/
    // consumption_l_per_100km_baseline/fuel_type), mergeando con el estado
    // ya persistido. Si el `unit_type` efectivo (post-merge) sigue siendo
    // NULL (fila legacy que nunca lo declaró), no hay nada que validar —
    // igual que la CHECK de BD, que bypasea cuando tipo_unidad IS NULL.
    if (touchesUnitConfig(body)) {
      const effectiveUnitType = body.unit_type !== undefined ? body.unit_type : existing.unitType;
      if (effectiveUnitType != null) {
        const effectiveConsumption =
          body.consumption_l_per_100km_baseline !== undefined
            ? body.consumption_l_per_100km_baseline
            : existing.consumptionLPer100kmBaseline != null
              ? Number(existing.consumptionLPer100kmBaseline)
              : null;
        const incoherencia = validarOResponderIncoherencia(c, {
          unitCategory:
            body.unit_category !== undefined ? body.unit_category : existing.unitCategory,
          unitType: effectiveUnitType,
          capacityKg: body.capacity_kg !== undefined ? body.capacity_kg : existing.capacityKg,
          curbWeightKg:
            body.curb_weight_kg !== undefined
              ? (body.curb_weight_kg ?? null)
              : existing.curbWeightKg,
          consumptionLPer100kmBaseline: effectiveConsumption ?? null,
          fuelType: body.fuel_type !== undefined ? (body.fuel_type ?? null) : existing.fuelType,
        });
        if (incoherencia) {
          return incoherencia;
        }
      }
    }

    try {
      const [updated] = await opts.db
        .update(vehicles)
        .set(updates)
        .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
        .returning();

      if (!updated) {
        return c.json({ error: 'vehicle_not_found' }, 404);
      }
      opts.logger.info(
        { vehicleId: id, plate: updated.plate, empresaId, fields: Object.keys(updates) },
        'vehículo actualizado',
      );
      return c.json({ vehicle: serializeVehicle(updated) });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505') {
        return c.json({ error: 'plate_already_exists', code: 'plate_duplicate' }, 409);
      }
      throw err;
    }
  });

  // ---------------------------------------------------------------------
  // DELETE /:id — soft delete (vehicleStatus = 'retirado').
  // No hard-delete porque vehicles está referenciado por trip_assignments,
  // telemetria_puntos, etc. Borrar rompería integridad.
  // ---------------------------------------------------------------------
  app.delete('/:id', async (c) => {
    const auth = requireDeleteRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [updated] = await opts.db
      .update(vehicles)
      .set({ vehicleStatus: 'retirado', updatedAt: new Date() })
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .returning();

    if (!updated) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    opts.logger.info({ vehicleId: id, plate: updated.plate, empresaId }, 'vehículo retirado');
    return c.json({ vehicle: serializeVehicle(updated) });
  });

  // ---------------------------------------------------------------------
  // GET /:id/telemetria — últimos puntos de telemetría del vehículo.
  //
  // Limit default 50, max 500. Sirve para confirmar que el processor
  // está poblando telemetria_puntos (post asociación a Teltonika) +
  // pantalla de "actividad reciente" en /app/vehiculos/:id.
  // ---------------------------------------------------------------------
  app.get('/:id/telemetria', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const limitParam = Number.parseInt(c.req.query('limit') ?? '50', 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 500) : 50;

    // Verificar ownership del vehículo antes de exponer telemetría.
    const [vehicle] = await opts.db
      .select({ id: vehicles.id, plate: vehicles.plate, teltonikaImei: vehicles.teltonikaImei })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!vehicle) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    const rows = await opts.db
      .select({
        id: telemetryPoints.id,
        imei: telemetryPoints.imei,
        timestamp_device: telemetryPoints.timestampDevice,
        timestamp_received_at: telemetryPoints.timestampReceivedAt,
        priority: telemetryPoints.priority,
        longitude: telemetryPoints.longitude,
        latitude: telemetryPoints.latitude,
        altitude_m: telemetryPoints.altitudeM,
        angle_deg: telemetryPoints.angleDeg,
        satellites: telemetryPoints.satellites,
        speed_kmh: telemetryPoints.speedKmh,
        event_io_id: telemetryPoints.eventIoId,
      })
      .from(telemetryPoints)
      .where(eq(telemetryPoints.vehicleId, id))
      .orderBy(desc(telemetryPoints.timestampDevice))
      .limit(limit);

    return c.json({
      vehicle_id: id,
      plate: vehicle.plate,
      teltonika_imei: vehicle.teltonikaImei,
      count: rows.length,
      points: rows.map((r) => ({
        id: r.id.toString(), // bigint → string para JSON
        imei: r.imei,
        timestamp_device: r.timestamp_device,
        timestamp_received_at: r.timestamp_received_at,
        priority: r.priority,
        longitude: r.longitude,
        latitude: r.latitude,
        altitude_m: r.altitude_m,
        angle_deg: r.angle_deg,
        satellites: r.satellites,
        speed_kmh: r.speed_kmh,
        event_io_id: r.event_io_id,
      })),
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id/ubicacion — último punto GPS del vehículo (para mapas).
  //
  // Versión liviana de /:id/telemetria optimizada para "dónde está ahora".
  // Devuelve solo el último point (no array). 404 si vehículo no tiene
  // teltonika asociado o no se han recibido packets.
  // ---------------------------------------------------------------------
  app.get('/:id/ubicacion', async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;

    const [vehicle] = await opts.db
      .select({
        id: vehicles.id,
        plate: vehicles.plate,
        teltonikaImei: vehicles.teltonikaImei,
        teltonikaImeiEspejo: vehicles.teltonikaImeiEspejo,
      })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!vehicle) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    // D1/D2 — Determinar fuente de datos en orden de prioridad:
    //   - Tiene teltonika_imei propio → leer por vehicle_id (path histórico).
    //   - Tiene teltonika_imei_espejo → leer por imei (D1 mirror).
    //   - No tiene ningún Teltonika → leer de posiciones_movil_conductor (D2
    //     GPS browser).
    const effectiveImei = vehicle.teltonikaImei ?? vehicle.teltonikaImeiEspejo;

    if (!effectiveImei) {
      // D2 — Browser GPS fallback.
      const [browserPoint] = await opts.db
        .select({
          timestamp_device: posicionesMovilConductor.timestampDevice,
          timestamp_received_at: posicionesMovilConductor.timestampReceivedAt,
          latitude: posicionesMovilConductor.latitude,
          longitude: posicionesMovilConductor.longitude,
          speed_kmh: posicionesMovilConductor.speedKmh,
          heading_deg: posicionesMovilConductor.headingDeg,
          accuracy_m: posicionesMovilConductor.accuracyM,
        })
        .from(posicionesMovilConductor)
        .where(eq(posicionesMovilConductor.vehicleId, id))
        .orderBy(desc(posicionesMovilConductor.timestampDevice))
        .limit(1);

      if (!browserPoint) {
        return c.json({ error: 'no_teltonika', code: 'no_teltonika', plate: vehicle.plate }, 404);
      }

      return c.json({
        vehicle_id: id,
        plate: vehicle.plate,
        teltonika_imei: null,
        teltonika_source: 'browser_gps',
        ubicacion: {
          timestamp_device: browserPoint.timestamp_device,
          timestamp_received_at: browserPoint.timestamp_received_at,
          latitude: Number.parseFloat(browserPoint.latitude),
          longitude: Number.parseFloat(browserPoint.longitude),
          altitude_m: null,
          angle_deg: browserPoint.heading_deg,
          satellites: null,
          speed_kmh:
            browserPoint.speed_kmh != null ? Number.parseFloat(browserPoint.speed_kmh) : null,
          priority: 0,
          accuracy_m:
            browserPoint.accuracy_m != null ? Number.parseFloat(browserPoint.accuracy_m) : null,
        },
      });
    }

    const baseSelect = opts.db
      .select({
        timestamp_device: telemetryPoints.timestampDevice,
        timestamp_received_at: telemetryPoints.timestampReceivedAt,
        longitude: telemetryPoints.longitude,
        latitude: telemetryPoints.latitude,
        altitude_m: telemetryPoints.altitudeM,
        angle_deg: telemetryPoints.angleDeg,
        satellites: telemetryPoints.satellites,
        speed_kmh: telemetryPoints.speedKmh,
        priority: telemetryPoints.priority,
      })
      .from(telemetryPoints);

    const [last] = vehicle.teltonikaImei
      ? await baseSelect
          .where(eq(telemetryPoints.vehicleId, id))
          .orderBy(desc(telemetryPoints.timestampDevice))
          .limit(1)
      : await baseSelect
          .where(eq(telemetryPoints.imei, effectiveImei))
          .orderBy(desc(telemetryPoints.timestampDevice))
          .limit(1);

    if (!last) {
      return c.json(
        {
          error: 'no_points_yet',
          code: 'no_points_yet',
          plate: vehicle.plate,
          imei: effectiveImei,
        },
        404,
      );
    }

    return c.json({
      vehicle_id: id,
      plate: vehicle.plate,
      teltonika_imei: effectiveImei,
      /**
       * D1/D2 — `teltonika_source` indica el canal de la posición:
       *   - `own`: Teltonika propio del vehículo.
       *   - `mirror`: leyendo el stream de otro IMEI (demo).
       *   - `browser_gps`: posición del browser del conductor (D2).
       */
      teltonika_source: vehicle.teltonikaImei ? 'own' : 'mirror',
      ubicacion: {
        timestamp_device: last.timestamp_device,
        timestamp_received_at: last.timestamp_received_at,
        latitude: last.latitude != null ? Number.parseFloat(last.latitude) : null,
        longitude: last.longitude != null ? Number.parseFloat(last.longitude) : null,
        altitude_m: last.altitude_m,
        angle_deg: last.angle_deg,
        satellites: last.satellites,
        speed_kmh: last.speed_kmh,
        priority: last.priority,
      },
    });
  });

  return app;
}

function serializeVehicle(row: typeof vehicles.$inferSelect) {
  return {
    id: row.id,
    plate: row.plate,
    type: row.vehicleType,
    unit_category: row.unitCategory,
    unit_type: row.unitType,
    body_type: row.bodyType,
    capacity_kg: row.capacityKg,
    capacity_m3: row.capacityM3,
    year: row.year,
    brand: row.brand,
    model: row.model,
    fuel_type: row.fuelType,
    curb_weight_kg: row.curbWeightKg,
    consumption_l_per_100km_baseline: row.consumptionLPer100kmBaseline,
    teltonika_imei: row.teltonikaImei,
    status: row.vehicleStatus,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

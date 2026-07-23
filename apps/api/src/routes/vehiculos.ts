import type { Logger } from '@booster-ai/logger';
import {
  AVL_ID_CAN,
  AVL_ID_DALLAS,
  type BodyType,
  type FuelType,
  type MinimalIoEntry,
  type UnitCategory,
  type UnitType,
  bodyTypeSchema,
  chileanPlateSchema,
  derivarUnidadDesdeTipoLegacy,
  interpretCanLvcan,
  interpretDallasTemperature,
  teltonikaImeiSchema,
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
import {
  pendingDevices,
  posicionesMovilConductor,
  telemetryPoints,
  vehicles,
} from '../db/schema.js';
import { getBusinessCounter } from '../observability/business-metrics.js';
import { setResultAttributes, withBusinessSpan } from '../observability/business-span.js';
import { obtenerTemperaturaAmbiente } from '../services/clima-ambiente-cache.js';
import { obtenerTrazaVehiculo } from '../services/obtener-traza-vehiculo.js';
import { obtenerClimaActual } from '../services/weather-api.js';

/**
 * Endpoints de vehículos. CRUD completo:
 *
 *   GET    /vehiculos              → lista de la empresa activa (todos los users)
 *   POST   /vehiculos              → crear (dueno/admin/despachador)
 *   GET    /vehiculos/:id          → detalle (todos los users)
 *   PATCH  /vehiculos/:id          → actualizar (dueno/admin/despachador)
 *   PATCH  /vehiculos/:id/dispositivo → asociar/cambiar/desasociar IMEI Teltonika
 *                                    (dueno/admin) — W2 self-service
 *   DELETE /vehiculos/:id          → soft delete = vehicleStatus 'retirado'
 *                                    (dueno/admin)
 *
 * Reglas multi-tenant:
 *   - Todos los reads y writes filtran por activeMembership.empresa.id.
 *   - Patente única en el sistema (constraint DB). Si choca → 409.
 *   - teltonika_imei: hasta W2 (hito 2 CORFO) solo se asignaba desde
 *     /admin/dispositivos-pendientes (asociar) y este PATCH lo descartaba
 *     silenciosamente (no estaba en `updateBodySchema`). Ahora el write-path
 *     self-service vive acá mismo, en `PATCH /:id/dispositivo` — ver esa
 *     ruta más abajo para el contrato completo (reconciliación con
 *     dispositivos_pendientes, invariante espejo, etc). El PATCH genérico
 *     de arriba (`/:id`) sigue sin aceptar teltonika_imei en su body.
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

/**
 * `telemetria_puntos.io_data` es jsonb sin `$type<>` en el schema Drizzle
 * (columna catalog-agnostic, ver comentario en db/schema.ts) → llega como
 * `unknown` al select. Boundary: validamos con Zod antes de interpretar
 * cualquier IO — el contenido lo escribió el processor a partir de bytes
 * de un device de terreno, no confiamos en la forma sin chequear.
 */
const ioDataRecordSchema = z.record(z.string(), z.union([z.number(), z.string()]));

/**
 * W3 — interpreta IO 72 (Dallas Temperature 1, FMC150) desde `io_data` para
 * exponerlo en `GET /vehiculos/:id/ubicacion`. `null` explícito si no hay
 * IO 72 en el punto o si el valor no pasa el catálogo Dallas (fuera del
 * rango físico DS18B20, ver `packages/shared-schemas/avl-ids`).
 *
 * `temperatura_registrada_en` viaja junto a `temperatura_c`: si no hay
 * lectura válida, tampoco hay timestamp de lectura que reportar.
 */
function extractTemperatura(
  ioData: unknown,
  timestampDevice: Date,
): { temperatura_c: number | null; temperatura_registrada_en: string | null } {
  const parsedIoData = ioDataRecordSchema.safeParse(ioData);
  const raw72 = parsedIoData.success ? parsedIoData.data['72'] : undefined;
  if (typeof raw72 !== 'number') {
    return { temperatura_c: null, temperatura_registrada_en: null };
  }

  const { telemetry } = interpretDallasTemperature([
    { id: AVL_ID_DALLAS.DALLAS_TEMPERATURE_1, value: raw72, byteSize: 2 },
  ]);
  const temperaturaC = telemetry.dallasTemperature1C ?? null;
  return {
    temperatura_c: temperaturaC,
    temperatura_registrada_en: temperaturaC != null ? timestampDevice.toISOString() : null,
  };
}

/** Nº de pings recientes que mira la sanity de varianza del sensor Dallas. */
export const SANITY_TEMP_PINGS = 20;
/** Mínimo de lecturas para disparar la sanity (evita falso positivo en device recién online). */
export const SANITY_TEMP_MIN = 10;

/** Lee el crudo IO 72 de un `io_data` (para la sanity de varianza). `null` si ausente. */
export function extraerRaw72(ioData: unknown): number | null {
  const parsed = ioDataRecordSchema.safeParse(ioData);
  const raw = parsed.success ? parsed.data['72'] : undefined;
  return typeof raw === 'number' ? raw : null;
}

/**
 * Sanity de varianza: `true` si hay ≥ `SANITY_TEMP_MIN` lecturas y TODAS son
 * exactamente 0. Una DS18B20 real —incluso a 0°C en cadena de frío— tiene ruido
 * físico; 0 exacto y constante sobre decenas de pings ⇒ sonda no cableada
 * (instalación fallida). Función pura.
 */
export function temperaturaConstanteCero(raw72: readonly number[]): boolean {
  return raw72.length >= SANITY_TEMP_MIN && raw72.every((v) => v === 0);
}

/**
 * Resuelve la temperatura de CARGA (sonda Dallas IO 72) con **gating por
 * provisioning**. Sin sensor cableado (`tieneSensor=false`) → siempre `null`,
 * sin importar el crudo: 0°C es lectura VÁLIDA (cadena de frío) e indistinguible
 * por VALOR de "sin sensor" — la distinción viene del flag, NO del dato (ver
 * `.specs/sensor-temperatura-flag/`). Con sensor → interpreta IO 72 + señal de
 * sanity (`temperatura_sensor_sospechoso`) si las últimas lecturas son 0
 * constante. NO se special-casea 0 en el intérprete (sigue siendo 0.0°C válido).
 */
export function resolverTemperaturaCarga(opts: {
  ioData: unknown;
  timestampDevice: Date;
  tieneSensor: boolean;
  recent72: readonly number[];
}): {
  temperatura_c: number | null;
  temperatura_registrada_en: string | null;
  temperatura_sensor_sospechoso: boolean;
} {
  if (!opts.tieneSensor) {
    return {
      temperatura_c: null,
      temperatura_registrada_en: null,
      temperatura_sensor_sospechoso: false,
    };
  }
  return {
    ...extractTemperatura(opts.ioData, opts.timestampDevice),
    temperatura_sensor_sospechoso: temperaturaConstanteCero(opts.recent72),
  };
}

/**
 * W4 — interpreta los 3 parámetros CAN LVCAN de la vista en vivo desde
 * `io_data`: **81** vehicle speed (km/h), **85** engine RPM, **89** fuel
 * level (%). Mismo molde que `extractTemperatura`: Zod safeParse boundary
 * sobre el jsonb (bytes de un device de terreno, no confiamos en la forma),
 * intérprete puro, retorno null-safe.
 *
 * El CAN solo llega con el **motor encendido** — si el ping no trae estos
 * IDs (vehículo apagado o sin adaptador CAN), los 3 campos son `null` y NO
 * rompe. Fuel level en litros (84), fuel consumed (83) y mileage (87) se
 * mapean en `avl-ids/` pero NO se exponen en vivo (historial por carga).
 */
export function extractCan(ioData: unknown): {
  can_speed_kmh: number | null;
  rpm: number | null;
  fuel_pct: number | null;
} {
  const parsed = ioDataRecordSchema.safeParse(ioData);
  if (!parsed.success) {
    return { can_speed_kmh: null, rpm: null, fuel_pct: null };
  }

  const viewIds = [
    AVL_ID_CAN.CAN_VEHICLE_SPEED,
    AVL_ID_CAN.CAN_ENGINE_RPM,
    AVL_ID_CAN.CAN_FUEL_LEVEL_PCT,
  ] as const;
  const entries: MinimalIoEntry[] = [];
  for (const id of viewIds) {
    const raw = parsed.data[String(id)];
    if (typeof raw === 'number') {
      // byteSize es informativo para el intérprete CAN (unsigned, no lo usa);
      // 89 es N1 (uint8), 81/85 son N2 (uint16).
      entries.push({ id, value: raw, byteSize: id === AVL_ID_CAN.CAN_FUEL_LEVEL_PCT ? 1 : 2 });
    }
  }

  const { telemetry } = interpretCanLvcan(entries);
  return {
    can_speed_kmh: telemetry.vehicleSpeedKmh ?? null,
    rpm: telemetry.engineRpm ?? null,
    fuel_pct: telemetry.fuelLevelPct ?? null,
  };
}

// W2 (hito 2 CORFO) — body del PATCH de auto-asociación de dispositivo.
// `teltonika_imei` es requerido (puede ser null para desasociar); usa el
// schema compartido con el frontend para paridad cliente/servidor.
const patchDispositivoBodySchema = z.object({
  teltonika_imei: teltonikaImeiSchema.nullable(),
  confirmar_reasociacion: z.boolean().optional(),
});

/**
 * TOCTOU en la reconciliación del IMEI entrante de `PATCH /:id/dispositivo`
 * (ver esa ruta más abajo): el UPDATE con CAS sobre `dispositivos_pendientes`
 * puede perder la carrera contra un actor externo — p.ej. un admin de
 * CUALQUIER empresa rechazando el mismo pending vía el panel
 * (`admin-dispositivos.ts:191-216`; D2b: el rechazo NO es tenant-scoped, ver
 * `.specs/hito-2-corfo-mes-8/decisiones.md`). Cuando el CAS devuelve 0 filas,
 * este error aborta la transacción COMPLETA (incluyendo el UPDATE ya
 * aplicado a `vehicles.teltonika_imei`) y el handler responde con el estado
 * REAL re-derivado fresco — "nunca silencioso".
 */
class PendingDeviceReconciliationConflictError extends Error {
  readonly detail:
    | { kind: 'rechazado'; rechazadoEn: Date; motivo: string | null }
    | { kind: 'inesperado'; status: string };

  constructor(
    detail:
      | { kind: 'rechazado'; rechazadoEn: Date; motivo: string | null }
      | { kind: 'inesperado'; status: string },
  ) {
    super('pending device reconciliation conflict (TOCTOU)');
    this.name = 'PendingDeviceReconciliationConflictError';
    this.detail = detail;
  }
}

// Métrica de negocio del PATCH de auto-asociación (W2). Único endpoint de
// vehiculos.ts instrumentado hoy — ver
// .specs/_followups/vehiculos-router-otel-spans.md para el resto del router.
const dispositivoAsociacionesCounter = getBusinessCounter('dispositivo_asociaciones_total');
const trazaConsultasCounter = getBusinessCounter('vehiculo_traza_consultas_total');

/** Rango máx defensivo de la ventana de traza (protege query + browser). */
const MAX_RANGO_TRAZA_MS = 31 * 24 * 60 * 60 * 1000;

/** Query de `GET /:id/traza`: ventana ISO + cap de puntos (default 800, máx 2000). */
const trazaQuerySchema = z.object({
  desde: z.string().datetime({ offset: true }),
  hasta: z.string().datetime({ offset: true }),
  maxPuntos: z.coerce.number().int().min(2).max(2000).optional().default(800),
});

export function createVehiculosRoutes(opts: {
  db: Db;
  logger: Logger;
  /** GCP project ID facturado por Weather API (X-Goog-User-Project). Ausente → clima off. */
  weatherProjectId?: string | undefined;
  /** Override del lookup de clima (para tests). Default: cache-wrapped Weather API. */
  obtenerClima?: ((lat: number, lng: number) => Promise<number | null>) | undefined;
}) {
  const app = new Hono();

  // Lookup de temperatura ambiente con caché por celda (TTL 30 min). Si no hay
  // projectId ni override → feature off (siempre null, sin llamadas a la API).
  const weatherProjectId = opts.weatherProjectId;
  const lookupClima: (lat: number, lng: number) => Promise<number | null> =
    opts.obtenerClima ??
    (weatherProjectId
      ? (lat, lng) =>
          obtenerTemperaturaAmbiente({
            lat,
            lng,
            nowMs: Date.now(),
            logger: opts.logger,
            fetchClima: (la, ln) =>
              obtenerClimaActual({
                lat: la,
                lng: ln,
                projectId: weatherProjectId,
                logger: opts.logger,
              }),
          })
      : async () => null);

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

  // Umbral dueno|admin — mismo patrón que admin-dispositivos.ts:37-57
  // (requireAdmin). Compartido por DELETE /:id y PATCH /:id/dispositivo
  // (W2 self-service, más abajo); antes solo lo usaba DELETE (de ahí el
  // nombre previo `requireDeleteRole`, renombrado acá al generalizarse).
  // biome-ignore lint/suspicious/noExplicitAny: hono Context generics complejos
  function requireOwnerOrAdminRole(c: Context<any, any, any>) {
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
  // PATCH /:id/dispositivo — asociar/cambiar/desasociar el IMEI Teltonika
  // del vehículo (W2 self-service, hito 2 CORFO mes 8). La empresa
  // (dueno|admin) gestiona su propio dispositivo sin pasar por el panel
  // `/admin/dispositivos-pendientes`. Primera implementación real de la
  // invariante espejo y primer uso del estado `reemplazado`
  // (.specs/hito-2-corfo-mes-8/{w2-contexto,decisiones}.md).
  //
  // Reconciliación con dispositivos_pendientes (D2/D3 — literal):
  //   ASOCIAR (teltonika_imei no-null), según el row de ese IMEI en pending:
  //     - pendiente   → aprobado (directo).
  //     - reemplazado → aprobado (directo, D3.a: solo `rechazado` exige
  //       confirmar_reasociacion).
  //     - rechazado   → 409 imei_rechazado (con rechazado_en/motivo) salvo
  //       confirmar_reasociacion:true → aprobado + log de override (D2).
  //     - aprobado en OTRO vehículo → 409 imei_en_uso (pre-check derivado +
  //       fallback 23505 real en el UPDATE — race-safe).
  //     - sin row → reconciliacion:'sin_registro' (el enrollment ocurrirá
  //       al conectar, ver imei-auth.ts).
  //   CAMBIAR X→Y / DESASOCIAR (null): el row de X con
  //     status='aprobado' AND assignedToVehicleId=este vehículo → pasa a
  //     `reemplazado`. Se CONSERVA assignedToVehicleId como historial (no
  //     se limpia el FK) — decisión: el dato "quién lo tuvo antes" es útil
  //     para auditoría y no hay necesidad funcional de nulearlo.
  //
  // TOCTOU en la reconciliación de Y (fix — ver
  // PendingDeviceReconciliationConflictError arriba en este archivo): los
  // dos UPDATE que mueven Y a 'aprobado' llevan CAS (status esperado en el
  // WHERE, espejo del patrón de la línea de "reemplazado" de X y de
  // admin-dispositivos.ts:191-216). Si el CAS devuelve 0 filas — otro actor
  // (p.ej. un admin de OTRA empresa rechazando el mismo pending vía D2b)
  // cambió el status entre la SELECT de reconciliación y este UPDATE —, la
  // tx aborta (throw) y el catch de más abajo responde con el estado FRESCO
  // re-leído, nunca sobreescribe silenciosamente una decisión ajena.
  //
  // Observabilidad: log estructurado (igual que antes) + PRIMER span OTel y
  // PRIMERA métrica de negocio de este router (vehiculos.ts no tenía ninguno
  // de los dos en sus otros 7 endpoints — deuda documentada en
  // .specs/_followups/vehiculos-router-otel-spans.md, que toma este endpoint
  // como el patrón a replicar). Atributos del span: SOLO vehiculo_id/
  // empresa_id/reconciliacion — el IMEI completo NO se expone como
  // atributo (el logger estructurado ya lo registra con su propia
  // retención; un atributo de span queda indexado/exportado a Cloud Trace
  // con superficie de acceso más amplia, y ningún span del repo expone hoy
  // un identificador de dispositivo — se prefiere no sentar ese precedente
  // acá). La métrica (`dispositivo_asociaciones_total`) lleva labels
  // resultado/reconciliacion para cubrir TODOS los desenlaces, incluidos
  // los 4xx.
  // ---------------------------------------------------------------------
  app.patch('/:id/dispositivo', zValidator('json', patchDispositivoBodySchema), async (c) => {
    const auth = requireOwnerOrAdminRole(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const empresaId = auth.activeMembership.empresa.id;
    const actorUserId = auth.userContext.user.id;
    const newImei = body.teltonika_imei;

    let resultado = 'error_interno';
    let reconciliacionMetrica = 'ninguna';

    try {
      return await withBusinessSpan(
        {
          name: 'vehiculo.actualizar_dispositivo',
          attributes: { 'booster.vehiculo_id': id, 'booster.empresa_id': empresaId },
        },
        async (span) => {
          return await opts.db.transaction(async (tx) => {
            // TOCTOU: cuando el CAS de reconciliación de Y (abajo) pierde la
            // carrera (0 filas), re-lee el row para responder con el estado
            // REAL en vez de fallar genérico — "nunca silencioso".
            async function reconciliationConflict(
              pendingId: string,
            ): Promise<PendingDeviceReconciliationConflictError> {
              const [fresh] = await tx
                .select({
                  status: pendingDevices.status,
                  notes: pendingDevices.notes,
                  updatedAt: pendingDevices.updatedAt,
                })
                .from(pendingDevices)
                .where(eq(pendingDevices.id, pendingId))
                .limit(1);
              if (fresh?.status === 'rechazado') {
                return new PendingDeviceReconciliationConflictError({
                  kind: 'rechazado',
                  rechazadoEn: fresh.updatedAt,
                  motivo: fresh.notes,
                });
              }
              return new PendingDeviceReconciliationConflictError({
                kind: 'inesperado',
                status: fresh?.status ?? 'ausente',
              });
            }

            const [vehicle] = await tx
              .select({
                id: vehicles.id,
                teltonikaImei: vehicles.teltonikaImei,
                teltonikaImeiEspejo: vehicles.teltonikaImeiEspejo,
                plate: vehicles.plate,
              })
              .from(vehicles)
              .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
              .limit(1);
            if (!vehicle) {
              resultado = 'vehicle_not_found';
              return c.json({ error: 'vehicle_not_found' }, 404);
            }
            const oldImei = vehicle.teltonikaImei;

            // Invariante espejo (schema.ts L804-806): "mutuamente excluyente con
            // teltonika_imei... validado en runtime, no en BD" — hasta hoy ese
            // runtime check no existía en ningún endpoint. Primer enforcement real.
            if (newImei !== null && vehicle.teltonikaImeiEspejo !== null) {
              resultado = 'imei_espejo_activo';
              return c.json({ error: 'imei_espejo_activo', code: 'imei_espejo_activo' }, 422);
            }

            // Reconciliación del IMEI entrante (Y): se busca ANTES de escribir
            // nada para poder cortar en 409 (rechazado sin confirmar) sin dejar
            // writes a medias en la transacción.
            type PendingDeviceRow = Pick<
              typeof pendingDevices.$inferSelect,
              'id' | 'status' | 'notes' | 'updatedAt' | 'assignedToVehicleId'
            >;
            let pendingRow: PendingDeviceRow | undefined;
            if (newImei !== null) {
              [pendingRow] = await tx
                .select({
                  id: pendingDevices.id,
                  status: pendingDevices.status,
                  notes: pendingDevices.notes,
                  updatedAt: pendingDevices.updatedAt,
                  assignedToVehicleId: pendingDevices.assignedToVehicleId,
                })
                .from(pendingDevices)
                .where(eq(pendingDevices.imei, newImei))
                .limit(1);

              if (pendingRow?.status === 'rechazado' && !body.confirmar_reasociacion) {
                resultado = 'imei_rechazado';
                return c.json(
                  {
                    error: 'imei_rechazado',
                    code: 'imei_rechazado',
                    rechazado_en: pendingRow.updatedAt,
                    motivo: pendingRow.notes,
                  },
                  409,
                );
              }

              // Coherencia UNIQUE (D2, verificado): si el pending ya dice
              // 'aprobado' en OTRO vehículo, cortamos acá sin gastar el UPDATE.
              // El catch de 23505 más abajo sigue siendo la defensa de fondo
              // real (race-safe) para cualquier estado que no reflejara esto
              // (pending ausente/desactualizado, condición de carrera genuina).
              if (
                pendingRow?.status === 'aprobado' &&
                pendingRow.assignedToVehicleId !== null &&
                pendingRow.assignedToVehicleId !== vehicle.id
              ) {
                resultado = 'imei_en_uso';
                return c.json({ error: 'imei_en_uso', code: 'imei_en_uso' }, 409);
              }
            }

            let updated: typeof vehicles.$inferSelect | undefined;
            try {
              [updated] = await tx
                .update(vehicles)
                .set({ teltonikaImei: newImei, updatedAt: new Date() })
                .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
                .returning();
            } catch (err) {
              const code = (err as { code?: string }).code;
              if (code === '23505') {
                // Mensaje neutro: NO revela qué otra empresa/patente tiene el IMEI.
                resultado = 'imei_en_uso';
                return c.json({ error: 'imei_en_uso', code: 'imei_en_uso' }, 409);
              }
              throw err;
            }
            if (!updated) {
              resultado = 'vehicle_not_found';
              return c.json({ error: 'vehicle_not_found' }, 404);
            }

            // Row de X (IMEI anterior) → reemplazado. Solo si estaba aprobado y
            // asignado a ESTE vehículo (la condición va en el WHERE: si no
            // matchea, no reemplaza nada — no hay nada que reconciliar).
            let reemplazadoAnterior = false;
            if (oldImei !== null && oldImei !== newImei) {
              const [reemplazado] = await tx
                .update(pendingDevices)
                .set({ status: 'reemplazado', updatedAt: new Date() })
                .where(
                  and(
                    eq(pendingDevices.imei, oldImei),
                    eq(pendingDevices.status, 'aprobado'),
                    eq(pendingDevices.assignedToVehicleId, vehicle.id),
                  ),
                )
                .returning();
              reemplazadoAnterior = Boolean(reemplazado);
            }

            // Row de Y (IMEI nuevo) → reconciliación según su estado previo.
            let reconciliacion: 'aprobado' | 'reaprobado_desde_rechazado' | 'sin_registro' | null =
              null;
            let reasociadoDesde: 'rechazado' | undefined;
            if (newImei !== null) {
              if (!pendingRow) {
                reconciliacion = 'sin_registro';
              } else if (pendingRow.status === 'pendiente' || pendingRow.status === 'reemplazado') {
                // CAS: re-exige en el WHERE el status leído más arriba (ver
                // comentario TOCTOU al inicio de la ruta).
                const [reconciled] = await tx
                  .update(pendingDevices)
                  .set({
                    status: 'aprobado',
                    assignedToVehicleId: vehicle.id,
                    assignedAt: new Date(),
                    assignedByUserId: actorUserId,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(pendingDevices.id, pendingRow.id),
                      inArray(pendingDevices.status, ['pendiente', 'reemplazado']),
                    ),
                  )
                  .returning();
                if (!reconciled) {
                  throw await reconciliationConflict(pendingRow.id);
                }
                reconciliacion = 'aprobado';
              } else if (pendingRow.status === 'rechazado') {
                // Solo se llega acá con confirmar_reasociacion:true — el gate de
                // arriba ya cortó en 409 el caso sin confirmar.
                //
                // CAS: re-exige status='rechazado' en el WHERE (ver
                // comentario TOCTOU al inicio de la ruta) — si 0 filas, el
                // row cambió entre la SELECT de reconciliación y este
                // UPDATE (p.ej. otro admin lo rechazó de nuevo, o ganó otro
                // PATCH concurrente con el mismo override).
                const [reconciled] = await tx
                  .update(pendingDevices)
                  .set({
                    status: 'aprobado',
                    assignedToVehicleId: vehicle.id,
                    assignedAt: new Date(),
                    assignedByUserId: actorUserId,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(pendingDevices.id, pendingRow.id),
                      eq(pendingDevices.status, 'rechazado'),
                    ),
                  )
                  .returning();
                if (!reconciled) {
                  throw await reconciliationConflict(pendingRow.id);
                }
                reconciliacion = 'reaprobado_desde_rechazado';
                reasociadoDesde = 'rechazado';
                opts.logger.warn(
                  {
                    actorUserId,
                    empresaId,
                    vehicleId: vehicle.id,
                    imei: newImei,
                    estadoPrevio: 'rechazado',
                    rechazadoEn: pendingRow.updatedAt,
                    timestamp: new Date().toISOString(),
                  },
                  'override: reasociación de IMEI previamente rechazado (confirmar_reasociacion)',
                );
              } else {
                // pendingRow.status === 'aprobado' asignado a ESTE MISMO
                // vehículo (PATCH idempotente: reenviar el mismo IMEI que ya
                // tenía). Nada que reconciliar, pero no es un error.
                reconciliacion = 'aprobado';
              }
            }

            opts.logger.info(
              {
                actorUserId,
                empresaId,
                vehicleId: vehicle.id,
                plate: vehicle.plate,
                imeiAnterior: oldImei,
                imeiNuevo: newImei,
                reconciliacion,
                reemplazadoAnterior,
              },
              'dispositivo Teltonika actualizado vía self-service (W2)',
            );

            resultado = 'ok';
            reconciliacionMetrica = reconciliacion ?? 'ninguna';
            setResultAttributes(span, {
              'booster.dispositivo.reconciliacion': reconciliacionMetrica,
            });

            return c.json({
              vehicle: serializeVehicle(updated),
              reconciliacion,
              reemplazado_anterior: reemplazadoAnterior,
              ...(reasociadoDesde ? { reasociado_desde: reasociadoDesde } : {}),
            });
          });
        },
      );
    } catch (err) {
      if (err instanceof PendingDeviceReconciliationConflictError) {
        if (err.detail.kind === 'rechazado') {
          resultado = 'imei_rechazado';
          return c.json(
            {
              error: 'imei_rechazado',
              code: 'imei_rechazado',
              rechazado_en: err.detail.rechazadoEn,
              motivo: err.detail.motivo,
            },
            409,
          );
        }
        resultado = 'pending_device_conflict';
        return c.json(
          {
            error: 'pending_device_conflict',
            code: 'pending_device_conflict',
            status: err.detail.status,
          },
          409,
        );
      }
      throw err;
    } finally {
      dispositivoAsociacionesCounter.add(1, {
        resultado,
        reconciliacion: reconciliacionMetrica,
      });
    }
  });

  // ---------------------------------------------------------------------
  // DELETE /:id — soft delete (vehicleStatus = 'retirado').
  // No hard-delete porque vehicles está referenciado por trip_assignments,
  // telemetria_puntos, etc. Borrar rompería integridad.
  // ---------------------------------------------------------------------
  app.delete('/:id', async (c) => {
    const auth = requireOwnerOrAdminRole(c);
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
        tieneSensorTemperatura: vehicles.tieneSensorTemperatura,
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

      const brLat = Number.parseFloat(browserPoint.latitude);
      const brLng = Number.parseFloat(browserPoint.longitude);
      const temperaturaAmbienteBrowser =
        Number.isFinite(brLat) && Number.isFinite(brLng) ? await lookupClima(brLat, brLng) : null;

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
          // D2 — posiciones_movil_conductor no tiene sensores (es GPS del
          // browser del conductor): temperatura y CAN siempre "sin dato".
          temperatura_c: null,
          temperatura_registrada_en: null,
          temperatura_sensor_sospechoso: false,
          can_speed_kmh: null,
          rpm: null,
          fuel_pct: null,
          // Clima ambiente (Google Weather API, cacheado por celda). Es
          // location-based → aplica también al fallback browser_gps.
          temperatura_ambiente_c: temperaturaAmbienteBrowser,
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
        io_data: telemetryPoints.ioData,
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

    // W3+ — temperatura de CARGA (Dallas IO 72) con gating por provisioning.
    // La sanity de varianza mira las últimas lecturas para detectar instalación
    // fallida (0 constante). Query extra SOLO cuando hay sensor cableado (hoy:
    // ningún vehículo → costo cero); con flag off no se consulta.
    let recent72: number[] = [];
    if (vehicle.tieneSensorTemperatura) {
      const recentRows = vehicle.teltonikaImei
        ? await opts.db
            .select({ io_data: telemetryPoints.ioData })
            .from(telemetryPoints)
            .where(eq(telemetryPoints.vehicleId, id))
            .orderBy(desc(telemetryPoints.timestampDevice))
            .limit(SANITY_TEMP_PINGS)
        : await opts.db
            .select({ io_data: telemetryPoints.ioData })
            .from(telemetryPoints)
            .where(eq(telemetryPoints.imei, effectiveImei))
            .orderBy(desc(telemetryPoints.timestampDevice))
            .limit(SANITY_TEMP_PINGS);
      recent72 = recentRows
        .map((r) => extraerRaw72(r.io_data))
        .filter((v): v is number => v !== null);
    }
    const temperatura = resolverTemperaturaCarga({
      ioData: last.io_data,
      timestampDevice: last.timestamp_device,
      tieneSensor: vehicle.tieneSensorTemperatura,
      recent72,
    });
    if (temperatura.temperatura_sensor_sospechoso) {
      opts.logger.warn(
        { vehicleId: id, plate: vehicle.plate, pingsMirados: recent72.length },
        'sensor temperatura sospechoso: flag activo pero IO 72 constante 0 (instalación fallida?)',
      );
    }

    // Clima ambiente (Google Weather API, cacheado por celda) — #616.
    const tlLat = last.latitude != null ? Number.parseFloat(last.latitude) : Number.NaN;
    const tlLng = last.longitude != null ? Number.parseFloat(last.longitude) : Number.NaN;
    const temperaturaAmbiente =
      Number.isFinite(tlLat) && Number.isFinite(tlLng) ? await lookupClima(tlLat, tlLng) : null;

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
        // W3 — temperatura de CARGA (IO 72 Dallas), GATED por
        // `tiene_sensor_temperatura`: sin sonda cableada → temperatura_c null
        // aunque el crudo sea 0 (0°C es lectura válida; ver
        // .specs/sensor-temperatura-flag). + señal de sanity de varianza.
        ...temperatura,
        // W4 — CAN LVCAN en vivo (81 speed, 85 RPM, 89 fuel %). null si el
        // ping no trae CAN (motor apagado / sin adaptador).
        ...extractCan(last.io_data),
        // Clima ambiente (Google Weather API, cacheado por celda geográfica,
        // TTL 30 min; NO se persiste — ToS Maps Platform). null si no hay
        // proyecto configurado, GPS sin fix, o la API falla (degrada).
        temperatura_ambiente_c: temperaturaAmbiente,
      },
    });
  });

  // ---------------------------------------------------------------------
  // GET /:id/traza — historial de recorrido del vehículo en una ventana.
  //
  // Capa 2 (reframe a vehículo): traza real downsampleada + resumen
  // (distancia, duración, y si hay CAN, litros consumidos y km del odómetro
  // CAN). La versión por-carga quedó bloqueada por datos (0 cargas entregadas
  // con telemetría); ver `.specs/vehiculo-traza-historial/`.
  // ---------------------------------------------------------------------
  app.get('/:id/traza', zValidator('query', trazaQuerySchema), async (c) => {
    const auth = requireAuth(c);
    if (!auth.ok) {
      return auth.response;
    }
    const id = c.req.param('id');
    const empresaId = auth.activeMembership.empresa.id;
    const { desde, hasta, maxPuntos } = c.req.valid('query');

    const desdeDate = new Date(desde);
    const hastaDate = new Date(hasta);
    if (hastaDate.getTime() <= desdeDate.getTime()) {
      return c.json({ error: 'rango_invalido', code: 'rango_invalido' }, 400);
    }
    if (hastaDate.getTime() - desdeDate.getTime() > MAX_RANGO_TRAZA_MS) {
      return c.json({ error: 'rango_muy_amplio', code: 'rango_muy_amplio', max_dias: 31 }, 400);
    }

    // Ownership por empresa antes de exponer la traza.
    const [vehicle] = await opts.db
      .select({ id: vehicles.id, plate: vehicles.plate })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.empresaId, empresaId)))
      .limit(1);
    if (!vehicle) {
      return c.json({ error: 'vehicle_not_found' }, 404);
    }

    return await withBusinessSpan(
      {
        name: 'vehiculos.traza',
        attributes: { 'booster.vehicle_id': id, 'booster.traza.max_puntos': maxPuntos },
      },
      async (span) => {
        const traza = await obtenerTrazaVehiculo({
          db: opts.db,
          logger: opts.logger,
          vehicleId: id,
          desde: desdeDate,
          hasta: hastaDate,
          maxPuntos,
        });
        trazaConsultasCounter.add(1, { con_can: traza.resumen.litrosConsumidos !== null });
        setResultAttributes(span, {
          'booster.traza.puntos_total': traza.puntosTotal,
          'booster.traza.puntos_devueltos': traza.puntos.length,
        });
        return c.json({
          vehicle_id: id,
          plate: vehicle.plate,
          desde,
          hasta,
          puntos: traza.puntos.map((p) => ({
            t: new Date(p.tMs).toISOString(),
            lat: p.lat,
            lng: p.lng,
          })),
          puntos_total: traza.puntosTotal,
          puntos_devueltos: traza.puntos.length,
          resumen: {
            distancia_km: traza.resumen.distanciaKm,
            duracion_min: traza.resumen.duracionMin,
            litros_consumidos: traza.resumen.litrosConsumidos,
            km_can: traza.resumen.kmCan,
          },
        });
      },
    );
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

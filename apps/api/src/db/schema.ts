import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * `inet` no es export del core Drizzle PG (lo agregaron en versiones
 * recientes; usamos customType para soportar versiones existentes).
 * Stored as text en TS — Postgres mantiene el tipo nativo INET para
 * indexing/validación.
 */
const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'inet';
  },
});

/**
 * Drizzle schema — Booster AI multi-tenant.
 *
 * Naming bilingüe (ver CLAUDE.md):
 *   - Tablas y columnas en SQL: español snake_case sin tildes
 *   - Exports y campos TS: camelCase inglés
 *   - Enum values: español snake_case sin tildes (excepto siglas)
 *
 * Layout:
 *   - billing/auth: planes, empresas, usuarios, membresias
 *   - capacidades transportista: vehiculos, zonas
 *   - operaciones: viajes, ofertas, asignaciones, eventos_viaje, metricas_viaje
 *   - sostenibilidad: stakeholders, consentimientos
 *   - intake legacy: borradores_whatsapp
 */

// =============================================================================
// ENUMS
// =============================================================================

export const planSlugEnum = pgEnum('plan_slug', ['gratis', 'estandar', 'pro', 'enterprise']);

export const empresaStatusEnum = pgEnum('estado_empresa', [
  'pendiente_verificacion',
  'activa',
  'suspendida',
]);

export const userStatusEnum = pgEnum('estado_usuario', [
  'pendiente_verificacion',
  'activo',
  'suspendido',
  'eliminado',
]);

export const membershipRoleEnum = pgEnum('rol_membresia', [
  'dueno',
  'admin',
  'despachador',
  'conductor',
  'visualizador',
  'stakeholder_sostenibilidad',
]);

export const membershipStatusEnum = pgEnum('estado_membresia', [
  'pendiente_invitacion',
  'activa',
  'suspendida',
  'removida',
]);

export const vehicleTypeEnum = pgEnum('tipo_vehiculo', [
  'camioneta',
  'furgon_pequeno',
  'furgon_mediano',
  'camion_pequeno',
  'camion_mediano',
  'camion_pesado',
  'semi_remolque',
  'refrigerado',
  'tanque',
]);

export const fuelTypeEnum = pgEnum('tipo_combustible', [
  'diesel',
  'gasolina',
  'gas_glp',
  'gas_gnc',
  'electrico',
  'hibrido_diesel',
  'hibrido_gasolina',
  'hidrogeno',
]);

export const vehicleStatusEnum = pgEnum('estado_vehiculo', ['activo', 'mantenimiento', 'retirado']);

export const zoneTypeEnum = pgEnum('tipo_zona', ['recogida', 'entrega', 'ambos']);

export const cargoTypeEnum = pgEnum('tipo_carga', [
  'carga_seca',
  'perecible',
  'refrigerada',
  'congelada',
  'fragil',
  'peligrosa',
  'liquida',
  'construccion',
  'agricola',
  'ganado',
  'otra',
]);

export const tripStatusEnum = pgEnum('estado_viaje', [
  'borrador',
  'esperando_match',
  'emparejando',
  'ofertas_enviadas',
  'asignado',
  'en_proceso',
  'entregado',
  'cancelado',
  'expirado',
]);

export const offerStatusEnum = pgEnum('estado_oferta', [
  'pendiente',
  'aceptada',
  'rechazada',
  'expirada',
  'reemplazada',
]);

export const offerResponseChannelEnum = pgEnum('canal_respuesta_oferta', [
  'web',
  'whatsapp',
  'api',
]);

export const assignmentStatusEnum = pgEnum('estado_asignacion', [
  'asignado',
  'recogido',
  'entregado',
  'cancelado',
]);

export const cancellationActorEnum = pgEnum('actor_cancelacion', [
  'transportista',
  'generador_carga',
  'admin_plataforma',
]);

export const tripEventTypeEnum = pgEnum('tipo_evento_viaje', [
  'intake_iniciado',
  'intake_capturado',
  'matching_iniciado',
  'ofertas_enviadas',
  'oferta_aceptada',
  'oferta_rechazada',
  'oferta_expirada',
  'asignacion_creada',
  'recogida_confirmada',
  'entrega_confirmada',
  'cancelado',
  'carbono_calculado',
  'certificado_emitido',
  'telemetria_primera_recibida',
  'telemetria_perdida',
  'ruta_desviada',
  'disputa_abierta',
]);

export const tripEventSourceEnum = pgEnum('origen_evento_viaje', [
  'web',
  'whatsapp',
  'api',
  'sistema',
]);

export const whatsAppIntakeStatusEnum = pgEnum('estado_intake_whatsapp', [
  'en_progreso',
  'capturado',
  'convertido',
  'abandonado',
  'cancelado',
]);

export const precisionMethodEnum = pgEnum('metodo_precision', [
  'exacto_canbus',
  'modelado',
  'por_defecto',
]);

export const reportingStandardEnum = pgEnum('estandar_reporte', [
  'GLEC_V3',
  'GHG_PROTOCOL',
  'ISO_14064',
  'GRI',
  'SASB',
  'CDP',
]);

export const stakeholderTypeEnum = pgEnum('tipo_stakeholder', [
  'mandante_corporativo',
  'sostenibilidad_interna',
  'auditor',
  'regulador',
  'inversor',
]);

export const reportCadenceEnum = pgEnum('cadencia_reporte', [
  'mensual',
  'trimestral',
  'anual',
  'bajo_demanda',
]);

export const consentScopeTypeEnum = pgEnum('tipo_alcance_consentimiento', [
  'generador_carga',
  'transportista',
  'portafolio_viajes',
  'organizacion',
]);

export const consentDataCategoryEnum = pgEnum('categoria_dato_consentimiento', [
  'emisiones_carbono',
  'rutas',
  'distancias',
  'combustibles',
  'certificados',
  'perfiles_vehiculos',
]);

/**
 * Estado del flujo de aprobación de un dispositivo Teltonika que conectó
 * al gateway pero todavía no está asociado a un vehículo.
 */
export const pendingDeviceStatusEnum = pgEnum('estado_dispositivo_pendiente', [
  'pendiente',
  'aprobado',
  'rechazado',
  'reemplazado',
]);

/**
 * Tipo de mensaje en el chat shipper↔transportista (P3).
 *   - texto: contenido en `texto`.
 *   - foto: URI GCS en `foto_gcs_uri`.
 *   - ubicacion: lat+lng en `ubicacion_lat`+`ubicacion_lng`.
 *
 * El backend valida que solo el campo correspondiente al tipo esté
 * poblado (CHECK constraint en la tabla).
 */
export const chatMessageTypeEnum = pgEnum('tipo_mensaje_chat', ['texto', 'foto', 'ubicacion']);

/**
 * Rol del remitente en el chat. Sigue el patrón de `actor_cancelacion`.
 * Sirve para que el cliente sepa de qué lado renderizar la burbuja sin
 * tener que consultar la membership del sender_user_id.
 */
export const chatSenderRoleEnum = pgEnum('rol_remitente_chat', [
  'transportista',
  'generador_carga',
]);

/**
 * Estado de una subscription Web Push (P3.c). Usado para soft-disable
 * cuando el push service devuelve 410 Gone (subscription expirada o
 * revocada por el browser); en vez de borrar el row, lo marcamos
 * 'inactive' para conservar audit trail. Si el user re-suscribe, se
 * reactiva con un UPSERT por endpoint.
 */
export const pushSubscriptionStatusEnum = pgEnum('estado_push_subscription', [
  'activa',
  'inactiva',
]);

/**
 * Tipos de documento que el indexer persiste. Ver ADR-007 + domain
 * `document.ts`. Mantener en orden con `documentTypeSchema` del shared
 * (TS) — el typecheck no lo fuerza, los tests del package sí.
 */
export const documentTypeEnum = pgEnum('tipo_documento', [
  'dte_guia_despacho',
  'dte_factura',
  'dte_factura_exenta',
  'carta_porte',
  'acta_entrega',
  'certificado_esg',
  'foto_pickup',
  'foto_delivery',
  'firma_receptor',
  'checklist_vehiculo',
  'factura_externa',
  'comprobante_pago',
  'otro',
]);

// =============================================================================
// BILLING / AUTH
// =============================================================================

export const plans = pgTable('planes', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: planSlugEnum('slug').notNull().unique(),
  name: varchar('nombre', { length: 100 }).notNull(),
  description: text('descripcion').notNull(),
  monthlyPriceClp: integer('precio_mensual_clp').notNull(),
  features: jsonb('caracteristicas').notNull(),
  isActive: boolean('es_activo').notNull().default(true),
  createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Empresa = tenant raíz. Una empresa puede ser generador de carga,
 * transportista, o ambos. Incluye perfil ESG (meta de reducción de
 * carbono, certificaciones previas, estándares de reporte requeridos).
 */
export const empresas = pgTable(
  'empresas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalName: varchar('razon_social', { length: 200 }).notNull(),
    rut: varchar('rut', { length: 20 }).notNull().unique(),
    contactEmail: varchar('email_contacto', { length: 255 }).notNull(),
    contactPhone: varchar('telefono_contacto', { length: 20 }).notNull(),
    addressStreet: varchar('direccion_calle', { length: 200 }).notNull(),
    addressCity: varchar('direccion_ciudad', { length: 100 }).notNull(),
    addressRegion: varchar('direccion_region', { length: 4 }).notNull(),
    addressPostalCode: varchar('direccion_codigo_postal', { length: 20 }),
    isGeneradorCarga: boolean('es_generador_carga').notNull().default(false),
    isTransportista: boolean('es_transportista').notNull().default(false),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: empresaStatusEnum('estado').notNull().default('pendiente_verificacion'),
    timezone: varchar('zona_horaria', { length: 50 }).notNull().default('America/Santiago'),
    maxConcurrentOffersOverride: integer('max_ofertas_concurrentes_override'),
    /** Meta declarada de reducción de huella de carbono (% vs baseline). */
    carbonReductionTargetPct: numeric('meta_reduccion_carbono_pct', { precision: 5, scale: 2 }),
    /** Año objetivo de la meta. */
    carbonReductionTargetYear: integer('meta_reduccion_carbono_anio'),
    /** Lista libre de certificaciones declaradas (ISO 14001, B Corp, etc.). */
    priorCertifications: jsonb('certificaciones_previas').notNull().default(sql`'[]'::jsonb`),
    /** Estándares de reporte requeridos por la empresa. */
    requiredReportingStandards: reportingStandardEnum('estandares_reporte_requeridos')
      .array()
      .notNull()
      .default(sql`'{}'::estandar_reporte[]`),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planIdx: index('idx_empresas_plan').on(table.planId),
    statusIdx: index('idx_empresas_estado').on(table.status),
    isGeneradorCargaIdx: index('idx_empresas_es_generador_carga').on(table.isGeneradorCarga),
    isTransportistaIdx: index('idx_empresas_es_transportista').on(table.isTransportista),
  }),
);

/**
 * Usuarios. Auth via Firebase (firebase_uid). Pertenecen a empresas vía
 * memberships.
 */
export const users = pgTable(
  'usuarios',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    firebaseUid: varchar('firebase_uid', { length: 128 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    fullName: varchar('nombre_completo', { length: 200 }).notNull(),
    phone: varchar('telefono', { length: 20 }),
    /** Número WhatsApp del usuario en formato E.164. */
    whatsappE164: varchar('whatsapp_e164', { length: 20 }),
    rut: varchar('rut', { length: 20 }),
    status: userStatusEnum('estado').notNull().default('pendiente_verificacion'),
    isPlatformAdmin: boolean('es_admin_plataforma').notNull().default(false),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('ultimo_login_en', { withTimezone: true }),
  },
  (table) => ({
    firebaseUidIdx: index('idx_usuarios_firebase_uid').on(table.firebaseUid),
    emailIdx: index('idx_usuarios_email').on(table.email),
    statusIdx: index('idx_usuarios_estado').on(table.status),
  }),
);

/**
 * Membership = User pertenece a Empresa con un role. Composite UNIQUE
 * (user_id, empresa_id).
 */
export const memberships = pgTable(
  'membresias',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('usuario_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    role: membershipRoleEnum('rol').notNull(),
    status: membershipStatusEnum('estado').notNull().default('pendiente_invitacion'),
    invitedByUserId: uuid('invitado_por_id').references(() => users.id),
    invitedAt: timestamp('invitado_en', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('unido_en', { withTimezone: true }),
    removedAt: timestamp('removido_en', { withTimezone: true }),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userEmpresaUnique: unique('uq_membresias_usuario_empresa').on(table.userId, table.empresaId),
    userIdx: index('idx_membresias_usuario').on(table.userId),
    empresaIdx: index('idx_membresias_empresa').on(table.empresaId),
    roleIdx: index('idx_membresias_rol').on(table.role),
    statusIdx: index('idx_membresias_estado').on(table.status),
  }),
);

// =============================================================================
// CAPACIDADES TRANSPORTISTA
// =============================================================================

/**
 * Vehículos de un transportista. Cada vehículo pertenece a una empresa.
 * Incluye perfil energético (tipo combustible, peso vacío, consumo
 * baseline) — insumo del carbon-calculator.
 */
export const vehicles = pgTable(
  'vehiculos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    plate: varchar('patente', { length: 12 }).notNull().unique(),
    vehicleType: vehicleTypeEnum('tipo_vehiculo').notNull(),
    capacityKg: integer('capacidad_kg').notNull(),
    capacityM3: integer('capacidad_m3'),
    year: integer('anio'),
    brand: varchar('marca', { length: 50 }),
    model: varchar('modelo', { length: 100 }),
    fuelType: fuelTypeEnum('tipo_combustible'),
    /** Peso en vacío del vehículo, kg. Insumo carbon-calculator. */
    curbWeightKg: integer('peso_vacio_kg'),
    /** Consumo base L/100km a carga normal. Null = no declarado. */
    consumptionLPer100kmBaseline: numeric('consumo_l_por_100km_base', { precision: 5, scale: 2 }),
    teltonikaImei: varchar('teltonika_imei', { length: 20 }).unique(),
    lastInspectionAt: timestamp('ultima_inspeccion_en', { withTimezone: true }),
    inspectionExpiresAt: timestamp('inspeccion_expira_en', { withTimezone: true }),
    vehicleStatus: vehicleStatusEnum('estado_vehiculo').notNull().default('activo'),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    empresaIdx: index('idx_vehiculos_empresa').on(table.empresaId),
    typeIdx: index('idx_vehiculos_tipo').on(table.vehicleType),
    statusIdx: index('idx_vehiculos_estado').on(table.vehicleStatus),
    teltonikaImeiIdx: index('idx_vehiculos_teltonika_imei').on(table.teltonikaImei),
  }),
);

/**
 * Zonas operativas de un transportista. Define dónde puede operar.
 */
export const zones = pgTable(
  'zonas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    regionCode: varchar('codigo_region', { length: 4 }).notNull(),
    /** Códigos comuna DPA INE Chile. NULL = toda la región. */
    comunaCodes: text('codigos_comuna').array(),
    zoneType: zoneTypeEnum('tipo_zona').notNull(),
    isActive: boolean('es_activa').notNull().default(true),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    empresaIdx: index('idx_zonas_empresa').on(table.empresaId),
    regionIdx: index('idx_zonas_region').on(table.regionCode),
    typeIdx: index('idx_zonas_tipo').on(table.zoneType),
  }),
);

// =============================================================================
// OPERACIONES
// =============================================================================

/**
 * Trip request canónico (`viajes` en SQL). Las métricas ESG NO viven acá
 * — tabla aparte `metricas_viaje` (1:1).
 */
export const trips = pgTable(
  'viajes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingCode: varchar('codigo_seguimiento', { length: 12 }).notNull().unique(),
    /** Empresa generador de carga. Null si todavía es draft anónimo (WhatsApp pre-binding). */
    generadorCargaEmpresaId: uuid('generador_carga_empresa_id').references(() => empresas.id),
    /** Para trazabilidad cuando viene por WhatsApp anónimo. */
    generadorCargaWhatsapp: varchar('generador_carga_whatsapp', { length: 20 }),
    createdByUserId: uuid('creado_por_id').references(() => users.id),
    originAddressRaw: text('origen_direccion_raw').notNull(),
    originRegionCode: varchar('origen_codigo_region', { length: 4 }),
    originComunaCode: varchar('origen_codigo_comuna', { length: 10 }),
    destinationAddressRaw: text('destino_direccion_raw').notNull(),
    destinationRegionCode: varchar('destino_codigo_region', { length: 4 }),
    destinationComunaCode: varchar('destino_codigo_comuna', { length: 10 }),
    cargoType: cargoTypeEnum('tipo_carga').notNull(),
    cargoWeightKg: integer('carga_peso_kg'),
    cargoVolumeM3: integer('carga_volumen_m3'),
    cargoDescription: text('carga_descripcion'),
    pickupDateRaw: varchar('recogida_fecha_raw', { length: 200 }).notNull(),
    pickupWindowStart: timestamp('recogida_ventana_inicio', { withTimezone: true }),
    pickupWindowEnd: timestamp('recogida_ventana_fin', { withTimezone: true }),
    /** Precio sugerido por generador de carga o admin. Null si pricing-engine sugerirá. */
    proposedPriceClp: integer('precio_propuesto_clp'),
    status: tripStatusEnum('estado').notNull().default('esperando_match'),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    generadorCargaEmpresaIdx: index('idx_viajes_generador_carga_empresa').on(
      table.generadorCargaEmpresaId,
    ),
    generadorCargaWhatsappIdx: index('idx_viajes_generador_carga_whatsapp').on(
      table.generadorCargaWhatsapp,
    ),
    statusIdx: index('idx_viajes_estado').on(table.status),
    originRegionIdx: index('idx_viajes_origen_region').on(table.originRegionCode),
    createdIdx: index('idx_viajes_creado').on(table.createdAt),
  }),
);

/**
 * Offer = matching engine output, enviada al transportista.
 *
 * UNIQUE (viaje_id, empresa_id): un mismo transportista no recibe dos
 * ofertas para la misma carga.
 */
export const offers = pgTable(
  'ofertas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('viaje_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'restrict' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    suggestedVehicleId: uuid('vehiculo_sugerido_id').references(() => vehicles.id),
    /** Score 0-1 multiplicado por 1000 (entero) para evitar floats. */
    score: integer('puntaje').notNull(),
    status: offerStatusEnum('estado').notNull().default('pendiente'),
    responseChannel: offerResponseChannelEnum('canal_respuesta'),
    rejectionReason: text('razon_rechazo'),
    proposedPriceClp: integer('precio_propuesto_clp').notNull(),
    sentAt: timestamp('enviado_en', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expira_en', { withTimezone: true }).notNull(),
    respondedAt: timestamp('respondido_en', { withTimezone: true }),
    /** Timestamp del envío exitoso del template WhatsApp al transportista. */
    notifiedAt: timestamp('notificado_en', { withTimezone: true }),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tripEmpresaUnique: unique('uq_ofertas_viaje_empresa').on(table.tripId, table.empresaId),
    tripIdx: index('idx_ofertas_viaje').on(table.tripId),
    empresaIdx: index('idx_ofertas_empresa').on(table.empresaId),
    statusIdx: index('idx_ofertas_estado').on(table.status),
    expiresIdx: index('idx_ofertas_expira').on(table.expiresAt),
  }),
);

/**
 * Assignment = offer aceptada. Una sola por viaje (UNIQUE).
 */
export const assignments = pgTable(
  'asignaciones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('viaje_id')
      .notNull()
      .unique()
      .references(() => trips.id, { onDelete: 'restrict' }),
    offerId: uuid('oferta_id')
      .notNull()
      .unique()
      .references(() => offers.id, { onDelete: 'restrict' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    vehicleId: uuid('vehiculo_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    driverUserId: uuid('conductor_id').references(() => users.id),
    status: assignmentStatusEnum('estado').notNull().default('asignado'),
    agreedPriceClp: integer('precio_acordado_clp').notNull(),
    pickupEvidenceUrl: text('evidencia_recogida_url'),
    deliveryEvidenceUrl: text('evidencia_entrega_url'),
    cancelledByActor: cancellationActorEnum('cancelado_por_actor'),
    cancellationReason: text('razon_cancelacion'),
    acceptedAt: timestamp('aceptado_en', { withTimezone: true }).notNull().defaultNow(),
    pickedUpAt: timestamp('recogido_en', { withTimezone: true }),
    deliveredAt: timestamp('entregado_en', { withTimezone: true }),
    cancelledAt: timestamp('cancelado_en', { withTimezone: true }),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    empresaIdx: index('idx_asignaciones_empresa').on(table.empresaId),
    statusIdx: index('idx_asignaciones_estado').on(table.status),
    driverIdx: index('idx_asignaciones_conductor').on(table.driverUserId),
  }),
);

/**
 * TripEvent = log inmutable del lifecycle. Append-only.
 */
export const tripEvents = pgTable(
  'eventos_viaje',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('viaje_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'restrict' }),
    assignmentId: uuid('asignacion_id').references(() => assignments.id),
    eventType: tripEventTypeEnum('tipo_evento').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    source: tripEventSourceEnum('origen').notNull(),
    recordedByUserId: uuid('registrado_por_id').references(() => users.id),
    recordedAt: timestamp('registrado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tripIdx: index('idx_eventos_viaje_viaje').on(table.tripId),
    assignmentIdx: index('idx_eventos_viaje_asignacion').on(table.assignmentId),
    typeIdx: index('idx_eventos_viaje_tipo').on(table.eventType),
    recordedIdx: index('idx_eventos_viaje_registrado').on(table.recordedAt),
  }),
);

/**
 * TripMetrics = métricas ESG por viaje (1:1 con trips). Moat ESG.
 *
 * Estimadas: al confirmar pickup, basadas en perfil del vehículo +
 * distancia planificada.
 *
 * Reales: actualizadas al confirmar entrega con telemetría/datos reales.
 */
export const tripMetrics = pgTable(
  'metricas_viaje',
  {
    tripId: uuid('viaje_id')
      .primaryKey()
      .references(() => trips.id, { onDelete: 'restrict' }),
    distanceKmEstimated: numeric('distancia_km_estimada', { precision: 10, scale: 2 }),
    distanceKmActual: numeric('distancia_km_real', { precision: 10, scale: 2 }),
    carbonEmissionsKgco2eEstimated: numeric('emisiones_kgco2e_estimadas', {
      precision: 10,
      scale: 3,
    }),
    carbonEmissionsKgco2eActual: numeric('emisiones_kgco2e_reales', { precision: 10, scale: 3 }),
    fuelConsumedLEstimated: numeric('combustible_consumido_l_estimado', {
      precision: 10,
      scale: 2,
    }),
    fuelConsumedLActual: numeric('combustible_consumido_l_real', { precision: 10, scale: 2 }),
    precisionMethod: precisionMethodEnum('metodo_precision'),
    glecVersion: varchar('version_glec', { length: 10 }),
    emissionFactorUsed: numeric('factor_emision_usado', { precision: 8, scale: 5 }),
    source: varchar('fuente_datos', { length: 20 }),
    calculatedAt: timestamp('calculado_en', { withTimezone: true }),
    certificatePdfUrl: text('certificado_pdf_url'),
    certificateSha256: char('certificado_sha256', { length: 64 }),
    certificateKmsKeyVersion: varchar('certificado_kms_version', { length: 50 }),
    certificateIssuedAt: timestamp('certificado_emitido_en', { withTimezone: true }),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    precisionIdx: index('idx_metricas_viaje_metodo_precision').on(table.precisionMethod),
    calculatedIdx: index('idx_metricas_viaje_calculado').on(table.calculatedAt),
  }),
);

// =============================================================================
// SOSTENIBILIDAD (Stakeholders + consentimientos)
// =============================================================================

/**
 * Sustainability Stakeholder = mandante / sostenibilidad interna /
 * auditor / regulador / inversor que necesita ver datos ESG agregados o
 * por viaje. Se le otorga acceso vía consentimientos por scope.
 */
export const stakeholders = pgTable(
  'stakeholders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('usuario_id')
      .notNull()
      .references(() => users.id),
    organizationName: varchar('organizacion_nombre', { length: 200 }).notNull(),
    organizationRut: varchar('organizacion_rut', { length: 20 }),
    stakeholderType: stakeholderTypeEnum('tipo_stakeholder').notNull(),
    reportingStandards: reportingStandardEnum('estandares_reporte')
      .array()
      .notNull()
      .default(sql`'{}'::estandar_reporte[]`),
    reportCadence: reportCadenceEnum('cadencia_reporte').notNull().default('bajo_demanda'),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_stakeholders_usuario').on(table.userId),
    typeIdx: index('idx_stakeholders_tipo').on(table.stakeholderType),
  }),
);

export const consents = pgTable(
  'consentimientos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    grantedByUserId: uuid('otorgado_por_id')
      .notNull()
      .references(() => users.id),
    stakeholderId: uuid('stakeholder_id')
      .notNull()
      .references(() => stakeholders.id),
    scopeType: consentScopeTypeEnum('tipo_alcance').notNull(),
    scopeId: uuid('alcance_id').notNull(),
    dataCategories: consentDataCategoryEnum('categorias_datos').array().notNull(),
    grantedAt: timestamp('otorgado_en', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expira_en', { withTimezone: true }),
    revokedAt: timestamp('revocado_en', { withTimezone: true }),
    consentDocumentUrl: text('documento_consentimiento_url').notNull(),
  },
  (table) => ({
    stakeholderIdx: index('idx_consentimientos_stakeholder').on(table.stakeholderId),
    grantedByIdx: index('idx_consentimientos_otorgado_por').on(table.grantedByUserId),
    dataCategoriesCheck: check(
      'consentimientos_categorias_datos_check',
      sql`array_length(${table.dataCategories}, 1) >= 1`,
    ),
  }),
);

// =============================================================================
// INTAKE LEGACY (pre-empresa anonymous WhatsApp)
// =============================================================================

/**
 * Intake draft pre-empresa — viene del bot WhatsApp anónimo. Al binding
 * del generador de carga con una empresa se promueve a `viajes`.
 */
export const whatsAppIntakeDrafts = pgTable(
  'borradores_whatsapp',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingCode: varchar('codigo_seguimiento', { length: 10 }).notNull().unique(),
    generadorCargaWhatsapp: varchar('generador_carga_whatsapp', { length: 20 }).notNull(),
    originAddressRaw: text('origen_direccion_raw').notNull(),
    destinationAddressRaw: text('destino_direccion_raw').notNull(),
    cargoType: cargoTypeEnum('tipo_carga').notNull(),
    pickupDateRaw: varchar('recogida_fecha_raw', { length: 200 }).notNull(),
    status: whatsAppIntakeStatusEnum('estado').notNull().default('capturado'),
    promotedToTripId: uuid('promovido_a_viaje_id').references(() => trips.id),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    generadorCargaIdx: index('idx_borradores_whatsapp_generador_carga').on(
      table.generadorCargaWhatsapp,
    ),
    statusIdx: index('idx_borradores_whatsapp_estado').on(table.status),
    createdIdx: index('idx_borradores_whatsapp_creado').on(table.createdAt),
  }),
);

// =============================================================================
// TELEMETRÍA TELTONIKA (Phase 2)
// =============================================================================

/**
 * Buffer entre "device se conecta al gateway por primera vez" y "admin
 * lo asocia a un vehículo". El gateway hace upsert por IMEI cuando un
 * device conecta sin asociación previa; cantidad_conexiones es proxy
 * de actividad para que el admin priorize.
 */
export const pendingDevices = pgTable(
  'dispositivos_pendientes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    imei: varchar('imei', { length: 20 }).notNull().unique(),
    firstConnectionAt: timestamp('primera_conexion_en', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastConnectionAt: timestamp('ultima_conexion_en', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSourceIp: inet('ultima_ip_origen'),
    connectionCount: integer('cantidad_conexiones').notNull().default(1),
    detectedModel: varchar('modelo_detectado', { length: 50 }),
    status: pendingDeviceStatusEnum('estado').notNull().default('pendiente'),
    assignedToVehicleId: uuid('asignado_a_vehiculo_id').references(() => vehicles.id),
    assignedAt: timestamp('asignado_en', { withTimezone: true }),
    assignedByUserId: uuid('asignado_por_id').references(() => users.id),
    notes: text('notas'),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    statusIdx: index('idx_dispositivos_pendientes_estado').on(table.status),
    lastConnectionIdx: index('idx_dispositivos_pendientes_ultima_conexion').on(
      table.lastConnectionAt,
    ),
  }),
);

/**
 * Un row por record AVL recibido (un punto GPS del Teltonika). Volumen
 * estimado piloto: 1 record/min/device × 50 devices × 30 días ≈ 2.16M
 * rows/mes. Postgres es OK hasta ~10M rows con buenos indexes; migrar
 * a BigQuery si la flota crece >500 devices.
 *
 * io_data jsonb: el codec8-parser entrega {id: value} para todos los
 * IO entries (catalog-agnostic). El catálogo semántico (id 239 =
 * ignición, id 16 = total odometer, etc.) vive en código y se aplica
 * en lectura, no en escritura. Esto permite que devices configurados
 * con IDs distintos se persistan sin loss y el catalog evolucione sin
 * migration de datos.
 */
export const telemetryPoints = pgTable(
  'telemetria_puntos',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    vehicleId: uuid('vehiculo_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    imei: varchar('imei', { length: 20 }).notNull(),
    timestampDevice: timestamp('timestamp_device', { withTimezone: true }).notNull(),
    timestampReceivedAt: timestamp('timestamp_recibido_en', { withTimezone: true })
      .notNull()
      .defaultNow(),
    priority: smallint('prioridad').notNull(),
    longitude: numeric('longitud', { precision: 10, scale: 7 }),
    latitude: numeric('latitud', { precision: 10, scale: 7 }),
    altitudeM: smallint('altitud_m'),
    angleDeg: smallint('rumbo_deg'),
    satellites: smallint('satelites'),
    speedKmh: smallint('velocidad_kmh'),
    eventIoId: integer('event_io_id'),
    ioData: jsonb('io_data').notNull().default(sql`'{}'::jsonb`),
  },
  (table) => ({
    imeiTsUnique: unique('uq_telemetria_imei_ts').on(table.imei, table.timestampDevice),
    vehicleTsIdx: index('idx_telemetria_vehiculo_ts').on(table.vehicleId, table.timestampDevice),
    imeiTsIdx: index('idx_telemetria_imei_ts').on(table.imei, table.timestampDevice),
    vehicleReceivedIdx: index('idx_telemetria_vehiculo_recibido').on(
      table.vehicleId,
      table.timestampReceivedAt,
    ),
    priorityCheck: check('prioridad_check', sql`${table.priority} IN (0, 1, 2)`),
  }),
);

// =============================================================================
// CHAT (P3) — comunicación shipper↔transportista por assignment
// =============================================================================

/**
 * Mensajes de chat dentro del contexto de un assignment.
 *
 * Diseño:
 *   - 1 chat = 1 assignment. Cuando el assignment cierra (status='entregado'
 *     o 'cancelado'), el chat queda read-only (la lógica de write está en
 *     el endpoint POST, que valida el status del assignment antes de aceptar).
 *   - Cada mensaje tiene 1 sender (empresa + user) + 1 tipo (texto / foto /
 *     ubicación). El campo correspondiente al tipo es notNull; los otros
 *     son null. CHECK constraint enforza esto a nivel DB.
 *   - `read_at` se setea cuando el OTRO lado del chat marca el mensaje
 *     como leído. Permite contar no-leídos por (assignment, role) con un
 *     simple count(*) WHERE read_at IS NULL AND sender_role <> :role.
 *   - `whatsapp_notif_sent_at` lo usa el cron de fallback (P3.d) para
 *     evitar mandar el WhatsApp dos veces si el cron corre múltiples veces.
 *
 * Audit: no agregamos updated_at — los mensajes son inmutables una vez
 * enviados (no edit, no soft-delete). Si en el futuro queremos "borrar
 * para mí" o "borrar para todos", agregar `deleted_at` notNull a default
 * '1970-01-01' o algo así, con un nuevo enum.
 */
export const chatMessages = pgTable(
  'mensajes_chat',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('asignacion_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'restrict' }),
    senderEmpresaId: uuid('remitente_empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    senderUserId: uuid('remitente_usuario_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    senderRole: chatSenderRoleEnum('rol_remitente').notNull(),
    messageType: chatMessageTypeEnum('tipo_mensaje').notNull(),
    /** Solo poblado si messageType='texto'. Hasta 4000 chars (límite generoso). */
    textContent: text('texto'),
    /**
     * Solo poblado si messageType='foto'. URI gs:// (o https:// si en el
     * futuro servimos via signed URL pre-cacheada). El cliente pide signed
     * URL al endpoint para mostrar la imagen.
     */
    photoGcsUri: text('foto_gcs_uri'),
    /** Solo poblado si messageType='ubicacion'. WGS84 decimal degrees. */
    locationLat: numeric('ubicacion_lat', { precision: 9, scale: 6 }),
    locationLng: numeric('ubicacion_lng', { precision: 9, scale: 6 }),
    /**
     * Timestamp en que el OTRO lado del chat marcó este mensaje como leído.
     * Null = no leído todavía. El propio sender NO marca sus mensajes (eso
     * sería trivialmente leído por uno mismo).
     */
    readAt: timestamp('leido_en', { withTimezone: true }),
    /**
     * Timestamp en que el cron de fallback (P3.d) mandó la notificación
     * WhatsApp por este mensaje no leído. Null = no se mandó (todavía no
     * pasaron 5 min, o el destinatario lo leyó antes, o el push notif
     * cubrió). Sirve para idempotencia del cron.
     */
    whatsappNotifSentAt: timestamp('whatsapp_notif_enviado_en', { withTimezone: true }),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Index principal: traer mensajes de un chat ordenados desc para paginación.
    assignmentCreatedIdx: index('idx_mensajes_chat_asignacion_creado').on(
      table.assignmentId,
      table.createdAt,
    ),
    // Index para el query del cron de fallback WhatsApp (P3.d).
    unreadOldIdx: index('idx_mensajes_chat_no_leidos_viejos').on(
      table.readAt,
      table.whatsappNotifSentAt,
      table.createdAt,
    ),
    // CHECK: el campo correspondiente al tipo debe estar notNull, los otros
    // null. Defensa-en-profundidad — el endpoint POST también valida.
    typeContentCheck: check(
      'tipo_contenido_check',
      sql`(
        (${table.messageType} = 'texto' AND ${table.textContent} IS NOT NULL
          AND ${table.photoGcsUri} IS NULL
          AND ${table.locationLat} IS NULL AND ${table.locationLng} IS NULL)
        OR
        (${table.messageType} = 'foto' AND ${table.photoGcsUri} IS NOT NULL
          AND ${table.textContent} IS NULL
          AND ${table.locationLat} IS NULL AND ${table.locationLng} IS NULL)
        OR
        (${table.messageType} = 'ubicacion'
          AND ${table.locationLat} IS NOT NULL AND ${table.locationLng} IS NOT NULL
          AND ${table.textContent} IS NULL
          AND ${table.photoGcsUri} IS NULL)
      )`,
    ),
    // CHECK: texto entre 1 y 4000 chars cuando aplica.
    textLengthCheck: check(
      'texto_length_check',
      sql`${table.textContent} IS NULL OR (length(${table.textContent}) BETWEEN 1 AND 4000)`,
    ),
    // CHECK: lat/lng en rangos WGS84 válidos cuando aplica.
    locationRangeCheck: check(
      'ubicacion_rango_check',
      sql`(${table.locationLat} IS NULL AND ${table.locationLng} IS NULL)
        OR (${table.locationLat} BETWEEN -90 AND 90 AND ${table.locationLng} BETWEEN -180 AND 180)`,
    ),
  }),
);

/**
 * Subscriptions Web Push (P3.c) — una row por user × device.
 *
 * El browser registra una "subscription" con su push service (FCM Web,
 * Mozilla autopush, etc.) y nos da:
 *   - endpoint: URL del push service donde POSTear la notificación.
 *   - p256dh: ECDH public key del browser (para encriptar el payload).
 *   - auth: secret compartido (para validar la integridad).
 *
 * El api mantiene esto en DB y al insertar un mensaje de chat, hace
 * lookup de las subscriptions del destinatario (el OTRO lado del chat)
 * y manda push a cada endpoint via la lib `web-push` con VAPID JWT.
 *
 * Múltiples devices: un mismo user puede tener varias subscriptions
 * (PWA en celular + browser desktop). Cada una se identifica por su
 * endpoint único; UPSERT por (user_id, endpoint) evita duplicados al
 * re-suscribirse.
 *
 * Cleanup: si el push service devuelve 410 Gone, marcamos como
 * 'inactive' (el browser revocó). El user puede re-suscribir y
 * volvemos a 'activa'.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('usuario_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * URL del push service (provider-specific). Ej. para Chrome:
     * https://fcm.googleapis.com/wp/[id]. Es el campo "natural key" de
     * la subscription — usamos UNIQUE para que UPSERT por endpoint sea
     * atómico.
     */
    endpoint: text('endpoint').notNull(),
    /**
     * Public key ECDH del browser, base64url-encoded. La librería
     * web-push la usa para derivar el shared secret y encriptar el
     * payload.
     */
    p256dhKey: text('p256dh_key').notNull(),
    /**
     * Auth secret del browser, base64url-encoded. Usado por web-push
     * en el HMAC del payload encriptado.
     */
    authKey: text('auth_key').notNull(),
    /**
     * User-agent del browser al momento de subscribir. Útil para que el
     * user pueda identificar "esta es mi laptop" vs "este es mi
     * teléfono" en /perfil al ofrecer disable.
     */
    userAgent: text('user_agent'),
    status: pushSubscriptionStatusEnum('estado').notNull().default('activa'),
    /** Timestamp del último 410 Gone recibido (para auditoría). */
    lastFailedAt: timestamp('ultimo_fallo_en', { withTimezone: true }),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    endpointUnique: unique('uq_push_subscriptions_endpoint').on(table.endpoint),
    userActiveIdx: index('idx_push_subscriptions_user_activa').on(table.userId, table.status),
  }),
);

/**
 * Índice de documentos. Ver ADR-007 "Gestión Documental Obligatoria Chile".
 *
 * Esta tabla NO almacena el contenido (eso vive en GCS) — sólo el
 * metadata indexable. El bucket es config-driven y único por ambiente
 * (`booster-ai-documents-{env}`); aquí guardamos sólo el `gcs_path`
 * relativo.
 *
 * `retention_until` es null para tipos sin obligación legal (ej. fotos
 * operacionales). Para los `dte_*`, `carta_porte` y `acta_entrega` el
 * indexer setea `emitido_en + 6 años`; el bucket aplica Object Retention
 * Lock con esa misma ventana.
 *
 * `folio_sii` y `rut_emisor` solo aplican a DTEs. Indexados juntos para
 * lookup rápido por (rut_emisor, folio_sii) que es el "natural key" de
 * un DTE en el sistema del SII.
 */
export const documents = pgTable(
  'documentos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    tripId: uuid('viaje_id').references(() => trips.id, { onDelete: 'set null' }),
    type: documentTypeEnum('tipo').notNull(),
    /** Path relativo al bucket. Bucket viene del config (`DOCUMENTS_BUCKET`). */
    gcsPath: text('gcs_path').notNull(),
    /** SHA-256 hex (64 chars). Verificación de integridad post-download. */
    sha256: char('sha256', { length: 64 }).notNull(),
    mimeType: varchar('mime_type', { length: 127 }).notNull(),
    sizeBytes: integer('tamano_bytes').notNull(),
    /** Folio asignado por el SII; sólo para DTEs. */
    folioSii: varchar('folio_sii', { length: 40 }),
    /** RUT del emisor del DTE (en formato SII: NNNNNNNN-D). */
    rutEmisor: varchar('rut_emisor', { length: 12 }),
    emittedByUserId: uuid('emitido_por_usuario_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    emittedAt: timestamp('emitido_en', { withTimezone: true }).notNull().defaultNow(),
    /** NULL = sin retención legal. Set automáticamente por el indexer. */
    retentionUntil: timestamp('retencion_hasta', { withTimezone: true }),
    /** Si existe una versión PII-redacted lista para compartir externamente. */
    piiRedactedCopy: boolean('copia_pii_redactada').notNull().default(false),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('creado_en', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('actualizado_en', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * UNIQUE de DTEs por (rut_emisor, folio_sii). Postgres considera
     * NULLs distintos por default, asi que docs no-DTE (folio NULL)
     * conviven sin colisión.
     */
    folioUnique: unique('uq_documentos_rut_folio').on(table.rutEmisor, table.folioSii),
    empresaIdx: index('idx_documentos_empresa').on(table.empresaId),
    tripIdx: index('idx_documentos_viaje').on(table.tripId),
    typeIdx: index('idx_documentos_tipo').on(table.type),
    emittedIdx: index('idx_documentos_emitido_en').on(table.emittedAt),
    retentionIdx: index('idx_documentos_retencion').on(table.retentionUntil),
    sha256Chk: check('chk_documentos_sha256_hex', sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  }),
);

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PlanRow = typeof plans.$inferSelect;
export type NewPlanRow = typeof plans.$inferInsert;
export type EmpresaRow = typeof empresas.$inferSelect;
export type NewEmpresaRow = typeof empresas.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type MembershipRow = typeof memberships.$inferSelect;
export type NewMembershipRow = typeof memberships.$inferInsert;
export type VehicleRow = typeof vehicles.$inferSelect;
export type NewVehicleRow = typeof vehicles.$inferInsert;
export type ZoneRow = typeof zones.$inferSelect;
export type NewZoneRow = typeof zones.$inferInsert;
export type TripRow = typeof trips.$inferSelect;
export type NewTripRow = typeof trips.$inferInsert;
export type OfferRow = typeof offers.$inferSelect;
export type NewOfferRow = typeof offers.$inferInsert;
export type AssignmentRow = typeof assignments.$inferSelect;
export type NewAssignmentRow = typeof assignments.$inferInsert;
export type TripEventRow = typeof tripEvents.$inferSelect;
export type NewTripEventRow = typeof tripEvents.$inferInsert;
export type TripMetricsRow = typeof tripMetrics.$inferSelect;
export type NewTripMetricsRow = typeof tripMetrics.$inferInsert;
export type StakeholderRow = typeof stakeholders.$inferSelect;
export type NewStakeholderRow = typeof stakeholders.$inferInsert;
export type ConsentRow = typeof consents.$inferSelect;
export type NewConsentRow = typeof consents.$inferInsert;
export type WhatsAppIntakeRow = typeof whatsAppIntakeDrafts.$inferSelect;
export type NewWhatsAppIntakeRow = typeof whatsAppIntakeDrafts.$inferInsert;
export type PendingDeviceRow = typeof pendingDevices.$inferSelect;
export type NewPendingDeviceRow = typeof pendingDevices.$inferInsert;
export type TelemetryPointRow = typeof telemetryPoints.$inferSelect;
export type NewTelemetryPointRow = typeof telemetryPoints.$inferInsert;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessageRow = typeof chatMessages.$inferInsert;
export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionRow = typeof pushSubscriptions.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;

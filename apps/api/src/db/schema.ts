import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Drizzle schema — Booster AI multi-tenant.
 *
 * Layout:
 *   - billing/auth: plans, empresas, users, memberships
 *   - carrier capabilities: vehicles, zones
 *   - operations: trip_requests, offers, assignments, trip_events
 *   - legacy intake (pre-empresa anonymous): whatsapp_intake_drafts
 *
 * Cambios de schema: usar drizzle-kit generate + incluir en drizzle/ y
 * aplicar automáticamente al startup (ver db/migrator.ts con advisory lock).
 */

// =============================================================================
// ENUMS
// =============================================================================

export const planSlugEnum = pgEnum('plan_slug', ['free', 'standard', 'pro', 'enterprise']);

export const empresaStatusEnum = pgEnum('empresa_status', [
  'pending_verification',
  'active',
  'suspended',
]);

export const userStatusEnum = pgEnum('user_status', [
  'pending_verification',
  'active',
  'suspended',
  'deleted',
]);

export const membershipRoleEnum = pgEnum('membership_role', [
  'owner',
  'admin',
  'dispatcher',
  'driver',
  'viewer',
]);

export const membershipStatusEnum = pgEnum('membership_status', [
  'pending_invitation',
  'active',
  'suspended',
  'removed',
]);

export const vehicleTypeEnum = pgEnum('vehicle_type', [
  'pickup', // camioneta
  'truck_3_4', // camión 3/4
  'truck_dry', // camión seco
  'truck_reefer', // camión refrigerado
  'semi_trailer', // semi-remolque
  'flatbed', // batea
  'tank', // estanque
  'container', // portacontenedor
  'other',
]);

export const zoneTypeEnum = pgEnum('zone_type', ['pickup', 'delivery', 'both']);

export const cargoTypeEnum = pgEnum('cargo_type', [
  'dry_goods',
  'perishable',
  'refrigerated',
  'frozen',
  'fragile',
  'dangerous',
  'liquid',
  'construction',
  'agricultural',
  'livestock',
  'other',
]);

export const tripRequestStatusEnum = pgEnum('trip_request_status', [
  'draft', // intake incompleto
  'pending_match', // listo, esperando matching engine
  'matching', // matching corriendo
  'offers_sent', // offers enviadas, esperando respuesta carrier
  'assigned', // un carrier aceptó (Assignment creada)
  'in_progress', // pickup confirmado
  'delivered', // entrega confirmada
  'cancelled', // shipper, carrier o admin canceló
  'expired', // sin matches después de TTL global
]);

export const offerStatusEnum = pgEnum('offer_status', [
  'pending',
  'accepted',
  'rejected',
  'expired',
  'superseded',
]);

export const offerResponseChannelEnum = pgEnum('offer_response_channel', [
  'web',
  'whatsapp',
  'api',
]);

export const assignmentStatusEnum = pgEnum('assignment_status', [
  'assigned',
  'picked_up',
  'delivered',
  'cancelled',
]);

export const cancellationActorEnum = pgEnum('cancellation_actor', [
  'carrier',
  'shipper',
  'platform_admin',
]);

export const tripEventTypeEnum = pgEnum('trip_event_type', [
  'intake_started',
  'intake_captured',
  'matching_started',
  'offers_sent',
  'offer_accepted',
  'offer_rejected',
  'offer_expired',
  'assignment_created',
  'pickup_confirmed',
  'delivery_confirmed',
  'cancelled',
]);

export const tripEventSourceEnum = pgEnum('trip_event_source', [
  'web',
  'whatsapp',
  'api',
  'system',
]);

export const whatsAppIntakeStatusEnum = pgEnum('whatsapp_intake_status', [
  'in_progress',
  'captured',
  'converted',
  'abandoned',
  'cancelled',
]);

// =============================================================================
// BILLING / AUTH
// =============================================================================

/**
 * Planes de suscripción. Cargados con seeds (free / standard / pro / enterprise).
 * `features` es un JSONB con los flags definidos en
 * @booster-ai/shared-schemas → planFeaturesSchema.
 */
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: planSlugEnum('slug').notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description').notNull(),
  monthlyPriceClp: integer('monthly_price_clp').notNull(),
  features: jsonb('features').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Empresa = tenant raíz. Una empresa puede ser shipper, carrier, o ambos.
 */
export const empresas = pgTable(
  'empresas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legalName: varchar('legal_name', { length: 200 }).notNull(),
    rut: varchar('rut', { length: 20 }).notNull().unique(),
    contactEmail: varchar('contact_email', { length: 255 }).notNull(),
    contactPhone: varchar('contact_phone', { length: 20 }).notNull(),
    addressStreet: varchar('address_street', { length: 200 }).notNull(),
    addressCity: varchar('address_city', { length: 100 }).notNull(),
    addressRegion: varchar('address_region', { length: 4 }).notNull(),
    addressPostalCode: varchar('address_postal_code', { length: 20 }),
    isShipper: boolean('is_shipper').notNull().default(false),
    isCarrier: boolean('is_carrier').notNull().default(false),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: empresaStatusEnum('status').notNull().default('pending_verification'),
    timezone: varchar('timezone', { length: 50 }).notNull().default('America/Santiago'),
    maxConcurrentOffersOverride: integer('max_concurrent_offers_override'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    planIdx: index('idx_empresas_plan').on(table.planId),
    statusIdx: index('idx_empresas_status').on(table.status),
    isShipperIdx: index('idx_empresas_is_shipper').on(table.isShipper),
    isCarrierIdx: index('idx_empresas_is_carrier').on(table.isCarrier),
  }),
);

/**
 * Usuarios. Auth via Firebase (firebase_uid). Pertenecen a empresas vía
 * memberships.
 *
 * `is_platform_admin` indica staff de Booster (no empresa cliente). Da
 * acceso al admin console y bypass de empresa-scoping en ciertos endpoints.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    firebaseUid: varchar('firebase_uid', { length: 128 }).notNull().unique(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    fullName: varchar('full_name', { length: 200 }).notNull(),
    phone: varchar('phone', { length: 20 }),
    rut: varchar('rut', { length: 20 }),
    status: userStatusEnum('status').notNull().default('pending_verification'),
    isPlatformAdmin: boolean('is_platform_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => ({
    firebaseUidIdx: index('idx_users_firebase_uid').on(table.firebaseUid),
    emailIdx: index('idx_users_email').on(table.email),
    statusIdx: index('idx_users_status').on(table.status),
  }),
);

/**
 * Membership = User pertenece a Empresa con un role. Composite UNIQUE
 * (user_id, empresa_id) — un user no puede tener dos memberships en la
 * misma empresa.
 */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    role: membershipRoleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('pending_invitation'),
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id),
    invitedAt: timestamp('invited_at', { withTimezone: true }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userEmpresaUnique: unique('uq_memberships_user_empresa').on(table.userId, table.empresaId),
    userIdx: index('idx_memberships_user').on(table.userId),
    empresaIdx: index('idx_memberships_empresa').on(table.empresaId),
    roleIdx: index('idx_memberships_role').on(table.role),
    statusIdx: index('idx_memberships_status').on(table.status),
  }),
);

// =============================================================================
// CARRIER CAPABILITIES
// =============================================================================

/**
 * Vehículos de un carrier. Cada vehículo pertenece a una empresa carrier.
 */
export const vehicles = pgTable(
  'vehicles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    plate: varchar('plate', { length: 12 }).notNull().unique(),
    vehicleType: vehicleTypeEnum('vehicle_type').notNull(),
    capacityKg: integer('capacity_kg').notNull(),
    /** Volumen máximo en m³ (null si el vehículo no aplica — ej. tanker). */
    capacityM3: integer('capacity_m3'),
    /** Año del vehículo (para cálculo de huella de carbono base). */
    yearManufactured: integer('year_manufactured'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    empresaIdx: index('idx_vehicles_empresa').on(table.empresaId),
    typeIdx: index('idx_vehicles_type').on(table.vehicleType),
    activeIdx: index('idx_vehicles_active').on(table.isActive),
  }),
);

/**
 * Zonas operativas de un carrier. Cada empresa carrier define dónde
 * puede operar (regiones de Chile, opcionalmente por comunas).
 */
export const zones = pgTable(
  'zones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    regionCode: varchar('region_code', { length: 4 }).notNull(),
    /** Array de codigos comuna DPA INE Chile. NULL = toda la región. */
    comunaCodes: text('comuna_codes').array(),
    zoneType: zoneTypeEnum('zone_type').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    empresaIdx: index('idx_zones_empresa').on(table.empresaId),
    regionIdx: index('idx_zones_region').on(table.regionCode),
    typeIdx: index('idx_zones_type').on(table.zoneType),
  }),
);

// =============================================================================
// OPERATIONS
// =============================================================================

/**
 * Trip request canónico. Reemplaza whatsapp_intake_drafts como entidad
 * principal — los drafts WhatsApp se promueven a trip_requests cuando el
 * shipper queda identificado con una empresa.
 */
export const tripRequests = pgTable(
  'trip_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingCode: varchar('tracking_code', { length: 12 }).notNull().unique(),
    /** Empresa shipper. Null si todavía es draft anónimo (WhatsApp pre-binding). */
    shipperEmpresaId: uuid('shipper_empresa_id').references(() => empresas.id),
    /** Para trazabilidad cuando el shipper viene por WhatsApp anónimo. */
    shipperWhatsapp: varchar('shipper_whatsapp', { length: 20 }),
    /** User que creó el request (member dispatcher del shipper o anónimo WA). */
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    originAddressRaw: text('origin_address_raw').notNull(),
    originRegionCode: varchar('origin_region_code', { length: 4 }),
    originComunaCode: varchar('origin_comuna_code', { length: 10 }),
    destinationAddressRaw: text('destination_address_raw').notNull(),
    destinationRegionCode: varchar('destination_region_code', { length: 4 }),
    destinationComunaCode: varchar('destination_comuna_code', { length: 10 }),
    cargoType: cargoTypeEnum('cargo_type').notNull(),
    cargoWeightKg: integer('cargo_weight_kg'),
    cargoVolumeM3: integer('cargo_volume_m3'),
    cargoDescription: text('cargo_description'),
    pickupDateRaw: varchar('pickup_date_raw', { length: 200 }).notNull(),
    pickupWindowStart: timestamp('pickup_window_start', { withTimezone: true }),
    pickupWindowEnd: timestamp('pickup_window_end', { withTimezone: true }),
    /** Precio sugerido por shipper o admin. Null si pricing-engine sugerirá. */
    proposedPriceClp: integer('proposed_price_clp'),
    status: tripRequestStatusEnum('status').notNull().default('pending_match'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shipperEmpresaIdx: index('idx_trip_requests_shipper_empresa').on(table.shipperEmpresaId),
    shipperWaIdx: index('idx_trip_requests_shipper_wa').on(table.shipperWhatsapp),
    statusIdx: index('idx_trip_requests_status').on(table.status),
    originRegionIdx: index('idx_trip_requests_origin_region').on(table.originRegionCode),
    createdIdx: index('idx_trip_requests_created').on(table.createdAt),
  }),
);

/**
 * Offer = matching engine output, enviada al carrier.
 *
 * UNIQUE (trip_request_id, empresa_id): un mismo carrier no puede recibir
 * dos ofertas para la misma carga.
 */
export const offers = pgTable(
  'offers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripRequestId: uuid('trip_request_id')
      .notNull()
      .references(() => tripRequests.id, { onDelete: 'restrict' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    suggestedVehicleId: uuid('suggested_vehicle_id').references(() => vehicles.id),
    /** Score 0-1 calculado por matching engine. Audit, no se muestra al carrier. */
    score: integer('score').notNull(), // multiplicado por 1000 para evitar floats
    status: offerStatusEnum('status').notNull().default('pending'),
    responseChannel: offerResponseChannelEnum('response_channel'),
    rejectionReason: text('rejection_reason'),
    proposedPriceClp: integer('proposed_price_clp').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tripRequestEmpresaUnique: unique('uq_offers_trip_empresa').on(
      table.tripRequestId,
      table.empresaId,
    ),
    tripRequestIdx: index('idx_offers_trip_request').on(table.tripRequestId),
    empresaIdx: index('idx_offers_empresa').on(table.empresaId),
    statusIdx: index('idx_offers_status').on(table.status),
    expiresIdx: index('idx_offers_expires').on(table.expiresAt),
  }),
);

/**
 * Assignment = offer aceptada. Una sola por trip_request (UNIQUE).
 */
export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripRequestId: uuid('trip_request_id')
      .notNull()
      .unique()
      .references(() => tripRequests.id, { onDelete: 'restrict' }),
    offerId: uuid('offer_id')
      .notNull()
      .unique()
      .references(() => offers.id, { onDelete: 'restrict' }),
    empresaId: uuid('empresa_id')
      .notNull()
      .references(() => empresas.id, { onDelete: 'restrict' }),
    vehicleId: uuid('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    driverUserId: uuid('driver_user_id').references(() => users.id),
    status: assignmentStatusEnum('status').notNull().default('assigned'),
    agreedPriceClp: integer('agreed_price_clp').notNull(),
    pickupEvidenceUrl: text('pickup_evidence_url'),
    deliveryEvidenceUrl: text('delivery_evidence_url'),
    cancelledByActor: cancellationActorEnum('cancelled_by_actor'),
    cancellationReason: text('cancellation_reason'),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    pickedUpAt: timestamp('picked_up_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    empresaIdx: index('idx_assignments_empresa').on(table.empresaId),
    statusIdx: index('idx_assignments_status').on(table.status),
    driverIdx: index('idx_assignments_driver').on(table.driverUserId),
  }),
);

/**
 * TripEvent = log inmutable del lifecycle. Append-only.
 */
export const tripEvents = pgTable(
  'trip_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripRequestId: uuid('trip_request_id')
      .notNull()
      .references(() => tripRequests.id, { onDelete: 'restrict' }),
    assignmentId: uuid('assignment_id').references(() => assignments.id),
    eventType: tripEventTypeEnum('event_type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    source: tripEventSourceEnum('source').notNull(),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tripRequestIdx: index('idx_trip_events_trip_request').on(table.tripRequestId),
    assignmentIdx: index('idx_trip_events_assignment').on(table.assignmentId),
    typeIdx: index('idx_trip_events_type').on(table.eventType),
    recordedIdx: index('idx_trip_events_recorded').on(table.recordedAt),
  }),
);

// =============================================================================
// LEGACY INTAKE (pre-empresa anonymous WhatsApp)
// =============================================================================

/**
 * Intake draft pre-empresa — viene del bot WhatsApp anónimo. Cuando el
 * shipper queda identificado con una empresa, se promueve a trip_request.
 *
 * Mantenido como tabla separada para no contaminar trip_requests con
 * drafts incompletos. Ver decisión original en task #45 (slice WhatsApp
 * Fase 6).
 */
export const whatsAppIntakeDrafts = pgTable(
  'whatsapp_intake_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingCode: varchar('tracking_code', { length: 10 }).notNull().unique(),
    shipperWhatsapp: varchar('shipper_whatsapp', { length: 20 }).notNull(),
    originAddressRaw: text('origin_address_raw').notNull(),
    destinationAddressRaw: text('destination_address_raw').notNull(),
    cargoType: cargoTypeEnum('cargo_type').notNull(),
    pickupDateRaw: varchar('pickup_date_raw', { length: 200 }).notNull(),
    status: whatsAppIntakeStatusEnum('status').notNull().default('captured'),
    /** Si el draft fue promovido a trip_request, este FK queda lleno. */
    promotedToTripRequestId: uuid('promoted_to_trip_request_id').references(() => tripRequests.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    shipperIdx: index('idx_whatsapp_intake_shipper').on(table.shipperWhatsapp),
    statusIdx: index('idx_whatsapp_intake_status').on(table.status),
    createdIdx: index('idx_whatsapp_intake_created').on(table.createdAt),
  }),
);

// =============================================================================
// TYPE EXPORTS — para usar en handlers y queries
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
export type TripRequestRow = typeof tripRequests.$inferSelect;
export type NewTripRequestRow = typeof tripRequests.$inferInsert;
export type OfferRow = typeof offers.$inferSelect;
export type NewOfferRow = typeof offers.$inferInsert;
export type AssignmentRow = typeof assignments.$inferSelect;
export type NewAssignmentRow = typeof assignments.$inferInsert;
export type TripEventRow = typeof tripEvents.$inferSelect;
export type NewTripEventRow = typeof tripEvents.$inferInsert;
export type WhatsAppIntakeRow = typeof whatsAppIntakeDrafts.$inferSelect;
export type NewWhatsAppIntakeRow = typeof whatsAppIntakeDrafts.$inferInsert;
